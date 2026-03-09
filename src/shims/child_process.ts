/**
 * Node.js child_process module shim
 * Uses just-bash for command execution in browser with VirtualFS adapter
 */

// Polyfill process for just-bash (it expects Node.js environment)
if (typeof globalThis.process === 'undefined') {
  (globalThis as any).process = {
    env: {
      HOME: '/home/user',
      USER: 'user',
      PATH: '/usr/local/bin:/usr/bin:/bin',
      NODE_ENV: 'development',
      SHELL: '/bin/bash',
    },
    cwd: () => '/',
    arch: 'x64',
    platform: 'linux',
    version: 'v18.0.0',
    versions: { node: '18.0.0' },
    stdout: { write: () => {} },
    stderr: { write: () => {} },
  };
}

import { Bash, defineCommand } from 'just-bash';
import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import { EventEmitter } from './events';
import { writeToFdSync } from './fs';
import { Readable, Writable, Buffer } from './stream';
import type { VirtualFS } from '../virtual-fs';
import { VirtualFSAdapter } from './vfs-adapter';
import { Runtime } from '../runtime';
import type { PackageJson } from '../types/package-json';
import * as path from './path';
import { extractTarball } from '../npm/tarball';
import {
  DEFAULT_POSIX_SHELL,
  SYNTHETIC_SHELL_COMMAND_NAMES,
  getSyntheticShellSpec,
  getSyntheticShellVersion,
} from './synthetic-shells';

type ManagedFrameworkDevServer = {
  key: string;
  framework: 'next' | 'vite';
  port: number;
  stop: () => void;
};

const CONTROLLER_ID_ENV_KEY = '__ALMOSTNODE_CONTROLLER_ID';
const EXECUTION_ID_ENV_KEY = '__ALMOSTNODE_EXECUTION_ID';
const INTERNAL_ENV_KEYS = [CONTROLLER_ID_ENV_KEY, EXECUTION_ID_ENV_KEY] as const;

const DEFAULT_SHELL_ENV: Record<string, string> = {
  HOME: '/home/user',
  USER: 'user',
  PATH: '/usr/local/bin:/usr/bin:/bin:/node_modules/.bin',
  NODE_ENV: 'development',
  SHELL: DEFAULT_POSIX_SHELL,
};

interface ActiveProcessStdin {
  emit: (event: string, ...args: unknown[]) => void;
  listenerCount?: (event: string) => number;
}

export interface ChildProcessExecutionContext {
  id: string;
  controllerId: string;
  onStdout: ((data: string) => void) | null;
  onStderr: ((data: string) => void) | null;
  signal: AbortSignal | null;
  activeProcessStdin: ActiveProcessStdin | null;
  activeForkedChildren: number;
  onForkedChildExit: (() => void) | null;
  activeShellChildren: number;
  /** Set to true by command handlers (e.g. node) that stream their own output via onStdout/onStderr */
  outputStreamed: boolean;
}

export interface ChildProcessController {
  id: string;
  vfs: VirtualFS;
  vfsAdapter: VirtualFSAdapter;
  bashInstance: Bash;
  frameworkDevServers: Map<string, ManagedFrameworkDevServer>;
  executions: Map<string, ChildProcessExecutionContext>;
  createExecution: (opts?: {
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
    signal?: AbortSignal;
  }) => ChildProcessExecutionContext;
  destroyExecution: (executionId: string | null | undefined) => void;
  runCommand: (
    command: string,
    options?: { cwd?: string; env?: Record<string, string> },
    executionId?: string | null
  ) => Promise<JustBashExecResult>;
  sendInput: (executionId: string | null | undefined, data: string) => void;
}

export interface ChildProcessModuleBinding {
  controller?: ChildProcessController | null;
  getDefaultCwd?: () => string;
  getDefaultEnv?: () => Record<string, string>;
  getExecutionId?: () => string | null;
}

const controllersByVfs = new WeakMap<VirtualFS, ChildProcessController>();
const controllersById = new Map<string, ChildProcessController>();
let defaultChildProcessController: ChildProcessController | null = null;

// Patch Object.defineProperty globally to force configurable: true on globalThis properties.
// In real Node.js, each process has its own globalThis. In our browser environment,
// all forks share globalThis, so libraries like vitest that define non-configurable
// properties (e.g. __vitest_index__) need them to be configurable for re-runs.
const _realDefineProperty = Object.defineProperty;
Object.defineProperty = function(target: object, key: PropertyKey, descriptor: PropertyDescriptor): object {
  if (target === globalThis && descriptor && !descriptor.configurable) {
    descriptor = { ...descriptor, configurable: true };
  }
  return _realDefineProperty.call(Object, target, key, descriptor) as object;
} as typeof Object.defineProperty;

// Legacy compatibility hooks used by existing tests and callers that still rely
// on the singleton-style "next command" streaming configuration.
let legacyStreamingCallbacks: {
  onStdout: ((data: string) => void) | null;
  onStderr: ((data: string) => void) | null;
  signal: AbortSignal | null;
} = {
  onStdout: null,
  onStderr: null,
  signal: null,
};

/**
 * Set streaming callbacks for the next command execution.
 * Used by container.run() to enable streaming output from custom commands.
 */
export function setStreamingCallbacks(opts: {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  signal?: AbortSignal;
}): void {
  legacyStreamingCallbacks = {
    onStdout: opts.onStdout || null,
    onStderr: opts.onStderr || null,
    signal: opts.signal || null,
  };
}

/**
 * Clear streaming callbacks after command execution.
 */
export function clearStreamingCallbacks(): void {
  legacyStreamingCallbacks = {
    onStdout: null,
    onStderr: null,
    signal: null,
  };
}

function createExecutionContext(
  controller: ChildProcessController,
  opts?: {
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
    signal?: AbortSignal;
  }
): ChildProcessExecutionContext {
  const execution: ChildProcessExecutionContext = {
    id: crypto.randomUUID(),
    controllerId: controller.id,
    onStdout: opts?.onStdout || null,
    onStderr: opts?.onStderr || null,
    signal: opts?.signal || null,
    activeProcessStdin: null,
    activeForkedChildren: 0,
    onForkedChildExit: null,
    activeShellChildren: 0,
    outputStreamed: false,
  };
  controller.executions.set(execution.id, execution);
  return execution;
}

function destroyExecutionContext(
  controller: ChildProcessController,
  executionId: string | null | undefined
): void {
  if (!executionId) return;
  controller.executions.delete(executionId);
}

function getControllerById(controllerId: string | undefined | null): ChildProcessController | null {
  if (!controllerId) return null;
  return controllersById.get(controllerId) ?? null;
}

function getActiveController(binding?: ChildProcessModuleBinding, env?: Record<string, string>): ChildProcessController | null {
  return binding?.controller
    ?? getControllerById(env?.[CONTROLLER_ID_ENV_KEY])
    ?? getControllerById(binding?.getDefaultEnv?.()?.[CONTROLLER_ID_ENV_KEY])
    ?? defaultChildProcessController;
}

function getExecutionContextFromEnv(
  controller: ChildProcessController,
  env?: Record<string, string>
): ChildProcessExecutionContext | null {
  const executionId = env?.[EXECUTION_ID_ENV_KEY];
  if (!executionId) return null;
  return controller.executions.get(executionId) ?? null;
}

function getActiveExecutionContext(
  controller: ChildProcessController,
  binding?: ChildProcessModuleBinding,
  env?: Record<string, string>
): ChildProcessExecutionContext | null {
  return getExecutionContextFromEnv(controller, env)
    ?? getExecutionContextFromEnv(controller, binding?.getDefaultEnv?.())
    ?? (binding?.getExecutionId ? controller.executions.get(binding.getExecutionId() || '') ?? null : null);
}

function applyLegacyStreamingDefaults(
  controller: ChildProcessController,
  execution: ChildProcessExecutionContext | null
): ChildProcessExecutionContext {
  if (execution) return execution;
  return createExecutionContext(controller, {
    onStdout: legacyStreamingCallbacks.onStdout || undefined,
    onStderr: legacyStreamingCallbacks.onStderr || undefined,
    signal: legacyStreamingCallbacks.signal || undefined,
  });
}

function withExecutionEnv(
  controller: ChildProcessController,
  execution: ChildProcessExecutionContext,
  env: Record<string, string>
): Record<string, string> {
  return {
    ...env,
    [CONTROLLER_ID_ENV_KEY]: controller.id,
    [EXECUTION_ID_ENV_KEY]: execution.id,
  };
}

export function stripInternalChildProcessEnv(env: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if ((INTERNAL_ENV_KEYS as readonly string[]).includes(key)) continue;
    next[key] = value;
  }
  return next;
}

async function runCommandInController(
  controller: ChildProcessController,
  command: string,
  options?: { cwd?: string; env?: Record<string, string> },
  executionId?: string | null
): Promise<JustBashExecResult> {
  const existingExecution = executionId ? controller.executions.get(executionId) ?? null : null;
  const execution = existingExecution ?? createExecutionContext(controller, {
    onStdout: legacyStreamingCallbacks.onStdout || undefined,
    onStderr: legacyStreamingCallbacks.onStderr || undefined,
    signal: legacyStreamingCallbacks.signal || undefined,
  });
  const ownsExecution = !existingExecution;
  const resolvedCwd = options?.cwd ?? '/';
  const resolvedEnv = addNodeModuleBinPaths(options?.env ? { ...options.env } : {}, resolvedCwd);
  const envWithContext = withExecutionEnv(controller, execution, resolvedEnv);

  execution.activeShellChildren++;
  try {
    const result = await (
      maybeRunSyntheticShellCommand(controller, command, resolvedCwd, envWithContext)
      ?? controller.bashInstance.exec(command, {
        cwd: resolvedCwd,
        env: envWithContext,
      })
    );

    // Stream the result to callbacks for commands that don't handle their own
    // streaming (bash built-ins like ls, cat, echo, pwd, mkdir, etc.).
    // Custom command handlers (node, next, vite, npm install) already call
    // execution.onStdout/onStderr directly and set outputStreamed = true.
    if (!execution.outputStreamed) {
      if (result.stdout && execution.onStdout) execution.onStdout(result.stdout);
      if (result.stderr && execution.onStderr) execution.onStderr(result.stderr);
    }

    return result;
  } finally {
    execution.activeShellChildren = Math.max(0, execution.activeShellChildren - 1);
    if (ownsExecution) {
      destroyExecutionContext(controller, execution.id);
    }
  }
}

function shellQuote(value: string): string {
  return JSON.stringify(value);
}

function normalizeCommandCwd(cwd?: string): string {
  if (!cwd) return '/';
  if (path.isAbsolute(cwd)) return path.normalize(cwd);
  return path.normalize(`/${cwd}`);
}

function resolveFromCwd(cwd: string, candidate: string): string {
  if (path.isAbsolute(candidate)) return path.normalize(candidate);
  return path.normalize(path.join(cwd, candidate));
}

function stopManagedFrameworkServer(controller: ChildProcessController, key: string): void {
  const existing = controller.frameworkDevServers.get(key);
  if (!existing) return;
  try {
    existing.stop();
  } catch {
    // Ignore teardown errors during replacement.
  } finally {
    controller.frameworkDevServers.delete(key);
  }
}

