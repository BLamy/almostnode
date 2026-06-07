import type { CodexHostContainer } from "./host-bridge";
import {
  createCodexCliBrowserSession,
  type CodexCliBrowserSession,
  type CodexCliBrowserSessionOptions,
} from "./cli-browser-session";
import type {
  CodexCliBrowserLoginRequest,
  CodexCliBrowserTuiResult,
  CodexCliRunOptions,
} from "./types";

const DEFAULT_BROWSER_CODEX_CLI_VERSION = "0.137.0";

export interface CodexCliShellCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  browserLogin?: CodexCliBrowserLoginRequest;
  browserTui?: CodexCliBrowserTuiResult;
  env?: Record<string, string>;
  stdoutEncoding?: "binary";
}

export interface CodexCliShellCommandContext {
  cwd: string;
  env: Record<string, string>;
  stdin: string;
  signal?: AbortSignal;
  interactive?: boolean;
  vfs: unknown;
  writeStdout: (data: string) => void;
  writeStderr: (data: string) => void;
  setEnv: (name: string, value: string | null | undefined) => void;
  getEnv: () => Record<string, string>;
  setCwd: (cwd: string) => void;
  exec: (
    command: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      replaceEnv?: boolean;
      stdin?: string;
      signal?: AbortSignal;
      args?: string[];
    },
  ) => Promise<CodexCliShellCommandResult>;
  onInput?: (handler: (data: string) => void) => () => void;
  onKeypress?: (
    handler: (
      ch: string | undefined,
      key: {
        sequence?: string;
        name?: string;
        ctrl?: boolean;
        meta?: boolean;
        shift?: boolean;
      },
    ) => void,
  ) => () => void;
  onResize?: (
    handler: (size: { columns: number; rows: number }) => void,
  ) => () => void;
  terminalSize?: { columns: number; rows: number };
}

export interface CodexCliShellCommandDefinition {
  name: string;
  trusted?: boolean;
  interceptShellParsing?: boolean;
  execute: (
    args: string[],
    context: CodexCliShellCommandContext,
  ) => Promise<CodexCliShellCommandResult> | CodexCliShellCommandResult;
}

export interface CodexCliShellCommandRunner {
  run(
    args: string[],
    options?: CodexCliRunOptions,
  ): Promise<CodexCliShellCommandResult>;
  dispose(): void;
}

export interface CodexBrowserTuiAppServerPeer {
  initialize?(params: {
    clientInfo: { name: string; title: string; version: string };
    capabilities?: {
      experimentalApi?: boolean;
      optOutNotificationMethods?: string[];
    };
  }): Promise<unknown>;
  request(method: string, params?: unknown): Promise<unknown>;
  onNotification(listener: (notification: unknown) => void): () => void;
}

export interface CodexBrowserTuiAppServerSession {
  peer: CodexBrowserTuiAppServerPeer;
  ready: Promise<void>;
  dispose(): void;
}

export type CodexBrowserTuiAppServerSessionFactory = (
  context: CodexCliShellCommandContext,
) => CodexBrowserTuiAppServerSession | Promise<CodexBrowserTuiAppServerSession>;

export interface CodexCliBrowserLoginHandlerRequest {
  login: CodexCliBrowserLoginRequest;
  context: CodexCliShellCommandContext;
  source: "command" | "tui";
}

export type CodexCliBrowserLoginHandler = (
  request: CodexCliBrowserLoginHandlerRequest,
) => Promise<CodexCliShellCommandResult> | CodexCliShellCommandResult;

export interface CreateCodexCliShellCommandOptions {
  trusted?: boolean;
  createRunner(
    context: CodexCliShellCommandContext,
  ): CodexCliShellCommandRunner | Promise<CodexCliShellCommandRunner>;
  requestBrowserLogin?: CodexCliBrowserLoginHandler;
  createAppServerSession?: CodexBrowserTuiAppServerSessionFactory;
}

export interface CreateBrowserCodexCliShellCommandOptions extends Omit<
  CodexCliBrowserSessionOptions,
  "defaultCwd" | "env"
> {
  defaultCwd?: string;
  env?: Record<string, string>;
  requestBrowserLogin?: CodexCliBrowserLoginHandler;
  createAppServerSession?: CodexBrowserTuiAppServerSessionFactory;
}

