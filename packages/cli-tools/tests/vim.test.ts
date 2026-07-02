// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

interface VimInstance {
  onVimInit?: () => void;
  onVimExit?: (status: number) => void;
  onFileExport?: (fullpath: string, contents: ArrayBuffer) => void;
  onError?: (err: Error) => void;
  opts: { workerScriptPath: string };
  startOpts: {
    files?: Record<string, string>;
    dirs?: string[];
    cmdArgs?: string[];
  } | null;
}

// The mock class lives inside vi.hoisted so it exists when the hoisted vi.mock
// factory runs.
const hoisted = vi.hoisted(() => {
  const instances: VimInstance[] = [];
  class MockVimWasm implements VimInstance {
    onVimInit?: () => void;
    onVimExit?: (status: number) => void;
    onFileExport?: (fullpath: string, contents: ArrayBuffer) => void;
    onError?: (err: Error) => void;
    readonly opts: { workerScriptPath: string };
    startOpts: VimInstance["startOpts"] = null;
    constructor(opts: { workerScriptPath: string }) {
      this.opts = opts;
      instances.push(this);
    }
    start(opts: VimInstance["startOpts"]) {
      this.startOpts = opts;
    }
    resize() {}
    isRunning() {
      return true;
    }
    cmdline() {
      return Promise.resolve();
    }
    showError() {
      return Promise.resolve();
    }
    focus() {}
  }
  return {
    instances,
    MockVimWasm,
    checkBrowserCompatibility: vi.fn<() => string | undefined>(() => undefined),
  };
});

vi.mock("vim-wasm", () => ({
  VimWasm: hoisted.MockVimWasm,
  checkBrowserCompatibility: hoisted.checkBrowserCompatibility,
}));

import {
  createVimShellCommands,
  getVimWasmUnsupportedReason,
  runVimTerminalSession,
} from "../src/index";

interface FakeVfs {
  files: Map<string, string>;
  dirs: Set<string>;
  existsSync(path: string): boolean;
  readFileSync(path: string, encoding: "utf8"): string;
  writeFileSync(path: string, data: string | Uint8Array): void;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
}

function createFakeVfs(initial: Record<string, string> = {}): FakeVfs {
  const files = new Map(Object.entries(initial));
  const dirs = new Set<string>(["/", "/project"]);
  return {
    files,
    dirs,
    existsSync: (path) => files.has(path) || dirs.has(path),
    readFileSync: (path) => files.get(path) ?? "",
    writeFileSync: (path, data) => {
      files.set(
        path,
        typeof data === "string" ? data : new TextDecoder().decode(data),
      );
    },
    mkdirSync: (path) => {
      dirs.add(path);
    },
  };
}

const BASE = "/vim-wasm/";

beforeEach(() => {
  hoisted.instances.length = 0;
  hoisted.checkBrowserCompatibility.mockReturnValue(undefined);
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  (globalThis as unknown as { Worker: unknown }).Worker = class {};
});

describe("runVimTerminalSession", () => {
  it("preloads the file from the vfs and opens the full build for `vim`", async () => {
    const vfs = createFakeVfs({ "/work/hello.txt": "hi there" });
    const host = document.createElement("div");
    document.body.appendChild(host);

    const promise = runVimTerminalSession({
      host,
      vfs,
      absPath: "/work/hello.txt",
      variant: "vim",
      vimWasmBaseUrl: BASE,
    });

    const vim = hoisted.instances[0]!;
    expect(vim.startOpts?.files).toEqual({ "/work/hello.txt": "hi there" });
    expect(vim.startOpts?.cmdArgs).toEqual(["/work/hello.txt"]);
    expect(vim.startOpts?.dirs).toContain("/work");
    expect(vim.opts.workerScriptPath).toBe("/vim-wasm/vim.js");

    vim.onVimExit?.(0);
    await expect(promise).resolves.toEqual({ status: 0 });
    expect(host.querySelector(".almostnode-vim-overlay")).toBeNull();
  });

  it("uses the small build for `vi` and syncs `:w` bytes back to the vfs", async () => {
    const vfs = createFakeVfs();
    const host = document.createElement("div");
    const onSaved = vi.fn();

    const promise = runVimTerminalSession({
      host,
      vfs,
      absPath: "/work/new.txt",
      variant: "vi",
      vimWasmBaseUrl: BASE,
      onSaved,
    });

    const vim = hoisted.instances[0]!;
    expect(vim.opts.workerScriptPath).toBe("/vim-wasm/small/vim.js");
    expect(vim.startOpts?.files).toEqual({ "/work/new.txt": "" });

    vim.onVimInit?.();
    const bytes = new TextEncoder().encode("saved from vim!\n");
    vim.onFileExport?.("/work/new.txt", bytes.buffer);

    expect(vfs.files.get("/work/new.txt")).toBe("saved from vim!\n");
    expect(vfs.dirs.has("/work")).toBe(true);
    expect(onSaved).toHaveBeenCalledWith("/work/new.txt");

    vim.onVimExit?.(0);
    await expect(promise).resolves.toEqual({ status: 0 });
  });

  it("rejects with `aborted` when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runVimTerminalSession({
        host: document.createElement("div"),
        vfs: createFakeVfs(),
        absPath: "/work/x.txt",
        variant: "vim",
        vimWasmBaseUrl: BASE,
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted");
    expect(hoisted.instances).toHaveLength(0);
  });
});

