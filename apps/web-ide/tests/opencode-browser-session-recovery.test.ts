// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const createOpencodeClientMock = vi.fn();
const initBrowserDBMock = vi.fn();
const resetBrowserDBMock = vi.fn();
const databaseClientResetMock = vi.fn();

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
}));

vi.mock("../../../vendor/opencode/packages/browser/src/shims/fs.browser", () => ({
  withWorkspaceBridgeScope: (_bridge: unknown, fn: () => unknown) => fn(),
}));

vi.mock("../../../vendor/opencode/packages/browser/src/shims/db.browser", () => ({
  initBrowserDB: initBrowserDBMock,
  exportBrowserDBSnapshot: vi.fn(),
  importBrowserDBSnapshot: vi.fn(),
  resetBrowserDB: resetBrowserDBMock,
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
        cwd: "/workspace",
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
      cwd: "/workspace",
      env: {},
    });

    expect(sessions).toEqual([{ id: "session-1", title: "Recovered session" }]);
    expect(sessionList).toHaveBeenCalledTimes(2);
    expect(databaseClientResetMock).toHaveBeenCalledTimes(1);
    expect(resetBrowserDBMock).toHaveBeenCalledTimes(1);
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
        cwd: "/workspace",
        env: {},
      }),
    ).rejects.toThrow("permission denied");

    expect(sessionList).toHaveBeenCalledTimes(1);
    expect(databaseClientResetMock).not.toHaveBeenCalled();
    expect(resetBrowserDBMock).not.toHaveBeenCalled();
  });
});
