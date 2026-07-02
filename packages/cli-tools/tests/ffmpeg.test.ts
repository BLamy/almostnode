// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// A fake @ffmpeg/ffmpeg whose MEMFS is a Map. `exec` emits a log line and
// "produces" its output (last positional arg) so we can assert the round-trip.
const hoisted = vi.hoisted(() => {
  const state = { instances: [] as MockFFmpeg[] };
  class MockFFmpeg {
    loaded = false;
    loadConfig: unknown = null;
    fs = new Map<string, Uint8Array>();
    logCallbacks = new Set<(d: { type: string; message: string }) => void>();
    writes: Array<{ path: string; data: Uint8Array }> = [];
    execCalls: string[][] = [];
    deletes: string[] = [];
    constructor() {
      state.instances.push(this);
    }
    on(event: string, cb: (d: { type: string; message: string }) => void) {
      if (event === "log") this.logCallbacks.add(cb);
    }
    off(event: string, cb: (d: { type: string; message: string }) => void) {
      if (event === "log") this.logCallbacks.delete(cb);
    }
    async load(config: unknown) {
      this.loaded = true;
      this.loadConfig = config;
    }
    async writeFile(path: string, data: Uint8Array) {
      this.fs.set(path, data);
      this.writes.push({ path, data });
      return true;
    }
    async readFile(path: string) {
      if (!this.fs.has(path)) throw new Error(`ENOENT: ${path}`);
      return this.fs.get(path)!;
    }
    async deleteFile(path: string) {
      this.fs.delete(path);
      this.deletes.push(path);
      return true;
    }
    async exec(args: string[]) {
      this.execCalls.push(args);
      for (const cb of this.logCallbacks) cb({ type: "stderr", message: "frame=1 fps=0" });
      const out = args[args.length - 1];
      if (out && !out.startsWith("-")) {
        this.fs.set(out, new TextEncoder().encode("TRANSCODED"));
      }
      return 0;
    }
    async ffprobe(args: string[]) {
      this.execCalls.push(args);
      for (const cb of this.logCallbacks) cb({ type: "stderr", message: "Duration: 00:00:01.00" });
      return 0;
    }
  }
  return { state, MockFFmpeg };
});

vi.mock("@ffmpeg/ffmpeg", () => ({ FFmpeg: hoisted.MockFFmpeg }));

import { createFfmpegShellCommands } from "../src/index";

interface FakeVfs {
  files: Map<string, Uint8Array>;
  dirs: Set<string>;
  existsSync(path: string): boolean;
  readFileSync(path: string): Uint8Array;
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, data: string | Uint8Array): void;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

function createFakeVfs(initial: Record<string, string> = {}): FakeVfs {
  const files = new Map<string, Uint8Array>();
  for (const [path, content] of Object.entries(initial)) {
    files.set(path, new TextEncoder().encode(content));
  }
  return {
    files,
    dirs: new Set<string>(["/", "/project"]),
    existsSync(path: string) {
      return files.has(path) || this.dirs.has(path);
    },
    readFileSync(path: string, encoding?: "utf8") {
      const bytes = files.get(path) ?? new Uint8Array();
      return encoding === "utf8" ? new TextDecoder().decode(bytes) : bytes;
    },
    writeFileSync(path: string, data: string | Uint8Array) {
      files.set(
        path,
        typeof data === "string" ? new TextEncoder().encode(data) : data,
      );
    },
    mkdirSync(path: string) {
      this.dirs.add(path);
    },
  } as FakeVfs;
}

function makeCtx(vfs: FakeVfs, cwd = "/project") {
  const stderr: string[] = [];
  const stdout: string[] = [];
  return {
    ctx: {
      cwd,
      env: {},
      stdin: "",
      vfs,
      writeStdout: (d: string) => stdout.push(d),
      writeStderr: (d: string) => stderr.push(d),
      setEnv: () => {},
      getEnv: () => ({}),
      setCwd: () => {},
      exec: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
    } as unknown as Parameters<
      ReturnType<typeof createFfmpegShellCommands>[number]["execute"]
    >[1],
    stderr,
    stdout,
  };
}