function stopAllManagedFrameworkServers(controller: ChildProcessController): void {
  for (const key of controller.frameworkDevServers.keys()) {
    stopManagedFrameworkServer(controller, key);
  }
}

function stopManagedFrameworkServersOnPort(controller: ChildProcessController, port: number): void {
  for (const [key, server] of controller.frameworkDevServers.entries()) {
    if (server.port === port) {
      stopManagedFrameworkServer(controller, key);
    }
  }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function parsePortValue(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) return null;
  return parsed;
}

function createBridgeServerWrapper(devServer: {
  getPort: () => number;
  handleRequest: (
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: Buffer
  ) => Promise<unknown>;
}) {
  return {
    listening: true,
    address: () => ({
      port: devServer.getPort(),
      address: '0.0.0.0',
      family: 'IPv4',
    }),
    async handleRequest(
      method: string,
      url: string,
      headers: Record<string, string>,
      body?: string | Buffer
    ) {
      const bodyBuffer = body
        ? (typeof body === 'string' ? Buffer.from(body) : body)
        : undefined;
      return devServer.handleRequest(method, url, headers, bodyBuffer);
    },
  };
}

function getDefaultProcessCwd(): string {
  const proc = (globalThis as any).process as { cwd?: () => string } | undefined;
  if (proc && typeof proc.cwd === 'function') {
    try {
      const cwd = proc.cwd();
      if (typeof cwd === 'string' && cwd.length > 0) {
        return cwd;
      }
    } catch {
      // Fall back to root
    }
  }
  return '/';
}

