import { EventEmitter } from "../../../../packages/almostnode/src/shims/events.ts";
import path from "path";
import { PassThrough } from "stream";
import { _vfs_addDir, _vfs_getFile, _vfs_readdir } from "../../../../vendor/opencode/packages/browser/src/shims/fs.browser.ts";
import { listWorkspaceFiles, searchWorkspaceFiles } from "./opencode-ripgrep-shared.ts";

export interface BrowserProcessBridge {
  exec(input: {
    command: string;
    args: string[];
    cwd?: string;
    env?: Record<string, string>;
    stdin?: string;
    shell?: boolean | string;
    signal?: AbortSignal;
  }): Promise<{ stdout: string; stderr: string; code: number }>;
}

let processBridge: BrowserProcessBridge | null = null;

export function attachProcessBridge(bridge: BrowserProcessBridge): void {
  processBridge = bridge;
}

export function detachProcessBridge(): void {
  processBridge = null;
}

class FakeChildProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  stdin = new PassThrough();
  pid = 1;
  exitCode: number | null = null;
  killed = false;

  kill(_signal?: string | number) {
    this.killed = true;
    this.exitCode = 137;
    this.stdout.end();
    this.stderr.end();
    this.emit("exit", 137, "SIGTERM");
    this.emit("close", 137, "SIGTERM");
  }
}

function normalizeSpawnInput(
  command: string,
  argsOrOpts?: string[] | Record<string, unknown>,
  maybeOpts?: Record<string, unknown>,
): { args: string[]; opts: Record<string, unknown> } {
  if (Array.isArray(argsOrOpts)) {
    return { args: argsOrOpts, opts: maybeOpts || {} };
  }

  return { args: [], opts: argsOrOpts || {} };
}

function isRgCommand(command: string): boolean {
  const base = path.posix.basename(command).toLowerCase();
  return base === "rg" || base === "rg.exe";
}

function normalizeSearchPath(input: string | undefined, cwd: string): string {
  if (!input || input === ".") {
    return cwd;
  }
  if (input.startsWith("/")) {
    return input;
  }
  return path.posix.join(cwd, input);
}

function parseRipgrepArgs(args: string[], cwd: string) {
  const glob: string[] = [];
  let searchRoot = cwd;
  let hidden = false;
  let maxDepth: number | undefined;
  let limit: number | undefined;
  let pattern: string | undefined;
  let json = false;
  let separator = ":";
  let filesMode = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--files") {
      filesMode = true;
      continue;
    }
    if (arg === "--hidden") {
      hidden = true;
      continue;
    }
    if (arg === "--json") {
      json = true;
      continue;
    }
    if (arg.startsWith("--glob=")) {
      glob.push(arg.slice("--glob=".length));
      continue;
    }
    if (arg === "--glob") {
      const next = args[index + 1];
      if (next) {
        glob.push(next);
        index += 1;
      }
      continue;
    }
    if (arg.startsWith("--max-depth=")) {
      maxDepth = Number(arg.slice("--max-depth=".length));
      continue;
    }
    if (arg.startsWith("--max-count=")) {
      limit = Number(arg.slice("--max-count=".length));
      continue;
    }
    if (arg.startsWith("--field-match-separator=")) {
      separator = arg.slice("--field-match-separator=".length);
      continue;
    }
    if (arg === "--regexp") {
      pattern = args[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--") {
      pattern = args[index + 1];
      break;
    }
    if (!arg.startsWith("-")) {
      if (filesMode || pattern) {
        searchRoot = normalizeSearchPath(arg, cwd);
      } else if (!pattern) {
        pattern = arg;
      }
    }
  }

  return {
    filesMode,
    searchRoot,
    hidden,
    maxDepth,
    limit,
    pattern,
    json,
    separator,
    glob,
  };
}

