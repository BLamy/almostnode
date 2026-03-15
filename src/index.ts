/**
 * Mini WebContainers MVP - Main Entry Point
 *
 * Provides a browser-based Node.js-like environment
 * with virtual file system and CommonJS module support
 */

export { VirtualFS } from "./virtual-fs";
export type {
  FSNode,
  Stats,
  FSWatcher,
  WatchListener,
  WatchEventType,
} from "./virtual-fs";
export { Runtime, execute } from "./runtime";
export type { Module, RuntimeOptions, RequireFunction } from "./runtime";
export { createRuntime, WorkerRuntime, SandboxRuntime } from "./create-runtime";
export type {
  IRuntime,
  IExecuteResult,
  CreateRuntimeOptions,
  IRuntimeOptions,
  VFSSnapshot,
} from "./runtime-interface";
export {
  generateSandboxFiles,
  getSandboxHtml,
  getSandboxVercelConfig,
  SANDBOX_SETUP_INSTRUCTIONS,
} from "./sandbox-helpers";
export { createFsShim } from "./shims/fs";
export type { FsShim } from "./shims/fs";
export { createProcess } from "./shims/process";
export type { Process, ProcessEnv } from "./shims/process";
export * as path from "./shims/path";
export * as http from "./shims/http";
export * as net from "./shims/net";
export * as events from "./shims/events";
export * as stream from "./shims/stream";
export * as url from "./shims/url";
export * as querystring from "./shims/querystring";
export * as util from "./shims/util";
export * as npm from "./npm";
export { PackageManager, install } from "./npm";
export type { InstallMode } from "./npm";
export {
  ServerBridge,
  getServerBridge,
  resetServerBridge,
} from "./server-bridge";
export type { InitServiceWorkerOptions } from "./server-bridge";
// Dev servers
export { DevServer } from "./dev-server";
export type { DevServerOptions, ResponseData, HMRUpdate } from "./dev-server";
export { ViteDevServer } from "./frameworks/vite-dev-server";
export type { ViteDevServerOptions } from "./frameworks/vite-dev-server";
export { NextDevServer } from "./frameworks/next-dev-server";
export type { NextDevServerOptions } from "./frameworks/next-dev-server";
// New shims for Vite support
export * as chokidar from "./shims/chokidar";
export * as ws from "./shims/ws";
export * as fsevents from "./shims/fsevents";
export * as readdirp from "./shims/readdirp";
export * as module from "./shims/module";
export * as perf_hooks from "./shims/perf_hooks";
export * as worker_threads from "./shims/worker_threads";
export * as esbuild from "./shims/esbuild";
export * as rollup from "./shims/rollup";
export * as assert from "./shims/assert";

// Demo exports
export {
  createConvexAppProject,
  initConvexAppDemo,
  startConvexAppDevServer,
  PACKAGE_JSON as CONVEX_APP_PACKAGE_JSON,
  DEMO_PACKAGES as CONVEX_APP_DEMO_PACKAGES,
} from "./convex-app-demo";