function getDefaultProcessEnv(): Record<string, string> {
  const proc = (globalThis as any).process as { env?: Record<string, string | undefined> } | undefined;
  const env: Record<string, string> = {};
  if (!proc?.env) return env;

  for (const [key, value] of Object.entries(proc.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  return env;
}

function mergeWithDefaultProcessEnv(env?: Record<string, string>): Record<string, string> {
  return {
    ...getDefaultProcessEnv(),
    ...(env || {}),
  };
}

function addNodeModuleBinPaths(env: Record<string, string>, cwd: string): Record<string, string> {
  const pathKey = Object.prototype.hasOwnProperty.call(env, 'PATH')
    ? 'PATH'
    : (Object.prototype.hasOwnProperty.call(env, 'Path') ? 'Path' : 'PATH');
  const current = env[pathKey] || '';
  const segments = current.split(':').filter(Boolean);
  const normalizedCwd = normalizeCommandCwd(cwd || '/');
  const candidateBins = [
    path.normalize(path.join(normalizedCwd, 'node_modules/.bin')),
    '/node_modules/.bin',
  ];

  const nextSegments = [...segments];
  for (let i = candidateBins.length - 1; i >= 0; i--) {
    const candidate = candidateBins[i];
    if (!nextSegments.includes(candidate)) {
      nextSegments.unshift(candidate);
    }
  }

  return {
    ...env,
    [pathKey]: nextSegments.join(':'),
  };
}

function emitStreamData(
  execution: ChildProcessExecutionContext | null,
  output: unknown,
  stream: 'stdout' | 'stderr'
) {
  if (typeof output !== 'string') return;
  if (execution) execution.outputStreamed = true;
  if (stream === 'stdout') {
    execution?.onStdout?.(output);
  } else {
    execution?.onStderr?.(output);
  }
}

function emitBashLog(_message: string, _data: unknown) {
  // just-bash log callbacks do not include per-exec metadata, so streaming
  // built-in shell output cannot be safely attributed across concurrent
  // terminal sessions. Session-aware custom commands stream directly.
}

interface KeypressMeta {
  sequence: string;
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
}

function decodeKeypressEvents(data: string): Array<{ ch: string | undefined; key: KeypressMeta }> {
  const events: Array<{ ch: string | undefined; key: KeypressMeta }> = [];

  const pushKey = (ch: string | undefined, key: KeypressMeta) => {
    events.push({ ch, key });
  };

  let i = 0;
  while (i < data.length) {
    const ch = data[i];

    // Common escape sequences from terminals (arrow keys)
    if (ch === '\u001b') {
      const seq3 = data.slice(i, i + 3);
      if (seq3 === '\u001b[A' || seq3 === '\u001bOA') {
        pushKey(undefined, { sequence: seq3, name: 'up', ctrl: false, meta: false, shift: false });
        i += 3;
        continue;
      }
      if (seq3 === '\u001b[B' || seq3 === '\u001bOB') {
        pushKey(undefined, { sequence: seq3, name: 'down', ctrl: false, meta: false, shift: false });
        i += 3;
        continue;
      }
      if (seq3 === '\u001b[C' || seq3 === '\u001bOC') {
        pushKey(undefined, { sequence: seq3, name: 'right', ctrl: false, meta: false, shift: false });
        i += 3;
        continue;
      }
      if (seq3 === '\u001b[D' || seq3 === '\u001bOD') {
        pushKey(undefined, { sequence: seq3, name: 'left', ctrl: false, meta: false, shift: false });
        i += 3;
        continue;
      }

      pushKey(undefined, { sequence: '\u001b', name: 'escape', ctrl: false, meta: false, shift: false });
      i += 1;
      continue;
    }

    if (ch === '\r' && data[i + 1] === '\n') {
      pushKey('\r', { sequence: '\r\n', name: 'return', ctrl: false, meta: false, shift: false });
      i += 2;
      continue;
    }

    if (ch === '\r' || ch === '\n') {
      pushKey(ch, { sequence: ch, name: 'return', ctrl: false, meta: false, shift: false });
      i += 1;
      continue;
    }

    if (ch === '\t') {
      pushKey(ch, { sequence: ch, name: 'tab', ctrl: false, meta: false, shift: false });
      i += 1;
      continue;
    }

    if (ch === '\u007f') {
      pushKey(undefined, { sequence: ch, name: 'backspace', ctrl: false, meta: false, shift: false });
      i += 1;
      continue;
    }

    if (ch === '\u0003') {
      pushKey(undefined, { sequence: ch, name: 'c', ctrl: true, meta: false, shift: false });
      i += 1;
      continue;
    }

    const lower = ch.toLowerCase();
    const isLetter = (ch >= 'A' && ch <= 'Z') || (ch >= 'a' && ch <= 'z');
    pushKey(ch, {
      sequence: ch,
      name: lower,
      ctrl: false,
      meta: false,
      shift: isLetter && ch !== lower,
    });
    i += 1;
  }

  return events;
}

/**
 * Send data to the stdin of the currently running node process.
 * Emits both 'data' and 'keypress' events (vitest uses readline keypress events).
 */
export function sendStdin(data: string): void {
  const controller = defaultChildProcessController;
  if (!controller) return;
  const interactiveExecutions = Array.from(controller.executions.values()).filter((execution) => execution.activeProcessStdin);
  const latestExecution = interactiveExecutions[interactiveExecutions.length - 1] || null;
  if (!latestExecution?.activeProcessStdin) return;
  pushInputToExecutionStdin(latestExecution.activeProcessStdin, data);
}

function pushInputToExecutionStdin(target: ActiveProcessStdin, data: string): void {
  const normalized = data
    .replace(/\u001b\[200~/g, '')
    .replace(/\u001b\[201~/g, '');
  if (!normalized) return;

  (target as any).__almostnodePushInput?.(normalized);
  const hasKeypressListeners = typeof target.listenerCount === 'function'
    && target.listenerCount('keypress') > 0;
  const decoded = decodeKeypressEvents(normalized);

  const isControlSequenceOnly = decoded.length > 0 && decoded.every(({ ch, key }) => {
    if (ch !== undefined) return false;
    return key.name === 'up'
      || key.name === 'down'
      || key.name === 'left'
      || key.name === 'right'
      || key.name === 'escape';
  });

  if (!(hasKeypressListeners && isControlSequenceOnly)) {
    target.emit('data', normalized);
  }

  for (const { ch, key } of decoded) {
    target.emit('keypress', ch, key);
  }
}

/**
 * Initialize the child_process shim with a VirtualFS instance
 * Creates or reuses a controller-scoped Bash instance with VirtualFSAdapter.
 */
export function initChildProcess(vfs: VirtualFS): ChildProcessController {
  const existing = controllersByVfs.get(vfs);
  if (existing) {
    defaultChildProcessController = existing;
    return existing;
  }

  const controllerId = crypto.randomUUID();
  const vfsAdapter = new VirtualFSAdapter(vfs);
  let controller: ChildProcessController;

  const nodeCommand = defineCommand('node', async (args, ctx) => {
    const execution = getExecutionContextFromEnv(controller, ctx.env) ?? createExecutionContext(controller);
    const ownsExecution = !getExecutionContextFromEnv(controller, ctx.env);

    const scriptPath = args[0];
    if (!scriptPath) {
      if (ownsExecution) destroyExecutionContext(controller, execution.id);
      return { stdout: '', stderr: 'Usage: node <script.js> [args...]\n', exitCode: 1 };
    }

    const resolvedPath = scriptPath.startsWith('/')
      ? scriptPath
      : `${ctx.cwd}/${scriptPath}`.replace(/\/+/g, '/');
    const isNodeModulesCli = resolvedPath.includes('/node_modules/');
    const isOneShotNodeModulesCli = isNodeModulesCli && isLikelyOneShotCliInvocation(args.slice(1));
    const isLongIdleNodeModulesCli =
      isNodeModulesCli &&
      !isOneShotNodeModulesCli &&
      (ctx.env?.ALMOSTNODE_LONG_NODE_IDLE === '1' || ctx.env?.ALMOSTNODE_LONG_NODE_IDLE === 'true');

    if (!controller.vfs.existsSync(resolvedPath)) {
      if (ownsExecution) destroyExecutionContext(controller, execution.id);
      return { stdout: '', stderr: `Error: Cannot find module '${resolvedPath}'\n`, exitCode: 1 };
    }

    let stdout = '';
    let stderr = '';
    let lastActivityAt = Date.now();
    const initialShellChildren = execution.activeShellChildren;

    let exitCalled = false;
    let exitCode = 0;
    let syncExecution = true;
    let exitResolve: ((code: number) => void) | null = null;
    const exitPromise = new Promise<number>((resolve) => { exitResolve = resolve; });

    execution.outputStreamed = true;

    const appendStdout = (data: string) => {
      stdout += data;
      lastActivityAt = Date.now();
      execution.onStdout?.(data);
    };
    const appendStderr = (data: string) => {
      stderr += data;
      lastActivityAt = Date.now();
      execution.onStderr?.(data);
    };

    const runtime = new Runtime(controller.vfs, {
      cwd: ctx.cwd,
      env: ctx.env,
      childProcessController: controller,
      onConsole: (method, consoleArgs) => {
        const msg = consoleArgs.map((arg) => String(arg)).join(' ') + '\n';
        if (method === 'error') {
          appendStderr(msg);
        } else {
          appendStdout(msg);
        }
      },
      onStdout: appendStdout,
      onStderr: appendStderr,
    });

    const proc = runtime.getProcess();
    proc.exit = ((code = 0) => {
      if (!exitCalled) {
        exitCalled = true;
        exitCode = code;
        proc.emit('exit', code);
        exitResolve!(code);
      }
      if (syncExecution) {
        throw new Error(`Process exited with code ${code}`);
      }
    }) as (code?: number) => never;
    proc.argv = ['node', resolvedPath, ...args.slice(1)];

    const shouldEnableTty = !!execution.signal || !!execution.onStdout || !!execution.onStderr;
    let stdinRawMode = false;
    if (shouldEnableTty) {
      proc.stdout.isTTY = true;
      proc.stderr.isTTY = true;
      proc.stdin.isTTY = true;
      proc.stdin.setRawMode = (mode: boolean) => {
        stdinRawMode = !!mode;
        return proc.stdin;
      };
      execution.activeProcessStdin = proc.stdin;
    }

    (globalThis as any).__almostnodeYogaLayout = undefined;
    (globalThis as any).__almostnodeYogaLayoutError = undefined;

    const preloadYogaLayout = async (): Promise<void> => {
      const candidates = [
        `${ctx.cwd}/node_modules/yoga-layout/dist/src/load.js`.replace(/\/+/g, '/'),
        '/node_modules/yoga-layout/dist/src/load.js',
      ];
      const yogaLoadPath = candidates.find((candidate) => controller.vfs.existsSync(candidate));
      if (!yogaLoadPath) return;

      const preloadCode = `
module.exports = (async () => {
  const yogaMod = require(${JSON.stringify(yogaLoadPath)});
  const loadYoga = (yogaMod && typeof yogaMod.loadYoga === 'function')
    ? yogaMod.loadYoga
    : (typeof yogaMod === 'function' ? yogaMod : null);
  if (typeof loadYoga !== 'function') {
    throw new Error('loadYoga export not found');
  }
  globalThis.__almostnodeYogaLayout = await loadYoga();
  globalThis.__almostnodeYogaLayoutError = undefined;
})();
      `;

      const preloadResult = runtime.execute(preloadCode, '/__almostnode_preload_yoga__.js').exports;
      if (preloadResult && typeof (preloadResult as Promise<unknown>).then === 'function') {
        await (preloadResult as Promise<unknown>);
      }
    };

    try {
      await preloadYogaLayout();
      runtime.runFile(resolvedPath);
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('Process exited with code')) {
        return { stdout, stderr, exitCode };
      }
      const errorMsg = error instanceof Error
        ? `${error.message}\n${error.stack || ''}`
        : String(error);
      return { stdout, stderr: stderr + `Error: ${errorMsg}\n`, exitCode: 1 };
    } finally {
      syncExecution = false;
    }

    if (exitCalled) {
      return { stdout, stderr, exitCode };
    }

    const rejectionHandler = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      if (reason instanceof Error && reason.message.startsWith('Process exited with code')) {
        event.preventDefault();
        return;
      }
      const msg = reason instanceof Error
        ? `Unhandled rejection: ${reason.message}\n${reason.stack || ''}\n`
        : `Unhandled rejection: ${String(reason)}\n`;
      appendStderr(msg);
      event.preventDefault();
    };
    const hasGlobalRejectionEvents =
      typeof (globalThis as any).addEventListener === 'function' &&
      typeof (globalThis as any).removeEventListener === 'function';
    if (hasGlobalRejectionEvents) {
      globalThis.addEventListener('unhandledrejection', rejectionHandler);
    }

    const vfsActivityHandler = () => {
      lastActivityAt = Date.now();
    };
    controller.vfs.on('change', vfsActivityHandler);
    controller.vfs.on('delete', vfsActivityHandler);

    let childrenExited = false;
    let hadActiveSubprocess = false;
    const prevChildExitHandler = execution.onForkedChildExit;
    execution.onForkedChildExit = () => {
      if (execution.activeForkedChildren <= 0) childrenExited = true;
      prevChildExitHandler?.();
    };

    try {
      const MAX_TOTAL_MS = isLongIdleNodeModulesCli ? 5 * 60 * 1000 : 60_000;
      const IDLE_TIMEOUT_MS = isLongIdleNodeModulesCli
        ? 60_000
        : (isNodeModulesCli ? 300 : 200);
      const NO_OUTPUT_IDLE_MS = isLongIdleNodeModulesCli
        ? 120_000
        : (isNodeModulesCli ? 2_000 : 1_000);
      const POST_CHILD_EXIT_IDLE_MS = isLongIdleNodeModulesCli ? 2_000 : 100;
      const ACTIVE_SUBPROCESS_STALE_MS = isLongIdleNodeModulesCli ? 20_000 : 2_000;
      const CHECK_MS = 50;
      const startTime = Date.now();
      let lastOutputLen = stdout.length + stderr.length;
      let idleMs = 0;

      while (!exitCalled) {
        if (execution.signal?.aborted) break;

        const raceResult = await Promise.race([
          exitPromise.then(() => 'exit' as const),
          new Promise<'tick'>((resolve) => setTimeout(() => resolve('tick'), CHECK_MS)),
        ]);

        if (raceResult === 'exit' || exitCalled) break;
        if (execution.signal?.aborted) break;

        const currentLen = stdout.length + stderr.length;
        if (currentLen > lastOutputLen) {
          lastOutputLen = currentLen;
          idleMs = 0;
        } else {
          idleMs += CHECK_MS;
        }

        if (Date.now() - startTime >= MAX_TOTAL_MS) break;

        const keepAliveForInteractiveInput = !!execution.signal && (
          stdinRawMode ||
          hasActiveStdinListeners(proc.stdin)
        );
        if (keepAliveForInteractiveInput) {
          continue;
        }

        const hasActiveSubprocess = execution.activeForkedChildren > 0 || execution.activeShellChildren > initialShellChildren;
        if (hasActiveSubprocess) {
          hadActiveSubprocess = true;
          const activityAge = Date.now() - lastActivityAt;
          if (activityAge < ACTIVE_SUBPROCESS_STALE_MS) {
            idleMs = 0;
            continue;
          }
        }

        const effectiveIdle = (childrenExited || hadActiveSubprocess) ? POST_CHILD_EXIT_IDLE_MS : IDLE_TIMEOUT_MS;
        if (lastOutputLen > 0 && idleMs >= effectiveIdle) break;
        if (lastOutputLen === 0 && idleMs >= NO_OUTPUT_IDLE_MS) break;
      }

      return { stdout, stderr, exitCode: exitCalled ? exitCode : 0 };
    } finally {
      execution.activeProcessStdin = null;
      execution.onForkedChildExit = prevChildExitHandler;
      if (hasGlobalRejectionEvents) {
        globalThis.removeEventListener('unhandledrejection', rejectionHandler);
      }
      controller.vfs.off('change', vfsActivityHandler);
      controller.vfs.off('delete', vfsActivityHandler);
      if (ownsExecution) {
        destroyExecutionContext(controller, execution.id);
      }
    }
  });

  const npmCommand = defineCommand('npm', async (args, ctx) => {
    const subcommand = args[0];

    if (!subcommand || subcommand === 'help' || subcommand === '--help') {
      return {
        stdout: 'Usage: npm <command>\n\nCommands:\n  run <script>   Run a script from package.json\n  start          Run the start script\n  test           Run the test script\n  install [pkg]  Install packages\n  ls             List installed packages\n',
        stderr: '',
        exitCode: 0,
      };
    }

    switch (subcommand) {
      case 'run':
      case 'run-script':
        return handleNpmRun(controller, args.slice(1), ctx);
      case 'start':
        return handleNpmRun(controller, ['start'], ctx);
      case 'test':
      case 't':
      case 'tst':
        return handleNpmRun(controller, ['test'], ctx);
      case 'install':
      case 'i':
      case 'add':
        return handleNpmInstall(controller, args.slice(1), ctx);
      case 'ls':
      case 'list':
        return handleNpmList(controller, ctx);
      default:
        return {
          stdout: '',
          stderr: `npm ERR! Unknown command: "${subcommand}"\n`,
          exitCode: 1,
        };
    }
  });

  const npxCommand = defineCommand('npx', async (args, ctx) => {
    const execution = getExecutionContextFromEnv(controller, ctx.env);
    let packageSpec: string | null = null;
    const cmdArgs: string[] = [];
    let i = 0;

    while (i < args.length) {
      const arg = args[i];
      if ((arg === '-p' || arg === '--package') && i + 1 < args.length) {
        packageSpec = args[i + 1];
        i += 2;
      } else if (arg === '-y' || arg === '--yes') {
        i++;
      } else if (arg === '--') {
        cmdArgs.push(...args.slice(i + 1));
        break;
      } else {
        cmdArgs.push(...args.slice(i));
        break;
      }
    }

    if (cmdArgs.length === 0) {
      return { stdout: '', stderr: 'npx: missing command\nUsage: npx [options] <command> [args...]\n', exitCode: 1 };
    }

    const commandName = cmdArgs[0];
    const commandArgs = cmdArgs.slice(1);
    const installSpec = packageSpec || commandName;

    const { parsePackageSpec } = await import('../npm/index');
    const {
      name: pkgName,
      version: requestedVersion,
    } = parsePackageSpec(typeof installSpec === 'string' ? installSpec : commandName);
    const forceLatestInstall = requestedVersion === 'latest';
    const binName = packageSpec ? commandName : (pkgName.includes('/') ? pkgName.split('/').pop()! : pkgName);
    const quoteArg = (value: string) => JSON.stringify(value);

    const emitInstallProgress = (message: string) => {
      emitStreamData(execution, `${message}\n`, 'stdout');
    };

    const formatOutputTail = (output: string, maxLines = 20, maxChars = 2000): string => {
      if (!output) return '';
      const normalized = output.trimEnd();
      if (!normalized) return '';
      const lines = normalized.split(/\r?\n/);
      const tail = lines.slice(-maxLines).join('\n');
      return tail.length > maxChars ? tail.slice(-maxChars) : tail;
    };

    const withNpxExecDiagnostics = (result: JustBashExecResult, executionTarget: string): JustBashExecResult => {
      if (result.exitCode === 0) return result;
      const stderrText = result.stderr || '';
      const firstStderrLine = stderrText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);

      let diagnostic = `npx: command "${binName}" exited with code ${result.exitCode} while running ${executionTarget}\n`;
      if (firstStderrLine) {
        diagnostic += `npx: first stderr line: ${firstStderrLine}\n`;
      }
      if (!stderrText.trim()) {
        const stdoutTail = formatOutputTail(result.stdout || '');
        if (stdoutTail) {
          diagnostic += `npx: stdout tail:\n${stdoutTail}\n`;
        }
      }

      return {
        ...result,
        stderr: `${stderrText}${diagnostic}`,
      };
    };

    const resolveBin = (lookupCwd: string) => {
      const normalizedCwd = lookupCwd || '/';
      const binPaths = [
        `${normalizedCwd}/node_modules/.bin/${binName}`.replace(/\/+/g, '/'),
        `/node_modules/.bin/${binName}`,
      ];

      return {
        binPath: binPaths.find((candidate) => controller.vfs.existsSync(candidate)) ?? null,
        resolvedBinTarget: getPackageBinTarget(controller, pkgName, binName, normalizedCwd),
      };
    };

    const installPackage = async (installCwd: string) => {
      const { PackageManager } = await import('../npm/index');
      const pm = new PackageManager(controller.vfs, { cwd: installCwd || '/' });
      await pm.install(installSpec, { onProgress: emitInstallProgress });
    };

    let { binPath, resolvedBinTarget } = resolveBin(ctx.cwd);
    let useExtendedNodeIdle = false;

    if (forceLatestInstall || (!binPath && !resolvedBinTarget)) {
      useExtendedNodeIdle = true;
      try {
        await installPackage(ctx.cwd);
        ({ binPath, resolvedBinTarget } = resolveBin(ctx.cwd));
        if ((forceLatestInstall || (!binPath && !resolvedBinTarget)) && ctx.cwd !== '/') {
          emitInstallProgress('npx: retrying install in / to resolve command bin...');
          await installPackage('/');
          ({ binPath, resolvedBinTarget } = resolveBin('/'));
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { stdout: '', stderr: `npx: install failed: ${msg}\n`, exitCode: 1 };
      }
    }

    if (!binPath && !resolvedBinTarget) {
      return { stdout: '', stderr: `npx: command not found: ${binName}\n`, exitCode: 1 };
    }

    if (!ctx.exec) {
      return {
        stdout: '',
        stderr: 'npx: command execution not available in this context\n',
        exitCode: 1,
      };
    }

    const execEnv = useExtendedNodeIdle
      ? { ...ctx.env, ALMOSTNODE_LONG_NODE_IDLE: '1' }
      : ctx.env;

    if (resolvedBinTarget) {
      const fullCommand = ['node', resolvedBinTarget, ...commandArgs].map((value) => quoteArg(value)).join(' ');
      const result = await ctx.exec(fullCommand, { cwd: ctx.cwd, env: execEnv });
      return withNpxExecDiagnostics(result, `node ${resolvedBinTarget}`);
    }

    if (!binPath) {
      return { stdout: '', stderr: `npx: command not found: ${binName}\n`, exitCode: 1 };
    }

    const fullCommand = [binPath, ...commandArgs].map((value) => quoteArg(value)).join(' ');
    const result = await ctx.exec(fullCommand, { cwd: ctx.cwd, env: execEnv });
    return withNpxExecDiagnostics(result, binPath);
  });

  const tarCommand = defineCommand('tar', async (args, ctx) => {
    const parsed = parseTarOptions(args, ctx.cwd);
    if (!parsed.options) {
      return { stdout: '', stderr: `tar: ${parsed.error || 'invalid arguments'}\n`, exitCode: 2 };
    }

    const { archivePath, destPath, verbose } = parsed.options;
    if (!controller.vfs.existsSync(archivePath)) {
      return { stdout: '', stderr: `tar: ${archivePath}: Cannot open: No such file or directory\n`, exitCode: 1 };
    }

    try {
      controller.vfs.mkdirSync(destPath, { recursive: true });
      const archiveData = controller.vfs.readFileSync(archivePath);
      const extracted = extractTarball(archiveData, controller.vfs, destPath, {
        stripComponents: 0,
        filter: isSafeTarEntryPath,
      });
      const stdout = verbose && extracted.length > 0
        ? `${extracted.map((entry) => path.relative(destPath, entry)).join('\n')}\n`
        : '';
      return { stdout, stderr: '', exitCode: 0 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { stdout: '', stderr: `tar: ${message}\n`, exitCode: 1 };
    }
  });

  const nextCommand = defineCommand('next', async (args, ctx) => {
    const execution = getExecutionContextFromEnv(controller, ctx.env);
    const normalizedCwd = normalizeCommandCwd(ctx.cwd);
    const explicitSubcommand = args[0] && !args[0].startsWith('-') ? args[0] : 'dev';
    const devArgs = explicitSubcommand === 'dev' ? args.slice(args[0] === 'dev' ? 1 : 0) : args.slice(1);

    if (explicitSubcommand === 'help' || explicitSubcommand === '--help' || explicitSubcommand === '-h') {
      return {
        stdout: 'Usage: next dev [options]\n\nSupported:\n  -p, --port <n>\n  -H, --hostname <host>\n\nOther subcommands are delegated to installed next CLI.\n',
        stderr: '',
        exitCode: 0,
      };
    }

    if (explicitSubcommand !== 'dev') {
      return execInstalledPackageBin(controller, 'next', 'next', args, ctx);
    }

    let port = 3000;
    let hostname = 'localhost';

    for (let i = 0; i < devArgs.length; i++) {
      const arg = devArgs[i];
      if (arg === '-p' || arg === '--port') {
        const parsed = parsePortValue(devArgs[i + 1]);
        if (parsed == null) {
          return { stdout: '', stderr: 'next: invalid --port value\n', exitCode: 1 };
        }
        port = parsed;
        i++;
        continue;
      }
      if (arg.startsWith('--port=')) {
        const parsed = parsePortValue(arg.slice('--port='.length));
        if (parsed == null) {
          return { stdout: '', stderr: 'next: invalid --port value\n', exitCode: 1 };
        }
        port = parsed;
        continue;
      }
      if (arg === '-H' || arg === '--hostname') {
        const value = devArgs[i + 1];
        if (!value || value.startsWith('-')) {
          return { stdout: '', stderr: 'next: missing --hostname value\n', exitCode: 1 };
        }
        hostname = value;
        i++;
        continue;
      }
      if (arg.startsWith('--hostname=')) {
        const value = arg.slice('--hostname='.length).trim();
        hostname = value || hostname;
        continue;
      }
    }

    const key = `next:${port}`;
    stopManagedFrameworkServersOnPort(controller, port);

    try {
      const [{ NextDevServer }, { getServerBridge }] = await Promise.all([
        import('../frameworks/next-dev-server'),
        import('../server-bridge'),
      ]);

      const bridge = getServerBridge();
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        try {
          await bridge.initServiceWorker();
        } catch {
          // Service worker is optional for shell command usage.
        }
      }

      const root = normalizedCwd;
      const server = new NextDevServer(controller.vfs, {
        port,
        root,
        pagesDir: `${root}/pages`.replace(/\/+/g, '/'),
        appDir: `${root}/app`.replace(/\/+/g, '/'),
        publicDir: `${root}/public`.replace(/\/+/g, '/'),
        env: { ...ctx.env },
      });

      bridge.registerServer(createBridgeServerWrapper(server) as any, port);
      server.start();

      const url = `${bridge.getServerUrl(port)}/`;
      const startup = `next dev server running at ${url} (host: ${hostname}, root: ${root})\n`;
      emitStreamData(execution, startup, 'stdout');

      controller.frameworkDevServers.set(key, {
        key,
        framework: 'next',
        port,
        stop: () => {
          try {
            server.stop();
          } finally {
            bridge.unregisterServer(port);
          }
        },
      });

      if (execution?.signal) {
        await waitForAbort(execution.signal);
        stopManagedFrameworkServer(controller, key);
        return { stdout: startup, stderr: '', exitCode: 130 };
      }

      return { stdout: startup, stderr: '', exitCode: 0 };
    } catch (error) {
      stopManagedFrameworkServer(controller, key);
      const message = error instanceof Error ? error.message : String(error);
      return { stdout: '', stderr: `next: failed to start dev server: ${message}\n`, exitCode: 1 };
    }
  });

  const viteCommand = defineCommand('vite', async (args, ctx) => {
    const execution = getExecutionContextFromEnv(controller, ctx.env);
    const normalizedCwd = normalizeCommandCwd(ctx.cwd);
    let root = normalizedCwd;
    let devArgs = args;

    const firstArg = args[0];
    if (firstArg && !firstArg.startsWith('-')) {
      if (firstArg === 'build' || firstArg === 'preview' || firstArg === 'optimize' || firstArg === 'optimizeDeps') {
        return execInstalledPackageBin(controller, 'vite', 'vite', args, ctx);
      }
      if (firstArg === 'dev' || firstArg === 'serve') {
        devArgs = args.slice(1);
      } else {
        root = resolveFromCwd(normalizedCwd, firstArg);
        devArgs = args.slice(1);
      }
    }

    let port = 5173;
    let host = 'localhost';

    for (let i = 0; i < devArgs.length; i++) {
      const arg = devArgs[i];
      if (arg === '-p' || arg === '--port') {
        const parsed = parsePortValue(devArgs[i + 1]);
        if (parsed == null) {
          return { stdout: '', stderr: 'vite: invalid --port value\n', exitCode: 1 };
        }
        port = parsed;
        i++;
        continue;
      }
      if (arg.startsWith('--port=')) {
        const parsed = parsePortValue(arg.slice('--port='.length));
        if (parsed == null) {
          return { stdout: '', stderr: 'vite: invalid --port value\n', exitCode: 1 };
        }
        port = parsed;
        continue;
      }
      if (arg === '--host' || arg === '-H') {
        const value = devArgs[i + 1];
        if (!value || value.startsWith('-')) {
          host = '0.0.0.0';
          continue;
        }
        host = value;
        i++;
        continue;
      }
      if (arg.startsWith('--host=')) {
        const value = arg.slice('--host='.length).trim();
        host = value || '0.0.0.0';
        continue;
      }
      if (arg === '--root') {
        const value = devArgs[i + 1];
        if (!value || value.startsWith('-')) {
          return { stdout: '', stderr: 'vite: missing --root value\n', exitCode: 1 };
        }
        root = resolveFromCwd(normalizedCwd, value);
        i++;
        continue;
      }
      if (arg.startsWith('--root=')) {
        root = resolveFromCwd(normalizedCwd, arg.slice('--root='.length));
      }
    }

    const key = `vite:${port}`;
    stopManagedFrameworkServersOnPort(controller, port);

    try {
      const [{ ViteDevServer }, { getServerBridge }] = await Promise.all([
        import('../frameworks/vite-dev-server'),
        import('../server-bridge'),
      ]);

      const bridge = getServerBridge();
      if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
        try {
          await bridge.initServiceWorker();
        } catch {
          // Service worker is optional for shell command usage.
        }
      }

      const server = new ViteDevServer(controller.vfs, {
        port,
        root,
      });

      bridge.registerServer(createBridgeServerWrapper(server) as any, port);
      server.start();

      const url = `${bridge.getServerUrl(port)}/`;
      const startup = `vite dev server running at ${url} (host: ${host}, root: ${root})\n`;
      emitStreamData(execution, startup, 'stdout');

      controller.frameworkDevServers.set(key, {
        key,
        framework: 'vite',
        port,
        stop: () => {
          try {
            server.stop();
          } finally {
            bridge.unregisterServer(port);
          }
        },
      });

      if (execution?.signal) {
        await waitForAbort(execution.signal);
        stopManagedFrameworkServer(controller, key);
        return { stdout: startup, stderr: '', exitCode: 130 };
      }

      return { stdout: startup, stderr: '', exitCode: 0 };
    } catch (error) {
      stopManagedFrameworkServer(controller, key);
      const message = error instanceof Error ? error.message : String(error);
      return { stdout: '', stderr: `vite: failed to start dev server: ${message}\n`, exitCode: 1 };
    }
  });

  const gitCommand = defineCommand('git', async (args, ctx) => {
    const { runGitCommand } = await import('./git-command');
    return runGitCommand(args, ctx, controller.vfs);
  });

  const syntheticShellCommands = SYNTHETIC_SHELL_COMMAND_NAMES.map((commandName) => {
    return defineCommand(commandName, async (args, ctx) => {
      const shell = getSyntheticShellSpec(commandName);
      const shellName = shell?.names[0] || path.basename(commandName);

      if (args.includes('--version')) {
        return {
          stdout: getSyntheticShellVersion(commandName) || '',
          stderr: '',
          exitCode: 0,
        };
      }

      const parsed = parseSyntheticShellExec(args);
      if (parsed.error) {
        return {
          stdout: '',
          stderr: `${shellName}: ${parsed.error}`,
          exitCode: 2,
        };
      }

      if (parsed.script) {
        if (!ctx.exec) {
          return {
            stdout: '',
            stderr: `${shellName}: execution context unavailable\n`,
            exitCode: 1,
          };
        }
        return ctx.exec(parsed.script, { cwd: ctx.cwd, env: ctx.env });
      }

      return { stdout: '', stderr: '', exitCode: 0 };
    });
  });

  const bashInstance = new Bash({
    fs: vfsAdapter,
    cwd: '/',
    env: DEFAULT_SHELL_ENV,
    logger: {
      info: emitBashLog,
      debug: emitBashLog,
    },
    customCommands: [...syntheticShellCommands, nodeCommand, npmCommand, npxCommand, tarCommand, nextCommand, viteCommand, gitCommand],
  });

  controller = {
    id: controllerId,
    vfs,
    vfsAdapter,
    bashInstance,
    frameworkDevServers: new Map(),
    executions: new Map(),
    createExecution: (opts) => createExecutionContext(controller, opts),
    destroyExecution: (executionId) => destroyExecutionContext(controller, executionId),
    runCommand: (command, options, executionId) => runCommandInController(controller, command, options, executionId),
    sendInput: (executionId, data) => {
      if (!executionId) return;
      const execution = controller.executions.get(executionId);
      if (!execution?.activeProcessStdin) return;
      pushInputToExecutionStdin(execution.activeProcessStdin, data);
    },
  };

  controllersByVfs.set(vfs, controller);
  controllersById.set(controller.id, controller);
  defaultChildProcessController = controller;

  return controller;
}

/**
 * Read and parse package.json from the VFS
 */
function readPackageJson(
  controller: ChildProcessController,
  cwd: string
): { pkgJson: PackageJson; error?: undefined } | { pkgJson?: undefined; error: JustBashExecResult } {
  const pkgJsonPath = `${cwd}/package.json`.replace(/\/+/g, '/');

  if (!controller.vfs.existsSync(pkgJsonPath)) {
    return {
      error: {
        stdout: '',
        stderr: 'npm ERR! no package.json found\n',
        exitCode: 1,
      },
    };
  }

  try {
    const pkgJson = JSON.parse(controller.vfs.readFileSync(pkgJsonPath, 'utf8')) as PackageJson;
    return { pkgJson };
  } catch {
    return {
      error: {
        stdout: '',
        stderr: 'npm ERR! Failed to parse package.json\n',
        exitCode: 1,
      },
    };
  }
}

/**
 * Resolve a package bin target to a real entry file by reading package.json.
 * Returns the resolved JS file path if found, null otherwise.
 */
function getPackageBinTarget(
  controller: ChildProcessController,
  pkgName: string,
  binName: string,
  cwd: string
): string | null {
  const searchDirs = [
    `${cwd}/node_modules`.replace(/\/+/g, '/'),
    '/node_modules',
  ];

  for (const dir of searchDirs) {
    const packageDir = `${dir}/${pkgName}`.replace(/\/+/g, '/');
    const pkgJsonPath = `${packageDir}/package.json`;
    if (!controller.vfs.existsSync(pkgJsonPath)) continue;

    try {
      const pkgJson = JSON.parse(controller.vfs.readFileSync(pkgJsonPath, 'utf8')) as { bin?: Record<string, string> | string };

      const bins: Record<string, string> =
        typeof pkgJson.bin === 'string'
          ? {
            [pkgName.includes('/') ? pkgName.split('/').pop()! : pkgName]: pkgJson.bin,
          }
          : pkgJson.bin && typeof pkgJson.bin === 'object'
            ? pkgJson.bin
            : {};

      const binPath = bins[binName] || bins[Object.keys(bins)[0]];
      if (!binPath) continue;

      const resolved = `${packageDir}/${binPath}`.replace(/\/+/g, '/');
      if (controller.vfs.existsSync(resolved)) {
        return resolved;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function execInstalledPackageBin(
  controller: ChildProcessController,
  pkgName: string,
  binName: string,
  args: string[],
  ctx: CommandContext
): Promise<JustBashExecResult> {
  if (!ctx.exec) {
    return { stdout: '', stderr: `${binName}: execution context unavailable\n`, exitCode: 1 };
  }

  const normalizedCwd = normalizeCommandCwd(ctx.cwd);
  const resolvedTarget = getPackageBinTarget(controller, pkgName, binName, normalizedCwd)
    || getPackageBinTarget(controller, pkgName, binName, '/');

  if (resolvedTarget) {
    const fullCommand = ['node', resolvedTarget, ...args].map((value) => shellQuote(value)).join(' ');
    return ctx.exec(fullCommand, { cwd: normalizedCwd, env: ctx.env });
  }

  const binCandidates = [
    `${normalizedCwd}/node_modules/.bin/${binName}`.replace(/\/+/g, '/'),
    `/node_modules/.bin/${binName}`,
  ];
  const binPath = binCandidates.find((candidate) => controller.vfs.existsSync(candidate));
  if (!binPath) {
    return { stdout: '', stderr: `bash: ${binName}: command not found\n`, exitCode: 127 };
  }

  const fullCommand = [binPath, ...args].map((value) => shellQuote(value)).join(' ');
  return ctx.exec(fullCommand, { cwd: normalizedCwd, env: ctx.env });
}

function hasActiveStdinListeners(stdin: { listenerCount?: (event: string) => number }): boolean {
  if (typeof stdin.listenerCount !== 'function') return false;
  return stdin.listenerCount('data') > 0
    || stdin.listenerCount('keypress') > 0
    || stdin.listenerCount('readable') > 0;
}

function isLikelyOneShotCliInvocation(args: string[]): boolean {
  if (args.length === 0) return false;

  const helpOrVersionArgs = new Set(['--version', '-v', 'version', '--help', '-h', 'help']);
  let sawHelpOrVersion = false;

  for (const arg of args) {
    if (!arg) continue;

    if (helpOrVersionArgs.has(arg) || arg.startsWith('--version=') || arg.startsWith('--help=')) {
      sawHelpOrVersion = true;
      continue;
    }

    if (arg.startsWith('-')) {
      continue;
    }

    return false;
  }

  return sawHelpOrVersion;
}

interface ParsedTarOptions {
  archivePath: string;
  destPath: string;
  verbose: boolean;
}

function parseTarOptions(args: string[], cwd: string): { options?: ParsedTarOptions; error?: string } {
  let extractMode = false;
  let archivePath: string | null = null;
  let destPath = cwd;
  let verbose = false;

  const resolvePath = (candidate: string): string => (
    path.isAbsolute(candidate)
      ? path.normalize(candidate)
      : path.normalize(path.join(cwd, candidate))
  );

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '-C' || arg === '--directory') {
      const next = args[i + 1];
      if (!next) return { error: "option requires an argument -- 'C'" };
      destPath = resolvePath(next);
      i++;
      continue;
    }

    if (arg === '--extract') {
      extractMode = true;
      continue;
    }
    if (arg === '--verbose') {
      verbose = true;
      continue;
    }
    if (arg === '--file') {
      const next = args[i + 1];
      if (!next) return { error: "option requires an argument -- 'f'" };
      archivePath = resolvePath(next);
      i++;
      continue;
    }
    if (arg.startsWith('--file=')) {
      archivePath = resolvePath(arg.slice('--file='.length));
      continue;
    }

    if (arg.startsWith('-') && arg.length > 1) {
      const flags = arg.slice(1);
      for (let flagIndex = 0; flagIndex < flags.length; flagIndex++) {
        const flag = flags[flagIndex];
        if (flag === 'x') {
          extractMode = true;
          continue;
        }
        if (flag === 'v') {
          verbose = true;
          continue;
        }
        if (flag === 'z') {
          continue;
        }
        if (flag === 'f') {
          const inlineFile = flags.slice(flagIndex + 1);
          if (inlineFile) {
            archivePath = resolvePath(inlineFile);
            break;
          }
          const next = args[i + 1];
          if (!next) return { error: "option requires an argument -- 'f'" };
          archivePath = resolvePath(next);
          i++;
          break;
        }
        return { error: `unsupported option -- '${flag}'` };
      }
      continue;
    }

    if (!archivePath) {
      archivePath = resolvePath(arg);
      continue;
    }
  }

  if (!extractMode) {
    return { error: 'only extract mode is supported (use -x)' };
  }
  if (!archivePath) {
    return { error: 'archive file is required (use -f <file>)' };
  }

  return {
    options: {
      archivePath,
      destPath,
      verbose,
    },
  };
}

function isSafeTarEntryPath(entryPath: string): boolean {
  if (!entryPath || entryPath.includes('\0')) return false;
  const normalized = entryPath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter(Boolean);
  return !segments.some((segment) => segment === '..');
}

/**
 * Handle `npm run [script]` — execute a script from package.json
 */
async function handleNpmRun(
  controller: ChildProcessController,
  args: string[],
  ctx: CommandContext
): Promise<JustBashExecResult> {
  const scriptName = args[0];

  // "npm run" with no script name: list available scripts
  if (!scriptName) {
    return listScripts(controller, ctx);
  }

  const result = readPackageJson(controller, ctx.cwd);
  if (result.error) return result.error;
  const pkgJson = result.pkgJson;

  const scripts = pkgJson.scripts || {};
  const scriptCommand = scripts[scriptName];

  if (!scriptCommand) {
    const available = Object.keys(scripts);
    let msg = `npm ERR! Missing script: "${scriptName}"\n`;
    if (available.length > 0) {
      msg += '\nnpm ERR! Available scripts:\n';
      for (const name of available) {
        msg += `npm ERR!   ${name}\n`;
        msg += `npm ERR!     ${scripts[name]}\n`;
      }
    }
    return { stdout: '', stderr: msg, exitCode: 1 };
  }

  if (!ctx.exec) {
    return {
      stdout: '',
      stderr: 'npm ERR! Script execution not available in this context\n',
      exitCode: 1,
    };
  }

  // Set up npm-specific environment variables
  const npmEnv: Record<string, string> = {
    ...ctx.env,
    npm_lifecycle_event: scriptName,
  };
  if (pkgJson.name) npmEnv.npm_package_name = pkgJson.name;
  if (pkgJson.version) npmEnv.npm_package_version = pkgJson.version;

  let allStdout = '';
  let allStderr = '';
  const label = `${pkgJson.name || ''}@${pkgJson.version || ''}`;

  // Run pre<script> if it exists
  const preScript = scripts[`pre${scriptName}`];
  if (preScript) {
    allStderr += `\n> ${label} pre${scriptName}\n> ${preScript}\n\n`;
    const preResult = await ctx.exec(preScript, { cwd: ctx.cwd, env: npmEnv });
    allStdout += preResult.stdout;
    allStderr += preResult.stderr;
    if (preResult.exitCode !== 0) {
      return { stdout: allStdout, stderr: allStderr, exitCode: preResult.exitCode };
    }
  }

  // Run the main script
  allStderr += `\n> ${label} ${scriptName}\n> ${scriptCommand}\n\n`;
  const mainResult = await ctx.exec(scriptCommand, { cwd: ctx.cwd, env: npmEnv });
  allStdout += mainResult.stdout;
  allStderr += mainResult.stderr;

  if (mainResult.exitCode !== 0) {
    return { stdout: allStdout, stderr: allStderr, exitCode: mainResult.exitCode };
  }

  // Run post<script> if it exists
  const postScript = scripts[`post${scriptName}`];
  if (postScript) {
    allStderr += `\n> ${label} post${scriptName}\n> ${postScript}\n\n`;
    const postResult = await ctx.exec(postScript, { cwd: ctx.cwd, env: npmEnv });
    allStdout += postResult.stdout;
    allStderr += postResult.stderr;
    if (postResult.exitCode !== 0) {
      return { stdout: allStdout, stderr: allStderr, exitCode: postResult.exitCode };
    }
  }

  return { stdout: allStdout, stderr: allStderr, exitCode: 0 };
}

/**
 * List available scripts from package.json (when `npm run` is called with no args)
 */
function listScripts(controller: ChildProcessController, ctx: CommandContext): JustBashExecResult {
  const result = readPackageJson(controller, ctx.cwd);
  if (result.error) return result.error;
  const pkgJson = result.pkgJson;

  const scripts = pkgJson.scripts || {};
  const names = Object.keys(scripts);

  if (names.length === 0) {
    return { stdout: '', stderr: '', exitCode: 0 };
  }

  const lifecycle = ['prestart', 'start', 'poststart', 'pretest', 'test', 'posttest', 'prestop', 'stop', 'poststop'];
  const lifecyclePresent = names.filter(n => lifecycle.includes(n));
  const customPresent = names.filter(n => !lifecycle.includes(n));

  let output = `Lifecycle scripts included in ${pkgJson.name || ''}:\n`;
  for (const name of lifecyclePresent) {
    output += `  ${name}\n    ${scripts[name]}\n`;
  }
  if (customPresent.length > 0) {
    output += '\navailable via `npm run-script`:\n';
    for (const name of customPresent) {
      output += `  ${name}\n    ${scripts[name]}\n`;
    }
  }

  return { stdout: output, stderr: '', exitCode: 0 };
}

/**
 * Handle `npm install [pkg]` — bridge to PackageManager
 */
async function handleNpmInstall(
  controller: ChildProcessController,
  args: string[],
  ctx: CommandContext
): Promise<JustBashExecResult> {
  const { PackageManager } = await import('../npm/index');
  const pm = new PackageManager(controller.vfs, { cwd: ctx.cwd });

  let stdout = '';
  const execution = getExecutionContextFromEnv(controller, ctx.env);
  const emitProgress = (message: string) => {
    const line = `${message}\n`;
    stdout += line;
    emitStreamData(execution, line, 'stdout');
  };

  try {
    const pkgArgs = args.filter(a => !a.startsWith('-'));
    if (pkgArgs.length === 0) {
      // npm install (no package name) -> install from package.json
      const installResult = await pm.installFromPackageJson({
        onProgress: emitProgress,
      });
      stdout += `added ${installResult.added.length} packages\n`;
    } else {
      // npm install <pkg> [<pkg> ...]
      for (const arg of pkgArgs) {
        const installResult = await pm.install(arg, {
          save: true,
          onProgress: emitProgress,
        });
        stdout += `added ${installResult.added.length} packages\n`;
      }
    }
    return { stdout, stderr: '', exitCode: 0 };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return { stdout, stderr: `npm ERR! ${msg}\n`, exitCode: 1 };
  }
}

/**
 * Handle `npm ls` — list installed packages
 */
async function handleNpmList(
  controller: ChildProcessController,
  ctx: CommandContext
): Promise<JustBashExecResult> {
  const { PackageManager } = await import('../npm/index');
  const pm = new PackageManager(controller.vfs, { cwd: ctx.cwd });
  const packages = pm.list();
  const entries = Object.entries(packages);

  if (entries.length === 0) {
    return { stdout: '(empty)\n', stderr: '', exitCode: 0 };
  }

  let output = `${ctx.cwd}\n`;
  for (const [name, version] of entries) {
    output += `+-- ${name}@${version}\n`;
  }
  return { stdout: output, stderr: '', exitCode: 0 };
}

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string>;
  encoding?: BufferEncoding | 'buffer';
  timeout?: number;
  maxBuffer?: number;
  shell?: string | boolean;
}

export interface ExecResult {
  stdout: string | Buffer;
  stderr: string | Buffer;
}

export type ExecCallback = (
  error: Error | null,
  stdout: string | Buffer,
  stderr: string | Buffer
) => void;

function normalizeExecSyncResult(
  stdout: string,
  encoding?: BufferEncoding | 'buffer' | null
): string | Buffer {
  if (encoding === 'buffer' || encoding == null) {
    return Buffer.from(stdout);
  }
  return Buffer.from(stdout).toString(encoding);
}

function getCurrentProcessArch(): string {
  const proc = (globalThis as any).process as { arch?: unknown } | undefined;
  return typeof proc?.arch === 'string' && proc.arch ? proc.arch : 'x64';
}

const SYNTHETIC_WHICH_TARGETS: Record<string, string> = {
  bash: '/bin/bash',
  node: '/usr/bin/node',
  npm: '/usr/bin/npm',
  npx: '/usr/bin/npx',
  sh: '/bin/sh',
  tar: '/usr/bin/tar',
  zsh: '/bin/zsh',
};

function normalizeSpawnSyncOutput(
  stdout: string,
  encoding?: BufferEncoding | 'buffer' | null
): SpawnSyncOutput {
  if (encoding === 'buffer' || encoding == null) {
    return Buffer.from(stdout);
  }
  return Buffer.from(stdout).toString(encoding);
}

function getSyntheticExecFileSyncOutput(file: string, args: string[]): string | null {
  const command = path.basename(file).toLowerCase();
  const arch = getCurrentProcessArch();
  const bitness = ['x64', 'arm64', 'ppc64', 'riscv64'].includes(arch) ? '64' : '32';

  const shellVersion = getSyntheticShellVersion(file);
  if (shellVersion && args.length > 0 && args[0] === '--version') {
    return shellVersion;
  }

  if (command === 'getconf' && args[0] === 'LONG_BIT') {
    return `${bitness}\n`;
  }
  if (command === 'sysctl' && args.includes('sysctl.proc_translated')) {
    return '0\n';
  }
  if (command === 'wmic' && args.join(' ').toLowerCase().includes('osarchitecture')) {
    return `OSArchitecture\n${bitness}-bit\n`;
  }

  return null;
}

function resolveSyntheticWhichTarget(
  controller: ChildProcessController | null,
  target: string,
  cwd: string,
  env: Record<string, string>
): string | null {
  const trimmed = target.trim();
  if (!trimmed) return null;

  if (trimmed.includes('/')) {
    const resolved = resolveFromCwd(cwd, trimmed);
    return controller?.vfs.existsSync(resolved) ? resolved : null;
  }

  const normalizedCwd = normalizeCommandCwd(cwd);
  const resolvedBinTarget = controller
    ? (
      getPackageBinTarget(controller, trimmed, trimmed, normalizedCwd)
      || getPackageBinTarget(controller, trimmed, trimmed, '/')
    )
    : null;
  if (resolvedBinTarget) {
    return resolvedBinTarget;
  }

  const syntheticTarget = SYNTHETIC_WHICH_TARGETS[trimmed];
  if (syntheticTarget) {
    return syntheticTarget;
  }

  const pathKey = Object.prototype.hasOwnProperty.call(env, 'PATH')
    ? 'PATH'
    : (Object.prototype.hasOwnProperty.call(env, 'Path') ? 'Path' : 'PATH');
  const segments = (env[pathKey] || '').split(':').filter(Boolean);

  for (const segment of segments) {
    const candidate = path.normalize(path.join(segment, trimmed));
    if (controller?.vfs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getSyntheticSpawnSyncResult(
  controller: ChildProcessController | null,
  command: string,
  args: string[],
  options: SpawnOptions
): SpawnSyncResult | null {
  const commandName = path.basename(command).toLowerCase();
  const encoding = options.encoding;

  if (commandName === 'which' && args[0]) {
    const resolvedTarget = resolveSyntheticWhichTarget(
      controller,
      args[0],
      options.cwd ?? getDefaultProcessCwd(),
      options.env || {}
    );

    if (resolvedTarget) {
      return {
        stdout: normalizeSpawnSyncOutput(`${resolvedTarget}\n`, encoding),
        stderr: normalizeSpawnSyncOutput('', encoding),
        status: 0,
      };
    }

    return {
      stdout: normalizeSpawnSyncOutput('', encoding),
      stderr: normalizeSpawnSyncOutput('', encoding),
      status: 1,
    };
  }

  return null;
}

function resolveStdioTarget(
  stdio: SpawnOptions['stdio'] | undefined,
  index: number
): StdioTarget {
  const entry = Array.isArray(stdio) ? stdio[index] : stdio;

  if (typeof entry === 'number' && Number.isInteger(entry)) {
    return { fd: entry };
  }

  if (entry === 'inherit' || entry === 'ignore') {
    return entry;
  }

  return 'pipe';
}

function getParentProcessWritable(stream: 'stdout' | 'stderr'): { write?: (data: string) => unknown } | null {
  const proc = (globalThis as any).process as {
    stdout?: { write?: (data: string) => unknown };
    stderr?: { write?: (data: string) => unknown };
  } | undefined;

  return proc?.[stream] ?? null;
}

function applySpawnOutput(
  target: StdioTarget,
  stream: 'stdout' | 'stderr',
  childStream: Readable | null,
  data: string
): void {
  if (!data) return;

  if (target === 'pipe') {
    childStream?.push(Buffer.from(data));
    return;
  }

  if (target === 'inherit') {
    getParentProcessWritable(stream)?.write?.(data);
    return;
  }

  if (target === 'ignore') {
    return;
  }

  writeToFdSync(target.fd, data);
}

function closeSpawnOutput(target: StdioTarget, childStream: Readable | null): void {
  if (target === 'pipe') {
    childStream?.push(null);
  }
}

function getSyntheticExecSyncOutput(
  controller: ChildProcessController | null,
  command: string,
  options: ExecOptions
): string | null {
  const trimmed = command.trim();
  if (!trimmed) return '';

  const whichMatch = trimmed.match(/^which\s+([^\s]+)$/);
  if (whichMatch) {
    const resolvedTarget = resolveSyntheticWhichTarget(
      controller,
      whichMatch[1],
      options.cwd ?? getDefaultProcessCwd(),
      options.env || {}
    );
    if (resolvedTarget) {
      return `${resolvedTarget}\n`;
    }

    const error = new Error(`Command failed: ${command}`);
    (error as { code?: number }).code = 1;
    throw error;
  }

  const versionMatch = trimmed.match(/^(\S+)\s+--version$/);
  if (versionMatch) {
    return getSyntheticShellVersion(versionMatch[1]);
  }

  return null;
}

function parseSyntheticShellExec(args: string[]): { script?: string; error?: string } {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-l' || arg === '--login') {
      continue;
    }
    if (arg === '-lc' || arg === '-cl') {
      const script = args[i + 1];
      return script
        ? { script }
        : { error: 'option requires an argument -- c\n' };
    }
    if (arg === '-c') {
      const remainder = args.slice(i + 1);
      const script = remainder.find((candidate) => candidate !== '-l' && candidate !== '--login');
      return script
        ? { script }
        : { error: 'option requires an argument -- c\n' };
    }
  }

  return {};
}

function splitCommandArgs(command: string): string[] {
  const tokens: string[] = [];
  const matcher = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|([^\s]+)/g;

  let match: RegExpExecArray | null = null;
  while ((match = matcher.exec(command)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(match[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\'));
      continue;
    }
    if (match[2] !== undefined) {
      tokens.push(match[2].replace(/\\'/g, '\'').replace(/\\\\/g, '\\'));
      continue;
    }
    if (match[3] !== undefined) {
      tokens.push(match[3]);
    }
  }

  return tokens;
}

function getBindingDefaultEnv(binding?: ChildProcessModuleBinding): Record<string, string> {
  if (binding?.getDefaultEnv) {
    return {
      ...binding.getDefaultEnv(),
    };
  }
  return getDefaultProcessEnv();
}

function getBindingDefaultCwd(binding?: ChildProcessModuleBinding): string {
  return binding?.getDefaultCwd?.() ?? getDefaultProcessCwd();
}

function maybeRunSyntheticShellCommand(
  controller: ChildProcessController,
  command: string,
  cwd: string,
  env: Record<string, string>
): Promise<JustBashExecResult> | null {
  const tokens = splitCommandArgs(command);
  if (tokens.length === 0) return null;

  const shell = getSyntheticShellSpec(tokens[0]);
  if (!shell) return null;

  const shellName = shell.names[0] || path.basename(tokens[0]);
  const args = tokens.slice(1);

  if (args.includes('--version')) {
    return Promise.resolve({
      stdout: getSyntheticShellVersion(tokens[0]) || '',
      stderr: '',
      exitCode: 0,
    });
  }

  const parsed = parseSyntheticShellExec(args);
  if (parsed.error) {
    return Promise.resolve({
      stdout: '',
      stderr: `${shellName}: ${parsed.error}`,
      exitCode: 2,
    });
  }

  if (!parsed.script) {
    return Promise.resolve({ stdout: '', stderr: '', exitCode: 0 });
  }

  return controller.bashInstance.exec(parsed.script, { cwd, env });
}

function execWithBinding(
  binding: ChildProcessModuleBinding | undefined,
  command: string,
  optionsOrCallback?: ExecOptions | ExecCallback,
  callback?: ExecCallback
): ChildProcess {
  let options: ExecOptions = {};
  let cb: ExecCallback | undefined;

  if (typeof optionsOrCallback === 'function') {
    cb = optionsOrCallback;
  } else if (optionsOrCallback) {
    options = optionsOrCallback;
    cb = callback;
  }

  const child = new ChildProcess();

  (async () => {
    const baseEnv = getBindingDefaultEnv(binding);
    const envHint = { ...baseEnv, ...(options.env || {}) };
    const controller = getActiveController(binding, envHint);
    if (!controller) {
      const error = new Error('child_process not initialized');
      child.emit('error', error);
      if (cb) cb(error, '', '');
      return;
    }

    const existingExecution = getActiveExecutionContext(controller, binding, envHint);
    const execution = existingExecution ?? applyLegacyStreamingDefaults(controller, null);
    const ownsExecution = !existingExecution;
    try {
      const resolvedCwd = options.cwd ?? getBindingDefaultCwd(binding);
      const resolvedEnv = addNodeModuleBinPaths({ ...baseEnv, ...(options.env || {}) }, resolvedCwd);
      const result = await controller.runCommand(command, { cwd: resolvedCwd, env: resolvedEnv }, execution.id);

      const stdout = result.stdout || '';
      const stderr = result.stderr || '';

      // Emit data events
      if (stdout) {
        child.stdout?.push(Buffer.from(stdout));
      }
      child.stdout?.push(null);

      if (stderr) {
        child.stderr?.push(Buffer.from(stderr));
      }
      child.stderr?.push(null);

      // Emit close/exit
      child.emit('close', result.exitCode, null);
      child.emit('exit', result.exitCode, null);

      if (cb) {
        if (result.exitCode !== 0) {
          const error = new Error(`Command failed: ${command}`);
          (error as any).code = result.exitCode;
          cb(error, stdout, stderr);
        } else {
          cb(null, stdout, stderr);
        }
      }
    } catch (error) {
      child.emit('error', error);
      if (cb) cb(error as Error, '', '');
    } finally {
      if (ownsExecution) {
        controller.destroyExecution(execution.id);
      }
    }
  })();

  return child;
}

/**
 * Execute a command in a shell
 */
export function exec(
  command: string,
  optionsOrCallback?: ExecOptions | ExecCallback,
  callback?: ExecCallback
): ChildProcess {
  return execWithBinding(undefined, command, optionsOrCallback, callback);
}

/**
 * Execute a command synchronously
 */
function execSyncWithBinding(
  binding: ChildProcessModuleBinding | undefined,
  command: string,
  options?: ExecOptions
): string | Buffer {
  const controller = getActiveController(binding, { ...getBindingDefaultEnv(binding), ...(options?.env || {}) });
  if (!controller) {
    throw new Error('child_process not initialized');
  }

  const syntheticOutput = getSyntheticExecSyncOutput(controller, command, options || {});
  if (syntheticOutput !== null) {
    return normalizeExecSyncResult(syntheticOutput, options?.encoding);
  }

  throw new Error(
    'execSync is not supported in browser environment. Use exec() with async/await or callbacks instead.'
  );
}

export function execSync(
  command: string,
  options?: ExecOptions
): string | Buffer {
  return execSyncWithBinding(undefined, command, options);
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean | string;
  stdio?: 'pipe' | 'inherit' | 'ignore' | Array<'pipe' | 'inherit' | 'ignore' | number>;
  encoding?: BufferEncoding | 'buffer' | null;
  timeout?: number;
  detached?: boolean;
  windowsHide?: boolean;
}

type SpawnSyncOutput = string | Buffer;
type StdioTarget = 'pipe' | 'inherit' | 'ignore' | { fd: number };

type SpawnSyncResult = {
  stdout: SpawnSyncOutput;
  stderr: SpawnSyncOutput;
  status: number;
  error?: Error;
};

function spawnWithBinding(
  binding: ChildProcessModuleBinding | undefined,
  command: string,
  args?: string[] | SpawnOptions,
  options?: SpawnOptions
): ChildProcess {
  let spawnArgs: string[] = [];
  let spawnOptions: SpawnOptions = {};

  if (Array.isArray(args)) {
    spawnArgs = args;
    spawnOptions = options || {};
  } else if (args) {
    spawnOptions = args;
  }

  const child = new ChildProcess();
  const stdinTarget = resolveStdioTarget(spawnOptions.stdio, 0);
  const stdoutTarget = resolveStdioTarget(spawnOptions.stdio, 1);
  const stderrTarget = resolveStdioTarget(spawnOptions.stdio, 2);

  if (stdinTarget !== 'pipe') {
    child.stdin = null;
  }
  if (stdoutTarget !== 'pipe') {
    child.stdout = null;
  }
  if (stderrTarget !== 'pipe') {
    child.stderr = null;
  }
  child.spawnfile = command;
  child.spawnargs = [command, ...spawnArgs];

  // Build the full command
  const fullCommand = spawnArgs.length > 0
    ? `${command} ${spawnArgs.map(arg =>
        arg.includes(' ') ? `"${arg}"` : arg
      ).join(' ')}`
    : command;

  (async () => {
    const baseEnv = getBindingDefaultEnv(binding);
    const envHint = { ...baseEnv, ...(spawnOptions.env || {}) };
    const controller = getActiveController(binding, envHint);
    if (!controller) {
      const error = new Error('child_process not initialized');
      child.emit('error', error);
      return;
    }

    const existingExecution = getActiveExecutionContext(controller, binding, envHint);
    const execution = existingExecution ?? applyLegacyStreamingDefaults(controller, null);
    const ownsExecution = !existingExecution;
    try {
      const resolvedCwd = spawnOptions.cwd ?? getBindingDefaultCwd(binding);
      const resolvedEnv = addNodeModuleBinPaths({ ...baseEnv, ...(spawnOptions.env || {}) }, resolvedCwd);
      const result = await controller.runCommand(fullCommand, { cwd: resolvedCwd, env: resolvedEnv }, execution.id);

      const stdout = result.stdout || '';
      const stderr = result.stderr || '';

      applySpawnOutput(stdoutTarget, 'stdout', child.stdout, stdout);
      closeSpawnOutput(stdoutTarget, child.stdout);

      applySpawnOutput(stderrTarget, 'stderr', child.stderr, stderr);
      closeSpawnOutput(stderrTarget, child.stderr);

      // Defer close/exit so Readable 'data' events flush before 'close' fires.
      // push() queues data emission as a microtask; emitting close/exit
      // synchronously here would fire before the data reaches listeners.
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      child.exitCode = result.exitCode;
      child.emit('close', result.exitCode, null);
      child.emit('exit', result.exitCode, null);
    } catch (error) {
      child.emit('error', error);
    } finally {
      if (ownsExecution) {
        controller.destroyExecution(execution.id);
      }
    }
  })();

  return child;
}

/**
 * Spawn a new process
 */
export function spawn(
  command: string,
  args?: string[] | SpawnOptions,
  options?: SpawnOptions
): ChildProcess {
  return spawnWithBinding(undefined, command, args, options);
}

/**
 * Spawn a new process synchronously
 */
function spawnSyncWithBinding(
  binding: ChildProcessModuleBinding | undefined,
  command: string,
  args?: string[],
  options?: SpawnOptions
): SpawnSyncResult {
  const spawnArgs = args || [];
  const baseEnv = getBindingDefaultEnv(binding);
  const controller = getActiveController(binding, { ...baseEnv, ...(options?.env || {}) });
  const resolvedCwd = options?.cwd ?? getBindingDefaultCwd(binding);
  const resolvedEnv = addNodeModuleBinPaths({ ...baseEnv, ...(options?.env || {}) }, resolvedCwd);
  const syntheticResult = getSyntheticSpawnSyncResult(controller, command, spawnArgs, {
    ...options,
    cwd: resolvedCwd,
    env: resolvedEnv,
  });

  if (syntheticResult) {
    return syntheticResult;
  }

  throw new Error(
    'spawnSync is not supported in browser environment. Use spawn() instead.'
  );
}

export function spawnSync(
  command: string,
  args?: string[],
  options?: SpawnOptions
): SpawnSyncResult {
  return spawnSyncWithBinding(undefined, command, args, options);
}

/**
 * Execute a file
 */
function execFileWithBinding(
  binding: ChildProcessModuleBinding | undefined,
  file: string,
  args?: string[] | ExecOptions | ExecCallback,
  options?: ExecOptions | ExecCallback,
  callback?: ExecCallback
): ChildProcess {
  let execArgs: string[] = [];
  let execOptions: ExecOptions = {};
  let cb: ExecCallback | undefined;

  if (Array.isArray(args)) {
    execArgs = args;
    if (typeof options === 'function') {
      cb = options;
    } else if (options) {
      execOptions = options;
      cb = callback;
    }
  } else if (typeof args === 'function') {
    cb = args;
  } else if (args) {
    execOptions = args;
    cb = options as ExecCallback;
  }

  const command = execArgs.length > 0
    ? [file, ...execArgs.map((value) => shellQuote(value))].join(' ')
    : file;
  return execWithBinding(binding, command, execOptions, cb);
}

export function execFile(
  file: string,
  args?: string[] | ExecOptions | ExecCallback,
  options?: ExecOptions | ExecCallback,
  callback?: ExecCallback
): ChildProcess {
  return execFileWithBinding(undefined, file, args, options, callback);
}

/**
 * Execute a file synchronously.
 * This browser runtime cannot execute shell commands synchronously, so we provide
 * deterministic results for common architecture probes used by npm packages.
 */
function execFileSyncWithBinding(
  binding: ChildProcessModuleBinding | undefined,
  file: string,
  argsOrOptions?: string[] | ExecOptions,
  options?: ExecOptions
): string | Buffer {
  let execArgs: string[] = [];
  let execOptions: ExecOptions = {};

  if (Array.isArray(argsOrOptions)) {
    execArgs = argsOrOptions;
    execOptions = options || {};
  } else if (argsOrOptions) {
    execOptions = argsOrOptions;
  }

  const syntheticOutput = getSyntheticExecFileSyncOutput(file, execArgs);
  if (syntheticOutput !== null) {
    return normalizeExecSyncResult(syntheticOutput, execOptions.encoding);
  }

  throw new Error(
    'execFileSync is not supported in browser environment. Use execFile() with async/await or callbacks instead.'
  );
}

export function execFileSync(
  file: string,
  argsOrOptions?: string[] | ExecOptions,
  options?: ExecOptions
): string | Buffer {
  return execFileSyncWithBinding(undefined, file, argsOrOptions, options);
}

/**
 * Fork — runs a Node.js module in a simulated child process using a new Runtime.
 * In the browser, there's no real process forking. Instead we:
 * 1. Create a ChildProcess with IPC (send/on('message'))
 * 2. Create a new Runtime to execute the module
 * 3. Wire up bidirectional IPC between parent and child
 */
function forkWithBinding(
  binding: ChildProcessModuleBinding | undefined,
  modulePath: string,
  argsOrOptions?: string[] | Record<string, unknown>,
  options?: Record<string, unknown>
): ChildProcess {
  const baseEnv = getBindingDefaultEnv(binding);
  const controller = getActiveController(binding, {
    ...baseEnv,
    ...((!Array.isArray(argsOrOptions) && argsOrOptions?.env) ? argsOrOptions.env as Record<string, string> : {}),
    ...((options?.env as Record<string, string> | undefined) || {}),
  });
  if (!controller) throw new Error('VFS not initialized');

  // Parse overloaded arguments
  let args: string[] = [];
  let opts: Record<string, unknown> = {};
  if (Array.isArray(argsOrOptions)) {
    args = argsOrOptions;
    opts = options || {};
  } else if (argsOrOptions) {
    opts = argsOrOptions;
  }

  const cwd = (opts.cwd as string) || getBindingDefaultCwd(binding);
  const env = {
    ...baseEnv,
    ...(opts.env as Record<string, string> | undefined || {}),
  };
  const execArgv = (opts.execArgv as string[]) || [];

  // Resolve the module path
  const resolvedPath = modulePath.startsWith('/')
    ? modulePath
    : `${cwd}/${modulePath}`.replace(/\/+/g, '/');

  const child = new ChildProcess();
  child.connected = true;
  child.spawnargs = ['node', ...execArgv, resolvedPath, ...args];
  child.spawnfile = 'node';

  // Create a Runtime for the child process
  const existingExecution = getActiveExecutionContext(controller, binding, env);
  const execution = existingExecution ?? applyLegacyStreamingDefaults(controller, null);
  const ownsExecution = !existingExecution;

  const childRuntime = new Runtime(controller.vfs, {
    cwd,
    env: withExecutionEnv(controller, execution, env),
    childProcessController: controller,
    onConsole: (method, consoleArgs) => {
      const msg = consoleArgs.map(a => String(a)).join(' ');
      if (method === 'error' || method === 'warn') {
        child.stderr?.emit('data', msg + '\n');
      } else {
        child.stdout?.emit('data', msg + '\n');
      }
    },
    onStdout: (data: string) => {
      child.stdout?.emit('data', data);
    },
    onStderr: (data: string) => {
      child.stderr?.emit('data', data);
    },
  });

  const childProc = childRuntime.getProcess();
  childProc.argv = ['node', resolvedPath, ...args];

  // Set up bidirectional IPC with serialized delivery.
  // In real Node.js, IPC messages cross a process boundary (pipe/fd), so there's
  // natural latency. In our same-thread implementation, we need to serialize
  // message delivery to prevent race conditions (e.g. vitest's reporter receiving
  // task-update before the "collected" tasks are registered).

  // Clone IPC messages to mimic real Node.js IPC behavior.
  // Real IPC serializes messages across process boundaries (V8 serializer).
  // Without cloning, shared object references cause issues: vitest's child
  // modifies task objects after sending, and the parent sees stale/corrupted state.
  const cloneIpcMessage = (msg: unknown): unknown => {
    try { return structuredClone(msg); } catch { return msg; }
  };

  // Parent sends → child process receives
  child.send = (message: unknown, _callback?: (error: Error | null) => void): boolean => {
    if (!child.connected) return false;
    const cloned = cloneIpcMessage(message);
    setTimeout(() => {
      childProc.emit('message', cloned);
    }, 0);
    return true;
  };

  // Child sends → parent ChildProcess receives (serialized + awaited)
  // In real Node.js, IPC crosses a process boundary so messages are naturally serialized.
  // In our same-thread implementation, we must manually serialize AND await async handlers.
  // Using emit() won't work — EventEmitter is fire-and-forget for async handlers.
  // Instead, we directly invoke each 'message' listener and await any returned promises.
  // This ensures birpc's async onCollected finishes before onTaskUpdate starts.
  let ipcQueue: Promise<void> = Promise.resolve();
  childProc.send = ((message: unknown, _callback?: (error: Error | null) => void): boolean => {
    if (!child.connected) return false;
    const cloned = cloneIpcMessage(message);
    ipcQueue = ipcQueue.then(async () => {
      const listeners = child.listeners('message');
      for (const listener of listeners) {
        try {
          const result = (listener as (...args: unknown[]) => unknown)(cloned);
          if (result && typeof (result as Promise<unknown>).then === 'function') {
            await result;
          }
        } catch {
          // Handler errors propagate through vitest's own error handling
        }
      }
    });
    return true;
  }) as any;
  childProc.connected = true;

  // Track this fork in the active children count
  execution.activeForkedChildren++;

  const notifyChildExit = () => {
    execution.activeForkedChildren = Math.max(0, execution.activeForkedChildren - 1);
    execution.onForkedChildExit?.();
    if (ownsExecution && !execution.activeForkedChildren) {
      controller.destroyExecution(execution.id);
    }
  };

  // Override child's process.exit
  childProc.exit = ((code = 0) => {
    child.exitCode = code;
    child.connected = false;
    childProc.connected = false;
    childProc.emit('exit', code);
    child.emit('exit', code, null);
    child.emit('close', code, null);
    notifyChildExit();
  }) as (code?: number) => never;

  // Override child's kill to disconnect
  child.kill = (signal?: string): boolean => {
    child.killed = true;
    child.connected = false;
    childProc.connected = false;
    childProc.emit('exit', null, signal || 'SIGTERM');
    child.emit('exit', null, signal || 'SIGTERM');
    child.emit('close', null, signal || 'SIGTERM');
    notifyChildExit();
    return true;
  };

  child.disconnect = (): void => {
    child.connected = false;
    childProc.connected = false;
    child.emit('disconnect');
  };

  // Run the module asynchronously
  setTimeout(() => {
    try {
      childRuntime.runFile(resolvedPath);
    } catch (error) {
      // process.exit throws in sync mode — that's normal
      if (error instanceof Error && error.message.startsWith('Process exited with code')) {
        return;
      }
      const errorMsg = error instanceof Error ? error.message : String(error);
      child.stderr?.emit('data', `Error in forked process: ${errorMsg}\n`);
      child.exitCode = 1;
      child.emit('error', error);
      child.emit('exit', 1, null);
      child.emit('close', 1, null);
    }
  }, 0);

  return child;
}

export function fork(
  modulePath: string,
  argsOrOptions?: string[] | Record<string, unknown>,
  options?: Record<string, unknown>
): ChildProcess {
  return forkWithBinding(undefined, modulePath, argsOrOptions, options);
}

/**
 * ChildProcess class
 */
export class ChildProcess extends EventEmitter {
  pid: number;
  connected: boolean = false;
  killed: boolean = false;
  exitCode: number | null = null;
  signalCode: string | null = null;
  spawnargs: string[] = [];
  spawnfile: string = '';

  stdin: Writable | null;
  stdout: Readable | null;
  stderr: Readable | null;

  constructor() {
    super();
    this.pid = Math.floor(Math.random() * 10000) + 1000;
    this.stdin = new Writable();
    this.stdout = new Readable();
    this.stderr = new Readable();
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.emit('exit', null, signal || 'SIGTERM');
    return true;
  }

  disconnect(): void {
    this.connected = false;
  }

  send(message: unknown, callback?: (error: Error | null) => void): boolean {
    // IPC not supported
    if (callback) callback(new Error('IPC not supported'));
    return false;
  }

  ref(): this {
    return this;
  }

  unref(): this {
    return this;
  }
}

export function getDefaultChildProcessController(): ChildProcessController | null {
  return defaultChildProcessController;
}

export function createChildProcessModule(binding?: ChildProcessModuleBinding) {
  return {
    exec: (
      command: string,
      optionsOrCallback?: ExecOptions | ExecCallback,
      callback?: ExecCallback
    ) => execWithBinding(binding, command, optionsOrCallback, callback),
    execSync: (command: string, options?: ExecOptions) => execSyncWithBinding(binding, command, options),
    execFile: (
      file: string,
      args?: string[] | ExecOptions | ExecCallback,
      options?: ExecOptions | ExecCallback,
      callback?: ExecCallback
    ) => execFileWithBinding(binding, file, args, options, callback),
    execFileSync: (
      file: string,
      argsOrOptions?: string[] | ExecOptions,
      options?: ExecOptions
    ) => execFileSyncWithBinding(binding, file, argsOrOptions, options),
    spawn: (command: string, args?: string[] | SpawnOptions, options?: SpawnOptions) => {
      return spawnWithBinding(binding, command, args, options);
    },
    spawnSync: (command: string, args?: string[], options?: SpawnOptions) => {
      return spawnSyncWithBinding(binding, command, args, options);
    },
    fork: (modulePath: string, argsOrOptions?: string[] | Record<string, unknown>, options?: Record<string, unknown>) => {
      return forkWithBinding(binding, modulePath, argsOrOptions, options);
    },
    ChildProcess,
    initChildProcess,
    setStreamingCallbacks,
    clearStreamingCallbacks,
    sendStdin,
  };
}

export default {
  exec,
  execSync,
  execFile,
  execFileSync,
  spawn,
  spawnSync,
  fork,
  ChildProcess,
  initChildProcess,
  setStreamingCallbacks,
  clearStreamingCallbacks,
};
