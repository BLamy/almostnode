import { FFmpeg } from "@ffmpeg/ffmpeg";
import type {
  ShellCommandContext,
  ShellCommandDefinition,
  ShellCommandResult,
} from "@agent-wasm/core";

/**
 * `ffmpeg` / `ffprobe` shell commands backed by ffmpeg.wasm (@ffmpeg/ffmpeg +
 * the GPL @ffmpeg/core).
 *
 * Unlike vim.wasm, ffmpeg is headless: it reads/writes files in its own
 * Emscripten MEMFS and logs to stderr. So it maps cleanly onto a shell command
 * — no UI overlay. Each invocation:
 *   1. resolves file args (inputs after `-i`, the trailing positional output,
 *      and any `-o` outputs) against the shell cwd,
 *   2. copies inputs from almostnode's VirtualFS into ffmpeg's MEMFS,
 *   3. runs `exec`/`ffprobe`, streaming ffmpeg's log to stderr,
 *   4. copies produced outputs back into the VirtualFS (where the explorer and
 *      Monaco pick them up via `change` events).
 *
 * The 31 MB core is loaded once and the FFmpeg worker is reused across
 * invocations; ffmpeg runs single-threaded so no SharedArrayBuffer is required.
 */

// Injected by defines in vite.config.ts (served by `ffmpegCoreAssets()`).
declare const __FFMPEG_CORE_URL__: string;
declare const __FFMPEG_WASM_URL__: string;

const CORE_URL =
  typeof __FFMPEG_CORE_URL__ === "string"
    ? __FFMPEG_CORE_URL__
    : "/ffmpeg-core/ffmpeg-core.js";
const WASM_URL =
  typeof __FFMPEG_WASM_URL__ === "string"
    ? __FFMPEG_WASM_URL__
    : "/ffmpeg-core/ffmpeg-core.wasm";

// Paths that aren't real files — leave them untouched and don't read them back.
const SINKS = new Set(["-", "/dev/null", "null", "nul", "pipe:"]);

// A single shared worker/core is reused across commands; ffmpeg.wasm is a
// single-threaded worker so only one command may run at a time.
let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;
let running = false;

async function getFfmpeg(onFirstLoad: () => void): Promise<FFmpeg> {
  if (ffmpegInstance) {
    return ffmpegInstance;
  }
  if (!loadPromise) {
    loadPromise = (async () => {
      onFirstLoad();
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({ coreURL: CORE_URL, wasmURL: WASM_URL });
      ffmpegInstance = ffmpeg;
      return ffmpeg;
    })().catch((error) => {
      loadPromise = null; // allow a retry on the next invocation
      throw error;
    });
  }
  return loadPromise;
}

function normalizePosix(path: string): string {
  const out: string[] = [];
  for (const segment of path.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return `/${out.join("/")}`;
}

function resolvePath(arg: string, cwd: string): string {
  return arg.startsWith("/")
    ? normalizePosix(arg)
    : normalizePosix(`${cwd}/${arg}`);
}

/** A collision-free MEMFS name derived from a VFS path's basename. */
function fsNameFor(vfsPath: string, used: Set<string>): string {
  const base = vfsPath.split("/").pop() || "file";
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "_") || "file";
  let candidate = safe;
  let n = 1;
  while (used.has(candidate)) {
    candidate = `${n++}_${safe}`;
  }
  used.add(candidate);
  return candidate;
}

interface MappedFile {
  original: string;
  vfsPath: string;
  fsName: string;
}

interface FilePlan {
  mappedArgs: string[];
  inputs: MappedFile[];
  outputs: MappedFile[];
}

/**
 * Identify which argv tokens are files and map them to MEMFS names:
 * - inputs: the token after each `-i`, but ONLY when it names a file that
 *   exists in the VFS. Virtual sources (`-f lavfi -i testsrc=…`, `color=…`),
 *   URLs, and sinks are left untouched so ffmpeg handles them (and reports its
 *   own "No such file" for genuinely missing inputs).
 * - outputs: the token after each `-o`, plus the trailing positional (ffmpeg's
 *   conventional single output).
 */