describe("createVimShellCommands", () => {
  function makeCtx(cwd = "/project") {
    return { cwd, env: {}, stdin: "", vfs: createFakeVfs() } as unknown as Parameters<
      ReturnType<typeof createVimShellCommands>[number]["execute"]
    >[1];
  }

  it("registers vim and vi", () => {
    const cmds = createVimShellCommands({
      vfs: createFakeVfs(),
      vimWasmBaseUrl: BASE,
      resolveHost: () => document.createElement("div"),
    });
    expect(cmds.map((c) => c.name)).toEqual(["vim", "vi"]);
  });

  it("prints usage when no file arg is given", async () => {
    const [vim] = createVimShellCommands({
      vfs: createFakeVfs(),
      vimWasmBaseUrl: BASE,
      resolveHost: () => document.createElement("div"),
    });
    const result = await vim!.execute([], makeCtx());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("usage");
  });

  it("errors when no terminal host is available", async () => {
    const [vim] = createVimShellCommands({
      vfs: createFakeVfs(),
      vimWasmBaseUrl: BASE,
      resolveHost: () => null,
    });
    const result = await vim!.execute(["a.txt"], makeCtx());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no active terminal");
    expect(hoisted.instances).toHaveLength(0);
  });

  it("launches Vim on the resolved host and returns its exit status", async () => {
    const host = document.createElement("div");
    const onSessionEnd = vi.fn();
    const [vim] = createVimShellCommands({
      vfs: createFakeVfs(),
      vimWasmBaseUrl: BASE,
      resolveHost: () => host,
      onSessionEnd,
    });

    const pending = vim!.execute(["notes.txt"], makeCtx("/project"));
    const inst = hoisted.instances[0]!;
    // Path resolved against cwd and preloaded.
    expect(inst.startOpts?.cmdArgs).toEqual(["/project/notes.txt"]);

    inst.onVimExit?.(0);
    const result = await pending;
    expect(result.exitCode).toBe(0);
    expect(onSessionEnd).toHaveBeenCalled();
  });

  it("refuses a second concurrent session (vim is single-instance)", async () => {
    const host = document.createElement("div");
    const [vim] = createVimShellCommands({
      vfs: createFakeVfs(),
      vimWasmBaseUrl: BASE,
      resolveHost: () => host,
    });

    const first = vim!.execute(["a.txt"], makeCtx());
    const inst = hoisted.instances[0]!;

    const second = await vim!.execute(["b.txt"], makeCtx());
    expect(second.exitCode).toBe(1);
    expect(second.stderr).toContain("already open");

    inst.onVimExit?.(0);
    await first;
  });
});

describe("getVimWasmUnsupportedReason", () => {
  it("returns undefined when the browser is compatible", () => {
    expect(getVimWasmUnsupportedReason()).toBeUndefined();
  });
  it("surfaces the vim-wasm compatibility reason", () => {
    hoisted.checkBrowserCompatibility.mockReturnValueOnce("needs Chromium");
    expect(getVimWasmUnsupportedReason()).toBe("needs Chromium");
  });
});