const OPTS = {
  coreURL: "/ffmpeg-core/ffmpeg-core.js",
  wasmURL: "/ffmpeg-core/ffmpeg-core.wasm",
};

function getCommand(name: "ffmpeg" | "ffprobe") {
  const cmd = createFfmpegShellCommands(OPTS).find((c) => c.name === name);
  if (!cmd) throw new Error(`command ${name} not registered`);
  return cmd;
}

beforeEach(() => {
  const inst = hoisted.state.instances.at(-1);
  if (inst) {
    inst.writes.length = 0;
    inst.execCalls.length = 0;
    inst.deletes.length = 0;
    inst.fs.clear();
  }
});

describe("ffmpeg shell command", () => {
  it("registers ffmpeg and ffprobe", () => {
    expect(createFfmpegShellCommands(OPTS).map((c) => c.name).sort()).toEqual([
      "ffmpeg",
      "ffprobe",
    ]);
  });

  it("passes the served core/wasm URLs to FFmpeg.load()", async () => {
    const vfs = createFakeVfs({ "/project/in.mp4": "RAW" });
    const { ctx } = makeCtx(vfs);
    await getCommand("ffmpeg").execute(["-i", "in.mp4", "out.webm"], ctx);
    expect(hoisted.state.instances.at(-1)!.loadConfig).toEqual(OPTS);
  });

  it("stages the input from the VFS, runs, and writes the output back", async () => {
    const vfs = createFakeVfs({ "/project/input.mp4": "RAWVIDEO" });
    const { ctx, stderr } = makeCtx(vfs);

    const result = await getCommand("ffmpeg").execute(
      ["-i", "input.mp4", "output.webm"],
      ctx,
    );

    expect(result.exitCode).toBe(0);
    const ffmpeg = hoisted.state.instances.at(-1)!;
    expect(ffmpeg.writes[0]?.data).toEqual(new TextEncoder().encode("RAWVIDEO"));

    const execArgs = ffmpeg.execCalls.at(-1)!;
    expect(execArgs[0]).toBe("-y");
    expect(execArgs).toContain("-i");
    expect(execArgs).toContain("input.mp4");
    expect(execArgs[execArgs.length - 1]).toBe("output.webm");

    expect(vfs.files.has("/project/output.webm")).toBe(true);
    expect(new TextDecoder().decode(vfs.files.get("/project/output.webm")!)).toBe(
      "TRANSCODED",
    );
    expect(stderr.join("")).toContain("frame=1");
    expect(ffmpeg.fs.size).toBe(0);
  });

  it("resolves relative paths against the shell cwd", async () => {
    const vfs = createFakeVfs({ "/project/sub/in.wav": "AUDIO" });
    vfs.dirs.add("/project/sub");
    const { ctx } = makeCtx(vfs, "/project/sub");

    const result = await getCommand("ffmpeg").execute(
      ["-i", "in.wav", "../out.mp3"],
      ctx,
    );
    expect(result.exitCode).toBe(0);
    expect(vfs.files.has("/project/out.mp3")).toBe(true);
  });

  it("passes virtual sources (lavfi) through unchanged instead of staging them", async () => {
    const vfs = createFakeVfs();
    const { ctx } = makeCtx(vfs);

    const result = await getCommand("ffmpeg").execute(
      ["-f", "lavfi", "-i", "testsrc=duration=1:size=64x64:rate=1", "out.mp4"],
      ctx,
    );

    expect(result.exitCode).toBe(0);
    const ffmpeg = hoisted.state.instances.at(-1)!;
    expect(ffmpeg.writes).toHaveLength(0);
    expect(ffmpeg.execCalls.at(-1)).toContain("testsrc=duration=1:size=64x64:rate=1");
    expect(vfs.files.has("/project/out.mp4")).toBe(true);
  });

  it("streams ffprobe output to stderr", async () => {
    const vfs = createFakeVfs({ "/project/clip.mp4": "RAWVIDEO" });
    const { ctx, stderr } = makeCtx(vfs);

    const result = await getCommand("ffprobe").execute(["-i", "clip.mp4"], ctx);
    expect(result.exitCode).toBe(0);
    expect(stderr.join("")).toContain("Duration");
  });
});