function runRipgrep(args: string[], cwd: string): { stdout: string; stderr: string; code: number } {
  try {
    const parsed = parseRipgrepArgs(args, cwd);

    if (parsed.filesMode) {
      const files = listWorkspaceFiles({
        cwd: parsed.searchRoot,
        glob: parsed.glob,
        hidden: parsed.hidden,
        maxDepth: parsed.maxDepth,
      }).map((file) => file.relativePath);

      return {
        stdout: files.join("\n") + (files.length > 0 ? "\n" : ""),
        stderr: "",
        code: 0,
      };
    }

    if (!parsed.pattern) {
      return { stdout: "", stderr: "rg: missing pattern", code: 2 };
    }

    const matches = searchWorkspaceFiles({
      cwd: parsed.searchRoot,
      pattern: parsed.pattern,
      glob: parsed.glob,
      hidden: parsed.hidden,
      limit: parsed.limit,
    });

    if (matches.length === 0) {
      return { stdout: "", stderr: "", code: 1 };
    }

    if (parsed.json) {
      return {
        stdout:
          matches
            .map((match) =>
              JSON.stringify({
                type: "match",
                data: {
                  path: { text: match.absolutePath },
                  lines: { text: `${match.lineText}\n` },
                  line_number: match.lineNumber,
                  absolute_offset: match.absoluteOffset,
                  submatches: match.submatches.map((entry) => ({
                    match: { text: entry.text },
                    start: entry.start,
                    end: entry.end,
                  })),
                },
              }),
            )
            .join("\n") + "\n",
        stderr: "",
        code: 0,
      };
    }

    return {
      stdout:
        matches
          .map((match) => `${match.absolutePath}${parsed.separator}${match.lineNumber}${parsed.separator}${match.lineText}`)
          .join("\n") + "\n",
      stderr: "",
      code: 0,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { stdout: "", stderr: message, code: 2 };
  }
}

async function executeCommand(
  command: string,
  args: string[],
  opts: Record<string, unknown> = {},
): Promise<{ stdout: string; stderr: string; code: number }> {
  const cwd = typeof opts.cwd === "string" ? opts.cwd : "/workspace";

  if (isRgCommand(command)) {
    return runRipgrep(args, cwd);
  }

  if (processBridge) {
    return processBridge.exec({
      command,
      args,
      cwd,
      env: typeof opts.env === "object" && opts.env ? (opts.env as Record<string, string>) : undefined,
      stdin: typeof opts.input === "string" ? opts.input : undefined,
      shell: typeof opts.shell === "string" || typeof opts.shell === "boolean" ? opts.shell : undefined,
      signal: opts.signal instanceof AbortSignal ? opts.signal : undefined,
    });
  }

  if ((command === "sh" || command === "bash") && args[0] === "-c" && args[1]) {
    return executeCommand(args[1], [], { ...opts, shell: true });
  }

  if (opts.shell) {
    return {
      stdout: "",
      stderr: `[browser sandbox] Shell execution is unavailable for '${command}'.`,
      code: 127,
    };
  }

  if (command === "echo") {
    return { stdout: `${args.join(" ")}\n`, stderr: "", code: 0 };
  }

  if (command === "cat") {
    const content = _vfs_getFile(normalizeSearchPath(args[0], cwd));
    if (content !== undefined) {
      return { stdout: content, stderr: "", code: 0 };
    }
    return { stdout: "", stderr: `cat: ${args[0]}: No such file or directory`, code: 1 };
  }

  if (command === "ls") {
    try {
      const dir = normalizeSearchPath(args[0] || cwd, cwd);
      const entries = _vfs_readdir(dir);
      return { stdout: `${entries.map((entry) => entry.name).join("\n")}\n`, stderr: "", code: 0 };
    } catch {
      return { stdout: "", stderr: `ls: cannot access '${args[0]}': No such file or directory`, code: 1 };
    }
  }

  if (command === "pwd") {
    return { stdout: `${cwd}\n`, stderr: "", code: 0 };
  }

  if (command === "mkdir") {
    for (const arg of args.filter((value) => !value.startsWith("-"))) {
      _vfs_addDir(normalizeSearchPath(arg, cwd));
    }
    return { stdout: "", stderr: "", code: 0 };
  }

  if (command === "which" || command === "where") {
    return { stdout: "", stderr: `${args[0]}: not found`, code: 1 };
  }

  return {
    stdout: "",
    stderr: `[browser sandbox] Command '${[command, ...args].join(" ")}' is unavailable without a host bridge.`,
    code: 127,
  };
}

export async function runBrowserCommand(input: {
  command: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  shell?: boolean | string;
  signal?: AbortSignal;
}): Promise<{ stdout: string; stderr: string; code: number }> {
  return executeCommand(input.command, input.args ?? [], {
    cwd: input.cwd,
    env: input.env,
    input: input.stdin,
    shell: input.shell,
    signal: input.signal,
  });
}

export function spawn(command: string, argsOrOpts?: unknown, maybeOpts?: Record<string, unknown>): FakeChildProcess {
  const { args, opts } = normalizeSpawnInput(command, argsOrOpts as string[] | Record<string, unknown>, maybeOpts);
  const child = new FakeChildProcess();

  setTimeout(async () => {
    try {
      const result = await executeCommand(command, args, opts);
      if (result.stdout) {
        child.stdout.end(result.stdout);
      } else {
        child.stdout.end();
      }
      if (result.stderr) {
        child.stderr.end(result.stderr);
      } else {
        child.stderr.end();
      }
      child.exitCode = result.code;
      child.emit("exit", result.code, null);
      child.emit("close", result.code, null);
    } catch (error) {
      child.stderr.end(error instanceof Error ? error.message : String(error));
      child.stdout.end();
      child.exitCode = 1;
      child.emit("exit", 1, null);
      child.emit("close", 1, null);
    }
  }, 0);

  return child;
}

export function execSync(command: string): string {
  return `[browser] Command not available: ${command}`;
}

export function exec(command: string, callback?: Function): FakeChildProcess {
  const child = spawn("sh", ["-c", command]);
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data: Buffer | string) => {
    stdout += data.toString();
  });
  child.stderr.on("data", (data: Buffer | string) => {
    stderr += data.toString();
  });
  child.on("close", (code: number) => {
    if (callback) {
      callback(code ? new Error(stderr) : null, stdout, stderr);
    }
  });
  return child;
}

export function execFile(file: string, args: string[], opts: unknown, callback?: Function): FakeChildProcess {
  if (typeof opts === "function") {
    callback = opts;
  }
  return exec(`${file} ${args.join(" ")}`, callback);
}

export function fork(): never {
  throw new Error("fork() not available in browser");
}

export function spawnSync(command: string, args: string[] = []) {
  if (isRgCommand(command)) {
    const result = runRipgrep(args, "/workspace");
    return {
      status: result.code,
      stdout: Buffer.from(result.stdout),
      stderr: Buffer.from(result.stderr),
      error: null,
    };
  }

  return {
    status: 0,
    stdout: Buffer.from(`[browser] ${command} ${args.join(" ")}`),
    stderr: Buffer.from(""),
    error: null,
  };
}

export default {
  spawn,
  exec,
  execSync,
  execFile,
  fork,
  spawnSync,
  attachProcessBridge,
  detachProcessBridge,
};