function planFiles(
  args: string[],
  cwd: string,
  exists: (vfsPath: string) => boolean,
): FilePlan {
  const inputIdx = new Set<number>();
  const outputIdx = new Set<number>();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "-i" && i + 1 < args.length) inputIdx.add(i + 1);
    if (args[i] === "-o" && i + 1 < args.length) outputIdx.add(i + 1);
  }
  const last = args.length - 1;
  if (
    last >= 0 &&
    !args[last]!.startsWith("-") &&
    !inputIdx.has(last) &&
    !outputIdx.has(last) &&
    !SINKS.has(args[last]!)
  ) {
    outputIdx.add(last);
  }

  const used = new Set<string>();
  const mappedArgs = [...args];
  const inputs: MappedFile[] = [];
  const outputs: MappedFile[] = [];

  const mapToken = (
    index: number,
    bucket: MappedFile[],
    requireExisting: boolean,
  ) => {
    const original = args[index]!;
    if (SINKS.has(original) || original.includes("://")) return;
    const vfsPath = resolvePath(original, cwd);
    // Inputs must be real VFS files; a non-existent `-i` value is a virtual
    // source (lavfi/color/…) or a missing file — pass it through untouched.
    if (requireExisting && !exists(vfsPath)) return;
    const fsName = fsNameFor(vfsPath, used);
    mappedArgs[index] = fsName;
    bucket.push({ original, vfsPath, fsName });
  };

  for (const i of inputIdx) mapToken(i, inputs, true);
  for (const i of outputIdx) mapToken(i, outputs, false);
  return { mappedArgs, inputs, outputs };
}

function ancestorDirs(path: string): string[] {
  const parts = path.split("/").slice(0, -1).filter(Boolean);
  const dirs: string[] = [];
  let acc = "";
  for (const part of parts) {
    acc += `/${part}`;
    dirs.push(acc);
  }
  return dirs;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function runFfmpeg(
  kind: "ffmpeg" | "ffprobe",
  args: string[],
  ctx: ShellCommandContext,
): Promise<ShellCommandResult> {
  if (running) {
    return {
      stdout: "",
      stderr: `${kind}: another ffmpeg process is already running\n`,
      exitCode: 1,
    };
  }
  running = true;

  let ffmpeg: FFmpeg;
  try {
    ffmpeg = await getFfmpeg(() =>
      ctx.writeStderr("Loading ffmpeg-core (first run, ~31 MB)…\n"),
    );
  } catch (error) {
    running = false;
    return {
      stdout: "",
      stderr: `${kind}: failed to load ffmpeg core: ${errorMessage(error)}\n`,
      exitCode: 1,
    };
  }

  // ffmpeg logs to stderr, matching the native tool.
  const onLog = ({ message }: { type: string; message: string }) => {
    ctx.writeStderr(`${message}\n`);
  };
  ffmpeg.on("log", onLog);

  const stagedFsFiles: string[] = [];
  try {
    const plan = planFiles(args, ctx.cwd, (path) => ctx.vfs.existsSync(path));

    // plan.inputs only contains files that exist in the VFS; virtual sources
    // and genuinely-missing inputs are passed through for ffmpeg to handle.
    for (const input of plan.inputs) {
      await ffmpeg.writeFile(input.fsName, ctx.vfs.readFileSync(input.vfsPath));
      stagedFsFiles.push(input.fsName);
    }

    // `-y` overwrites outputs already sitting in the reused MEMFS; a user `-n`
    // later in argv still wins.
    const execArgs = kind === "ffmpeg" ? ["-y", ...plan.mappedArgs] : plan.mappedArgs;
    const exitCode =
      kind === "ffprobe"
        ? await ffmpeg.ffprobe(execArgs, -1, { signal: ctx.signal })
        : await ffmpeg.exec(execArgs, -1, { signal: ctx.signal });

    if (exitCode === 0) {
      for (const output of plan.outputs) {
        let data: Uint8Array;
        try {
          data = (await ffmpeg.readFile(output.fsName, "binary")) as Uint8Array;
        } catch {
          continue; // command produced no such output — nothing to copy back
        }
        stagedFsFiles.push(output.fsName);
        for (const dir of ancestorDirs(output.vfsPath)) {
          if (!ctx.vfs.existsSync(dir)) {
            ctx.vfs.mkdirSync(dir, { recursive: true });
          }
        }
        ctx.vfs.writeFileSync(output.vfsPath, data);
      }
    }

    return { stdout: "", stderr: "", exitCode };
  } catch (error) {
    if (
      ctx.signal?.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      return { stdout: "", stderr: "", exitCode: 130 };
    }
    return { stdout: "", stderr: `${kind}: ${errorMessage(error)}\n`, exitCode: 1 };
  } finally {
    ffmpeg.off("log", onLog);
    for (const name of stagedFsFiles) {
      try {
        await ffmpeg.deleteFile(name);
      } catch {
        // best-effort MEMFS cleanup
      }
    }
    running = false;
  }
}

/**
 * `ffmpeg` and `ffprobe` shell commands, ready to pass to
 * `container.registerShellCommand`.
 */
export function createFfmpegShellCommands(): ShellCommandDefinition[] {
  return [
    {
      name: "ffmpeg",
      execute: (args, ctx) => runFfmpeg("ffmpeg", args, ctx),
    },
    {
      name: "ffprobe",
      execute: (args, ctx) => runFfmpeg("ffprobe", args, ctx),
    },
  ];
}
