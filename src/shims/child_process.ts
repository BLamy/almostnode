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
    pid: Math.floor(Math.random() * 10000) + 1000,
    ppid: 0,
    getuid: () => 1000,
    getgid: () => 1000,
    geteuid: () => 1000,
    getegid: () => 1000,
    stdout: { write: () => {} },
    stderr: { write: () => {} },
  };
}

import { Bash, defineCommand } from 'just-bash';
import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import { EventEmitter } from './events';
import { closeFdSync, dupFdSync, writeToFdSync } from './fs';
import { Readable, Writable, Buffer } from './stream';
import type { Process } from './process';
import type { VirtualFS } from '../virtual-fs';
import { VirtualFSAdapter } from './vfs-adapter';
import { Runtime } from '../runtime';
import type { InstallMode, PackageManagerMutationSummary } from '../npm';
import type { PackageJson } from '../types/package-json';
import { almostnodeDebugError, almostnodeDebugLog } from '../utils/debug';
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
  clearInstalledPackagesCache?: () => void;
  setHMRTarget?: (targetWindow: Window) => void;
};

// ---------------------------------------------------------------------------
// Workspace search provider — used by grep/rg to delegate to VS Code search
// ---------------------------------------------------------------------------

export interface WorkspaceSearchMatch {
  lineNumber: number;
  lineText: string;
  matchStart: number;
  matchEnd: number;
}

export interface WorkspaceSearchFileResult {
  filePath: string;
  matches: WorkspaceSearchMatch[];
}

export interface WorkspaceSearchResult {
  files: WorkspaceSearchFileResult[];
  limitHit: boolean;
}

export interface WorkspaceSearchOptions {
  pattern: string;
  isRegExp: boolean;
  isCaseSensitive: boolean;
  isWordMatch: boolean;
  folderPath: string;
  includePattern?: string;
  excludePattern?: string;
  maxResults?: number;
  surroundingContext?: number;
}

export interface WorkspaceSearchProvider {
  search(options: WorkspaceSearchOptions): Promise<WorkspaceSearchResult>;
}

const CONTROLLER_ID_ENV_KEY = '__ALMOSTNODE_CONTROLLER_ID';
const EXECUTION_ID_ENV_KEY = '__ALMOSTNODE_EXECUTION_ID';
const INTERNAL_ENV_KEYS = [CONTROLLER_ID_ENV_KEY, EXECUTION_ID_ENV_KEY] as const;

/**
 * Convert ctx.env to a plain Record<string, string>.
 * just-bash 2.13+ changed CommandContext.env from Record to Map<string, string>.
 * All our code expects a plain object, so we normalize here.
 */
function envToRecord(env: Map<string, string> | Record<string, string> | undefined): Record<string, string> {
  if (!env) return {};
  if (env instanceof Map) return Object.fromEntries(env);
  return env;
}

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
  /** Keep the execution alive until it explicitly exits or is aborted. */
  interactive: boolean;
  activeProcessStdin: ActiveProcessStdin | null;
  activeProcess: Process | null;
  activeForkedChildren: number;
  onForkedChildExit: (() => void) | null;
  activeShellChildren: number;
  /** Set to true by command handlers (e.g. node) that stream their own output via onStdout/onStderr */
  outputStreamed: boolean;
  columns: number;
  rows: number;
}

export interface ChildProcessController {
  id: string;
  vfs: VirtualFS;
  vfsAdapter: VirtualFSAdapter;
  bashInstance: Bash;
  installMode: InstallMode;
  onInstallMutation: ((summary: PackageManagerMutationSummary) => void | Promise<void>) | null;
  frameworkDevServers: Map<string, ManagedFrameworkDevServer>;
  executions: Map<string, ChildProcessExecutionContext>;
  keychain?: { persistCurrentState(): Promise<void> } | null;
  searchProvider?: WorkspaceSearchProvider | null;
  createExecution: (opts?: {
    onStdout?: (data: string) => void;
    onStderr?: (data: string) => void;
    signal?: AbortSignal;
    interactive?: boolean;
    cols?: number;
    rows?: number;
  }) => ChildProcessExecutionContext;
  destroyExecution: (executionId: string | null | undefined) => void;
  runCommand: (
    command: string,
    options?: { cwd?: string; env?: Record<string, string> },
    executionId?: string | null
  ) => Promise<JustBashExecResult>;
  sendInput: (executionId: string | null | undefined, data: string) => void;
  updateExecutionSize: (executionId: string | null | undefined, cols: number, rows: number) => void;
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
    interactive?: boolean;
    cols?: number;
    rows?: number;
  }
): ChildProcessExecutionContext {
  const execution: ChildProcessExecutionContext = {
    id: crypto.randomUUID(),
    controllerId: controller.id,
    onStdout: opts?.onStdout || null,
    onStderr: opts?.onStderr || null,
    signal: opts?.signal || null,
    interactive: !!opts?.interactive,
    activeProcessStdin: null,
    activeProcess: null,
    activeForkedChildren: 0,
    onForkedChildExit: null,
    activeShellChildren: 0,
    outputStreamed: false,
    columns: Number.isFinite(opts?.cols) ? Math.max(1, Math.floor(opts!.cols!)) : 80,
    rows: Number.isFinite(opts?.rows) ? Math.max(1, Math.floor(opts!.rows!)) : 24,
  };
  controller.executions.set(execution.id, execution);
  return execution;
}

function applyExecutionTerminalSize(execution: ChildProcessExecutionContext, proc: Process): void {
  const columns = Math.max(1, Math.floor(execution.columns || 80));
  const rows = Math.max(1, Math.floor(execution.rows || 24));

  proc.env.COLUMNS = String(columns);
  proc.env.LINES = String(rows);
  proc.stdout.columns = columns;
  proc.stdout.rows = rows;
  proc.stderr.columns = columns;
  proc.stderr.rows = rows;
  proc.stdout.emit?.('resize', columns, rows);
  proc.stderr.emit?.('resize', columns, rows);
  proc.emit?.('SIGWINCH', rows, columns);
}

