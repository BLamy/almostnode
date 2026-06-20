// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const createOpencodeClientMock = vi.fn();
const initBrowserDBMock = vi.fn();
const resetBrowserDBMock = vi.fn();
const databaseClientResetMock = vi.fn();
const setWorkspaceRootMock = vi.fn();
const hasPersistedBrowserDBMock = vi.fn();
const importBrowserDBSnapshotMock = vi.fn();
const startAutoPersistMock = vi.fn();
const persistDBMock = vi.fn();

vi.mock("../src/shims/node-process", () => ({
  configureBrowserProcess: vi.fn(({ cwd, env }: { cwd: string; env: Record<string, string> }) => ({
    cwd: () => cwd,
    env,
  })),
}));

vi.mock("../../../vendor/opencode/packages/browser/src/shims/bun.browser", () => ({}));

vi.mock("../../../vendor/opencode/packages/browser/src/shims/opencode-sdk.browser", () => ({
  createOpencodeClient: createOpencodeClientMock,
}));

vi.mock("../src/shims/opencode-child-process", () => ({
  withProcessBridgeScope: (_bridge: unknown, fn: () => unknown) => fn(),
  registerProcessBridgeForRoot: vi.fn(),
  unregisterProcessBridgeForRoot: vi.fn(),
}));

vi.mock("../../../vendor/opencode/packages/browser/src/shims/fs.browser", () => ({
  setWorkspaceRoot: setWorkspaceRootMock,
  withWorkspaceBridgeScope: (_bridge: unknown, fn: () => unknown) => fn(),
  registerWorkspaceBridgeForRoot: vi.fn(),
  unregisterWorkspaceBridgeForRoot: vi.fn(),
}));

vi.mock("../../../vendor/opencode/packages/browser/src/shims/db.browser", () => ({
  initBrowserDB: initBrowserDBMock,
  exportBrowserDBSnapshot: vi.fn(),
  hasPersistedBrowserDB: hasPersistedBrowserDBMock,
  importBrowserDBSnapshot: importBrowserDBSnapshotMock,
  persistDB: persistDBMock,
  resetBrowserDB: resetBrowserDBMock,
  startAutoPersist: startAutoPersistMock,
  isRecoverableBrowserDBError: (error: unknown) =>
    String(error instanceof Error ? error.message : error).toLowerCase().includes("out of memory"),
}));

vi.mock("../../../vendor/opencode/packages/opencode/src/server/server", () => ({
  Server: {
    Default: () => ({
      fetch: vi.fn(async () =>
        new Response(JSON.stringify([]), {
          headers: { "content-type": "application/json" },
          status: 200,
        })),
    }),
  },
}));

vi.mock("../../../vendor/opencode/packages/opencode/src/storage/db", () => ({
  Database: {
    Client: {
      reset: databaseClientResetMock,
    },
  },
}));

function createFakeContainer() {
  return {
    createTerminalSession: vi.fn(() => ({
      dispose: vi.fn(),
      getState: () => ({
        cwd: "/project",
        env: {},
      }),
      run: vi.fn(async () => ({
        stdout: "",
        stderr: "",
        exitCode: 0,
      })),
    })),
    vfs: {
      existsSync: vi.fn(() => false),
      mkdirSync: vi.fn(),
      readFileSync: vi.fn(),
      statSync: vi.fn(() => ({
        isDirectory: () => false,
        isFile: () => true,
      })),
      writeFileSync: vi.fn(),
      readdirSync: vi.fn(() => []),
      rmSync: vi.fn(),
      unlinkSync: vi.fn(),
      renameSync: vi.fn(),
    },
  };
}

