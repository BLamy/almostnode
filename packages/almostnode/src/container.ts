import { VirtualFS } from "./virtual-fs";
import { Runtime, type RuntimeOptions } from "./runtime";
import { PackageManager } from "./npm";
import { almostnodeDebugLog } from "./utils/debug";
import type { InstallMode, PackageManagerMutationSummary } from "./npm";
import {
  createNetworkController,
  hasExplicitDefaultNetworkController,
  NETWORK_ENV_KEYS,
  setDefaultNetworkController,
} from "./network";
import { ServerBridge, getServerBridge } from "./server-bridge";
import type { ServerRegistrationMetadata } from "./server-bridge";
import {
  disposeChildProcessController,
  initChildProcess,
  stripInternalChildProcessEnv,
} from "./shims/child_process";
import { closeServersByOwner as closeHttpServersByOwner } from "./shims/http";
import type { ShellCommandDefinition } from "./shell-commands";
import type { IExecuteResult } from "./runtime-interface";
import type { WorkspaceSearchProvider } from "./shims/child_process";
import type {
  NetworkController,
  NetworkIntegration,
  NetworkOptions,
} from "./network/types";

export type {
  WorkspaceSearchProvider,
  WorkspaceSearchOptions,
  WorkspaceSearchResult,
  WorkspaceSearchMatch,
  WorkspaceSearchFileResult,
} from "./shims/child_process";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  signal?: AbortSignal;
  interactive?: boolean;
}

export interface TerminalSessionOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export interface TerminalSessionRunOptions {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  signal?: AbortSignal;
  interactive?: boolean;
}

export interface TerminalSessionState {
  cwd: string;
  env: Record<string, string>;
  running: boolean;
}

export interface TerminalSession {
  run: (
    command: string,
    options?: TerminalSessionRunOptions,
  ) => Promise<RunResult>;
  sendInput: (data: string) => void;
  resize: (cols: number, rows: number) => void;
  abort: () => void;
  dispose: () => void;
  getState: () => TerminalSessionState;
}

export interface GitAuthOptions {
  token?: string;
  username?: string;
  password?: string;
  corsProxy?: string;
  authorName?: string;
  authorEmail?: string;
}

export interface MutableGitAuth {
  token?: string | null;
  username?: string | null;
  password?: string | null;
  corsProxy?: string | null;
  authorName?: string | null;
  authorEmail?: string | null;
}

export interface ContainerOptions extends RuntimeOptions {
  baseUrl?: string;
  basePath?: string;
  onServerReady?: (port: number, url: string) => void;
  git?: GitAuthOptions;
  installMode?: InstallMode;
  shellCommands?: ShellCommandDefinition[];
  network?: NetworkOptions;
  networkIntegration?: NetworkIntegration;
}

export interface ContainerInstance {
  /** Unique id for this container (used as ServerRegistrationMetadata.ownerId). */
  id: string;
  vfs: VirtualFS;
  runtime: Runtime;
  network: NetworkController;
  npm: PackageManager;
  serverBridge: ServerBridge;
  execute: (code: string, filename?: string) => Promise<IExecuteResult>;
  runFile: (filename: string) => Promise<IExecuteResult>;
  run: (command: string, options?: RunOptions) => Promise<RunResult>;
  createTerminalSession: (options?: TerminalSessionOptions) => TerminalSession;
  registerShellCommand: (definition: ShellCommandDefinition) => void;
  unregisterShellCommand: (name: string) => boolean;
  setGitAuth: (updates: Partial<MutableGitAuth>) => void;
  getGitAuth: () => GitAuthOptions;
  sendInput: (data: string) => void;
  createREPL: () => { eval: (code: string) => Promise<unknown> };
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  setKeychain: (kc: { persistCurrentState(): Promise<void> }) => void;
  setSearchProvider: (provider: WorkspaceSearchProvider) => void;
  setHMRTargetForPort: (port: number, targetWindow: Window | null) => void;
  /**
   * Tear down this container: abort running commands, stop its framework dev
   * servers, and unregister its servers from the shared bridge.
   */
  dispose: () => void;
}

const GIT_ENV_KEYS = [
  "GIT_TOKEN",
  "GIT_USERNAME",
  "GIT_PASSWORD",
  "GIT_CORS_PROXY",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
] as const;