export function createCodexCliShellCommand(
  options: CreateCodexCliShellCommandOptions,
): CodexCliShellCommandDefinition {
  return {
    name: "codex",
    trusted: options.trusted,
    interceptShellParsing: true,
    async execute(args, context) {
      const runner = await options.createRunner(context);
      const interactive = shouldRunBrowserInteractiveCodex(args, context);
      try {
        let result: CodexCliShellCommandResult;
        if (interactive) {
          result = await runBrowserInteractiveCodex(
            args,
            context,
            runner,
            options.requestBrowserLogin,
            options.createAppServerSession,
          );
          if (result.env) {
            applyShellResultEnv(context, result.env);
          }
          return result;
        }

        const runArgs = shouldRunBrowserExecPrompt(args)
          ? ["exec", args.join(" ").trim()]
          : args;
        result = await runner.run(runArgs, {
          cwd: context.cwd,
          env: getBrowserCodexEnv(context),
          stdin: context.stdin,
          terminalSize: context.terminalSize,
        });
        if (result.env) {
          applyShellResultEnv(context, result.env);
        }
        if (result.browserLogin) {
          return handleDirectBrowserLoginRequest(
            result.browserLogin,
            context,
            options.requestBrowserLogin,
          );
        }
        return result;
      } finally {
        runner.dispose();
      }
    },
  };
}

export function createBrowserCodexCliShellCommand(
  options: CreateBrowserCodexCliShellCommandOptions,
): CodexCliShellCommandDefinition {
  return createCodexCliShellCommand({
    trusted: true,
    createRunner(context) {
      return createCodexCliBrowserSessionRunner({
        ...options,
        defaultCwd: options.defaultCwd ?? context.cwd,
        env: { ...options.env, ...getBrowserCodexEnv(context) },
      });
    },
    requestBrowserLogin: options.requestBrowserLogin,
    createAppServerSession: options.createAppServerSession,
  });
}

function createCodexCliBrowserSessionRunner(
  options: CodexCliBrowserSessionOptions & { container: CodexHostContainer },
): CodexCliBrowserSession {
  return createCodexCliBrowserSession(options);
}

const CODEX_BROWSER_TUI_SHOW_CURSOR = "\x1b[?25h\x1b[0m";
const CODEX_BROWSER_TUI_FRAME_PREFIX = "\x1b[?25l\x1b[H\x1b[2J";
const CODEX_BROWSER_TUI_FRAME_SUFFIX = "\x1b[?25h";
const CODEX_BROWSER_TUI_NATIVE_SUBCOMMANDS = new Set([
  "a",
  "app-server",
  "apply",
  "archive",
  "cloud",
  "cloud-tasks",
  "completion",
  "debug",
  "doctor",
  "e",
  "exec",
  "exec-server",
  "execpolicy",
  "features",
  "fork",
  "login",
  "logout",
  "mcp",
  "mcp-server",
  "plugin",
  "remote-control",
  "resume",
  "responses-api-proxy",
  "review",
  "sandbox",
  "stdio-to-uds",
  "unarchive",
  "update",
]);

function shouldRunBrowserInteractiveCodex(
  args: string[],
  context: CodexCliShellCommandContext,
): boolean {
  if (context.interactive !== true || !context.onKeypress || !context.signal) {
    return false;
  }
  if (args.length === 0) return true;

  if (
    args.some(
      (arg) =>
        arg === "--help" || arg === "-h" || arg === "--version" || arg === "-V",
    )
  ) {
    return false;
  }

  const first = args[0];
  return Boolean(
    first &&
    !first.startsWith("-") &&
    !CODEX_BROWSER_TUI_NATIVE_SUBCOMMANDS.has(first),
  );
}

function shouldRunBrowserExecPrompt(args: string[]): boolean {
  if (args.length === 0) return false;
  if (
    args.some(
      (arg) =>
        arg === "--help" || arg === "-h" || arg === "--version" || arg === "-V",
    )
  ) {
    return false;
  }

  const first = args[0];
  return Boolean(
    first &&
      !first.startsWith("-") &&
      !CODEX_BROWSER_TUI_NATIVE_SUBCOMMANDS.has(first),
  );
}