function destroyExecutionContext(
  controller: ChildProcessController,
  executionId: string | null | undefined
): void {
  if (!executionId) return;
  const execution = controller.executions.get(executionId);
  if (execution) {
    execution.activeProcessStdin = null;
    execution.activeProcess = null;
  }
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
      maybeRunCustomCommandDirect(controller, command, resolvedCwd, envWithContext)
      ?? maybeRunSyntheticShellCommand(controller, command, resolvedCwd, envWithContext)
      ?? controller.bashInstance.exec(stripQuotesForBash(normalizeQuotes(command)), {
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

/**
 * Replace Unicode curly/smart quotes with ASCII equivalents.
 * AI-generated commands may use \u201C \u201D (double) or \u2018 \u2019 (single)
 * which confuse bash lexers.
 */
function normalizeQuotes(s: string): string {
  return s
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'");
}

/**
 * Intercept known custom commands and dispatch them directly, bypassing
 * just-bash's lexer which fails on quoted arguments (e.g.
 * `playwright-cli fill e3 "Buy groceries"`, `pg "SELECT 1 as test"`).
 * Uses splitCommandArgs for proper quote-aware tokenization.
 */
function maybeRunCustomCommandDirect(
  controller: ChildProcessController,
  command: string,
  _cwd: string,
  _env: Record<string, string>
): Promise<JustBashExecResult> | null {
  const normalized = normalizeQuotes(command.trim());
  const tokens = splitCommandArgs(normalized);
  if (tokens.length === 0) return null;

  // Don't intercept compound commands (pipes, chains, semicolons).
  // Strip quoted content and shell redirections (e.g. 2>&1) first so
  // operators inside quotes or redirections are ignored.
  const withoutQuoted = normalized
    .replace(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'/g, '')
    .replace(/\d*>&\d+/g, '');
  if (/[|;&]/.test(withoutQuoted)) return null;

  const cmd = tokens[0];
  // Filter out shell redirections like 2>&1 that splitCommandArgs picks up as tokens
  const args = tokens.slice(1).filter(t => !/^\d*>&\d+$/.test(t));
  const vfs = controller.vfs;

  switch (cmd) {
    case 'playwright-cli':
      return (async () => {
        const { runPlaywrightCommand } = await import('./playwright-command');
        return runPlaywrightCommand(args, {} as any, vfs);
      })();
    case 'pg':
      return (async () => {
        const { runPgCommand } = await import('./pg-command');
        return runPgCommand(args, {} as any, vfs);
      })();
    case 'pglite':
      return (async () => {
        const { runPGliteCommand } = await import('./pglite-command');
        return runPGliteCommand(args, {} as any, vfs);
      })();
    case 'curl':
      return (async () => {
        const { runCurlCommand } = await import('./curl-command');
        return runCurlCommand(args, {} as any, vfs);
      })();
    case 'git':
      return (async () => {
        const { runGitCommand } = await import('./git-command');
        return runGitCommand(args, {} as any, vfs);
      })();
    case 'gh':
      return (async () => {
        const { runGhCommand } = await import('./gh-command');
        return runGhCommand(args, {} as any, vfs);
      })();
    case 'tsc':
      return (async () => {
        const { runTscCommand } = await import('./tsc-command');
        return runTscCommand(args, {} as any, vfs);
      })();
    default:
      return null;
  }
}

/**
 * Strip quotes from a command string so just-bash's broken lexer won't crash.
 * Tokenizes properly, then rejoins — but re-wraps originally-quoted tokens
 * in double quotes when they contain shell metacharacters like `(` or `)`.
 * This prevents just-bash's lexer from treating parentheses in SQL statements
 * (e.g. `INSERT INTO users (col) VALUES ('x')`) as subshell operators.
 */
function stripQuotesForBash(command: string): string {
  if (!command.includes('"') && !command.includes("'")) return command;

  const result: string[] = [];
  const matcher = /"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|([^\s]+)/g;
  let match: RegExpExecArray | null = null;

  while ((match = matcher.exec(command)) !== null) {
    if (match[1] !== undefined) {
      // Was double-quoted — unescape, then re-quote if it contains
      // characters that would confuse just-bash's lexer.
      const content = match[1].replace(/\\(["\\$`!])/g, '$1');
      if (/[()$`]/.test(content) || /\s/.test(content)) {
        result.push('"' + content.replace(/["\\$`]/g, '\\$&') + '"');
      } else {
        result.push(content);
      }
    } else if (match[2] !== undefined) {
      // Was single-quoted — unescape, then re-quote if needed.
      const content = match[2].replace(/\\(['\\!])/g, '$1');
      if (/[()$`]/.test(content) || /\s/.test(content)) {
        result.push('"' + content.replace(/["\\$`]/g, '\\$&') + '"');
      } else {
        result.push(content);
      }
    } else if (match[3] !== undefined) {
      // Was unquoted — pass through as-is (preserves legit shell syntax)
      result.push(match[3]);
    }
  }

  return result.join(' ');
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
export function initChildProcess(
  vfs: VirtualFS,
  options: {
    installMode?: InstallMode;
    onInstallMutation?: (summary: PackageManagerMutationSummary) => void | Promise<void>;
  } = {},
): ChildProcessController {
  const existing = controllersByVfs.get(vfs);
  if (existing) {
    defaultChildProcessController = existing;
    return existing;
  }

  const controllerId = crypto.randomUUID();
  const vfsAdapter = new VirtualFSAdapter(vfs);
  let controller: ChildProcessController;

  const nodeCommand = defineCommand('node', async (args, ctx) => {
    const env = envToRecord(ctx.env);
    const execution = getExecutionContextFromEnv(controller, env) ?? createExecutionContext(controller);
    const ownsExecution = !getExecutionContextFromEnv(controller, env);

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
    const isNpxExec = env.ALMOSTNODE_NPX_EXEC === '1';
    const isLongIdleNodeModulesCli =
      isNodeModulesCli &&
      !isOneShotNodeModulesCli &&
      (env.ALMOSTNODE_LONG_NODE_IDLE === '1' || env.ALMOSTNODE_LONG_NODE_IDLE === 'true');

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
      env,
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
    execution.activeProcess = proc;
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
      applyExecutionTerminalSize(execution, proc);
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

      const preloadResult = (await runtime.execute(preloadCode, '/__almostnode_preload_yoga__.js')).exports;
      if (preloadResult && typeof (preloadResult as Promise<unknown>).then === 'function') {
        await (preloadResult as Promise<unknown>);
      }
    };

    try {
      await preloadYogaLayout();
      await runtime.runFile(resolvedPath);
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
        ? 10_000
        : (isNodeModulesCli ? 300 : 200);
      const NO_OUTPUT_IDLE_MS = isLongIdleNodeModulesCli
        ? (isNpxExec ? 15_000 : 20_000)
        : (isNpxExec ? 30_000 : (isNodeModulesCli ? 2_000 : 1_000));
      const STALE_PENDING_TIMER_IDLE_MS = isLongIdleNodeModulesCli
        ? (isNpxExec ? 5_000 : 10_000)
        : (isNodeModulesCli ? 2_000 : Number.POSITIVE_INFINITY);
      const POST_CHILD_EXIT_IDLE_MS = isLongIdleNodeModulesCli ? 500 : 100;
      const ACTIVE_SUBPROCESS_STALE_MS = isLongIdleNodeModulesCli ? 5_000 : 2_000;
      const CHECK_MS = 50;
      const startTime = Date.now();
      let lastOutputLen = stdout.length + stderr.length;
      let idleMs = 0;
      let pendingTimerIdleMs = 0;

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
          pendingTimerIdleMs = 0;
        } else {
          idleMs += CHECK_MS;
          pendingTimerIdleMs += CHECK_MS;
        }

        const keepAliveForInteractiveInput = !!execution.signal && (
          stdinRawMode ||
          hasActiveStdinListeners(proc.stdin)
        );
        if (keepAliveForInteractiveInput) {
          continue;
        }

        if (Date.now() - startTime >= MAX_TOTAL_MS) break;

        const hasPendingRefedTimers = runtime.hasPendingRefedTimers();
        if (hasPendingRefedTimers) {
          const allowStalePendingTimerExit =
            isNodeModulesCli &&
            execution.activeForkedChildren <= 0 &&
            execution.activeShellChildren <= initialShellChildren;

          if (!allowStalePendingTimerExit || pendingTimerIdleMs < STALE_PENDING_TIMER_IDLE_MS) {
            continue;
          }

          almostnodeDebugLog(
            'npx',
            `[almostnode DEBUG] node exiting after stale pending timers: path=${resolvedPath} idleMs=${pendingTimerIdleMs} interactive=${execution.interactive ? '1' : '0'}`,
          );
        } else {
          pendingTimerIdleMs = 0;
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

      const aborted = execution.signal?.aborted;
      return { stdout, stderr, exitCode: exitCalled ? exitCode : (aborted ? 130 : 0) };
    } finally {
      // Free all cached module data (parsed ASTs, transformed code, resolver caches)
      // to avoid accumulating memory across consecutive node command invocations.
      runtime.clearCache();
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
    const env = envToRecord(ctx.env);
    const execution = getExecutionContextFromEnv(controller, env);
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

    const LONG_RUNNING_NPX_COMMANDS = new Set([
      // 'shadcn', 'npm', 'npx'
    ]);

    const commandName = cmdArgs[0];
    const commandArgs = cmdArgs.slice(1);

    // Intercept commands that have custom shim implementations — skip npm resolution
    if (commandName === 'drizzle-kit') {
      const { runDrizzleKitCommand } = await import('./drizzle-kit-command');
      return runDrizzleKitCommand(commandArgs, ctx, controller.vfs);
    }

    if (commandName === 'tsc') {
      const { runTscCommand } = await import('./tsc-command');
      return runTscCommand(commandArgs, ctx, controller.vfs);
    }

    const installSpec = packageSpec || commandName;

    const { parsePackageSpec } = await import('../npm/index');
    const {
      name: pkgName,
      version: requestedVersion,
    } = parsePackageSpec(typeof installSpec === 'string' ? installSpec : commandName);
    const forceLatestInstall = requestedVersion === 'latest';
    const binName = packageSpec ? commandName : (pkgName.includes('/') ? pkgName.split('/').pop()! : pkgName);
    const quoteArg = (value: string) => JSON.stringify(value);
    const installDecision = forceLatestInstall ? 'install-latest' : 'reuse-or-install';

    almostnodeDebugLog(
      'npx',
      `[almostnode DEBUG] npx parsed: command=${commandName} installSpec=${installSpec} package=${pkgName} version=${requestedVersion || 'latest'} bin=${binName} cwd=${ctx.cwd} mode=${controller.installMode} decision=${installDecision}`,
    );

    let npxSuppressedCount = 0;
    const emitInstallProgress = (message: string) => {
      // Suppress per-dep spam (same logic as handleNpmInstall)
      if ((/^Resolving\s+/.test(message) && !message.endsWith('...')) ||
          /^\s+Downloading\s+/.test(message) ||
          /^Skipping\s+/.test(message)) {
        npxSuppressedCount++;
        return;
      }
      // Don't stream — let output return in the final result to avoid
      // interleaving with Claude Code's UI rendering.
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
      almostnodeDebugError('npx', `[almostnode DEBUG] ${diagnostic.trimEnd()}`);

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
      const pm = await createPackageManager(controller, installCwd || '/');
      try {
        await pm.install(installSpec, { onProgress: emitInstallProgress });
        npxSuppressedCount = 0;
      } finally {
        pm.dispose();
      }
    };

    let { binPath, resolvedBinTarget } = resolveBin(ctx.cwd);
    let useExtendedNodeIdle = false;
    almostnodeDebugLog(
      'npx',
      `[almostnode DEBUG] npx resolve before install: binPath=${binPath || '-'} resolvedBinTarget=${resolvedBinTarget || '-'} mode=${controller.installMode}`,
    );

    if (forceLatestInstall && (binPath || resolvedBinTarget)) {
      almostnodeDebugLog(
        'npx',
        `[almostnode DEBUG] npx skipping @latest reinstall: already resolved binPath=${binPath || '-'} resolvedBinTarget=${resolvedBinTarget || '-'}`,
      );
    }

    if (!binPath && !resolvedBinTarget) {
      useExtendedNodeIdle = true;
      try {
        almostnodeDebugLog(
          'npx',
          `[almostnode DEBUG] npx install start: spec=${installSpec} cwd=${ctx.cwd} mode=${controller.installMode}`,
        );
        await installPackage(ctx.cwd);
        ({ binPath, resolvedBinTarget } = resolveBin(ctx.cwd));
        almostnodeDebugLog(
          'npx',
          `[almostnode DEBUG] npx resolve after install: binPath=${binPath || '-'} resolvedBinTarget=${resolvedBinTarget || '-'} cwd=${ctx.cwd}`,
        );
        if (!binPath && !resolvedBinTarget && ctx.cwd !== '/') {
          emitInstallProgress('npx: retrying install in / to resolve command bin...');
          almostnodeDebugLog(
            'npx',
            `[almostnode DEBUG] npx install retry in /: spec=${installSpec} originalCwd=${ctx.cwd} mode=${controller.installMode}`,
          );
          await installPackage('/');
          ({ binPath, resolvedBinTarget } = resolveBin('/'));
          almostnodeDebugLog(
            'npx',
            `[almostnode DEBUG] npx resolve after root retry: binPath=${binPath || '-'} resolvedBinTarget=${resolvedBinTarget || '-'} cwd=/`,
          );
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        almostnodeDebugError('npx', `[almostnode DEBUG] npx install failed: spec=${installSpec} cwd=${ctx.cwd} -> ${msg}`);
        return { stdout: '', stderr: `npx: install failed: ${msg}\n`, exitCode: 1 };
      }
    }

    if (!binPath && !resolvedBinTarget) {
      almostnodeDebugError(
        'npx',
        `[almostnode DEBUG] npx command not found after resolution: package=${pkgName} bin=${binName} cwd=${ctx.cwd}`,
      );
      return { stdout: '', stderr: `npx: command not found: ${binName}\n`, exitCode: 1 };
    }

    if (!ctx.exec) {
      return {
        stdout: '',
        stderr: 'npx: command execution not available in this context\n',
        exitCode: 1,
      };
    }

    const execEnv = {
      ...env,
      ...((useExtendedNodeIdle || LONG_RUNNING_NPX_COMMANDS.has(commandName)) ? { ALMOSTNODE_LONG_NODE_IDLE: '1' } : {}),
      ALMOSTNODE_NPX_EXEC: '1',
    };

    if (resolvedBinTarget) {
      const fullCommand = ['node', resolvedBinTarget, ...commandArgs].map((value) => quoteArg(value)).join(' ');
      almostnodeDebugLog(
        'npx',
        `[almostnode DEBUG] npx exec target: node ${resolvedBinTarget} args=${commandArgs.length} interactive=${execution?.interactive ? '1' : '0'}`,
      );
      const result = await ctx.exec(fullCommand, { cwd: ctx.cwd, env: execEnv });
      return withNpxExecDiagnostics(result, `node ${resolvedBinTarget}`);
    }

    if (!binPath) {
      return { stdout: '', stderr: `npx: command not found: ${binName}\n`, exitCode: 1 };
    }

    const fullCommand = [binPath, ...commandArgs].map((value) => quoteArg(value)).join(' ');
    almostnodeDebugLog(
      'npx',
      `[almostnode DEBUG] npx exec target: ${binPath} args=${commandArgs.length} interactive=${execution?.interactive ? '1' : '0'}`,
    );
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
    const env = envToRecord(ctx.env);
    const execution = getExecutionContextFromEnv(controller, env);
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
        env: { ...env },
        deploymentBasePath: bridge.getBasePath(),
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
        clearInstalledPackagesCache: () => server.clearInstalledPackagesCache(),
        setHMRTarget: (targetWindow: Window) => server.setHMRTarget(targetWindow),
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
    const env = envToRecord(ctx.env);
    const execution = getExecutionContextFromEnv(controller, env);
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

      // Auto-detect TanStack Router/Start from package.json
      let spaFallback = false;
      let aliases: Record<string, string> | undefined;
      let tanstackRouter = false;
      try {
        const pkgPath = root === '/' ? '/package.json' : root + '/package.json';
        const pkgJson = JSON.parse(controller.vfs.readFileSync(pkgPath, 'utf8') as string);
        const allDeps = { ...pkgJson.dependencies, ...pkgJson.devDependencies };
        if (allDeps['@tanstack/react-router'] || allDeps['@tanstack/start']) {
          spaFallback = true;
          aliases = { '~/': 'src/', '@/': 'src/' };
          tanstackRouter = true;
          console.log('[vite] Detected TanStack Router — enabling SPA fallback and route tree generation');
        } else if (allDeps['react-router-dom'] || allDeps['react-router']) {
          spaFallback = true;
          aliases = { '@/': 'src/' };
          console.log('[vite] Detected React Router — enabling SPA fallback');
        }
      } catch {
        // No package.json or parse error, skip detection
      }

      const server = new ViteDevServer(controller.vfs, {
        port,
        root,
        spaFallback,
        aliases,
        tanstackRouter,
      });

      // Generate initial route tree before server starts
      if (tanstackRouter) {
        try {
          const { generateAndWriteRouteTree } = await import('../frameworks/tanstack-route-tree');
          const wrote = generateAndWriteRouteTree(controller.vfs, root);
          if (wrote) {
            console.log('[vite] Generated initial routeTree.gen.ts');
          }
        } catch (error) {
          console.warn('[vite] Failed to generate route tree:', error);
        }
      }

      bridge.registerServer(createBridgeServerWrapper(server) as any, port);
      server.start();

      const url = `${bridge.getServerUrl(port)}/`;
      const startup = `vite dev server running at ${url} (host: ${host}, root: ${root})\n`;
      emitStreamData(execution, startup, 'stdout');

      controller.frameworkDevServers.set(key, {
        key,
        framework: 'vite',
        port,
        clearInstalledPackagesCache: typeof (server as { clearInstalledPackagesCache?: () => void }).clearInstalledPackagesCache === 'function'
          ? () => (server as { clearInstalledPackagesCache: () => void }).clearInstalledPackagesCache()
          : undefined,
        setHMRTarget: (targetWindow: Window) => server.setHMRTarget(targetWindow),
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

  const playwrightCliCommand = defineCommand('playwright-cli', async (args, ctx) => {
    const { runPlaywrightCommand } = await import('./playwright-command');
    return runPlaywrightCommand(args, ctx, controller.vfs);
  });

  const pgliteCommand = defineCommand('pglite', async (args, ctx) => {
    const { runPGliteCommand } = await import('./pglite-command');
    return runPGliteCommand(args, ctx, controller.vfs);
  });

  const pgCommand = defineCommand('pg', async (args, ctx) => {
    const { runPgCommand } = await import('./pg-command');
    return runPgCommand(args, ctx, controller.vfs);
  });

  const curlCommand = defineCommand('curl', async (args, ctx) => {
    const { runCurlCommand } = await import('./curl-command');
    return runCurlCommand(args, ctx, controller.vfs);
  });

  const drizzleKitCommand = defineCommand('drizzle-kit', async (args, ctx) => {
    const { runDrizzleKitCommand } = await import('./drizzle-kit-command');
    return runDrizzleKitCommand(args, ctx, controller.vfs);
  });

  const tscCommand = defineCommand('tsc', async (args, ctx) => {
    const { runTscCommand } = await import('./tsc-command');
    return runTscCommand(args, ctx, controller.vfs);
  });

  const ghCommand = defineCommand('gh', async (args, ctx) => {
    const { runGhCommand } = await import('./gh-command');
    return runGhCommand(args, ctx, controller.vfs, controller.keychain);
  });

  const replayioCommand = defineCommand('replayio', async (args, ctx) => {
    const { runReplayioCommand } = await import('./replayio-command');
    return runReplayioCommand(args, ctx, controller.vfs, controller.keychain);
  });

  // --- grep / egrep / fgrep / rg commands (delegate to search provider) ---

  const grepCommand = defineCommand('grep', async (args, ctx) => {
    return executeGrepCommand(args, ctx, controller, false, false);
  });

  const egrepCommand = defineCommand('egrep', async (args, ctx) => {
    return executeGrepCommand(args, ctx, controller, true, false);
  });

  const fgrepCommand = defineCommand('fgrep', async (args, ctx) => {
    return executeGrepCommand(args, ctx, controller, false, true);
  });

  const rgCommand = defineCommand('rg', async (args, ctx) => {
    return executeRgCommand(args, ctx, controller);
  });

  const psCommand = defineCommand('ps', async (args, _ctx) => {
    const lines: string[] = [];
    lines.push('  PID TTY      STAT  COMMAND');
    lines.push('    1 ?        Ss    bash');

    let pid = 3001;
    for (const [, server] of controller.frameworkDevServers) {
      const cmd = server.framework === 'next'
        ? `next dev (port ${server.port})`
        : `vite (port ${server.port})`;
      lines.push(`${String(pid).padStart(5)} ?        Sl    ${cmd}`);
      pid += 1000;
    }

    for (const [id, exec] of controller.executions) {
      if (exec.activeProcessStdin) {
        lines.push(`${String(pid).padStart(5)} ?        S+    node [interactive] (${id})`);
        pid += 1;
      }
    }

    return { stdout: lines.join('\n') + '\n', stderr: '', exitCode: 0 };
  });

  const jinaCommand = defineCommand('jina', async (args, ctx) => {
    const { runJinaCommand } = await import('./jina-command');
    return runJinaCommand(args, ctx, controller.vfs);
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
        return ctx.exec(parsed.script, { cwd: ctx.cwd, env: envToRecord(ctx.env) });
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
    customCommands: [...syntheticShellCommands, nodeCommand, npmCommand, npxCommand, tarCommand, nextCommand, viteCommand, gitCommand, playwrightCliCommand, pgliteCommand, pgCommand, curlCommand, drizzleKitCommand, tscCommand, ghCommand, replayioCommand, grepCommand, egrepCommand, fgrepCommand, rgCommand, psCommand, jinaCommand],
  });

  // Wrap bashInstance.exec to:
  // 1. Intercept playwright-cli commands before just-bash's lexer (which
  //    fails on quoted arguments like `playwright-cli fill e4 "Buy groceries"`)
  // 2. Normalize Unicode curly quotes to ASCII quotes for all commands
  const originalBashExec = bashInstance.exec.bind(bashInstance);
  (bashInstance as any).exec = async (commandLine: string, options?: any) => {
    const normalized = normalizeQuotes(commandLine.trim());
    if (normalized.startsWith('playwright-cli')) {
      const tokens = splitCommandArgs(normalized);
      if (tokens.length > 0 && tokens[0] === 'playwright-cli') {
        const { runPlaywrightCommand } = await import('./playwright-command');
        const result = await runPlaywrightCommand(filterRedirections(tokens.slice(1)), {} as any, vfs);
        return { ...result, env: options?.env ?? {} };
      }
    }
    if (normalized === 'pg' || normalized.startsWith('pg ')) {
      const tokens = splitCommandArgs(normalized);
      if (tokens[0] === 'pg') {
        const { runPgCommand } = await import('./pg-command');
        const result = await runPgCommand(filterRedirections(tokens.slice(1)), {} as any, vfs);
        return { ...result, env: options?.env ?? {} };
      }
    }
    if (normalized === 'drizzle-kit' || normalized.startsWith('drizzle-kit ')) {
      const tokens = splitCommandArgs(normalized);
      if (tokens[0] === 'drizzle-kit') {
        const { runDrizzleKitCommand } = await import('./drizzle-kit-command');
        const result = await runDrizzleKitCommand(filterRedirections(tokens.slice(1)), {} as any, vfs);
        return { ...result, env: options?.env ?? {} };
      }
    }
    if (normalized === 'replayio' || normalized.startsWith('replayio ')) {
      const tokens = splitCommandArgs(normalized);
      if (tokens[0] === 'replayio') {
        const { runReplayioCommand } = await import('./replayio-command');
        const result = await runReplayioCommand(filterRedirections(tokens.slice(1)), {} as any, vfs, controller.keychain);
        return { ...result, env: options?.env ?? {} };
      }
    }
    return originalBashExec(normalized, options);
  };

  controller = {
    id: controllerId,
    vfs,
    vfsAdapter,
    bashInstance,
    installMode: options.installMode || 'auto',
    onInstallMutation: options.onInstallMutation || null,
    frameworkDevServers: new Map(),
    executions: new Map(),
    keychain: null,
    searchProvider: null,
    createExecution: (opts) => createExecutionContext(controller, opts),
    destroyExecution: (executionId) => destroyExecutionContext(controller, executionId),
    runCommand: (command, options, executionId) => runCommandInController(controller, command, options, executionId),
    sendInput: (executionId, data) => {
      if (!executionId) return;
      const execution = controller.executions.get(executionId);
      if (!execution?.activeProcessStdin) return;
      pushInputToExecutionStdin(execution.activeProcessStdin, data);
    },
    updateExecutionSize: (executionId, cols, rows) => {
      if (!executionId) return;
      const execution = controller.executions.get(executionId);
      if (!execution) return;
      execution.columns = Math.max(1, Math.floor(cols));
      execution.rows = Math.max(1, Math.floor(rows));
      if (execution.activeProcess) {
        applyExecutionTerminalSize(execution, execution.activeProcess);
      }
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

      const resolved = path.normalize(path.join(packageDir, binPath));
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

  const env = envToRecord(ctx.env);
  const normalizedCwd = normalizeCommandCwd(ctx.cwd);
  const resolvedTarget = getPackageBinTarget(controller, pkgName, binName, normalizedCwd)
    || getPackageBinTarget(controller, pkgName, binName, '/');

  if (resolvedTarget) {
    const fullCommand = ['node', resolvedTarget, ...args].map((value) => shellQuote(value)).join(' ');
    return ctx.exec(fullCommand, { cwd: normalizedCwd, env });
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
  return ctx.exec(fullCommand, { cwd: normalizedCwd, env });
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
    ...envToRecord(ctx.env),
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
  const pm = await createPackageManager(controller, ctx.cwd);

  let stdout = '';
  const execution = getExecutionContextFromEnv(controller, envToRecord(ctx.env));
  let suppressedDepCount = 0;
  const emitProgress = (message: string) => {
    // Suppress per-dep spam from resolver/installer:
    // - "Resolving X@range" (no trailing "...") from resolver.ts
    // - "  Downloading X@Y..." from core.ts installResolved
    // - "Skipping X@Y (already installed)" from core.ts
    // Keep top-level: "Resolving X@latest...", "Resolving dependencies...", "Installing N packages..."
    if ((/^Resolving\s+/.test(message) && !message.endsWith('...')) ||
        /^\s+Downloading\s+/.test(message) ||
        /^Skipping\s+/.test(message)) {
      suppressedDepCount++;
      return;
    }
    stdout += `${message}\n`;
    // Don't call emitStreamData — accumulate and return in result.
    // Streaming interleaves with Claude Code's UI rendering and garbles output.
  };

  try {
    const pkgArgs = args.filter(a => !a.startsWith('-'));
    if (pkgArgs.length === 0) {
      // npm install (no package name) -> install from package.json
      const installResult = await pm.installFromPackageJson({
        onProgress: emitProgress,
      });
      if (suppressedDepCount > 0) {
        stdout += `Resolved ${suppressedDepCount} dependencies\n`;
      }
      stdout += `added ${installResult.added.length} packages\n`;
    } else {
      // npm install <pkg> [<pkg> ...]
      for (const arg of pkgArgs) {
        const installResult = await pm.install(arg, {
          save: true,
          onProgress: emitProgress,
        });
        if (suppressedDepCount > 0) {
          stdout += `Resolved ${suppressedDepCount} dependencies\n`;
          suppressedDepCount = 0;
        }
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
  const pm = await createPackageManager(controller, ctx.cwd);
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

async function createPackageManager(
  controller: ChildProcessController,
  cwd: string,
) {
  const { PackageManager } = await import('../npm/index');
  return new PackageManager(controller.vfs, {
    cwd,
    installMode: controller.installMode,
    onMutation: controller.onInstallMutation || undefined,
  });
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
  rec: '/usr/bin/rec',
  sh: '/bin/sh',
  sox: '/usr/bin/sox',
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

function runSyntheticSyncCommand(
  controller: ChildProcessController | null,
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> }
): { stdout: string; stderr: string; status: number } | null {
  const normalizedCwd = normalizeCommandCwd(options.cwd ?? getDefaultProcessCwd());
  const env = options.env || {};

  const shell = getSyntheticShellSpec(command);
  if (shell) {
    const parsed = parseSyntheticShellExec(args);
    if (parsed.error) {
      const shellName = shell.names[0] || path.basename(command);
      return {
        stdout: '',
        stderr: `${shellName}: ${parsed.error}`,
        status: 2,
      };
    }
    if (!parsed.script) {
      return { stdout: '', stderr: '', status: 0 };
    }
    const shellTokens = splitCommandArgs(parsed.script);
    if (shellTokens.length === 0) {
      return { stdout: '', stderr: '', status: 0 };
    }
    return runSyntheticSyncCommand(controller, shellTokens[0], shellTokens.slice(1), {
      cwd: normalizedCwd,
      env,
    });
  }

  const commandName = path.basename(command).toLowerCase();
  switch (commandName) {
    case 'pwd':
      return { stdout: `${normalizedCwd}\n`, stderr: '', status: 0 };
    case 'echo':
      return { stdout: `${args.join(' ')}\n`, stderr: '', status: 0 };
    case 'uname':
      return { stdout: 'Linux\n', stderr: '', status: 0 };
    case 'whoami':
      return { stdout: `${env.USER || 'user'}\n`, stderr: '', status: 0 };
    case 'true':
      return { stdout: '', stderr: '', status: 0 };
    case 'cat': {
      if (!controller) return null;
      const outputs: string[] = [];
      for (const arg of args) {
        const target = resolveFromCwd(normalizedCwd, arg);
        if (!controller.vfs.existsSync(target)) {
          return { stdout: '', stderr: `cat: ${arg}: No such file or directory\n`, status: 1 };
        }
        outputs.push(String(controller.vfs.readFileSync(target, 'utf8')));
      }
      return {
        stdout: outputs.join(outputs.length > 1 ? '\n' : ''),
        stderr: '',
        status: 0,
      };
    }
    case 'ls': {
      if (!controller) return null;
      const targetArg = args[0] || normalizedCwd;
      const target = resolveFromCwd(normalizedCwd, targetArg);
      if (!controller.vfs.existsSync(target)) {
        return { stdout: '', stderr: `ls: cannot access '${targetArg}': No such file or directory\n`, status: 1 };
      }
      const stats = controller.vfs.statSync(target);
      if (stats.isDirectory()) {
        const entries = controller.vfs.readdirSync(target).slice().sort();
        return {
          stdout: entries.length > 0 ? `${entries.join('\n')}\n` : '',
          stderr: '',
          status: 0,
        };
      }
      return {
        stdout: `${path.basename(target)}\n`,
        stderr: '',
        status: 0,
      };
    }
    default:
      return null;
  }
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

  const syntheticResult = runSyntheticSyncCommand(controller, command, args, {
    cwd: options.cwd,
    env: options.env,
  });
  if (syntheticResult) {
    return {
      stdout: normalizeSpawnSyncOutput(syntheticResult.stdout, encoding),
      stderr: normalizeSpawnSyncOutput(syntheticResult.stderr, encoding),
      status: syntheticResult.status,
      error: syntheticResult.status === 0 ? undefined : Object.assign(
        new Error(`Command failed: ${command}`),
        { code: syntheticResult.status }
      ),
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

function duplicateNumericStdioTarget(
  target: StdioTarget,
  duplicatedByOriginalFd: Map<number, number>
): StdioTarget {
  if (target === 'pipe' || target === 'inherit' || target === 'ignore') {
    return target;
  }

  let duplicatedFd = duplicatedByOriginalFd.get(target.fd);
  if (duplicatedFd === undefined) {
    duplicatedFd = dupFdSync(target.fd);
    duplicatedByOriginalFd.set(target.fd, duplicatedFd);
  }

  return { fd: duplicatedFd };
}

function releaseDuplicatedStdioTargets(duplicatedByOriginalFd: Map<number, number>): void {
  for (const duplicatedFd of duplicatedByOriginalFd.values()) {
    closeFdSync(duplicatedFd);
  }
  duplicatedByOriginalFd.clear();
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

  const tokens = splitCommandArgs(trimmed);
  if (tokens.length > 0) {
    const syntheticResult = runSyntheticSyncCommand(controller, tokens[0], tokens.slice(1), {
      cwd: options.cwd,
      env: options.env,
    });
    if (syntheticResult) {
      if (syntheticResult.status !== 0) {
        const error = new Error(`Command failed: ${command}`);
        (error as { code?: number }).code = syntheticResult.status;
        throw error;
      }
      return syntheticResult.stdout;
    }
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

export function splitCommandArgs(command: string): string[] {
  const tokens: string[] = [];
  const matcher = /"((?:\\[\s\S]|[^"\\])*)"|'((?:\\[\s\S]|[^'\\])*)'|([^\s]+)/g;

  let match: RegExpExecArray | null = null;
  while ((match = matcher.exec(command)) !== null) {
    if (match[1] !== undefined) {
      tokens.push(match[1].replace(/\\(["\\$`!])/g, '$1'));
      continue;
    }
    if (match[2] !== undefined) {
      tokens.push(match[2].replace(/\\(['\\!])/g, '$1'));
      continue;
    }
    if (match[3] !== undefined) {
      tokens.push(match[3]);
    }
  }

  return tokens;
}

/** Filter out shell redirection tokens like `2>&1` from parsed args. */
function filterRedirections(args: string[]): string[] {
  return args.filter(t => !/^\d*>&\d+$/.test(t));
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

  // Intercept custom commands before just-bash's broken lexer
  return maybeRunCustomCommandDirect(controller, parsed.script, cwd, env)
    ?? controller.bashInstance.exec(stripQuotesForBash(normalizeQuotes(parsed.script)), { cwd, env });
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

    // Create a dedicated child execution without streaming callbacks.
    // child_process.exec captures output in result.stdout/stderr and returns
    // it via the callback — it should NOT stream live to the parent terminal
    // (which causes output to leak in Claude Code's UI).
    const parentExecution = getActiveExecutionContext(controller, binding, envHint);
    const execution = createExecutionContext(controller, {
      signal: parentExecution?.signal || undefined,
    });
    const ownsExecution = true;
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

/**
 * Inline check for rec/sox audio capture commands (avoids dynamic import on every spawn).
 */
function isAudioCaptureCommand(command: string, args: string[]): boolean {
  const basename = command.slice(command.lastIndexOf('/') + 1);
  if (basename === 'rec') return true;
  if (basename === 'sox' && args.includes('-d')) return true;
  return false;
}

const DEBUG_REC_INTERCEPT = true;

function debugRecLog(message: string, data?: unknown) {
  if (!DEBUG_REC_INTERCEPT) return;
  if (data !== undefined) {
    console.log(`[rec-intercept] ${message}`, data);
  } else {
    console.log(`[rec-intercept] ${message}`);
  }
}

/**
 * Intercept rec/sox audio capture commands and use browser getUserMedia instead.
 * Returns true if the command was intercepted (caller should return child early).
 */
function tryInterceptAudioCommand(command: string, args: string[], child: ChildProcess): boolean {
  if (!isAudioCaptureCommand(command, args)) return false;

  console.log('%c[ALMOSTNODE] REC/SOX COMMAND INTERCEPTED!', 'background: #ff0; color: #000; font-size: 16px; padding: 4px;', { command, args });
  debugRecLog('Intercepted audio command', { command, args });

  let handle: { cleanup: () => void } | null = null;
  let totalBytes = 0;
  let chunkCount = 0;
  const startTime = Date.now();

  child.kill = (signal?: string): boolean => {
    const elapsedMs = Date.now() - startTime;
    debugRecLog(`kill(${signal}) called — SUMMARY`, { 
      totalBytes, 
      chunkCount, 
      elapsedMs,
      stdoutBufferLength: (child.stdout as any)?._buffer?.length,
      stdoutFlowing: (child.stdout as any)?._flowing,
    });
    if (totalBytes === 0) {
      debugRecLog('*** WARNING: NO AUDIO DATA WAS SENT! Silence detector may have filtered everything.');
    }
    if (handle) {
      handle.cleanup();
    }
    child.killed = true;
    child.stdout?.push(null);
    queueMicrotask(() => {
      queueMicrotask(() => {
        debugRecLog('Emitting close/exit after kill', { signal: signal || 'SIGTERM' });
        child.emit('close', null, signal || 'SIGTERM');
        child.emit('exit', null, signal || 'SIGTERM');
      });
    });
    return true;
  };

  (async () => {
    try {
      if (child.killed) {
        debugRecLog('Child already killed before async setup');
        return;
      }

      const { parseSoxArgs, startAudioCapture } = await import('./sox-audio-capture');
      if (child.killed) {
        debugRecLog('Child killed during import');
        return;
      }

      const config = parseSoxArgs(command, args);
      debugRecLog('Parsed SoX config', config);

      // Add listener to track if data is being consumed
      let dataEventsEmitted = 0;
      child.stdout?.on('data', () => {
        dataEventsEmitted++;
      });

      handle = await startAudioCapture(
        config,
        (pcmBytes: Uint8Array) => {
          if (!child.killed) {
            totalBytes += pcmBytes.length;
            chunkCount++;
            if (chunkCount <= 5 || chunkCount % 20 === 1) {
              debugRecLog(`stdout.push chunk #${chunkCount}`, { 
                bytes: pcmBytes.length, 
                totalBytes,
                dataEventsEmitted,
                stdoutFlowing: (child.stdout as any)?._flowing,
              });
            }
            child.stdout?.push(Buffer.from(pcmBytes));
          }
        },
        () => {
          const elapsedMs = Date.now() - startTime;
          debugRecLog('onEnd() called — natural recording end', { totalBytes, chunkCount, elapsedMs });
          child.stdout?.push(null);
          child.exitCode = 0;
          child.emit('close', 0, null);
          child.emit('exit', 0, null);
        },
        (error: Error) => {
          debugRecLog('onError() called', { error: error.message });
          console.warn('[almostnode:rec] Audio capture error:', error.message);
          child.stderr?.push(Buffer.from(error.message + '\n'));
          child.stdout?.push(null);
          child.exitCode = 1;
          child.emit('close', 1, null);
          child.emit('exit', 1, null);
        },
      );

      if (child.killed) {
        debugRecLog('Child killed while startAudioCapture was running — cleaning up');
        handle.cleanup();
        return;
      }

      debugRecLog('Emitting spawn event');
      child.emit('spawn');
    } catch (error) {
      debugRecLog('Async setup error', error);
      child.emit('error', error);
    }
  })();

  return true;
}

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
  const duplicatedStdioFds = new Map<number, number>();
  const ownedStdoutTarget = duplicateNumericStdioTarget(stdoutTarget, duplicatedStdioFds);
  const ownedStderrTarget = duplicateNumericStdioTarget(stderrTarget, duplicatedStdioFds);

  if (stdinTarget !== 'pipe') {
    child.stdin = null;
  }
  if (stdoutTarget !== 'pipe') {
    child.stdout = null;
  }
  if (stderrTarget !== 'pipe') {
    child.stderr = null;
  }
  child.stdio = [child.stdin, child.stdout, child.stderr];
  child.spawnfile = command;
  child.spawnargs = [command, ...spawnArgs];

  // Intercept rec/sox audio capture commands before they reach just-bash
  if (tryInterceptAudioCommand(command, spawnArgs, child)) {
    return child;
  }

  // Build the full command — use shellQuote for args containing spaces or
  // quotes so inner double quotes are properly escaped (e.g. spawn('bash',
  // ['-c', 'echo "hello world"']) must NOT produce `bash -c "echo "hello world""`)
  const fullCommand = spawnArgs.length > 0
    ? `${command} ${spawnArgs.map(arg =>
        /[\s"'\\]/.test(arg) ? shellQuote(arg) : arg
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

    child.emit('spawn');

    // Create a dedicated child execution without streaming callbacks.
    // spawn captures output via child.stdout/child.stderr streams —
    // it should NOT stream live to the parent terminal.
    const parentExecution = getActiveExecutionContext(controller, binding, envHint);
    const execution = createExecutionContext(controller, {
      signal: parentExecution?.signal || undefined,
    });
    const ownsExecution = true;
    try {
      const resolvedCwd = spawnOptions.cwd ?? getBindingDefaultCwd(binding);
      const resolvedEnv = addNodeModuleBinPaths({ ...baseEnv, ...(spawnOptions.env || {}) }, resolvedCwd);
      const result = await controller.runCommand(fullCommand, { cwd: resolvedCwd, env: resolvedEnv }, execution.id);

      const stdout = result.stdout || '';
      const stderr = result.stderr || '';

      applySpawnOutput(ownedStdoutTarget, 'stdout', child.stdout, stdout);
      closeSpawnOutput(ownedStdoutTarget, child.stdout);

      applySpawnOutput(ownedStderrTarget, 'stderr', child.stderr, stderr);
      closeSpawnOutput(ownedStderrTarget, child.stderr);
      releaseDuplicatedStdioTargets(duplicatedStdioFds);

      // Defer close/exit so Readable 'data' events flush before 'close' fires.
      // push() queues data emission as a microtask; emitting close/exit
      // synchronously here would fire before the data reaches listeners.
      await new Promise<void>((resolve) => queueMicrotask(resolve));
      child.exitCode = result.exitCode;
      child.emit('close', result.exitCode, null);
      child.emit('exit', result.exitCode, null);
    } catch (error) {
      releaseDuplicatedStdioTargets(duplicatedStdioFds);
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
    childRuntime.runFile(resolvedPath).catch((error) => {
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
    }).finally(() => {
      childRuntime.clearCache();
    });
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
  stdio: [Writable | null, Readable | null, Readable | null];

  constructor() {
    super();
    this.pid = Math.floor(Math.random() * 10000) + 1000;
    this.stdin = new Writable();
    this.stdout = new Readable();
    this.stderr = new Readable();
    this.stdio = [this.stdin, this.stdout, this.stderr];
  }

  kill(signal?: string): boolean {
    this.killed = true;
    this.emit('exit', null, signal || 'SIGTERM');
    this.emit('close', null, signal || 'SIGTERM');
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

// ---------------------------------------------------------------------------
// grep / egrep / fgrep / rg implementation
// ---------------------------------------------------------------------------

interface ParsedGrepArgs {
  pattern: string | null;
  files: string[];
  recursive: boolean;
  caseInsensitive: boolean;
  lineNumbers: boolean;
  filesOnly: boolean;
  countOnly: boolean;
  invert: boolean;
  wordMatch: boolean;
  extendedRegex: boolean;
  fixedStrings: boolean;
  afterContext: number;
  beforeContext: number;
  maxCount: number;
  quiet: boolean;
  onlyMatching: boolean;
  includeGlob: string | null;
  excludeGlob: string | null;
}

function parseGrepArgs(args: string[], isEgrep: boolean, isFgrep: boolean): ParsedGrepArgs {
  const parsed: ParsedGrepArgs = {
    pattern: null,
    files: [],
    recursive: false,
    caseInsensitive: false,
    lineNumbers: false,
    filesOnly: false,
    countOnly: false,
    invert: false,
    wordMatch: false,
    extendedRegex: isEgrep,
    fixedStrings: isFgrep,
    afterContext: 0,
    beforeContext: 0,
    maxCount: 0,
    quiet: false,
    onlyMatching: false,
    includeGlob: null,
    excludeGlob: null,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--' ) { i++; break; }
    if (arg === '-e' || arg === '--regexp') {
      parsed.pattern = args[++i] ?? '';
      i++; continue;
    }
    if (arg.startsWith('--include=')) { parsed.includeGlob = arg.slice('--include='.length); i++; continue; }
    if (arg === '--include') { parsed.includeGlob = args[++i] ?? ''; i++; continue; }
    if (arg.startsWith('--exclude=')) { parsed.excludeGlob = arg.slice('--exclude='.length); i++; continue; }
    if (arg === '--exclude') { parsed.excludeGlob = args[++i] ?? ''; i++; continue; }
    if (arg === '-A' || arg === '--after-context') { parsed.afterContext = parseInt(args[++i] ?? '0', 10) || 0; i++; continue; }
    if (arg.startsWith('-A') && arg.length > 2) { parsed.afterContext = parseInt(arg.slice(2), 10) || 0; i++; continue; }
    if (arg === '-B' || arg === '--before-context') { parsed.beforeContext = parseInt(args[++i] ?? '0', 10) || 0; i++; continue; }
    if (arg.startsWith('-B') && arg.length > 2) { parsed.beforeContext = parseInt(arg.slice(2), 10) || 0; i++; continue; }
    if (arg === '-C' || arg === '--context') { const n = parseInt(args[++i] ?? '0', 10) || 0; parsed.afterContext = n; parsed.beforeContext = n; i++; continue; }
    if (arg.startsWith('-C') && arg.length > 2) { const n = parseInt(arg.slice(2), 10) || 0; parsed.afterContext = n; parsed.beforeContext = n; i++; continue; }
    if (arg === '-m' || arg === '--max-count') { parsed.maxCount = parseInt(args[++i] ?? '0', 10) || 0; i++; continue; }
    if (arg.startsWith('-m') && arg.length > 2 && /^\d/.test(arg.slice(2))) { parsed.maxCount = parseInt(arg.slice(2), 10) || 0; i++; continue; }

    if (arg.startsWith('-') && !arg.startsWith('--') && arg.length > 1) {
      // combined short flags like -rin
      for (let j = 1; j < arg.length; j++) {
        const ch = arg[j];
        switch (ch) {
          case 'i': parsed.caseInsensitive = true; break;
          case 'r': case 'R': parsed.recursive = true; break;
          case 'n': parsed.lineNumbers = true; break;
          case 'l': parsed.filesOnly = true; break;
          case 'c': parsed.countOnly = true; break;
          case 'v': parsed.invert = true; break;
          case 'w': parsed.wordMatch = true; break;
          case 'E': parsed.extendedRegex = true; break;
          case 'F': parsed.fixedStrings = true; break;
          case 'q': parsed.quiet = true; break;
          case 'o': parsed.onlyMatching = true; break;
          case 'H': break; // with-filename (default for multi-file)
          case 'h': break; // no-filename
          default: break;
        }
      }
      i++; continue;
    }

    if (arg.startsWith('--')) {
      // long flags
      switch (arg) {
        case '--recursive': parsed.recursive = true; break;
        case '--ignore-case': parsed.caseInsensitive = true; break;
        case '--line-number': parsed.lineNumbers = true; break;
        case '--files-with-matches': parsed.filesOnly = true; break;
        case '--count': parsed.countOnly = true; break;
        case '--invert-match': parsed.invert = true; break;
        case '--word-regexp': parsed.wordMatch = true; break;
        case '--extended-regexp': parsed.extendedRegex = true; break;
        case '--fixed-strings': parsed.fixedStrings = true; break;
        case '--quiet': case '--silent': parsed.quiet = true; break;
        case '--only-matching': parsed.onlyMatching = true; break;
        case '--color': case '--colour': break; // ignore
        default:
          if (arg.startsWith('--color=') || arg.startsWith('--colour=')) break;
          break;
      }
      i++; continue;
    }

    // Positional args: first is pattern, rest are files
    if (parsed.pattern === null) {
      parsed.pattern = arg;
    } else {
      parsed.files.push(arg);
    }
    i++;
  }

  // Remaining args after -- are files
  while (i < args.length) {
    if (parsed.pattern === null) {
      parsed.pattern = args[i];
    } else {
      parsed.files.push(args[i]);
    }
    i++;
  }

  return parsed;
}

interface ParsedRgArgs {
  pattern: string | null;
  paths: string[];
  caseInsensitive: boolean;
  caseSensitive: boolean;
  smartCase: boolean;
  fixedStrings: boolean;
  wordMatch: boolean;
  lineNumbers: boolean;
  noLineNumbers: boolean;
  filesOnly: boolean;
  countOnly: boolean;
  invert: boolean;
  afterContext: number;
  beforeContext: number;
  maxCount: number;
  quiet: boolean;
  onlyMatching: boolean;
  hidden: boolean;
  globs: string[];
  typeFilters: string[];
  maxDepth: number;
}

function parseRgArgs(args: string[]): ParsedRgArgs {
  const parsed: ParsedRgArgs = {
    pattern: null,
    paths: [],
    caseInsensitive: false,
    caseSensitive: false,
    smartCase: true,
    fixedStrings: false,
    wordMatch: false,
    lineNumbers: true, // rg defaults to line numbers
    noLineNumbers: false,
    filesOnly: false,
    countOnly: false,
    invert: false,
    afterContext: 0,
    beforeContext: 0,
    maxCount: 0,
    quiet: false,
    onlyMatching: false,
    hidden: false,
    globs: [],
    typeFilters: [],
    maxDepth: 0,
  };

  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === '--') { i++; break; }

    if (arg === '-e' || arg === '--regexp') { parsed.pattern = args[++i] ?? ''; i++; continue; }
    if (arg === '-g' || arg === '--glob') { parsed.globs.push(args[++i] ?? ''); i++; continue; }
    if (arg.startsWith('--glob=')) { parsed.globs.push(arg.slice('--glob='.length)); i++; continue; }
    if (arg === '-t' || arg === '--type') { parsed.typeFilters.push(args[++i] ?? ''); i++; continue; }
    if (arg.startsWith('--type=')) { parsed.typeFilters.push(arg.slice('--type='.length)); i++; continue; }
    if (arg === '-A' || arg === '--after-context') { parsed.afterContext = parseInt(args[++i] ?? '0', 10) || 0; i++; continue; }
    if (arg.startsWith('-A') && arg.length > 2) { parsed.afterContext = parseInt(arg.slice(2), 10) || 0; i++; continue; }
    if (arg === '-B' || arg === '--before-context') { parsed.beforeContext = parseInt(args[++i] ?? '0', 10) || 0; i++; continue; }
    if (arg.startsWith('-B') && arg.length > 2) { parsed.beforeContext = parseInt(arg.slice(2), 10) || 0; i++; continue; }
    if (arg === '-C' || arg === '--context') { const n = parseInt(args[++i] ?? '0', 10) || 0; parsed.afterContext = n; parsed.beforeContext = n; i++; continue; }
    if (arg.startsWith('-C') && arg.length > 2) { const n = parseInt(arg.slice(2), 10) || 0; parsed.afterContext = n; parsed.beforeContext = n; i++; continue; }
    if (arg === '-m' || arg === '--max-count') { parsed.maxCount = parseInt(args[++i] ?? '0', 10) || 0; i++; continue; }
    if (arg.startsWith('-m') && arg.length > 2 && /^\d/.test(arg.slice(2))) { parsed.maxCount = parseInt(arg.slice(2), 10) || 0; i++; continue; }
    if (arg === '--max-depth' || arg === '--maxdepth') { parsed.maxDepth = parseInt(args[++i] ?? '0', 10) || 0; i++; continue; }
    if (arg.startsWith('--max-depth=')) { parsed.maxDepth = parseInt(arg.slice('--max-depth='.length), 10) || 0; i++; continue; }

    if (arg.startsWith('-') && !arg.startsWith('--') && arg.length > 1) {
      for (let j = 1; j < arg.length; j++) {
        switch (arg[j]) {
          case 'i': parsed.caseInsensitive = true; parsed.smartCase = false; break;
          case 's': parsed.caseSensitive = true; parsed.smartCase = false; break;
          case 'S': parsed.smartCase = true; break;
          case 'F': parsed.fixedStrings = true; break;
          case 'w': parsed.wordMatch = true; break;
          case 'n': parsed.lineNumbers = true; parsed.noLineNumbers = false; break;
          case 'N': parsed.noLineNumbers = true; parsed.lineNumbers = false; break;
          case 'l': parsed.filesOnly = true; break;
          case 'c': parsed.countOnly = true; break;
          case 'v': parsed.invert = true; break;
          case 'q': parsed.quiet = true; break;
          case 'o': parsed.onlyMatching = true; break;
          default: break;
        }
      }
      i++; continue;
    }

    if (arg.startsWith('--')) {
      switch (arg) {
        case '--ignore-case': parsed.caseInsensitive = true; parsed.smartCase = false; break;
        case '--case-sensitive': parsed.caseSensitive = true; parsed.smartCase = false; break;
        case '--smart-case': parsed.smartCase = true; break;
        case '--fixed-strings': parsed.fixedStrings = true; break;
        case '--word-regexp': parsed.wordMatch = true; break;
        case '--line-number': parsed.lineNumbers = true; parsed.noLineNumbers = false; break;
        case '--no-line-number': parsed.noLineNumbers = true; parsed.lineNumbers = false; break;
        case '--files-with-matches': parsed.filesOnly = true; break;
        case '--count': parsed.countOnly = true; break;
        case '--invert-match': parsed.invert = true; break;
        case '--quiet': parsed.quiet = true; break;
        case '--only-matching': parsed.onlyMatching = true; break;
        case '--hidden': parsed.hidden = true; break;
        case '--no-ignore': break; // ignore
        case '--color': case '--colour': break;
        default:
          if (arg.startsWith('--color=') || arg.startsWith('--colour=')) break;
          break;
      }
      i++; continue;
    }

    if (parsed.pattern === null) {
      parsed.pattern = arg;
    } else {
      parsed.paths.push(arg);
    }
    i++;
  }

  while (i < args.length) {
    if (parsed.pattern === null) {
      parsed.pattern = args[i];
    } else {
      parsed.paths.push(args[i]);
    }
    i++;
  }

  return parsed;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildRegex(pattern: string, flags: { caseInsensitive: boolean; wordMatch: boolean; fixedStrings: boolean; extendedRegex?: boolean }): RegExp | null {
  try {
    let src = flags.fixedStrings ? escapeRegExp(pattern) : pattern;
    if (flags.wordMatch) src = `\\b${src}\\b`;
    const regexFlags = flags.caseInsensitive ? 'gi' : 'g';
    return new RegExp(src, regexFlags);
  } catch {
    return null;
  }
}

function isBinaryContent(content: string): boolean {
  // Check first 8KB for null bytes
  const len = Math.min(content.length, 8192);
  for (let i = 0; i < len; i++) {
    if (content.charCodeAt(i) === 0) return true;
  }
  return false;
}

function resolvePath(base: string, p: string): string {
  if (p.startsWith('/')) return p;
  return `${base}/${p}`.replace(/\/+/g, '/');
}

function relativizePath(absPath: string, cwd: string): string {
  if (absPath.startsWith(cwd + '/')) {
    return absPath.slice(cwd.length + 1);
  }
  if (absPath === cwd) return '.';
  return absPath;
}

function simpleGlobMatch(pattern: string, name: string): boolean {
  // Convert simple glob pattern to regex (supports * and ?)
  const src = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${src}$`).test(name);
}

async function collectFiles(
  fs: import('just-bash').CommandContext['fs'],
  dir: string,
  recursive: boolean,
  includeGlob: string | null,
  excludeGlob: string | null,
): Promise<string[]> {
  const result: string[] = [];

  async function walk(dirPath: string): Promise<void> {
    let entries: string[];
    try {
      entries = await fs.readdir(dirPath);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === '.' || name === '..') continue;
      // skip hidden dirs and node_modules by default in recursive mode
      if (recursive && (name === 'node_modules' || name === '.git')) continue;
      const fullPath = `${dirPath}/${name}`.replace(/\/+/g, '/');
      let stat;
      try {
        stat = await fs.stat(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory) {
        if (recursive) await walk(fullPath);
      } else if (stat.isFile) {
        if (includeGlob && !simpleGlobMatch(includeGlob, name)) continue;
        if (excludeGlob && simpleGlobMatch(excludeGlob, name)) continue;
        result.push(fullPath);
      }
    }
  }

  await walk(dir);
  return result;
}

async function grepViaVfs(
  parsed: ParsedGrepArgs,
  ctx: CommandContext,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const regex = buildRegex(parsed.pattern!, {
    caseInsensitive: parsed.caseInsensitive,
    wordMatch: parsed.wordMatch,
    fixedStrings: parsed.fixedStrings,
    extendedRegex: parsed.extendedRegex,
  });
  if (!regex) {
    return { stdout: '', stderr: `grep: Invalid regular expression: '${parsed.pattern}'\n`, exitCode: 2 };
  }

  // Determine files to search
  let filePaths: string[] = [];
  if (parsed.files.length === 0 && !parsed.recursive) {
    // read from stdin
    return grepStdin(parsed, regex, ctx.stdin);
  }

  if (parsed.files.length === 0 && parsed.recursive) {
    filePaths = await collectFiles(ctx.fs, ctx.cwd, true, parsed.includeGlob, parsed.excludeGlob);
  } else {
    for (const f of parsed.files) {
      const abs = resolvePath(ctx.cwd, f);
      let stat;
      try {
        stat = await ctx.fs.stat(abs);
      } catch {
        continue;
      }
      if (stat.isDirectory) {
        if (parsed.recursive) {
          const subFiles = await collectFiles(ctx.fs, abs, true, parsed.includeGlob, parsed.excludeGlob);
          filePaths.push(...subFiles);
        }
      } else {
        filePaths.push(abs);
      }
    }
  }

  const multiFile = filePaths.length > 1 || parsed.recursive;
  const outputLines: string[] = [];
  let anyMatch = false;

  for (const fp of filePaths) {
    let content: string;
    try {
      content = await ctx.fs.readFile(fp);
    } catch {
      continue;
    }

    if (isBinaryContent(content)) {
      // Check if it matches at all
      regex.lastIndex = 0;
      if (regex.test(content) !== parsed.invert) {
        const display = relativizePath(fp, ctx.cwd);
        outputLines.push(`Binary file ${display} matches`);
        anyMatch = true;
      }
      continue;
    }

    const lines = content.split('\n');
    // Remove trailing empty line from split
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

    const display = relativizePath(fp, ctx.cwd);
    let fileMatchCount = 0;
    const matchedLineIndices: Set<number> = new Set();
    const contextLineIndices: Set<number> = new Set();

    // First pass: find matching lines
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
      const line = lines[lineIdx];
      regex.lastIndex = 0;
      const matches = regex.test(line);
      const isMatch = parsed.invert ? !matches : matches;
      if (isMatch) {
        matchedLineIndices.add(lineIdx);
        fileMatchCount++;
        if (parsed.maxCount > 0 && fileMatchCount >= parsed.maxCount) break;
      }
    }

    if (fileMatchCount === 0) continue;
    anyMatch = true;

    if (parsed.quiet) return { stdout: '', stderr: '', exitCode: 0 };
    if (parsed.filesOnly) { outputLines.push(display); continue; }
    if (parsed.countOnly) { outputLines.push(multiFile ? `${display}:${fileMatchCount}` : `${fileMatchCount}`); continue; }

    // Compute context lines
    for (const idx of matchedLineIndices) {
      for (let b = Math.max(0, idx - parsed.beforeContext); b < idx; b++) contextLineIndices.add(b);
      for (let a = idx + 1; a <= Math.min(lines.length - 1, idx + parsed.afterContext); a++) contextLineIndices.add(a);
    }

    // Output
    let lastPrintedIdx = -2;
    const allIndices = [...matchedLineIndices, ...contextLineIndices].sort((a, b) => a - b);
    const uniqueIndices = [...new Set(allIndices)];
    for (const idx of uniqueIndices) {
      if (lastPrintedIdx >= 0 && idx > lastPrintedIdx + 1) {
        outputLines.push('--');
      }
      const line = lines[idx];
      const lineNum = idx + 1;
      const isMatch = matchedLineIndices.has(idx);
      const sep = isMatch ? ':' : '-';

      let text: string;
      if (parsed.onlyMatching && isMatch) {
        regex.lastIndex = 0;
        const allMatches: string[] = [];
        let m: RegExpExecArray | null;
        while ((m = regex.exec(line)) !== null) {
          allMatches.push(m[0]);
          if (!regex.global) break;
        }
        text = allMatches.join('\n');
      } else {
        text = line;
      }

      if (multiFile && (parsed.lineNumbers || parsed.beforeContext > 0 || parsed.afterContext > 0)) {
        outputLines.push(`${display}${sep}${lineNum}${sep}${text}`);
      } else if (multiFile) {
        outputLines.push(`${display}${sep}${text}`);
      } else if (parsed.lineNumbers || parsed.beforeContext > 0 || parsed.afterContext > 0) {
        outputLines.push(`${lineNum}${sep}${text}`);
      } else {
        outputLines.push(text);
      }
      lastPrintedIdx = idx;
    }
  }

  if (parsed.quiet) return { stdout: '', stderr: '', exitCode: anyMatch ? 0 : 1 };
  const stdout = outputLines.length > 0 ? outputLines.join('\n') + '\n' : '';
  return { stdout, stderr: '', exitCode: anyMatch ? 0 : 1 };
}

function grepStdin(
  parsed: ParsedGrepArgs,
  regex: RegExp,
  stdin: string,
): { stdout: string; stderr: string; exitCode: number } {
  const lines = stdin.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const outputLines: string[] = [];
  let matchCount = 0;

  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    const line = lines[lineIdx];
    regex.lastIndex = 0;
    const matches = regex.test(line);
    const isMatch = parsed.invert ? !matches : matches;
    if (!isMatch) continue;
    matchCount++;
    if (parsed.quiet) return { stdout: '', stderr: '', exitCode: 0 };
    if (parsed.countOnly) { /* count at end */ }
    else if (parsed.onlyMatching) {
      regex.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = regex.exec(line)) !== null) {
        outputLines.push(parsed.lineNumbers ? `${lineIdx + 1}:${m[0]}` : m[0]);
        if (!regex.global) break;
      }
    } else {
      outputLines.push(parsed.lineNumbers ? `${lineIdx + 1}:${line}` : line);
    }
    if (parsed.maxCount > 0 && matchCount >= parsed.maxCount) break;
  }

  if (parsed.quiet) return { stdout: '', stderr: '', exitCode: matchCount > 0 ? 0 : 1 };
  if (parsed.countOnly) return { stdout: `${matchCount}\n`, stderr: '', exitCode: matchCount > 0 ? 0 : 1 };
  const stdout = outputLines.length > 0 ? outputLines.join('\n') + '\n' : '';
  return { stdout, stderr: '', exitCode: matchCount > 0 ? 0 : 1 };
}

async function executeGrepCommand(
  args: string[],
  ctx: CommandContext,
  controller: ChildProcessController,
  isEgrep: boolean,
  isFgrep: boolean,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const parsed = parseGrepArgs(args, isEgrep, isFgrep);

  if (parsed.pattern === null) {
    const cmd = isFgrep ? 'fgrep' : isEgrep ? 'egrep' : 'grep';
    return { stdout: '', stderr: `Usage: ${cmd} [OPTION]... PATTERN [FILE]...\n`, exitCode: 2 };
  }

  // Stdin mode — always handle locally
  if (ctx.stdin && parsed.files.length === 0 && !parsed.recursive) {
    const regex = buildRegex(parsed.pattern, {
      caseInsensitive: parsed.caseInsensitive,
      wordMatch: parsed.wordMatch,
      fixedStrings: parsed.fixedStrings,
      extendedRegex: parsed.extendedRegex,
    });
    if (!regex) {
      return { stdout: '', stderr: `grep: Invalid regular expression: '${parsed.pattern}'\n`, exitCode: 2 };
    }
    return grepStdin(parsed, regex, ctx.stdin);
  }

  // Invert mode — search provider can't handle this, fall back
  if (parsed.invert) {
    return grepViaVfs(parsed, ctx);
  }

  // Try search provider
  if (controller.searchProvider) {
    try {
      return await grepViaSearchProvider(parsed, ctx, controller.searchProvider);
    } catch {
      // Fall back to VFS
    }
  }

  return grepViaVfs(parsed, ctx);
}

async function grepViaSearchProvider(
  parsed: ParsedGrepArgs,
  ctx: CommandContext,
  provider: WorkspaceSearchProvider,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Determine search folder
  let searchFolder = ctx.cwd;
  if (parsed.files.length === 1 && parsed.recursive) {
    const abs = resolvePath(ctx.cwd, parsed.files[0]);
    try {
      const stat = await ctx.fs.stat(abs);
      if (stat.isDirectory) searchFolder = abs;
    } catch {
      // use cwd
    }
  }

  const contextLines = Math.max(parsed.afterContext, parsed.beforeContext);

  const result = await provider.search({
    pattern: parsed.pattern!,
    isRegExp: !parsed.fixedStrings,
    isCaseSensitive: !parsed.caseInsensitive,
    isWordMatch: parsed.wordMatch,
    folderPath: searchFolder,
    includePattern: parsed.includeGlob ?? undefined,
    excludePattern: parsed.excludeGlob ?? undefined,
    maxResults: parsed.maxCount > 0 ? parsed.maxCount : undefined,
    surroundingContext: contextLines > 0 ? contextLines : undefined,
  });

  if (parsed.quiet) {
    return { stdout: '', stderr: '', exitCode: result.files.length > 0 ? 0 : 1 };
  }

  const multiFile = parsed.files.length !== 1 || parsed.recursive || result.files.length > 1;
  const outputLines: string[] = [];

  // If specific non-directory files were given, filter results to those
  let allowedPaths: Set<string> | null = null;
  if (parsed.files.length > 0 && !parsed.recursive) {
    allowedPaths = new Set(parsed.files.map(f => resolvePath(ctx.cwd, f)));
  }

  for (const fileResult of result.files) {
    if (allowedPaths && !allowedPaths.has(fileResult.filePath)) continue;
    const display = relativizePath(fileResult.filePath, ctx.cwd);

    if (parsed.filesOnly) {
      outputLines.push(display);
      continue;
    }

    if (parsed.countOnly) {
      const count = fileResult.matches.length;
      outputLines.push(multiFile ? `${display}:${count}` : `${count}`);
      continue;
    }

    let fileMatchCount = 0;
    for (const match of fileResult.matches) {
      const lineNum = match.lineNumber + 1; // 0-based → 1-based

      let text: string;
      if (parsed.onlyMatching) {
        text = match.lineText.substring(match.matchStart, match.matchEnd);
      } else {
        text = match.lineText;
      }

      if (multiFile && (parsed.lineNumbers || contextLines > 0)) {
        outputLines.push(`${display}:${lineNum}:${text}`);
      } else if (multiFile) {
        outputLines.push(`${display}:${text}`);
      } else if (parsed.lineNumbers || contextLines > 0) {
        outputLines.push(`${lineNum}:${text}`);
      } else {
        outputLines.push(text);
      }

      fileMatchCount++;
      if (parsed.maxCount > 0 && fileMatchCount >= parsed.maxCount) break;
    }
  }

  const stdout = outputLines.length > 0 ? outputLines.join('\n') + '\n' : '';
  return { stdout, stderr: '', exitCode: outputLines.length > 0 ? 0 : 1 };
}

async function executeRgCommand(
  args: string[],
  ctx: CommandContext,
  controller: ChildProcessController,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const parsed = parseRgArgs(args);

  if (parsed.pattern === null) {
    return { stdout: '', stderr: 'error: The following required arguments were not provided:\n  <PATTERN>\n\nUsage:\n  rg <PATTERN> [PATH ...]\n', exitCode: 2 };
  }

  // Stdin mode
  if (ctx.stdin && parsed.paths.length === 0) {
    // Determine case sensitivity
    let caseInsensitive = parsed.caseInsensitive;
    if (parsed.smartCase && !parsed.caseSensitive && !parsed.caseInsensitive) {
      caseInsensitive = parsed.pattern === parsed.pattern.toLowerCase();
    }
    const regex = buildRegex(parsed.pattern, {
      caseInsensitive,
      wordMatch: parsed.wordMatch,
      fixedStrings: parsed.fixedStrings,
    });
    if (!regex) {
      return { stdout: '', stderr: `rg: regex parse error\n`, exitCode: 2 };
    }
    const grepParsed: ParsedGrepArgs = {
      pattern: parsed.pattern,
      files: [],
      recursive: false,
      caseInsensitive,
      lineNumbers: parsed.lineNumbers && !parsed.noLineNumbers,
      filesOnly: parsed.filesOnly,
      countOnly: parsed.countOnly,
      invert: parsed.invert,
      wordMatch: parsed.wordMatch,
      extendedRegex: true,
      fixedStrings: parsed.fixedStrings,
      afterContext: parsed.afterContext,
      beforeContext: parsed.beforeContext,
      maxCount: parsed.maxCount,
      quiet: parsed.quiet,
      onlyMatching: parsed.onlyMatching,
      includeGlob: null,
      excludeGlob: null,
    };
    return grepStdin(grepParsed, regex, ctx.stdin);
  }

  // Invert mode — fall back to VFS
  if (parsed.invert) {
    return rgViaVfs(parsed, ctx);
  }

  // Try search provider
  if (controller.searchProvider) {
    try {
      return await rgViaSearchProvider(parsed, ctx, controller.searchProvider);
    } catch {
      // Fall back
    }
  }

  return rgViaVfs(parsed, ctx);
}

function rgSmartCaseSensitive(parsed: ParsedRgArgs): boolean {
  if (parsed.caseSensitive) return true;
  if (parsed.caseInsensitive) return false;
  if (parsed.smartCase) {
    // smart case: case sensitive if pattern has uppercase
    return parsed.pattern !== parsed.pattern!.toLowerCase();
  }
  return true;
}

function rgTypeToGlob(typeFilter: string): string | null {
  const typeMap: Record<string, string> = {
    js: '*.js', ts: '*.ts', tsx: '*.tsx', jsx: '*.jsx',
    py: '*.py', rust: '*.rs', go: '*.go', java: '*.java',
    html: '*.html', css: '*.css', json: '*.json', md: '*.md',
    yaml: '*.yaml', yml: '*.yml', xml: '*.xml', toml: '*.toml',
    txt: '*.txt', sh: '*.sh', rb: '*.rb', php: '*.php',
    c: '*.c', cpp: '*.cpp', h: '*.h',
  };
  return typeMap[typeFilter] ?? null;
}

async function rgViaSearchProvider(
  parsed: ParsedRgArgs,
  ctx: CommandContext,
  provider: WorkspaceSearchProvider,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const searchFolder = parsed.paths.length > 0 ? resolvePath(ctx.cwd, parsed.paths[0]) : ctx.cwd;
  const caseSensitive = rgSmartCaseSensitive(parsed);
  const contextLines = Math.max(parsed.afterContext, parsed.beforeContext);

  // Build include pattern from type filters and globs
  let includePattern: string | undefined;
  const includePatterns: string[] = [];
  for (const t of parsed.typeFilters) {
    const g = rgTypeToGlob(t);
    if (g) includePatterns.push(g);
  }
  for (const g of parsed.globs) {
    if (!g.startsWith('!')) includePatterns.push(g);
  }
  if (includePatterns.length > 0) includePattern = includePatterns.join(',');

  let excludePattern: string | undefined;
  const excludePatterns: string[] = [];
  for (const g of parsed.globs) {
    if (g.startsWith('!')) excludePatterns.push(g.slice(1));
  }
  if (excludePatterns.length > 0) excludePattern = excludePatterns.join(',');

  const result = await provider.search({
    pattern: parsed.pattern!,
    isRegExp: !parsed.fixedStrings,
    isCaseSensitive: caseSensitive,
    isWordMatch: parsed.wordMatch,
    folderPath: searchFolder,
    includePattern,
    excludePattern,
    maxResults: parsed.maxCount > 0 ? parsed.maxCount : undefined,
    surroundingContext: contextLines > 0 ? contextLines : undefined,
  });

  if (parsed.quiet) {
    return { stdout: '', stderr: '', exitCode: result.files.length > 0 ? 0 : 1 };
  }

  const showLineNumbers = parsed.lineNumbers && !parsed.noLineNumbers;
  const outputLines: string[] = [];

  for (const fileResult of result.files) {
    const display = relativizePath(fileResult.filePath, ctx.cwd);

    if (parsed.filesOnly) {
      outputLines.push(display);
      continue;
    }

    if (parsed.countOnly) {
      outputLines.push(`${display}:${fileResult.matches.length}`);
      continue;
    }

    let fileMatchCount = 0;
    for (const match of fileResult.matches) {
      const lineNum = match.lineNumber + 1;
      let text: string;
      if (parsed.onlyMatching) {
        text = match.lineText.substring(match.matchStart, match.matchEnd);
      } else {
        text = match.lineText;
      }

      if (showLineNumbers) {
        outputLines.push(`${display}:${lineNum}:${text}`);
      } else {
        outputLines.push(`${display}:${text}`);
      }

      fileMatchCount++;
      if (parsed.maxCount > 0 && fileMatchCount >= parsed.maxCount) break;
    }

    // rg separates files with blank line when multiple files have matches
    if (fileResult.matches.length > 0 && result.files.indexOf(fileResult) < result.files.length - 1) {
      outputLines.push('');
    }
  }

  const stdout = outputLines.length > 0 ? outputLines.join('\n') + '\n' : '';
  return { stdout, stderr: '', exitCode: result.files.length > 0 ? 0 : 1 };
}

async function rgViaVfs(
  parsed: ParsedRgArgs,
  ctx: CommandContext,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  // Convert rg args to grep-compatible and reuse VFS grep
  let caseInsensitive = parsed.caseInsensitive;
  if (parsed.smartCase && !parsed.caseSensitive && !parsed.caseInsensitive) {
    caseInsensitive = parsed.pattern === parsed.pattern!.toLowerCase();
  }

  // Build include glob from type filters
  let includeGlob: string | null = null;
  if (parsed.typeFilters.length > 0) {
    const g = rgTypeToGlob(parsed.typeFilters[0]);
    if (g) includeGlob = g;
  }
  // Simple globs (non-negated)
  for (const g of parsed.globs) {
    if (!g.startsWith('!')) { includeGlob = g; break; }
  }
  let excludeGlob: string | null = null;
  for (const g of parsed.globs) {
    if (g.startsWith('!')) { excludeGlob = g.slice(1); break; }
  }

  const grepParsed: ParsedGrepArgs = {
    pattern: parsed.pattern!,
    files: parsed.paths.length > 0 ? parsed.paths : [],
    recursive: true, // rg is always recursive
    caseInsensitive,
    lineNumbers: parsed.lineNumbers && !parsed.noLineNumbers,
    filesOnly: parsed.filesOnly,
    countOnly: parsed.countOnly,
    invert: parsed.invert,
    wordMatch: parsed.wordMatch,
    extendedRegex: true,
    fixedStrings: parsed.fixedStrings,
    afterContext: parsed.afterContext,
    beforeContext: parsed.beforeContext,
    maxCount: parsed.maxCount,
    quiet: parsed.quiet,
    onlyMatching: parsed.onlyMatching,
    includeGlob,
    excludeGlob,
  };

  return grepViaVfs(grepParsed, ctx);
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