import { VirtualFS } from "./virtual-fs";
import { Runtime, RuntimeOptions } from "./runtime";
import { PackageManager } from "./npm";
import { almostnodeDebugLog } from "./utils/debug";
import type { InstallMode, PackageManagerMutationSummary } from "./npm";
import { ServerBridge, getServerBridge } from "./server-bridge";
import {
  initChildProcess,
  stripInternalChildProcessEnv,
} from "./shims/child_process";
import type { IExecuteResult } from "./runtime-interface";

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface RunOptions {
  cwd?: string;
  /** Environment variables for this command invocation */
  env?: Record<string, string>;
  /** Callback for streaming stdout chunks as they arrive (for long-running commands like vitest watch) */
  onStdout?: (data: string) => void;
  /** Callback for streaming stderr chunks as they arrive */
  onStderr?: (data: string) => void;
  /** AbortSignal to cancel long-running commands */
  signal?: AbortSignal;
  /** Keep the command alive while it has active stdin listeners (for interactive CLI prompts) */
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
  /** Keep the command attached to the session until it explicitly exits or is aborted. */
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
  /** Base path prefix for subpath deployments (e.g. '/almostnode' for GitHub Pages) */
  basePath?: string;
  onServerReady?: (port: number, url: string) => void;
  git?: GitAuthOptions;
  installMode?: InstallMode;
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

/**
 * Create a new WebContainer-like environment
 */
export function createContainer(options?: ContainerOptions): {
  vfs: VirtualFS;
  runtime: Runtime;
  npm: PackageManager;
  serverBridge: ServerBridge;
  execute: (code: string, filename?: string) => Promise<IExecuteResult>;
  runFile: (filename: string) => Promise<IExecuteResult>;
  run: (command: string, options?: RunOptions) => Promise<RunResult>;
  createTerminalSession: (options?: TerminalSessionOptions) => TerminalSession;
  setGitAuth: (updates: Partial<MutableGitAuth>) => void;
  getGitAuth: () => GitAuthOptions;
  sendInput: (data: string) => void;
  createREPL: () => { eval: (code: string) => Promise<unknown> };
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  setHMRTargetForPort: (port: number, targetWindow: Window) => void;
} {
  const baseEnv: Record<string, string> = { ...(options?.env || {}) };
  let gitAuth = sanitizeGitAuth(options?.git);
  const vfs = new VirtualFS();
  const childProcessController = initChildProcess(vfs, {
    installMode: options?.installMode,
    onInstallMutation: async (summary: PackageManagerMutationSummary) => {
      if (summary.touchesNodeModules) {
        const { clearNpmBundleCache } = await import("./frameworks/npm-serve");
        clearNpmBundleCache();
      }

      if (!(summary.touchesNodeModules || summary.touchesPackageJson)) {
        return;
      }

      for (const server of childProcessController.frameworkDevServers.values()) {
        server.clearInstalledPackagesCache?.();
      }
    },
  });

  const resolveCommandEnv = (
    runEnv?: Record<string, string>,
  ): Record<string, string> => ({
    ...baseEnv,
    ...gitAuthToEnv(gitAuth),
    ...(runEnv || {}),
  });

  const runtimeOptions: RuntimeOptions = {
    ...options,
    env: resolveCommandEnv(),
    childProcessController,
  };
  const runtime = new Runtime(vfs, runtimeOptions);
  const npmManager = new PackageManager(vfs, {
    installMode: options?.installMode,
    onMutation: childProcessController.onInstallMutation || undefined,
  });
  const serverBridge = getServerBridge({
    baseUrl: options?.baseUrl,
    basePath: options?.basePath,
    onServerReady: options?.onServerReady,
  });

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
    return next;
  };

  const createLinkedAbortController = (
    signal?: AbortSignal,
  ): {
    controller: AbortController;
    cleanup: () => void;
  } => {
    const controller = new AbortController();
    if (!signal) {
      return { controller, cleanup: () => {} };
    }

    if (signal.aborted) {
      controller.abort();
      return { controller, cleanup: () => {} };
    }

    const onAbort = () => controller.abort();
    signal.addEventListener("abort", onAbort, { once: true });
    return {
      controller,
      cleanup: () => signal.removeEventListener("abort", onAbort),
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
    almostnodeDebugLog('commands', `runLegacyCommand(${command} ${runOptions}`);
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

  return {
    vfs,
    runtime,
    npm: npmManager,
    serverBridge,
    execute: (code: string, filename?: string) =>
      runtime.execute(code, filename),
    runFile: (filename: string) => runtime.runFile(filename),
    run: (command: string, runOptions?: RunOptions) =>
      runLegacyCommand(command, runOptions),
    createTerminalSession,
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
    setHMRTargetForPort: (port: number, targetWindow: Window) => {
      for (const server of childProcessController.frameworkDevServers.values()) {
        if (server.port === port) {
          server.setHMRTarget?.(targetWindow);
          return;
        }
      }
    },
  };
}

export default createContainer;