async function runBrowserInteractiveCodex(
  args: string[],
  context: CodexCliShellCommandContext,
  runner: CodexCliShellCommandRunner,
  requestBrowserLogin?: CodexCliBrowserLoginHandler,
  createAppServerSession?: CodexBrowserTuiAppServerSessionFactory,
): Promise<CodexCliShellCommandResult> {
  const tuiRunner = createSerializedCodexTuiRunner(runner);
  const appServer = createBrowserTuiAppServerState(createAppServerSession);
  const backgroundTurns = new Set<Promise<void>>();
  const startResult = await tuiRunner.run(
    args.length > 0 ? [args.join(" ").trim()] : [],
    runOptionsForContext(context),
  );
  const startExit = await handleBrowserTuiResult(
    startResult,
    context,
    tuiRunner,
    requestBrowserLogin,
    appServer,
    backgroundTurns,
  );
  if (startExit) return startExit;

  const events = createBrowserTuiEventQueue(context);
  try {
    while (!context.signal?.aborted) {
      const event = await events.next();

      if (event.type === "abort") {
        context.writeStdout(`${CODEX_BROWSER_TUI_SHOW_CURSOR}^C\n`);
        return { stdout: "", stderr: "", exitCode: 130 };
      }

      const eventResult = await tuiRunner.run(
        event.args,
        runOptionsForContext(context),
      );
      const eventExit = await handleBrowserTuiResult(
        eventResult,
        context,
        tuiRunner,
        requestBrowserLogin,
        appServer,
        backgroundTurns,
      );
      if (eventExit) return eventExit;
    }
  } finally {
    events.dispose();
    appServer.dispose();
  }

  context.writeStdout(`${CODEX_BROWSER_TUI_SHOW_CURSOR}\n`);
  return { stdout: "", stderr: "", exitCode: 130 };
}

function createSerializedCodexTuiRunner(
  runner: CodexCliShellCommandRunner,
): CodexCliShellCommandRunner {
  let queue = Promise.resolve();
  return {
    run(args, options) {
      const run = queue.then(() => runner.run(args, options));
      queue = run.then(
        () => undefined,
        () => undefined,
      );
      return run;
    },
    dispose() {
      runner.dispose();
    },
  };
}

async function handleBrowserTuiResult(
  result: CodexCliShellCommandResult,
  context: CodexCliShellCommandContext,
  runner: CodexCliShellCommandRunner,
  requestBrowserLogin?: CodexCliBrowserLoginHandler,
  appServer?: BrowserTuiAppServerState,
  backgroundTurns?: Set<Promise<void>>,
): Promise<CodexCliShellCommandResult | null> {
  writeBrowserTuiOutput(result, context);
  const action = result.browserTui?.action ?? { type: "none" as const };

  if (action.type === "exit") {
    context.writeStdout(
      action.exitCode === 130
        ? `${CODEX_BROWSER_TUI_SHOW_CURSOR}^C\n`
        : CODEX_BROWSER_TUI_SHOW_CURSOR,
    );
    return { stdout: "", stderr: "", exitCode: action.exitCode };
  }

  if (action.type === "login") {
    await handleTuiBrowserLoginRequest(
      { type: "deviceCode" },
      context,
      runner,
      requestBrowserLogin,
    );
    return null;
  }

  if (action.type === "exec") {
    const runOptions = runOptionsForContext(context);
    if (appServer?.available()) {
      const turnTask = runBrowserTuiAppServerTurn(
          action.prompt,
          context,
          runner,
          runOptions,
          appServer,
        ).then((execResult) =>
          renderBrowserTuiAsyncActionResult(
            context,
            runner,
            "exec",
            execResult,
          ),
        );
      trackBrowserTuiBackgroundTurn(backgroundTurns, turnTask, context);
      return null;
    }

    const execResult = await runBrowserTuiExecAction(
          action.prompt,
          context,
          runner,
          runOptions,
        );
    await renderBrowserTuiAsyncActionResult(context, runner, "exec", execResult);
    return null;
  }

  if (action.type === "shell") {
    const shellResult = await context.exec(action.command, {
      cwd: context.cwd,
      env: getBrowserCodexEnv(context),
      stdin: "",
      signal: context.signal,
    });
    if (shellResult.env) {
      applyShellResultEnv(context, shellResult.env);
    }
    const rendered = await appendBrowserTuiActionResult(
      runner,
      context,
      "shell",
      shellResult,
    );
    writeBrowserTuiOutput(rendered, context);
    return null;
  }

  return null;
}

async function renderBrowserTuiAsyncActionResult(
  context: CodexCliShellCommandContext,
  runner: CodexCliShellCommandRunner,
  kind: "exec" | "shell",
  result: Pick<CodexCliShellCommandResult, "stdout" | "stderr" | "exitCode">,
): Promise<void> {
  if (result.stderr) {
    context.writeStderr(result.stderr);
  }
  if (result.stdout || result.stderr || result.exitCode !== 0) {
    const rendered = await appendBrowserTuiActionResult(
      runner,
      context,
      kind,
      result,
    );
    writeBrowserTuiOutput(rendered, context);
  }
}