function sanitizeGitAuth(input?: GitAuthOptions): GitAuthOptions {
  if (!input) return {};
  const trim = (value: string | undefined): string | undefined => {
    const next = value?.trim();
    return next ? next : undefined;
  };
  return {
    token: trim(input.token),
    username: trim(input.username),
    password: trim(input.password),
    corsProxy: trim(input.corsProxy),
    authorName: trim(input.authorName),
    authorEmail: trim(input.authorEmail),
  };
}

function gitAuthToEnv(auth: GitAuthOptions): Record<string, string> {
  const env: Record<string, string> = {};
  if (auth.token) env.GIT_TOKEN = auth.token;
  if (auth.username) env.GIT_USERNAME = auth.username;
  if (auth.password) env.GIT_PASSWORD = auth.password;
  if (auth.corsProxy) env.GIT_CORS_PROXY = auth.corsProxy;
  if (auth.authorName) env.GIT_AUTHOR_NAME = auth.authorName;
  if (auth.authorEmail) env.GIT_AUTHOR_EMAIL = auth.authorEmail;
  return env;
}

export function createContainer(options?: ContainerOptions): ContainerInstance {
  const containerId = crypto.randomUUID();
  const baseEnv: Record<string, string> = { ...(options?.env || {}) };
  let gitAuth = sanitizeGitAuth(options?.git);
  const vfs = new VirtualFS();
  const networkController = createNetworkController(
    options?.network,
    options?.networkIntegration ?? null,
  );
  // Set-if-unset: the first container becomes the page default; later
  // containers keep their controller scoped via runtimeOptions.networkController.
  if (!hasExplicitDefaultNetworkController()) {
    setDefaultNetworkController(networkController);
  }
  const childProcessController = initChildProcess(vfs, {
    installMode: options?.installMode,
    containerId,
    onInstallMutation: async (summary: PackageManagerMutationSummary) => {
      if (summary.touchesNodeModules) {
        const { clearNpmBundleCache } = await import("./frameworks/npm-serve");
        clearNpmBundleCache(vfs);
      }

      if (!(summary.touchesNodeModules || summary.touchesPackageJson)) {
        return;
      }

      for (const server of childProcessController.frameworkDevServers.values()) {
        server.clearInstalledPackagesCache?.();
      }
    },
  });

  for (const command of options?.shellCommands || []) {
    childProcessController.registerShellCommand(command);
  }

  const resolveCommandEnv = (
    runEnv?: Record<string, string>,
  ): Record<string, string> => ({
    ...networkController.getResolvedPolicy().env,
    ...baseEnv,
    ...gitAuthToEnv(gitAuth),
    ...(runEnv || {}),
  });

  const runtimeOptions: RuntimeOptions = {
    ...options,
    env: resolveCommandEnv(),
    childProcessController,
    networkController,
    // Servers created inside this runtime attribute to this container.
    ownerId: containerId,
  };
  const runtime = new Runtime(vfs, runtimeOptions);
  const npmManager = new PackageManager(vfs, {
    cwd: options?.cwd ?? runtime.getProcess().cwd(),
    installMode: options?.installMode,
    onMutation: childProcessController.onInstallMutation || undefined,
  });
  const serverBridge = getServerBridge({
    baseUrl: options?.baseUrl,
    basePath: options?.basePath,
  });

  // Subscribe via the bridge event rather than BridgeOptions.onServerReady:
  // the bridge is a singleton, so constructor options from the 2nd+ container
  // would be silently ignored. Filter to servers this container owns (servers
  // registered without an ownerId — e.g. raw http.listen — notify everyone).
  const handleServerReady = (...args: unknown[]) => {
    const [port, url, metadata] = args as [
      number,
      string,
      ServerRegistrationMetadata | undefined,
    ];
    if (metadata?.ownerId && metadata.ownerId !== containerId) return;
    options?.onServerReady?.(port, url);
  };
  if (options?.onServerReady) {
    serverBridge.on("server-ready", handleServerReady);
  }

  const syncRuntimeEnvWithGitAuth = () => {
    const proc = runtime.getProcess();
    const env = proc.env;
    for (const key of GIT_ENV_KEYS) {
      delete env[key];
    }
    Object.assign(env, gitAuthToEnv(gitAuth));
  };

  syncRuntimeEnvWithGitAuth();

  let legacyActiveExecutionId: string | null = null;

  const sanitizeSessionEnv = (
    env: Record<string, string>,
  ): Record<string, string> => {
    const next = stripInternalChildProcessEnv(env);
    for (const key of GIT_ENV_KEYS) {
      delete next[key];
    }
    for (const key of NETWORK_ENV_KEYS) {
      delete next[key];
    }
    return next;
  };

  // Tracked so dispose() can abort everything this container is running.
  const activeAbortControllers = new Set<AbortController>();

  const createLinkedAbortController = (
    signal?: AbortSignal,
  ): {
    controller: AbortController;
    cleanup: () => void;
  } => {
    const controller = new AbortController();
    activeAbortControllers.add(controller);
    const untrack = () => activeAbortControllers.delete(controller);
    if (!signal) {
      return { controller, cleanup: untrack };
    }

    if (signal.aborted) {
      controller.abort();
      return { controller, cleanup: untrack };
    }

    const onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    return {
      controller,
      cleanup: () => {
        untrack();
        signal.removeEventListener("abort", onAbort);
      },
    };
  };

  const toRunResult = (result: {
    stdout?: string;
    stderr?: string;
    exitCode: number;
  }): RunResult => ({
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || ""),
    exitCode: result.exitCode,
  });

  const runLegacyCommand = async (
    command: string,
    runOptions?: RunOptions,
  ): Promise<RunResult> => {
    almostnodeDebugLog("commands", `runLegacyCommand(${command} ${runOptions}`);
    if (runOptions?.signal?.aborted) {
      return { stdout: "", stderr: "", exitCode: 130 };
    }

    const resolvedCwd = runOptions?.cwd ?? runtime.getProcess().cwd();
    const env = resolveCommandEnv(runOptions?.env);
    const { controller, cleanup } = createLinkedAbortController(
      runOptions?.signal,
    );
    const execution = childProcessController.createExecution({
      onStdout: runOptions?.onStdout,
      onStderr: runOptions?.onStderr,
      signal: controller.signal,
      interactive: runOptions?.interactive,
    });
    legacyActiveExecutionId = execution.id;

    try {
      const result = await childProcessController.runCommand(
        command,
        { cwd: resolvedCwd, env },
        execution.id,
      );
      return toRunResult({
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      });
    } finally {
      if (legacyActiveExecutionId === execution.id) {
        legacyActiveExecutionId = null;
      }
      cleanup();
      childProcessController.destroyExecution(execution.id);
    }
  };

  const createTerminalSession = (
    sessionOptions?: TerminalSessionOptions,
  ): TerminalSession => {
    let disposed = false;
    let activeExecutionId: string | null = null;
    let activeAbortController: AbortController | null = null;
    const state: TerminalSessionState = {
      cwd: sessionOptions?.cwd ?? runtime.getProcess().cwd(),
      env: sanitizeSessionEnv(sessionOptions?.env || {}),
      running: false,
    };

    return {
      run: async (
        command: string,
        sessionRunOptions?: TerminalSessionRunOptions,
      ): Promise<RunResult> => {
        if (disposed) {
          throw new Error("Terminal session has been disposed");
        }
        if (state.running) {
          throw new Error("Terminal session is already running a command");
        }
        if (sessionRunOptions?.signal?.aborted) {
          return { stdout: "", stderr: "", exitCode: 130 };
        }

        const { controller, cleanup } = createLinkedAbortController(
          sessionRunOptions?.signal,
        );
        const execution = childProcessController.createExecution({
          onStdout: sessionRunOptions?.onStdout,
          onStderr: sessionRunOptions?.onStderr,
          signal: controller.signal,
          interactive: sessionRunOptions?.interactive,
          cols: Number(state.env.COLUMNS || 80),
          rows: Number(state.env.LINES || 24),
        });

        state.running = true;
        activeExecutionId = execution.id;
        activeAbortController = controller;

        try {
          const result = await childProcessController.runCommand(
            command,
            {
              cwd: state.cwd,
              env: resolveCommandEnv(state.env),
            },
            execution.id,
          );

          if (result.env) {
            const nextEnv = sanitizeSessionEnv(result.env);
            state.cwd = nextEnv.PWD || state.cwd;
            state.env = nextEnv;
          }

          return toRunResult({
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          });
        } finally {
          cleanup();
          state.running = false;
          activeAbortController = null;
          activeExecutionId = null;
          childProcessController.destroyExecution(execution.id);
        }
      },
      sendInput: (data: string) => {
        if (!activeExecutionId) return;
        childProcessController.sendInput(activeExecutionId, data);
      },
      resize: (cols: number, rows: number) => {
        const normalizedCols = Number.isFinite(cols)
          ? Math.max(1, Math.floor(cols))
          : 80;
        const normalizedRows = Number.isFinite(rows)
          ? Math.max(1, Math.floor(rows))
          : 24;
        state.env = {
          ...state.env,
          COLUMNS: String(normalizedCols),
          LINES: String(normalizedRows),
        };
        if (activeExecutionId) {
          childProcessController.updateExecutionSize(
            activeExecutionId,
            normalizedCols,
            normalizedRows,
          );
        }
      },
      abort: () => {
        activeAbortController?.abort();
      },
      dispose: () => {
        disposed = true;
        activeAbortController?.abort();
      },
      getState: () => ({
        cwd: state.cwd,
        env: { ...state.env },
        running: state.running,
      }),
    };
  };

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    serverBridge.off("server-ready", handleServerReady);
    for (const controller of activeAbortControllers) {
      controller.abort();
    }
    activeAbortControllers.clear();
    // Stops framework dev servers (which unregister their bridge ports) and
    // drops the controller from the child_process registries.
    disposeChildProcessController(childProcessController);
    // Raw `node server.js` servers outlive their terminal command by
    // design, so nothing above closed them — and the http server registry
    // is page-global. Close them or this container's ports would
    // EADDRINUSE every other container until a page reload.
    closeHttpServersByOwner(containerId);
    serverBridge.unregisterServersByOwner(containerId);
  };

  return {
    id: containerId,
    vfs,
    runtime,
    network: networkController,
    npm: npmManager,
    serverBridge,
    execute: (code: string, filename?: string) =>
      runtime.execute(code, filename),
    runFile: (filename: string) => runtime.runFile(filename),
    run: (command: string, runOptions?: RunOptions) =>
      runLegacyCommand(command, runOptions),
    createTerminalSession,
    registerShellCommand: (definition: ShellCommandDefinition) => {
      childProcessController.registerShellCommand(definition);
    },
    unregisterShellCommand: (name: string) => {
      return childProcessController.unregisterShellCommand(name);
    },
    setGitAuth: (updates: Partial<MutableGitAuth>) => {
      const next: GitAuthOptions = { ...gitAuth };
      const keys = Object.keys(updates) as Array<keyof MutableGitAuth>;
      for (const key of keys) {
        const value = updates[key];
        if (value === null) {
          delete (next as Record<string, unknown>)[key];
          continue;
        }
        if (typeof value === "string") {
          const trimmed = value.trim();
          if (trimmed) {
            (next as Record<string, unknown>)[key] = trimmed;
          } else {
            delete (next as Record<string, unknown>)[key];
          }
        }
      }
      gitAuth = next;
      syncRuntimeEnvWithGitAuth();
    },
    getGitAuth: () => ({ ...gitAuth }),
    sendInput: (data: string) => {
      if (!legacyActiveExecutionId) return;
      childProcessController.sendInput(legacyActiveExecutionId, data);
    },
    createREPL: () => runtime.createREPL(),
    on: (event: string, listener: (...args: unknown[]) => void) => {
      serverBridge.on(event, listener);
    },
    setKeychain: (kc: { persistCurrentState(): Promise<void> }) => {
      childProcessController.keychain = kc;
    },
    setSearchProvider: (provider: WorkspaceSearchProvider) => {
      childProcessController.searchProvider = provider;
    },
    setHMRTargetForPort: (port: number, targetWindow: Window | null) => {
      for (const server of childProcessController.frameworkDevServers.values()) {
        if (server.port === port) {
          server.setHMRTarget?.(targetWindow);
          return;
        }
      }
    },
    dispose,
  };
}

export default createContainer;
