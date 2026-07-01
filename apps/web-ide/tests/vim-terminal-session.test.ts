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

// Shared state the mocked `vim-wasm` module and the tests both reach. The mock
// class lives inside `vi.hoisted` so it exists when the hoisted `vi.mock`
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
  getVimWasmUnsupportedReason,
  runVimTerminalSession,
} from "../src/workbench/vim-terminal-session";

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
  const dirs = new Set<string>(["/"]);
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
  it("preloads the target file from the vfs and opens the full build for `vim`", async () => {
    const vfs = createFakeVfs({ "/work/hello.txt": "hi there" });
    const host = document.createElement("div");
    document.body.appendChild(host);

    const promise = runVimTerminalSession({
      host,
      vfs,
      absPath: "/work/hello.txt",
      variant: "vim",
    });

    const vim = hoisted.instances[0]!;
    expect(vim.startOpts?.files).toEqual({ "/work/hello.txt": "hi there" });
    expect(vim.startOpts?.cmdArgs).toEqual(["/work/hello.txt"]);
    expect(vim.startOpts?.dirs).toContain("/work");
    expect(vim.opts.workerScriptPath).toMatch(/\/vim-wasm\/vim\.js$/);
    // `vim` (not `vi`) must NOT use the small build.
    expect(vim.opts.workerScriptPath).not.toMatch(/small/);

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
      onSaved,
    });

    const vim = hoisted.instances[0]!;
    expect(vim.opts.workerScriptPath).toMatch(/\/vim-wasm\/small\/vim\.js$/);
    // New file → empty preload.
    expect(vim.startOpts?.files).toEqual({ "/work/new.txt": "" });

    // Simulate `:w` → BufWritePost export firing onFileExport.
    vim.onVimInit?.();
    const bytes = new TextEncoder().encode("saved from vim!\n");
    vim.onFileExport?.("/work/new.txt", bytes.buffer);

    expect(vfs.files.get("/work/new.txt")).toBe("saved from vim!\n");
    expect(vfs.dirs.has("/work")).toBe(true); // ancestor dir auto-created
    expect(onSaved).toHaveBeenCalledWith("/work/new.txt");

    vim.onVimExit?.(0);
    await expect(promise).resolves.toEqual({ status: 0 });
  });

  it("rejects with `aborted` when the signal is already aborted", async () => {
    const vfs = createFakeVfs();
    const host = document.createElement("div");
    const controller = new AbortController();
    controller.abort();

    await expect(
      runVimTerminalSession({
        host,
        vfs,
        absPath: "/work/x.txt",
        variant: "vim",
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted");
    expect(hoisted.instances).toHaveLength(0);
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