function trackBrowserTuiBackgroundTurn(
  tasks: Set<Promise<void>> | undefined,
  task: Promise<void>,
  context: Pick<CodexCliShellCommandContext, "writeStderr">,
): void {
  const tracked = task.catch((error) => {
    context.writeStderr(`${browserTuiExecErrorMessage(error)}\n`);
  });
  tasks?.add(tracked);
  void tracked.finally(() => {
    tasks?.delete(tracked);
  });
}

async function runBrowserTuiExecAction(
  prompt: string,
  context: CodexCliShellCommandContext,
  runner: CodexCliShellCommandRunner,
  runOptions: CodexCliRunOptions,
): Promise<CodexCliShellCommandResult> {
  try {
    return await runner.run(["exec", prompt], runOptions);
  } catch (error) {
    return {
      stdout: "",
      stderr: `${browserTuiExecErrorMessage(error)}\n`,
      exitCode: 1,
    };
  }
}

interface BrowserTuiAppServerState {
  available(): boolean;
  get(
    context: CodexCliShellCommandContext,
  ): Promise<BrowserTuiAppServerRuntime>;
  dispose(): void;
}

interface BrowserTuiAppServerRuntime {
  session: CodexBrowserTuiAppServerSession;
  threadId: string;
  unsubscribe: () => void;
  dispose(): void;
  enqueueNotification(notification: unknown): void;
  renderNotificationsWith(listener: (notification: unknown) => void): void;
  waitForTurnComplete(turnId: string, signal?: AbortSignal): Promise<void>;
}

const BROWSER_TUI_APP_SERVER_DISPOSED =
  "Codex browser app-server was disposed.";

function createBrowserTuiAppServerState(
  createAppServerSession?: CodexBrowserTuiAppServerSessionFactory,
): BrowserTuiAppServerState {
  let runtimePromise: Promise<BrowserTuiAppServerRuntime> | null = null;
  let disposed = false;

  return {
    available() {
      return typeof createAppServerSession === "function";
    },
    get(context) {
      if (!createAppServerSession) {
        return Promise.reject(
          new Error("Codex browser app-server is unavailable."),
        );
      }
      if (!runtimePromise) {
        runtimePromise = createBrowserTuiAppServerRuntime(
          context,
          createAppServerSession,
        );
      }
      return runtimePromise;
    },
    dispose() {
      disposed = true;
      if (!runtimePromise) return;
      void runtimePromise
        .then((runtime) => runtime.dispose())
        .catch(() => undefined);
    },
  };

  async function createBrowserTuiAppServerRuntime(
    context: CodexCliShellCommandContext,
    factory: CodexBrowserTuiAppServerSessionFactory,
  ): Promise<BrowserTuiAppServerRuntime> {
    if (disposed) {
      throw new Error("Codex browser app-server was disposed.");
    }
    const effectiveEnv = getBrowserCodexEnv(context);
    const session = await factory({
      ...context,
      env: effectiveEnv,
      getEnv: () => ({ ...effectiveEnv }),
    });
    await session.ready;
    if (typeof session.peer.initialize === "function") {
      await session.peer.initialize({
        clientInfo: {
          name: "almostnode_browser_codex_tui",
          title: "almostnode Browser Codex TUI",
          version: "0.1.0",
        },
        capabilities: { experimentalApi: true },
      });
    }
    const completedTurnIds = new Set<string>();
    const turnWaiters = new Map<
      string,
      { resolve: () => void; reject: (error: Error) => void }
    >();

    let renderNotification: ((notification: unknown) => void) | null = null;

    const runtime: BrowserTuiAppServerRuntime = {
      session,
      threadId: "",
      unsubscribe: () => undefined,
      dispose() {
        renderNotification = null;
        runtime.unsubscribe();
        for (const [turnId, waiter] of turnWaiters) {
          turnWaiters.delete(turnId);
          waiter.reject(new Error(BROWSER_TUI_APP_SERVER_DISPOSED));
        }
        session.dispose();
      },
      enqueueNotification(notification) {
        const turnId = completedTurnIdFromNotification(notification);
        if (turnId) {
          completedTurnIds.add(turnId);
          const waiter = turnWaiters.get(turnId);
          if (waiter) {
            turnWaiters.delete(turnId);
            waiter.resolve();
          }
        }
      },
      renderNotificationsWith(listener) {
        renderNotification = listener;
      },
      waitForTurnComplete(turnId, signal) {
        if (completedTurnIds.has(turnId)) {
          return Promise.resolve();
        }
        if (signal?.aborted) {
          return Promise.reject(new Error("Codex turn aborted."));
        }
        return new Promise((resolve, reject) => {
          const onAbort = () => {
            turnWaiters.delete(turnId);
            reject(new Error("Codex turn aborted."));
          };
          turnWaiters.set(turnId, {
            resolve() {
              signal?.removeEventListener("abort", onAbort);
              resolve();
            },
            reject(error) {
              signal?.removeEventListener("abort", onAbort);
              reject(error);
            },
          });
          signal?.addEventListener("abort", onAbort, { once: true });
        });
      },
    };

    runtime.unsubscribe = session.peer.onNotification((notification) => {
      runtime.enqueueNotification(notification);
      renderNotification?.(notification);
    });

    const threadStart = await session.peer.request("thread/start", {
      model: browserTuiModelId(context),
      cwd: context.cwd,
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "danger-full-access",
      ephemeral: true,
      runtimeWorkspaceRoots: [context.cwd],
    });
    runtime.threadId = threadIdFromThreadStart(threadStart);
    return runtime;
  }
}

