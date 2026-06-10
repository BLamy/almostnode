import { describe, expect, it, vi } from "vitest";
import {
  createCodexCliShellCommand,
  type CodexCliShellCommandContext,
  type CodexCliShellCommandResult,
} from "../src/shell-command";

const DEFAULT_CODEX_CLI_VERSION = "0.137.0";

describe("createCodexCliShellCommand", () => {
  it("runs codex through the provided browser runner and forwards shell state", async () => {
    const seen: unknown[] = [];
    const command = createCodexCliShellCommand({
      createRunner() {
        return {
          async run(args, options) {
            seen.push({ args, options });
            return {
              stdout: "codex ok\n",
              stderr: "",
              exitCode: 0,
            };
          },
          dispose() {
            seen.push("disposed");
          },
        };
      },
    });

    await expect(
      command.execute(["exec", "hello"], createShellContext()),
    ).resolves.toEqual({
      stdout: "codex ok\n",
      stderr: "",
      exitCode: 0,
    });

    expect(seen).toEqual([
      {
        args: ["exec", "hello"],
        options: {
          cwd: "/workspace",
          env: {
            CODEX_CLI_VERSION: DEFAULT_CODEX_CLI_VERSION,
            OPENAI_API_KEY: "test-key",
            PWD: "/workspace",
          },
          stdin: "prompt\n",
          terminalSize: { columns: 120, rows: 40 },
        },
      },
      "disposed",
    ]);
  });

  it("loads restored Codex auth from the browser VFS when env keys are absent", async () => {
    const seen: unknown[] = [];
    const command = createCodexCliShellCommand({
      createRunner() {
        return {
          async run(args, options) {
            seen.push({ args, options });
            return {
              stdout: "codex ok\n",
              stderr: "",
              exitCode: 0,
            };
          },
          dispose() {
            seen.push("disposed");
          },
        };
      },
    });
    const context = createShellContext({
      env: { PWD: "/workspace" },
      getEnv() {
        return { PWD: "/workspace" };
      },
      vfs: {
        existsSync(path: string) {
          return path === "/home/user/.codex/auth.json";
        },
        readFileSync(path: string) {
          if (path !== "/home/user/.codex/auth.json") {
            throw new Error(`unexpected path ${path}`);
          }
          return JSON.stringify({
            auth_mode: "api_key",
            OPENAI_API_KEY: "sk-restored",
          });
        },
      },
    });

    await expect(command.execute(["exec", "hello"], context)).resolves.toEqual({
      stdout: "codex ok\n",
      stderr: "",
      exitCode: 0,
    });

    expect(seen).toEqual([
      {
        args: ["exec", "hello"],
        options: {
          cwd: "/workspace",
          env: {
            CODEX_CLI_VERSION: DEFAULT_CODEX_CLI_VERSION,
            OPENAI_API_KEY: "sk-restored",
            CODEX_API_KEY: "sk-restored",
            PWD: "/workspace",
          },
          stdin: "prompt\n",
          terminalSize: { columns: 120, rows: 40 },
        },
      },
      "disposed",
    ]);
  });

  it("applies browser login env returned by the Codex runner", async () => {
    const setEnvCalls: Array<[string, string | null | undefined]> = [];
    const command = createCodexCliShellCommand({
      createRunner() {
        return {
          async run() {
            return {
              stdout: "Stored OpenAI API key for this browser Codex session.\n",
              stderr: "",
              exitCode: 0,
              env: {
                OPENAI_API_KEY: "sk-login",
                CODEX_API_KEY: "sk-login",
              },
            };
          },
          dispose() {},
        };
      },
    });

    await expect(
      command.execute(
        ["login", "--with-api-key"],
        createShellContext({
          env: { PWD: "/workspace" },
          stdin: "sk-login\n",
          getEnv() {
            return { PWD: "/workspace" };
          },
          setEnv(name, value) {
            setEnvCalls.push([name, value]);
          },
        }),
      ),
    ).resolves.toEqual({
      stdout: "Stored OpenAI API key for this browser Codex session.\n",
      stderr: "",
      exitCode: 0,
      env: {
        OPENAI_API_KEY: "sk-login",
        CODEX_API_KEY: "sk-login",
      },
    });

    expect(setEnvCalls).toEqual([
      ["OPENAI_API_KEY", "sk-login"],
      ["CODEX_API_KEY", "sk-login"],
    ]);
  });

  it("passes top-level prompt args through to the Codex runner when not interactive", async () => {
    const seen: unknown[] = [];
    const command = createCodexCliShellCommand({
      createRunner() {
        return {
          async run(args, options) {
            seen.push({ args, options });
            return {
              stdout: "prompt ok\n",
              stderr: "",
              exitCode: 0,
            };
          },
          dispose() {
            seen.push("disposed");
          },
        };
      },
    });

    await expect(
      command.execute(["summarize", "workspace"], createShellContext()),
    ).resolves.toEqual({
      stdout: "prompt ok\n",
      stderr: "",
      exitCode: 0,
    });

    expect(seen).toEqual([
      {
        args: ["exec", "summarize workspace"],
        options: {
          cwd: "/workspace",
          env: {
            CODEX_CLI_VERSION: DEFAULT_CODEX_CLI_VERSION,
            OPENAI_API_KEY: "test-key",
            PWD: "/workspace",
          },
          stdin: "prompt\n",
          terminalSize: { columns: 120, rows: 40 },
        },
      },
      "disposed",
    ]);
  });

  it("runs the browser interactive codex loop through codex exec", async () => {
    const seen: unknown[] = [];
    const disposed: string[] = [];
    const interactive = createInteractiveShellContext();
    const command = createCodexCliShellCommand({
      createRunner() {
        const tui = createTestTuiRunner(seen);
        return {
          async run(args, options) {
            seen.push({ args, options });
            const tuiResult = tui(args);
            if (tuiResult) return tuiResult;
            return {
              stdout: `answer:${args.join(" ")}\n`,
              stderr: "",
              exitCode: 0,
            };
          },
          dispose() {
            disposed.push("disposed");
          },
        };
      },
    });

    const runPromise = command.execute([], interactive.ctx);
    await interactive.waitForStdout("OpenAI Codex");

    interactive.type("hello browser");
    interactive.key("\r", { name: "return" });
    await interactive.waitForStdout("answer:exec hello browser");

    interactive.type("/exit");
    interactive.key("\r", { name: "return" });

    await expect(runPromise).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(
      seen.filter(
        (entry) =>
          typeof entry === "object" &&
          Array.isArray((entry as { args?: unknown }).args) &&
          (entry as { args: string[] }).args[0] === "exec",
      ),
    ).toEqual([
      {
        args: ["exec", "hello browser"],
        options: {
          cwd: "/workspace",
          env: {
            CODEX_CLI_VERSION: DEFAULT_CODEX_CLI_VERSION,
            OPENAI_API_KEY: "test-key",
            PWD: "/workspace",
          },
          stdin: "prompt\n",
          terminalSize: { columns: 120, rows: 40 },
        },
      },
    ]);
    expect(disposed).toEqual(["disposed"]);
  });

  it("writes browser TUI scrollback deltas before redrawing the live frame", async () => {
    const interactive = createInteractiveShellContext();
    const command = createCodexCliShellCommand({
      createRunner() {
        const tui = createTestTuiRunner([]);
        return {
          async run(args): Promise<CodexCliShellCommandResult> {
            const tuiResult = tui(args);
            if (tuiResult) return tuiResult;
            return {
              stdout: `answer:${args.join(" ")}\n`,
              stderr: "",
              exitCode: 0,
            };
          },
          dispose() {},
        };
      },
    });

    const runPromise = command.execute([], interactive.ctx);
    await interactive.waitForStdout("OpenAI Codex");

    interactive.type("scrollback probe");
    interactive.key("\r", { name: "return" });
    await interactive.waitForStdout("› scrollback probe\r\n");

    const output = interactive.stdout();
    const scrollbackIndex = output.indexOf("› scrollback probe\r\n");
    const redrawIndex = output.indexOf(
      "\x1b[?25l\x1b[H\x1b[2J",
      scrollbackIndex,
    );
    expect(scrollbackIndex).toBeGreaterThanOrEqual(0);
    expect(redrawIndex).toBeGreaterThan(scrollbackIndex);

    interactive.key(undefined, { name: "d", ctrl: true });
    await expect(runPromise).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
  });

  it("keeps the browser interactive codex loop alive after exec errors", async () => {
    const disposed: string[] = [];
    const interactive = createInteractiveShellContext();
    const command = createCodexCliShellCommand({
      createRunner() {
        const tui = createTestTuiRunner([]);
        return {
          async run(args) {
            const tuiResult = tui(args);
            if (tuiResult) return tuiResult;
            if (args[0] === "exec") {
              throw new Error(
                "OpenAI Responses API request failed with HTTP 400: Instructions are required",
              );
            }
            return {
              stdout: "",
              stderr: "",
              exitCode: 0,
            };
          },
          dispose() {
            disposed.push("disposed");
          },
        };
      },
    });

    const runPromise = command.execute([], interactive.ctx);
    await interactive.waitForStdout("OpenAI Codex");

    interactive.type("hello browser");
    interactive.key("\r", { name: "return" });
    await interactive.waitForStdout("codex exec failed in the browser");
    await interactive.waitForStdout("Instructions are required");

    interactive.type("/exit");
    interactive.key("\r", { name: "return" });

    await expect(runPromise).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(interactive.stderr()).toContain("Instructions are required");
    expect(disposed).toEqual(["disposed"]);
  });

  it("runs browser interactive bang commands through shell exec", async () => {
    const seen: unknown[] = [];
    const shellCommands: unknown[] = [];
    const disposed: string[] = [];
    const interactive = createInteractiveShellContext({
      async exec(command, options) {
        shellCommands.push({ command, options });
        return {
          stdout: "AGENTS.md\nCLAUDE.md\nREADME.md\n",
          stderr: "",
          exitCode: 0,
          env: {
            CODEX_CLI_VERSION: DEFAULT_CODEX_CLI_VERSION,
            OPENAI_API_KEY: "test-key",
            PWD: "/workspace",
          },
        };
      },
    });
    const command = createCodexCliShellCommand({
      createRunner() {
        const tui = createTestTuiRunner(seen);
        return {
          async run(args, options) {
            seen.push({ args, options });
            const tuiResult = tui(args);
            if (tuiResult) return tuiResult;
            return {
              stdout: `answer:${args.join(" ")}\n`,
              stderr: "",
              exitCode: 0,
            };
          },
          dispose() {
            disposed.push("disposed");
          },
        };
      },
    });

    const runPromise = command.execute([], interactive.ctx);
    await interactive.waitForStdout("OpenAI Codex");

    interactive.type("!ls");
    interactive.key("\r", { name: "return" });
    await interactive.waitForStdout("AGENTS.md");

    interactive.type("/exit");
    interactive.key("\r", { name: "return" });

    await expect(runPromise).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(shellCommands).toEqual([
      {
        command: "ls",
        options: {
          cwd: "/workspace",
          env: {
            CODEX_CLI_VERSION: DEFAULT_CODEX_CLI_VERSION,
            OPENAI_API_KEY: "test-key",
            PWD: "/workspace",
          },
          stdin: "",
          signal: interactive.ctx.signal,
        },
      },
    ]);
    expect(
      seen.filter(
        (entry) =>
          typeof entry === "object" &&
          Array.isArray((entry as { args?: unknown }).args) &&
          (entry as { args: string[] }).args[0] === "exec",
      ),
    ).toEqual([]);
    expect(disposed).toEqual(["disposed"]);
  });

  it("routes browser interactive bang playwright-cli commands through shell exec", async () => {
    const seen: unknown[] = [];
    const shellCommands: unknown[] = [];
    const interactive = createInteractiveShellContext({
      async exec(command, options) {
        shellCommands.push({ command, options });
        return {
          stdout: "playwright-cli shim ok\n",
          stderr: "",
          exitCode: 0,
          env: {
            CODEX_CLI_VERSION: DEFAULT_CODEX_CLI_VERSION,
            OPENAI_API_KEY: "test-key",
            PWD: "/workspace",
          },
        };
      },
    });
    const command = createCodexCliShellCommand({
      createRunner() {
        const tui = createTestTuiRunner(seen);
        return {
          async run(args, options) {
            seen.push({ args, options });
            const tuiResult = tui(args);
            if (tuiResult) return tuiResult;
            return {
              stdout: `answer:${args.join(" ")}\n`,
              stderr: "",
              exitCode: 0,
            };
          },
          dispose() {},
        };
      },
    });

    const runPromise = command.execute([], interactive.ctx);
    await interactive.waitForStdout("OpenAI Codex");

    interactive.type("!playwright-cli help");
    interactive.key("\r", { name: "return" });
    await interactive.waitForStdout("playwright-cli shim ok");

    interactive.type("/exit");
    interactive.key("\r", { name: "return" });

    await expect(runPromise).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(shellCommands).toEqual([
      {
        command: "playwright-cli help",
        options: {
          cwd: "/workspace",
          env: {
            CODEX_CLI_VERSION: DEFAULT_CODEX_CLI_VERSION,
            OPENAI_API_KEY: "test-key",
            PWD: "/workspace",
          },
          stdin: "",
          signal: interactive.ctx.signal,
        },
      },
    ]);
    expect(
      seen.filter(
        (entry) =>
          typeof entry === "object" &&
          Array.isArray((entry as { args?: unknown }).args) &&
          (entry as { args: string[] }).args[0] === "exec",
      ),
    ).toEqual([]);
  });

  it("runs browser interactive turns through app-server notifications when available", async () => {
    const seen: unknown[] = [];
    const appServerRequests: Array<{ method: string; params?: unknown }> = [];
    const appServerEnv: Array<Record<string, string>> = [];
    const appServerNotifications = new Set<(notification: unknown) => void>();
    const disposed: string[] = [];
    const interactive = createInteractiveShellContext({
      env: { PWD: "/workspace" },
      getEnv() {
        return { PWD: "/workspace" };
      },
      vfs: {
        existsSync(path: string) {
          return path === "/home/user/.codex/auth.json";
        },
        readFileSync(path: string) {
          if (path !== "/home/user/.codex/auth.json") {
            throw new Error(`unexpected path ${path}`);
          }
          return JSON.stringify({
            auth_mode: "api_key",
            OPENAI_API_KEY: "sk-restored",
          });
        },
      },
    });
    const command = createCodexCliShellCommand({
      createRunner() {
        const tui = createTestTuiRunner(seen);
        return {
          async run(args, options) {
            seen.push({ args, options });
            const tuiResult = tui(args);
            if (tuiResult) return tuiResult;
            if (args[0] === "exec") {
              throw new Error("interactive turns must use app-server");
            }
            return {
              stdout: `answer:${args.join(" ")}\n`,
              stderr: "",
              exitCode: 0,
            };
          },
          dispose() {
            disposed.push("runner");
          },
        };
      },
      createAppServerSession(context) {
        appServerEnv.push(context.getEnv());
        return {
          ready: Promise.resolve(),
          dispose() {
            disposed.push("app-server");
          },
          peer: {
            async initialize(params) {
              appServerRequests.push({ method: "initialize", params });
              return {};
            },
            async request(method, params) {
              appServerRequests.push({ method, params });
              if (method === "thread/start") {
                return { thread: { id: "thread-1" } };
              }
              if (method === "turn/start") {
                queueMicrotask(() => {
                  for (const listener of Array.from(appServerNotifications)) {
                    listener({
                      method: "item/completed",
                      params: {
                        threadId: "thread-1",
                        turnId: "turn-1",
                        completedAtMs: 1,
                        item: {
                          type: "commandExecution",
                          id: "item-1",
                          command: "pwd",
                          cwd: "/workspace",
                          processId: null,
                          source: "agent",
                          status: "completed",
                          commandActions: [],
                          aggregatedOutput: "/workspace\n",
                          exitCode: 0,
                          durationMs: 1,
                        },
                      },
                    });
                    listener({
                      method: "turn/completed",
                      params: {
                        threadId: "thread-1",
                        turn: {
                          id: "turn-1",
                          items: [],
                          itemsView: "full",
                          status: "completed",
                          error: null,
                          startedAt: 1,
                          completedAt: 2,
                          durationMs: 1,
                        },
                      },
                    });
                  }
                });
                return {
                  turn: {
                    id: "turn-1",
                    items: [],
                    itemsView: "notLoaded",
                    status: "inProgress",
                  },
                };
              }
              throw new Error(`unexpected app-server request ${method}`);
            },
            onNotification(listener) {
              appServerNotifications.add(listener);
              return () => appServerNotifications.delete(listener);
            },
          },
        };
      },
    });

    const runPromise = command.execute([], interactive.ctx);
    await interactive.waitForStdout("OpenAI Codex");

    interactive.type("inspect workspace");
    interactive.key("\r", { name: "return" });
    await interactive.waitForStdout("notification:item/completed");

    interactive.type("/exit");
    interactive.key("\r", { name: "return" });

    await expect(runPromise).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    await waitFor(() => disposed.includes("app-server"));
    expect(appServerEnv[0]).toMatchObject({
      OPENAI_API_KEY: "sk-restored",
      CODEX_API_KEY: "sk-restored",
      PWD: "/workspace",
    });
    expect(appServerRequests.map((request) => request.method)).toEqual([
      "initialize",
      "thread/start",
      "turn/start",
    ]);
    expect(
      seen.filter(
        (entry) =>
          typeof entry === "object" &&
          Array.isArray((entry as { args?: unknown }).args) &&
          (entry as { args: string[] }).args[0] === "exec",
      ),
    ).toEqual([]);
    expect(
      seen.some(
        (entry) =>
          typeof entry === "object" &&
          Array.isArray((entry as { args?: unknown }).args) &&
          (entry as { args: string[] }).args[1] === "browser-tui-notification",
      ),
    ).toBe(true);
    expect(disposed).toEqual(expect.arrayContaining(["app-server", "runner"]));
  });

  it("keeps browser interactive TUI input live while an app-server turn is streaming", async () => {
    const seen: unknown[] = [];
    const disposed: string[] = [];
    const appServerRequests: { method: string; params: unknown }[] = [];
    const appServerNotifications = new Set<(notification: unknown) => void>();
    const interactive = createInteractiveShellContext({
      env: { PWD: "/workspace" },
      getEnv() {
        return { PWD: "/workspace" };
      },
      vfs: {
        existsSync(path: string) {
          return path === "/home/user/.codex/auth.json";
        },
        readFileSync(path: string) {
          if (path !== "/home/user/.codex/auth.json") {
            throw new Error(`unexpected path ${path}`);
          }
          return JSON.stringify({
            auth_mode: "api_key",
            OPENAI_API_KEY: "sk-restored",
          });
        },
      },
    });
    const command = createCodexCliShellCommand({
      createRunner() {
        const tui = createTestTuiRunner(seen);
        return {
          async run(args, options) {
            seen.push({ args, options });
            const tuiResult = tui(args);
            if (tuiResult) return tuiResult;
            if (args[0] === "exec") {
              throw new Error("interactive turns must use app-server");
            }
            return { stdout: "", stderr: "", exitCode: 0 };
          },
          dispose() {
            disposed.push("runner");
          },
        };
      },
      createAppServerSession() {
        return {
          ready: Promise.resolve(),
          dispose() {
            disposed.push("app-server");
          },
          peer: {
            async initialize(params) {
              appServerRequests.push({ method: "initialize", params });
              return {};
            },
            async request(method, params) {
              appServerRequests.push({ method, params });
              if (method === "thread/start") {
                return { thread: { id: "thread-1" } };
              }
              if (method === "turn/start") {
                return {
                  turn: {
                    id: "turn-1",
                    items: [],
                    itemsView: "notLoaded",
                    status: "inProgress",
                  },
                };
              }
              throw new Error(`unexpected app-server request ${method}`);
            },
            onNotification(listener) {
              appServerNotifications.add(listener);
              return () => appServerNotifications.delete(listener);
            },
          },
        };
      },
    });

    const runPromise = command.execute([], interactive.ctx);
    await interactive.waitForStdout("OpenAI Codex");

    interactive.type("start dev server");
    interactive.key("\r", { name: "return" });
    await waitFor(() =>
      appServerRequests.some((request) => request.method === "turn/start"),
    );

    interactive.type("next prompt");
    await interactive.waitForStdout("› next prompt");

    for (const listener of Array.from(appServerNotifications)) {
      listener({
        method: "turn/completed",
        params: {
          threadId: "thread-1",
          turn: {
            id: "turn-1",
            items: [],
            itemsView: "full",
            status: "completed",
            error: null,
            startedAt: 1,
            completedAt: 2,
            durationMs: 1,
          },
        },
      });
    }

    for (const listener of Array.from(appServerNotifications)) {
      listener({
        method: "item/completed",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          completedAtMs: 3,
          item: {
            type: "commandExecution",
            id: "item-1",
            command: "npm run dev",
            cwd: "/workspace",
            processId: null,
            source: "agent",
            status: "completed",
            commandActions: [],
            aggregatedOutput: "ready\n",
            exitCode: 0,
            durationMs: 1,
          },
        },
      });
    }
    await interactive.waitForStdout("notification:item/completed");

    interactive.key(undefined, { name: "d", ctrl: true });

    await expect(runPromise).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
    expect(
      seen.filter(
        (entry) =>
          typeof entry === "object" &&
          Array.isArray((entry as { args?: unknown }).args) &&
          (entry as { args: string[] }).args[0] === "exec",
      ),
    ).toEqual([]);
    expect(disposed).toEqual(expect.arrayContaining(["app-server", "runner"]));
  });

  it("does not fail an active app-server turn with a browser wrapper timeout", async () => {
    vi.useFakeTimers();
    try {
      const seen: unknown[] = [];
      const disposed: string[] = [];
      const appServerRequests: { method: string; params: unknown }[] = [];
      const appServerNotifications = new Set<(notification: unknown) => void>();
      const interactive = createInteractiveShellContext({
        env: { PWD: "/workspace" },
        getEnv() {
          return { PWD: "/workspace" };
        },
        vfs: {
          existsSync(path: string) {
            return path === "/home/user/.codex/auth.json";
          },
          readFileSync(path: string) {
            if (path !== "/home/user/.codex/auth.json") {
              throw new Error(`unexpected path ${path}`);
            }
            return JSON.stringify({
              auth_mode: "api_key",
              OPENAI_API_KEY: "sk-restored",
            });
          },
        },
      });
      const command = createCodexCliShellCommand({
        createRunner() {
          const tui = createTestTuiRunner(seen);
          return {
            async run(args, options) {
              seen.push({ args, options });
              const tuiResult = tui(args);
              if (tuiResult) return tuiResult;
              if (args[0] === "exec") {
                throw new Error("interactive turns must use app-server");
              }
              return { stdout: "", stderr: "", exitCode: 0 };
            },
            dispose() {
              disposed.push("runner");
            },
          };
        },
        createAppServerSession() {
          return {
            ready: Promise.resolve(),
            dispose() {
              disposed.push("app-server");
            },
            peer: {
              async initialize(params) {
                appServerRequests.push({ method: "initialize", params });
                return {};
              },
              async request(method, params) {
                appServerRequests.push({ method, params });
                if (method === "thread/start") {
                  return { thread: { id: "thread-1" } };
                }
                if (method === "turn/start") {
                  return {
                    turn: {
                      id: "turn-1",
                      items: [],
                      itemsView: "notLoaded",
                      status: "inProgress",
                    },
                  };
                }
                throw new Error(`unexpected app-server request ${method}`);
              },
              onNotification(listener) {
                appServerNotifications.add(listener);
                return () => appServerNotifications.delete(listener);
              },
            },
          };
        },
      });

      const runPromise = Promise.resolve(command.execute([], interactive.ctx));
      let settled = false;
      void runPromise.finally(() => {
        settled = true;
      });
      await waitForAsyncCondition(() =>
        interactive.stdout().includes("OpenAI Codex"),
      );

      interactive.type("x");
      interactive.key("\r", { name: "return" });
      await waitForAsyncCondition(() =>
        appServerRequests.some((request) => request.method === "turn/start"),
      );

      await vi.advanceTimersByTimeAsync(121_000);
      await flushAsyncWork();

      expect(interactive.stderr()).not.toContain(
        "Timed out waiting for Codex turn",
      );
      expect(settled).toBe(false);

      for (const listener of Array.from(appServerNotifications)) {
        listener({
          method: "turn/completed",
          params: {
            threadId: "thread-1",
            turn: {
              id: "turn-1",
              items: [],
              itemsView: "full",
              status: "completed",
              error: null,
              startedAt: 1,
              completedAt: 2,
              durationMs: 1,
            },
          },
        });
      }
      await flushAsyncWork();

      interactive.key(undefined, { name: "d", ctrl: true });
      await expect(runPromise).resolves.toEqual({
        stdout: "",
        stderr: "",
        exitCode: 0,
      });
      expect(disposed).toEqual(
        expect.arrayContaining(["app-server", "runner"]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("redraws the browser interactive TUI when the terminal is resized", async () => {
    const seen: unknown[] = [];
    const interactive = createInteractiveShellContext();
    const command = createCodexCliShellCommand({
      createRunner() {
        const tui = createTestTuiRunner(seen);
        return {
          async run(args, options) {
            seen.push({ args, options });
            const tuiResult = tui(args);
            if (tuiResult) return tuiResult;
            throw new Error("exec runner should not be called during resize");
          },
          dispose() {},
        };
      },
    });

    const runPromise = command.execute([], interactive.ctx);
    await interactive.waitForStdout("OpenAI Codex");

    interactive.resize(90, 22);
    await waitFor(() =>
      seen.some(
        (entry) =>
          typeof entry === "object" &&
          Array.isArray((entry as { args?: unknown }).args) &&
          (entry as { args: string[] }).args[1] === "browser-tui-event" &&
          (entry as { args: string[] }).args.includes("resize") &&
          (entry as { options?: { terminalSize?: unknown } }).options
            ?.terminalSize &&
          (
            entry as {
              options: { terminalSize: { columns: number; rows: number } };
            }
          ).options.terminalSize.columns === 90 &&
          (
            entry as {
              options: { terminalSize: { columns: number; rows: number } };
            }
          ).options.terminalSize.rows === 22,
      ),
    );

    interactive.type("/exit");
    interactive.key("\r", { name: "return" });

    await expect(runPromise).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
  });

  it("places the terminal cursor at the upstream browser TUI cursor position", async () => {
    const interactive = createInteractiveShellContext();
    const command = createCodexCliShellCommand({
      createRunner() {
        const tui = createTestTuiRunner([]);
        return {
          async run(args): Promise<CodexCliShellCommandResult> {
            const tuiResult = tui(args);
            if (tuiResult) return tuiResult;
            throw new Error("exec runner should not be called before input");
          },
          dispose() {},
        };
      },
    });

    const runPromise = command.execute([], interactive.ctx);
    await interactive.waitForStdout("OpenAI Codex");
    expect(interactive.stdout()).toContain("\x1b[2;3H");

    interactive.type("ab");
    await waitFor(() => interactive.stdout().includes("\x1b[2;5H"));

    interactive.key(undefined, { name: "d", ctrl: true });

    await expect(runPromise).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
  });

  it("returns 130 when the browser interactive codex loop is interrupted", async () => {
    const interactive = createInteractiveShellContext();
    const command = createCodexCliShellCommand({
      createRunner() {
        const tui = createTestTuiRunner([]);
        return {
          async run(args): Promise<CodexCliShellCommandResult> {
            const tuiResult = tui(args);
            if (tuiResult) return tuiResult;
            throw new Error("exec runner should not be called before input");
          },
          dispose() {},
        };
      },
    });

    const runPromise = command.execute([], interactive.ctx);
    await interactive.waitForStdout("OpenAI Codex");
    interactive.key(undefined, { name: "c", ctrl: true });

    await expect(runPromise).resolves.toEqual({
      stdout: "",
      stderr: "",
      exitCode: 130,
    });
    expect(interactive.stdout()).toContain("^C");
  });
});

function createShellContext(
  overrides: Partial<CodexCliShellCommandContext> = {},
): CodexCliShellCommandContext {
  return {
    cwd: "/workspace",
    env: { OPENAI_API_KEY: "test-key", PWD: "/workspace" },
    stdin: "prompt\n",
    vfs: {},
    writeStdout() {},
    writeStderr() {},
    setEnv() {},
    getEnv() {
      return { OPENAI_API_KEY: "test-key", PWD: "/workspace" };
    },
    setCwd() {},
    async exec() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    terminalSize: { columns: 120, rows: 40 },
    ...overrides,
  };
}

function createInteractiveShellContext(
  overrides: Partial<CodexCliShellCommandContext> = {},
) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const keypressHandlers = new Set<
    (
      ch: string | undefined,
      key: {
        sequence?: string;
        name?: string;
        ctrl?: boolean;
        meta?: boolean;
        shift?: boolean;
      },
    ) => void
  >();
  const resizeHandlers = new Set<
    (size: { columns: number; rows: number }) => void
  >();
  const controller = new AbortController();
  const ctx = createShellContext({
    interactive: true,
    signal: controller.signal,
    writeStdout(data) {
      stdout.push(data);
    },
    writeStderr(data) {
      stderr.push(data);
    },
    onKeypress(handler) {
      keypressHandlers.add(handler);
      return () => keypressHandlers.delete(handler);
    },
    onResize(handler) {
      resizeHandlers.add(handler);
      return () => resizeHandlers.delete(handler);
    },
    ...overrides,
  });

  return {
    ctx,
    abort() {
      controller.abort();
    },
    stdout() {
      return stdout.join("");
    },
    stderr() {
      return stderr.join("");
    },
    type(value: string) {
      for (const ch of value) {
        this.key(ch, { sequence: ch });
      }
    },
    key(
      ch: string | undefined,
      key: {
        sequence?: string;
        name?: string;
        ctrl?: boolean;
        meta?: boolean;
        shift?: boolean;
      },
    ) {
      for (const handler of Array.from(keypressHandlers)) {
        handler(ch, key);
      }
    },
    resize(columns: number, rows: number) {
      ctx.terminalSize = { columns, rows };
      for (const handler of Array.from(resizeHandlers)) {
        handler({ columns, rows });
      }
    },
    async waitForStdout(expected: string) {
      await waitFor(() => stdout.join("").includes(expected));
    },
  };
}

function createTestTuiRunner(_seen: unknown[]) {
  let input = "";
  const transcript: string[] = [];

  return (args: string[]): CodexCliShellCommandResult | null => {
    if (args.length === 0) {
      input = "";
      transcript.length = 0;
      return renderTestTui(input, transcript, { type: "none" });
    }

    if (args[0] !== "debug") return null;

    if (args[1] === "browser-tui-input") {
      input = valueAfter(args, "--input") ?? "";
      return renderTestTui(input, transcript, { type: "none" });
    }

    if (args[1] === "browser-tui-event") {
      const eventType = valueAfter(args, "--type") ?? "key";
      if (eventType === "key") {
        const name = valueAfter(args, "--name") ?? "char";
        const text = valueAfter(args, "--text") ?? "";
        const ctrl = args.includes("--ctrl");
        if (ctrl && name === "c") {
          input = "";
          return renderTestTui(input, transcript, {
            type: "exit",
            exitCode: 130,
          });
        }
        if (ctrl && name === "d") {
          input = "";
          return renderTestTui(input, transcript, {
            type: "exit",
            exitCode: 0,
          });
        }
        if (name === "return" || name === "enter") {
          const result = submitTestTuiInput(input, transcript);
          input = "";
          return result;
        }
        if (name === "backspace" || name === "delete") {
          input = input.slice(0, -1);
          return renderTestTui(input, transcript, { type: "none" });
        }
        if (text) {
          input += text;
        }
        return renderTestTui(input, transcript, { type: "none" });
      }
      if (eventType === "paste") {
        input += (valueAfter(args, "--text") ?? "")
          .replace(/\r\n/g, "\n")
          .replace(/\r/g, "\n");
        return renderTestTui(input, transcript, { type: "none" });
      }
      return renderTestTui(input, transcript, { type: "none" });
    }

    if (args[1] === "browser-tui-submit") {
      const result = submitTestTuiInput(input, transcript);
      input = "";
      return result;
    }

    if (args[1] === "browser-tui-result") {
      input = "";
      const stdout = valueAfter(args, "--stdout") ?? "";
      const stderr = valueAfter(args, "--stderr") ?? "";
      if (stdout) transcript.push(stdout.trimEnd());
      if (stderr) transcript.push(stderr.trimEnd());
      return renderTestTui(input, transcript, { type: "none" });
    }

    if (args[1] === "browser-tui-notification") {
      input = "";
      const json = valueAfter(args, "--json") ?? "{}";
      const notification = JSON.parse(json) as { method?: string };
      if (notification.method) {
        transcript.push(`notification:${notification.method}`);
      }
      return renderTestTui(input, transcript, { type: "none" });
    }

    if (args[1] === "browser-tui-agent-message") {
      input = "";
      const text = valueAfter(args, "--text") ?? "";
      if (text) transcript.push(text.trimEnd());
      return renderTestTui(input, transcript, { type: "none" });
    }

    if (args[1] === "browser-tui-plan-update") {
      const explanation = valueAfter(args, "--explanation");
      const lines = ["• Updated Plan"];
      if (explanation) lines.push(`  └ ${explanation}`);
      for (const step of valuesAfter(args, "--step")) {
        const [, text = step] = step.split(/:(.*)/, 2);
        lines.push(`  └ ${text}`);
      }
      transcript.push(lines.join("\n"));
      return renderTestTui(input, transcript, { type: "none" });
    }

    return null;
  };
}

function submitTestTuiInput(
  input: string,
  transcript: string[],
): CodexCliShellCommandResult {
  const text = input.trim();
  if (text === "/exit" || text === "exit" || text === "quit") {
    return renderTestTui("", transcript, { type: "exit", exitCode: 0 });
  }
  if (text.startsWith("!")) {
    const command = text.slice(1).trim();
    transcript.push(`› !${command}`);
    return renderTestTui(
      "",
      transcript,
      { type: "shell", command },
      `› !${command}\r\n`,
    );
  }
  transcript.push(`› ${text}`);
  return renderTestTui(
    "",
    transcript,
    { type: "exec", prompt: text },
    `› ${text}\r\n`,
  );
}

function renderTestTui(
  input: string,
  transcript: string[],
  action: NonNullable<CodexCliShellCommandResult["browserTui"]>["action"],
  scrollbackAnsi?: string,
): CodexCliShellCommandResult {
  return {
    stdout: "",
    stderr: "",
    exitCode: 0,
    browserTui: {
      ansi: ["OpenAI Codex", `› ${input}`, ...transcript].join("\n"),
      action,
      ...(scrollbackAnsi ? { scrollbackAnsi } : {}),
      cursor: { x: 2 + input.length, y: 1 },
    },
  };
}

function valueAfter(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function valuesAfter(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === name) {
      values.push(args[index + 1]);
    }
  }
  return values;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > 2000) {
      throw new Error("Timed out waiting for shell command test condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function flushAsyncWork(iterations = 10): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    await Promise.resolve();
  }
}

async function waitForAsyncCondition(
  predicate: () => boolean,
  iterations = 100,
): Promise<void> {
  for (let index = 0; index < iterations; index += 1) {
    if (predicate()) return;
    await Promise.resolve();
  }
  throw new Error("Timed out waiting for async test condition");
}