describe("OpenCode browser session recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    initBrowserDBMock.mockResolvedValue({});
    resetBrowserDBMock.mockResolvedValue({});
    hasPersistedBrowserDBMock.mockResolvedValue(true);
    importBrowserDBSnapshotMock.mockResolvedValue(undefined);
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  it("resets the browser DB and retries once when session listing fails with out of memory", async () => {
    const sessionList = vi
      .fn()
      .mockRejectedValueOnce(new Error("out of memory"))
      .mockResolvedValueOnce([{ id: "session-1", title: "Recovered session" }]);
    createOpencodeClientMock.mockReturnValue({
      session: {
        list: sessionList,
      },
    });

    const { listOpenCodeBrowserSessions } = await import("../src/features/opencode-browser-session");
    const sessions = await listOpenCodeBrowserSessions({
      container: createFakeContainer() as never,
      cwd: "/project",
      env: {},
    });

    expect(sessions).toEqual([{ id: "session-1", title: "Recovered session" }]);
    expect(sessionList).toHaveBeenCalledTimes(2);
    expect(setWorkspaceRootMock).toHaveBeenCalledWith("/project", ["/project"]);
    expect(createOpencodeClientMock).toHaveBeenLastCalledWith(expect.objectContaining({
      directory: "/project",
    }));
    expect(databaseClientResetMock).toHaveBeenCalledTimes(1);
    expect(resetBrowserDBMock).toHaveBeenCalledTimes(1);
    // The reset wipes the single host-level store — the warning says so.
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining("ALL projects and sandboxes"),
      expect.any(Error),
    );
  });

  it("scopes the client and session listing to the per-sandbox directory", async () => {
    const sessionList = vi.fn().mockResolvedValue([]);
    createOpencodeClientMock.mockReturnValue({
      session: {
        list: sessionList,
      },
    });

    const { listOpenCodeBrowserSessions } = await import("../src/features/opencode-browser-session");
    await listOpenCodeBrowserSessions({
      container: createFakeContainer() as never,
      cwd: "/project",
      env: {},
      opencodeDirectory: "/sandboxes/sb-1",
    });

    expect(createOpencodeClientMock).toHaveBeenLastCalledWith(expect.objectContaining({
      directory: "/sandboxes/sb-1",
    }));
    expect(sessionList).toHaveBeenCalledWith({ directory: "/sandboxes/sb-1" });
    expect(setWorkspaceRootMock).toHaveBeenCalledWith("/sandboxes/sb-1", ["/project"]);
  });

  it("seeds the host-level DB once from a legacy project blob, then leaves it alone", async () => {
    hasPersistedBrowserDBMock.mockResolvedValue(false);
    const { registerLegacyOpenCodeDbSnapshot } = await import(
      "../src/features/opencode-browser-session"
    );

    const legacyBlob = new Uint8Array([1, 2, 3]);
    await registerLegacyOpenCodeDbSnapshot(legacyBlob);
    expect(importBrowserDBSnapshotMock).toHaveBeenCalledTimes(1);
    expect(importBrowserDBSnapshotMock).toHaveBeenCalledWith(legacyBlob);

    // Later project switches never re-import over the global DB.
    await registerLegacyOpenCodeDbSnapshot(new Uint8Array([9, 9]));
    expect(importBrowserDBSnapshotMock).toHaveBeenCalledTimes(1);
  });

  it("does not seed from a legacy blob when a host-level DB already exists", async () => {
    hasPersistedBrowserDBMock.mockResolvedValue(true);
    const { registerLegacyOpenCodeDbSnapshot } = await import(
      "../src/features/opencode-browser-session"
    );

    await registerLegacyOpenCodeDbSnapshot(new Uint8Array([1, 2, 3]));
    expect(importBrowserDBSnapshotMock).not.toHaveBeenCalled();
  });

  it("re-imports the active project's legacy blob after a recovery reset", async () => {
    hasPersistedBrowserDBMock.mockResolvedValue(true);
    const sessionList = vi
      .fn()
      .mockRejectedValueOnce(new Error("out of memory"))
      .mockResolvedValueOnce([]);
    createOpencodeClientMock.mockReturnValue({
      session: {
        list: sessionList,
      },
    });

    const { listOpenCodeBrowserSessions, registerLegacyOpenCodeDbSnapshot } = await import(
      "../src/features/opencode-browser-session"
    );

    const legacyBlob = new Uint8Array([4, 5, 6]);
    await registerLegacyOpenCodeDbSnapshot(legacyBlob);
    expect(importBrowserDBSnapshotMock).not.toHaveBeenCalled();

    await listOpenCodeBrowserSessions({
      container: createFakeContainer() as never,
      cwd: "/project",
      env: {},
    });

    expect(resetBrowserDBMock).toHaveBeenCalledTimes(1);
    expect(importBrowserDBSnapshotMock).toHaveBeenCalledWith(legacyBlob);
  });

  it("does not reset the browser DB for unrelated session list failures", async () => {
    const sessionList = vi.fn().mockRejectedValue(new Error("permission denied"));
    createOpencodeClientMock.mockReturnValue({
      session: {
        list: sessionList,
      },
    });

    const { listOpenCodeBrowserSessions } = await import("../src/features/opencode-browser-session");

    await expect(
      listOpenCodeBrowserSessions({
        container: createFakeContainer() as never,
        cwd: "/project",
        env: {},
      }),
    ).rejects.toThrow("permission denied");

    expect(sessionList).toHaveBeenCalledTimes(1);
    expect(databaseClientResetMock).not.toHaveBeenCalled();
    expect(resetBrowserDBMock).not.toHaveBeenCalled();
  });
});