async function runBrowserTuiAppServerTurn(
  prompt: string,
  context: CodexCliShellCommandContext,
  runner: CodexCliShellCommandRunner,
  runOptions: CodexCliRunOptions,
  appServer: BrowserTuiAppServerState,
): Promise<CodexCliShellCommandResult> {
  try {
    const runtime = await appServer.get(context);
    let draining = false;
    const queuedNotifications: unknown[] = [];
    runtime.renderNotificationsWith((notification) => {
      queuedNotifications.push(notification);
      void drainQueuedNotifications();
    });

    async function drainQueuedNotifications(): Promise<void> {
      if (draining) return;
      draining = true;
      try {
        while (queuedNotifications.length > 0) {
          const notification = queuedNotifications.shift();
          if (!notification) continue;
          const rendered = await appendBrowserTuiServerNotification(
            runner,
            context,
            notification,
            runOptions,
          );
          writeBrowserTuiOutput(rendered, context);
        }
      } finally {
        draining = false;
        if (queuedNotifications.length > 0) {
          void drainQueuedNotifications();
        }
      }
    }

    const turnStart = await runtime.session.peer.request("turn/start", {
      threadId: runtime.threadId,
      clientUserMessageId: `browser-user-message-${Date.now()}`,
      input: [{ type: "text", text: prompt }],
      cwd: context.cwd,
      runtimeWorkspaceRoots: [context.cwd],
    });
    const turnId = turnIdFromTurnStart(turnStart);
    await runtime.waitForTurnComplete(turnId, context.signal);
    await drainQueuedNotifications();
    return { stdout: "", stderr: "", exitCode: 0 };
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === BROWSER_TUI_APP_SERVER_DISPOSED
    ) {
      return { stdout: "", stderr: "", exitCode: 0 };
    }
    return {
      stdout: "",
      stderr: `${browserTuiExecErrorMessage(error)}\n`,
      exitCode: 1,
    };
  }
}

async function appendBrowserTuiServerNotification(
  runner: CodexCliShellCommandRunner,
  context: CodexCliShellCommandContext,
  notification: unknown,
  runOptions: CodexCliRunOptions,
): Promise<CodexCliShellCommandResult> {
  return runner.run(
    [
      "debug",
      "browser-tui-notification",
      "--json",
      JSON.stringify(notification),
    ],
    {
      ...runOptions,
      cwd: context.cwd,
      env: getBrowserCodexEnv(context),
      terminalSize: context.terminalSize,
    },
  );
}

function browserTuiModelId(context: CodexCliShellCommandContext): string {
  const env = getBrowserCodexEnv(context);
  return env.CODEX_MODEL?.trim() || env.OPENAI_MODEL?.trim() || "gpt-5.5";
}

function threadIdFromThreadStart(value: unknown): string {
  const thread =
    value && typeof value === "object"
      ? (value as { thread?: { id?: unknown } }).thread
      : undefined;
  const threadId = typeof thread?.id === "string" ? thread.id : "";
  if (!threadId) {
    throw new Error(
      "Codex app-server thread/start did not return a thread id.",
    );
  }
  return threadId;
}

function turnIdFromTurnStart(value: unknown): string {
  const turn =
    value && typeof value === "object"
      ? (value as { turn?: { id?: unknown } }).turn
      : undefined;
  const turnId = typeof turn?.id === "string" ? turn.id : "";
  if (!turnId) {
    throw new Error("Codex app-server turn/start did not return a turn id.");
  }
  return turnId;
}

