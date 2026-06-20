/**
 * Regression tests: statSync must report real, stable mtimes. OpenCode's
 * FileTime.assert compares stat mtimes captured at Read time against Write
 * time — when the shim fabricated `new Date()` on every call, every
 * overwrite of an existing file failed with "file has been modified since
 * it was last read", no matter how often the agent re-read it.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  attachWorkspaceBridge,
  detachWorkspaceBridge,
  setWorkspaceRoot,
  _vfs_setFile,
  _vfs_remove,
} from "../../../vendor/opencode/packages/browser/src/shims/fs.browser";
import { statSync } from "../../../vendor/opencode/packages/browser/src/shims/fs-sync.browser";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("statSync mtime stability", () => {
  afterEach(() => {
    detachWorkspaceBridge();
    _vfs_remove("/project", { recursive: true });
  });

  it("returns the same mtime across repeated stats of an unchanged file", async () => {
    _vfs_setFile("/project/src/app.tsx", "export const x = 1;\n");

    const first = statSync("/project/src/app.tsx");
    await wait(10);
    const second = statSync("/project/src/app.tsx");

    expect(second.mtimeMs).toBe(first.mtimeMs);
    expect(second.mtime.getTime()).toBe(first.mtime.getTime());
    expect(second.size).toBe(first.size);
  });

  it("bumps mtime when the file is rewritten", async () => {
    _vfs_setFile("/project/src/app.tsx", "v1");
    const before = statSync("/project/src/app.tsx");

    await wait(10);
    _vfs_setFile("/project/src/app.tsx", "v2");
    const after = statSync("/project/src/app.tsx");

    expect(after.mtimeMs).toBeGreaterThan(before.mtimeMs);
  });

  it("returns undefined with throwIfNoEntry:false for missing paths", () => {
    expect(statSync("/project/missing.txt", { throwIfNoEntry: false })).toBeUndefined();
  });

  it("delegates workspace paths to the bridge stats verbatim", () => {
    const bridgeMtime = new Date(1700000000000);
    setWorkspaceRoot("/project");
    attachWorkspaceBridge({
      exists: (path) => path === "/project/file.txt",
      mkdir() {},
      readFile: (path) => (path === "/project/file.txt" ? "hello" : undefined),
      writeFile() {},
      readdir: () => [],
      stat(path) {
        if (path !== "/project/file.txt") return undefined;
        return {
          isFile: () => true,
          isDirectory: () => false,
          size: 5,
          mtime: bridgeMtime,
          mtimeMs: bridgeMtime.getTime(),
        };
      },
    });

    const stats = statSync("/project/file.txt");
    expect(stats.mtimeMs).toBe(bridgeMtime.getTime());

    const again = statSync("/project/file.txt");
    expect(again.mtimeMs).toBe(stats.mtimeMs);
  });
});