function completedTurnIdFromNotification(notification: unknown): string | null {
  if (!notification || typeof notification !== "object") return null;
  const candidate = notification as {
    method?: unknown;
    params?: { turn?: { id?: unknown } };
  };
  if (candidate.method !== "turn/completed") return null;
  const turnId = candidate.params?.turn?.id;
  return typeof turnId === "string" ? turnId : null;
}

function browserTuiExecErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return `codex exec failed in the browser: ${error.message}`;
  }
  return "codex exec failed in the browser.";
}

async function handleDirectBrowserLoginRequest(
  login: CodexCliBrowserLoginRequest,
  context: CodexCliShellCommandContext,
  requestBrowserLogin?: CodexCliBrowserLoginHandler,
): Promise<CodexCliShellCommandResult> {
  const result = await runBrowserLoginRequest(
    login,
    context,
    "command",
    requestBrowserLogin,
  );
  if (result.env) {
    applyShellResultEnv(context, result.env);
  }
  return result;
}

async function handleTuiBrowserLoginRequest(
  login: CodexCliBrowserLoginRequest,
  context: CodexCliShellCommandContext,
  runner: CodexCliShellCommandRunner,
  requestBrowserLogin?: CodexCliBrowserLoginHandler,
): Promise<void> {
  const loginResult = await runBrowserLoginRequest(
    login,
    context,
    "tui",
    requestBrowserLogin,
  );
  if (loginResult.env) {
    applyShellResultEnv(context, loginResult.env);
  }
  if (loginResult.stdout) {
    context.writeStdout(loginResult.stdout);
  }
  if (loginResult.stderr) {
    context.writeStderr(loginResult.stderr);
  }

  const rendered = await runner.run(
    ["debug", "browser-tui-event", "--type", "draw"],
    runOptionsForContext(context),
  );
  writeBrowserTuiOutput(rendered, context);
}

async function runBrowserLoginRequest(
  login: CodexCliBrowserLoginRequest,
  context: CodexCliShellCommandContext,
  source: CodexCliBrowserLoginHandlerRequest["source"],
  requestBrowserLogin?: CodexCliBrowserLoginHandler,
): Promise<CodexCliShellCommandResult> {
  if (!requestBrowserLogin) {
    return {
      stdout: "",
      stderr:
        "codex login requires a browser login host. Connect Codex in Keychain or provide OPENAI_API_KEY, CODEX_API_KEY, or CODEX_ACCESS_TOKEN.\n",
      exitCode: 78,
    };
  }

  return requestBrowserLogin({ login, context, source });
}

async function appendBrowserTuiActionResult(
  runner: CodexCliShellCommandRunner,
  context: CodexCliShellCommandContext,
  kind: "exec" | "shell",
  result: Pick<CodexCliShellCommandResult, "stdout" | "stderr" | "exitCode">,
): Promise<CodexCliShellCommandResult> {
  return runner.run(
    [
      "debug",
      "browser-tui-result",
      "--kind",
      kind,
      "--stdout",
      result.stdout,
      "--stderr",
      result.stderr,
      "--exit-code",
      String(result.exitCode),
    ],
    runOptionsForContext(context),
  );
}

function writeBrowserTuiOutput(
  result: CodexCliShellCommandResult,
  context: CodexCliShellCommandContext,
): void {
  if (result.browserTui?.ansi) {
    context.writeStdout(
      `${CODEX_BROWSER_TUI_FRAME_PREFIX}${result.browserTui.ansi}${browserTuiCursorAnsi(result.browserTui)}${CODEX_BROWSER_TUI_FRAME_SUFFIX}`,
    );
  } else if (result.stdout) {
    context.writeStdout(result.stdout);
  }
  if (result.stderr) {
    context.writeStderr(result.stderr);
  }
}

function browserTuiCursorAnsi(result: CodexCliBrowserTuiResult): string {
  const cursor = result.cursor;
  if (!cursor) return "";
  const row = Math.max(1, Math.floor(cursor.y) + 1);
  const column = Math.max(1, Math.floor(cursor.x) + 1);
  return `\x1b[${row};${column}H`;
}

function runOptionsForContext(
  context: CodexCliShellCommandContext,
): CodexCliRunOptions {
  return {
    cwd: context.cwd,
    env: getBrowserCodexEnv(context),
    stdin: context.stdin,
    terminalSize: context.terminalSize,
  };
}

function applyShellResultEnv(
  context: CodexCliShellCommandContext,
  env: Record<string, string>,
): void {
  const previousPwd = context.cwd;
  for (const [name, value] of Object.entries(env)) {
    context.setEnv(name, value);
  }
  if (env.PWD && env.PWD !== previousPwd) {
    context.setCwd(env.PWD);
  }
}

const CODEX_BROWSER_AUTH_PATHS = [
  "/home/user/.codex/auth.json",
  "/root/.codex/auth.json",
  "/.codex/auth.json",
];

function getBrowserCodexEnv(
  context: Pick<CodexCliShellCommandContext, "getEnv" | "vfs">,
): Record<string, string> {
  const env = context.getEnv();
  const authEnv = readBrowserCodexAuthEnv(context.vfs);
  return {
    CODEX_CLI_VERSION: DEFAULT_BROWSER_CODEX_CLI_VERSION,
    ...authEnv,
    ...env,
  };
}

function readBrowserCodexAuthEnv(vfs: unknown): Record<string, string> {
  const reader =
    vfs && typeof vfs === "object"
      ? (vfs as {
          existsSync?: (path: string) => boolean;
          readFileSync?: (path: string, encoding?: string) => unknown;
        })
      : null;
  if (
    !reader ||
    typeof reader.existsSync !== "function" ||
    typeof reader.readFileSync !== "function"
  ) {
    return {};
  }

  for (const path of CODEX_BROWSER_AUTH_PATHS) {
    let raw: unknown;
    try {
      if (!reader.existsSync(path)) {
        continue;
      }
      raw = reader.readFileSync(path, "utf8");
    } catch {
      continue;
    }

    const parsed = parseBrowserCodexAuth(raw);
    if (parsed) {
      return parsed;
    }
  }

  return {};
}

function parseBrowserCodexAuth(raw: unknown): Record<string, string> | null {
  const text =
    typeof raw === "string"
      ? raw
      : raw instanceof Uint8Array
        ? new TextDecoder().decode(raw)
        : "";
  if (!text.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(text) as {
      OPENAI_API_KEY?: unknown;
      openai_api_key?: unknown;
      agent_identity?: unknown;
      tokens?: {
        access_token?: unknown;
        accessToken?: unknown;
        account_id?: unknown;
        accountId?: unknown;
        id_token?:
          | string
          | {
              chatgpt_account_id?: unknown;
              chatgpt_account_is_fedramp?: unknown;
            };
      };
    };
    const apiKey =
      typeof parsed.OPENAI_API_KEY === "string"
        ? parsed.OPENAI_API_KEY.trim()
        : typeof parsed.openai_api_key === "string"
          ? parsed.openai_api_key.trim()
          : "";
    const rawAccessToken =
      parsed.tokens?.access_token ??
      parsed.tokens?.accessToken ??
      parsed.agent_identity;
    const accessToken =
      typeof rawAccessToken === "string" ? rawAccessToken.trim() : "";
    const rawAccountId =
      parsed.tokens?.account_id ??
      parsed.tokens?.accountId ??
      (typeof parsed.tokens?.id_token === "object" &&
      parsed.tokens.id_token !== null
        ? parsed.tokens.id_token.chatgpt_account_id
        : undefined);
    const idTokenInfo =
      typeof parsed.tokens?.id_token === "string"
        ? parseCodexIdTokenPayload(parsed.tokens.id_token)
        : null;
    const accountId =
      typeof rawAccountId === "string"
        ? rawAccountId.trim()
        : (idTokenInfo?.chatgpt_account_id?.trim() ?? "");
    const env: Record<string, string> = {};
    if (apiKey) {
      env.OPENAI_API_KEY = apiKey;
      env.CODEX_API_KEY = apiKey;
    }
    if (accessToken) {
      env.CODEX_ACCESS_TOKEN = accessToken;
    }
    if (accountId) {
      env.CODEX_CHATGPT_ACCOUNT_ID = accountId;
    }
    if (
      (typeof parsed.tokens?.id_token === "object" &&
        parsed.tokens.id_token !== null &&
        parsed.tokens.id_token.chatgpt_account_is_fedramp === true) ||
      idTokenInfo?.chatgpt_account_is_fedramp === true
    ) {
      env.CODEX_CHATGPT_ACCOUNT_IS_FEDRAMP = "true";
    }
    return Object.keys(env).length > 0 ? env : null;
  } catch {
    return null;
  }
}

function parseCodexIdTokenPayload(jwt: string): {
  chatgpt_account_id?: string;
  chatgpt_account_is_fedramp?: boolean;
} | null {
  try {
    const [, payload] = jwt.split(".");
    if (!payload || typeof atob !== "function") return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(
      normalized.length + ((4 - (normalized.length % 4)) % 4),
      "=",
    );
    const parsed = JSON.parse(atob(padded)) as {
      "https://api.openai.com/auth"?: {
        chatgpt_account_id?: unknown;
        chatgpt_account_is_fedramp?: unknown;
      };
    };
    const auth = parsed["https://api.openai.com/auth"];
    return {
      chatgpt_account_id:
        typeof auth?.chatgpt_account_id === "string"
          ? auth.chatgpt_account_id
          : undefined,
      chatgpt_account_is_fedramp: auth?.chatgpt_account_is_fedramp === true,
    };
  } catch {
    return null;
  }
}

type BrowserTuiPromptResult =
  | { type: "event"; args: string[] }
  | { type: "abort" };

interface BrowserTuiEventQueue {
  next(): Promise<BrowserTuiPromptResult>;
  dispose(): void;
}

function createBrowserTuiEventQueue(
  context: CodexCliShellCommandContext,
): BrowserTuiEventQueue {
  const queued: BrowserTuiPromptResult[] = [];
  let pendingResolve: ((result: BrowserTuiPromptResult) => void) | undefined;
  let disposed = false;

  const push = (result: BrowserTuiPromptResult): void => {
    if (disposed) return;
    const resolve = pendingResolve;
    if (resolve) {
      pendingResolve = undefined;
      resolve(result);
      return;
    }
    queued.push(result);
  };

  const onAbort = (): void => push({ type: "abort" });
  const unsubscribeKeypress = context.onKeypress?.(
    (
      ch: string | undefined,
      key: {
        sequence?: string;
        name?: string;
        ctrl?: boolean;
        meta?: boolean;
        shift?: boolean;
      },
    ): void => {
      push({
        type: "event",
        args: browserTuiKeyEventArgs(ch, key),
      });
    },
  );
  const unsubscribeResize = context.onResize?.(() => {
    push({
      type: "event",
      args: browserTuiResizeEventArgs(),
    });
  });

  if (context.signal?.aborted) {
    onAbort();
  } else {
    context.signal?.addEventListener("abort", onAbort, { once: true });
  }

  return {
    next() {
      const next = queued.shift();
      if (next) return Promise.resolve(next);
      if (disposed) return Promise.resolve({ type: "abort" });
      return new Promise((resolve) => {
        pendingResolve = resolve;
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribeKeypress?.();
      unsubscribeResize?.();
      context.signal?.removeEventListener("abort", onAbort);
      const resolve = pendingResolve;
      if (resolve) {
        pendingResolve = undefined;
        resolve({ type: "abort" });
      }
      queued.length = 0;
    },
  };
}

function browserTuiResizeEventArgs(): string[] {
  return ["debug", "browser-tui-event", "--type", "resize"];
}

function browserTuiKeyEventArgs(
  ch: string | undefined,
  key: {
    sequence?: string;
    name?: string;
    ctrl?: boolean;
    meta?: boolean;
    shift?: boolean;
  },
): string[] {
  const args = ["debug", "browser-tui-event", "--type", "key"];
  const name = browserTuiKeyName(ch, key);
  if (name) {
    args.push("--name", name);
  }
  if (isBrowserTuiPrintableText(ch, key)) {
    args.push("--text", ch);
  }
  if (key.ctrl) {
    args.push("--ctrl");
  }
  if (key.meta) {
    args.push("--alt");
  }
  if (key.shift) {
    args.push("--shift");
  }
  return args;
}

function browserTuiKeyName(
  ch: string | undefined,
  key: {
    name?: string;
    ctrl?: boolean;
    meta?: boolean;
  },
): string {
  if (
    key.name === "return" ||
    key.name === "enter" ||
    ch === "\r" ||
    ch === "\n"
  ) {
    return "return";
  }
  if (key.name === "backspace" || key.name === "delete") {
    return key.name;
  }
  if (key.name) {
    if (isBrowserTuiPrintableText(ch, key)) return "char";
    return key.name;
  }
  return isBrowserTuiPrintableText(ch, key) ? "char" : "unknown";
}

function isBrowserTuiPrintableText(
  ch: string | undefined,
  key: {
    ctrl?: boolean;
    meta?: boolean;
  },
): ch is string {
  return Boolean(ch && !key.ctrl && !key.meta && ch >= " ");
}
