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
import { Readable, Writable, Buffer } from './stream';
import type { VirtualFS } from '../virtual-fs';
import { VirtualFSAdapter } from './vfs-adapter';
import { Runtime } from '../runtime';
import type { PackageJson } from '../types/package-json';
import * as path from './path';
import { extractTarball } from '../npm/tarball';

// Singleton bash instance - uses VFS adapter for two-way file sync
let bashInstance: Bash | null = null;
let vfsAdapter: VirtualFSAdapter | null = null;
let currentVfs: VirtualFS | null = null;

// Track active forked child processes so the node command can detect when children exit.
// When the last child exits, the node command uses a shorter idle timeout.
let _activeForkedChildren = 0;
let _onForkedChildExit: (() => void) | null = null;
// Track active shell subprocesses started via exec/spawn.
// This keeps parent node CLIs alive while nested commands (e.g. npm install) run.
let _activeShellChildren = 0;

type ManagedFrameworkDevServer = {
  key: string;
  framework: 'next' | 'vite';
  port: number;
  stop: () => void;
};

// Track framework dev servers started from shell commands so we can replace
// and tear them down deterministically across command reruns/containers.
const _frameworkDevServers = new Map<string, ManagedFrameworkDevServer>();

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

// Module-level streaming callbacks for long-running commands (e.g. vitest watch)
// Set by container.run() before calling exec, cleared after
let _streamStdout: ((data: string) => void) | null = null;
let _streamStderr: ((data: string) => void) | null = null;
let _abortSignal: AbortSignal | null = null;

/**
 * Set streaming callbacks for the next command execution.
 * Used by container.run() to enable streaming output from custom commands.
 */
export function setStreamingCallbacks(opts: {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
  signal?: AbortSignal;
}): void {
  _streamStdout = opts.onStdout || null;
  _streamStderr = opts.onStderr || null;
  _abortSignal = opts.signal || null;
}

/**
 * Clear streaming callbacks after command execution.
 */
export function clearStreamingCallbacks(): void {
  _streamStdout = null;
  _streamStderr = null;
  _abortSignal = null;
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

function stopManagedFrameworkServer(key: string): void {
  const existing = _frameworkDevServers.get(key);
  if (!existing) return;
  try {
    existing.stop();
  } catch {
    // Ignore teardown errors during replacement.
  } finally {
    _frameworkDevServers.delete(key);
  }
}

function stopAllManagedFrameworkServers(): void {
  for (const key of _frameworkDevServers.keys()) {
    stopManagedFrameworkServer(key);
  }
}

function stopManagedFrameworkServersOnPort(port: number): void {
  for (const [key, server] of _frameworkDevServers.entries()) {
    if (server.port === port) {
      stopManagedFrameworkServer(key);
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

function emitStreamData(output: unknown, stream: 'stdout' | 'stderr') {
  if (typeof output !== 'string') return;
  if (stream === 'stdout') {
    _streamStdout?.(output);
  } else {
    _streamStderr?.(output);
  }
}

function emitBashLog(message: string, data: unknown) {
  if (!data || typeof data !== 'object') return;
  const payload = data as { output?: unknown };
  if (payload.output === undefined) return;

  // Node command output is already streamed directly from its runtime.
  // Avoid double-emitting by skipping logs while stdin is actively wired.
  if (_activeProcessStdin) return;

  if (message === 'stdout' || message === 'stderr') {
    emitStreamData(payload.output, message);
  }
}

// Reference to the currently running node command's process stdin.
// Used to send stdin input to long-running commands (e.g. vitest watch mode).
let _activeProcessStdin: {
  emit: (event: string, ...args: unknown[]) => void;
  listenerCount?: (event: string) => number;
} | null = null;

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
  if (_activeProcessStdin) {
    const hasKeypressListeners = typeof _activeProcessStdin.listenerCount === 'function'
      && _activeProcessStdin.listenerCount('keypress') > 0;
    const decoded = decodeKeypressEvents(data);

    const isControlSequenceOnly = decoded.length > 0 && decoded.every(({ ch, key }) => {
      if (ch !== undefined) return false;
      return key.name === 'up'
        || key.name === 'down'
        || key.name === 'left'
        || key.name === 'right'
        || key.name === 'escape';
    });

    // Avoid double-handling arrow/escape sequences in prompt UIs while still
    // delivering normal text/enter input via 'data' (needed for text prompts).
    if (!(hasKeypressListeners && isControlSequenceOnly)) {
      _activeProcessStdin.emit('data', data);
    }

    for (const { ch, key } of decoded) {
      _activeProcessStdin.emit('keypress', ch, key);
    }
  }
}

/**
 * Initialize the child_process shim with a VirtualFS instance
 * Creates a single Bash instance with VirtualFSAdapter for efficient file access
 */
export function initChildProcess(vfs: VirtualFS): void {
  if (currentVfs && currentVfs !== vfs) {
    stopAllManagedFrameworkServers();
  }
  currentVfs = vfs;
  vfsAdapter = new VirtualFSAdapter(vfs);

  // Create custom 'node' command that runs JS files using the Runtime
  const nodeCommand = defineCommand('node', async (args, ctx) => {
    if (!currentVfs) {
      return { stdout: '', stderr: 'VFS not initialized\n', exitCode: 1 };
    }

    const scriptPath = args[0];
    if (!scriptPath) {
      return { stdout: '', stderr: 'Usage: node <script.js> [args...]\n', exitCode: 1 };
    }

    // Resolve the script path
    const resolvedPath = scriptPath.startsWith('/')
      ? scriptPath
      : `${ctx.cwd}/${scriptPath}`.replace(/\/+/g, '/');
    const isNodeModulesCli = resolvedPath.includes('/node_modules/');

    if (!currentVfs.existsSync(resolvedPath)) {
      return { stdout: '', stderr: `Error: Cannot find module '${resolvedPath}'\n`, exitCode: 1 };
    }

    let stdout = '';
    let stderr = '';
    let lastActivityAt = Date.now();
    const initialShellChildren = _activeShellChildren;

    // Track whether process.exit() was called
    let exitCalled = false;
    let exitCode = 0;
    let syncExecution = true;
    let exitResolve: ((code: number) => void) | null = null;
    const exitPromise = new Promise<number>((resolve) => { exitResolve = resolve; });

    // Helper to append to stdout, also streaming if configured
    const appendStdout = (data: string) => {
      stdout += data;
      lastActivityAt = Date.now();
      if (_streamStdout) _streamStdout(data);
    };
    const appendStderr = (data: string) => {
      stderr += data;
      lastActivityAt = Date.now();
      if (_streamStderr) _streamStderr(data);
    };

    // Create a runtime with output capture for both console.log AND process.stdout.write
    const runtime = new Runtime(currentVfs, {
      cwd: ctx.cwd,
      env: ctx.env,
      onConsole: (method, consoleArgs) => {
        const msg = consoleArgs.map(a => String(a)).join(' ') + '\n';
        if (method === 'error') {
          appendStderr(msg);
        } else {
          appendStdout(msg);
        }
      },
      onStdout: (data: string) => {
        appendStdout(data);
      },
      onStderr: (data: string) => {
        appendStderr(data);
      },
    });

    // Override process.exit to resolve the completion promise
    const proc = runtime.getProcess();
    proc.exit = ((code = 0) => {
      if (!exitCalled) {
        exitCalled = true;
        exitCode = code;
        proc.emit('exit', code);
        exitResolve!(code);
      }
      // In sync context, throw to stop execution (like real process.exit)
      // In async context, return silently to avoid unhandled rejections
      if (syncExecution) {
        throw new Error(`Process exited with code ${code}`);
      }
    }) as (code?: number) => never;

    // Set up process.argv for the script
    proc.argv = ['node', resolvedPath, ...args.slice(1)];

    // For interactive commands, report as TTY and track stdin so external
    // code can forward input (e.g. Ctrl+C in demo terminals).
    // Enable TTY whenever output is being streamed, not only when an abort
    // signal is present. Some TUIs stream without passing a signal.
    const shouldEnableTty = !!_abortSignal || !!_streamStdout || !!_streamStderr;
    let stdinRawMode = false;
    if (shouldEnableTty) {
      proc.stdout.isTTY = true;
      proc.stderr.isTTY = true;
      proc.stdin.isTTY = true;
      proc.stdin.setRawMode = (mode: boolean) => {
        stdinRawMode = !!mode;
        return proc.stdin;
      };
      _activeProcessStdin = proc.stdin;
    }

    // Reset per-run yoga preload state.
    (globalThis as any).__almostnodeYogaLayout = undefined;
    (globalThis as any).__almostnodeYogaLayoutError = undefined;

    // Preload yoga-layout when available so require('yoga-layout') can bypass
    // the package's top-level-await ESM entry from CJS execution.
    const preloadYogaLayout = async (): Promise<void> => {
      const candidates = [
        `${ctx.cwd}/node_modules/yoga-layout/dist/src/load.js`.replace(/\/+/g, '/'),
        '/node_modules/yoga-layout/dist/src/load.js',
      ];
      const yogaLoadPath = candidates.find((p) => currentVfs!.existsSync(p));
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
      // Run the script (synchronous part)
      runtime.runFile(resolvedPath);
    } catch (error) {
      // process.exit() throws to stop sync execution — this is expected
      if (error instanceof Error && error.message.startsWith('Process exited with code')) {
        return { stdout, stderr, exitCode };
      }
      // Real error
      const errorMsg = error instanceof Error
        ? `${error.message}\n${error.stack || ''}`
        : String(error);
      return { stdout, stderr: stderr + `Error: ${errorMsg}\n`, exitCode: 1 };
    } finally {
      // After runFile returns, switch to async mode (no more throwing from process.exit)
      syncExecution = false;
    }

    // If process.exit was called synchronously (but didn't throw for some reason), return
    if (exitCalled) {
      return { stdout, stderr, exitCode };
    }

    // Script returned without calling process.exit().
    // Wait for process.exit() or until output stabilizes.
    // Also catch unhandled rejections from async code to surface errors.

    // Catch unhandled rejections from the script's async code
    const rejectionHandler = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      // Ignore process.exit throws (they're expected)
      if (reason instanceof Error && reason.message.startsWith('Process exited with code')) {
        event.preventDefault();
        return;
      }
      const msg = reason instanceof Error
        ? `Unhandled rejection: ${reason.message}\n${reason.stack || ''}\n`
        : `Unhandled rejection: ${String(reason)}\n`;
      appendStderr(msg);
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
    currentVfs?.on('change', vfsActivityHandler);
    currentVfs?.on('delete', vfsActivityHandler);

    // Listen for forked child exits to shorten the idle timeout.
    // Many CLI tools (vitest, jest, etc.) fork workers and exit shortly after
    // all children complete. We use a shorter timeout once children are done.
    let childrenExited = false;
    let hadActiveSubprocess = false;
    const prevChildExitHandler = _onForkedChildExit;
    _onForkedChildExit = () => {
      if (_activeForkedChildren <= 0) childrenExited = true;
      prevChildExitHandler?.();
    };

    try {
      // Poll until process.exit is called, output stabilizes, or we time out.
      // Keep the process alive indefinitely only while stdin is interactive
      // (watch mode / prompts). This prevents one-shot CLIs from hanging.
      // Package CLIs often have long silent async phases (network + scaffold)
      // before they emit output or call process.exit().
      const MAX_TOTAL_MS = isNodeModulesCli ? 5 * 60 * 1000 : 60000;
      const IDLE_TIMEOUT_MS = isNodeModulesCli ? 60_000 : 500;
      const NO_OUTPUT_IDLE_MS = isNodeModulesCli ? 120_000 : 1500;
      const POST_CHILD_EXIT_IDLE_MS = isNodeModulesCli ? 2_000 : 100; // short timeout after children finish
      const ACTIVE_SUBPROCESS_STALE_MS = isNodeModulesCli ? 20_000 : 3_000;
      const CHECK_MS = 50;
      const startTime = Date.now();
      let lastOutputLen = stdout.length + stderr.length;
      let idleMs = 0;

      while (!exitCalled) {
        // Always allow explicit abort from caller.
        if (_abortSignal?.aborted) break;

        // Check if exitPromise resolved (non-blocking)
        const raceResult = await Promise.race([
          exitPromise.then(() => 'exit' as const),
          new Promise<'tick'>(r => setTimeout(() => r('tick'), CHECK_MS)),
        ]);

        if (raceResult === 'exit' || exitCalled) break;
        if (_abortSignal?.aborted) break;

        const currentLen = stdout.length + stderr.length;
        if (currentLen > lastOutputLen) {
          // New output — reset idle timer
          lastOutputLen = currentLen;
          idleMs = 0;
        } else {
          idleMs += CHECK_MS;
        }

        // Hard timeout regardless of activity tracking.
        if (Date.now() - startTime >= MAX_TOTAL_MS) break;

        const keepAliveForInteractiveInput = !!_abortSignal && (
          stdinRawMode ||
          hasActiveStdinListeners(proc.stdin)
        );
        if (keepAliveForInteractiveInput) {
          continue;
        }

        const hasActiveSubprocess = _activeForkedChildren > 0 || _activeShellChildren > initialShellChildren;
        if (hasActiveSubprocess) {
          hadActiveSubprocess = true;
          const activityAge = Date.now() - lastActivityAt;
          if (activityAge < ACTIVE_SUBPROCESS_STALE_MS) {
            idleMs = 0;
            continue;
          }
        }

        // Use shorter idle timeout once all forked children have exited.
        const effectiveIdle = (childrenExited || hadActiveSubprocess) ? POST_CHILD_EXIT_IDLE_MS : IDLE_TIMEOUT_MS;
        if (lastOutputLen > 0 && idleMs >= effectiveIdle) break;
        if (lastOutputLen === 0 && idleMs >= NO_OUTPUT_IDLE_MS) break;

      }

      return { stdout, stderr, exitCode: exitCalled ? exitCode : 0 };
    } finally {
      _activeProcessStdin = null;
      _onForkedChildExit = prevChildExitHandler;
      if (hasGlobalRejectionEvents) {
        globalThis.removeEventListener('unhandledrejection', rejectionHandler);
      }
      currentVfs?.off('change', vfsActivityHandler);
      currentVfs?.off('delete', vfsActivityHandler);
    }
  });

  // Create custom 'npm' command that runs scripts from package.json
  const npmCommand = defineCommand('npm', async (args, ctx) => {
    if (!currentVfs) {
      return { stdout: '', stderr: 'VFS not initialized\n', exitCode: 1 };
    }

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
        return handleNpmRun(args.slice(1), ctx);
      case 'start':
        return handleNpmRun(['start'], ctx);
      case 'test':
      case 't':
      case 'tst':
        return handleNpmRun(['test'], ctx);
      case 'install':
      case 'i':
      case 'add':
        return handleNpmInstall(args.slice(1), ctx);
      case 'ls':
      case 'list':
        return handleNpmList(ctx);
      default:
        return {
          stdout: '',
          stderr: `npm ERR! Unknown command: "${subcommand}"\n`,
          exitCode: 1,
        };
    }
  });

  // Create custom 'npx' command that runs package binaries
  const npxCommand = defineCommand('npx', async (args, ctx) => {
    if (!currentVfs) {
      return { stdout: '', stderr: 'VFS not initialized\n', exitCode: 1 };
    }

    // Parse flags
    let packageSpec: string | null = null;
    const cmdArgs: string[] = [];
    let i = 0;

    while (i < args.length) {
      const arg = args[i];
      if ((arg === '-p' || arg === '--package') && i + 1 < args.length) {
        packageSpec = args[i + 1];
        i += 2;
      } else if (arg === '-y' || arg === '--yes') {
        // Always auto-confirm in browser — skip
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
    // If no -p flag, the first positional arg is both what to install and what to run
    const installSpec = packageSpec || commandName;

    // Strip version specifier from command name for bin lookup
    const { parsePackageSpec } = await import('../npm/index');
    const {
      name: pkgName,
      version: requestedVersion,
    } = parsePackageSpec(typeof installSpec === 'string' ? installSpec : commandName);
    const forceLatestInstall = requestedVersion === 'latest';

    // Derive the bin command name: for -p, use commandName as-is; otherwise derive from package name
    const binName = packageSpec ? commandName : (pkgName.includes('/') ? pkgName.split('/').pop()! : pkgName);

    const quoteArg = (value: string) => JSON.stringify(value);

    const emitInstallProgress = (message: string) => {
      emitStreamData(`${message}\n`, 'stdout');
    };

    const formatOutputTail = (output: string, maxLines = 20, maxChars = 2000): string => {
      if (!output) return '';
      const normalized = output.trimEnd();
      if (!normalized) return '';
      const lines = normalized.split(/\r?\n/);
      const tail = lines.slice(-maxLines).join('\n');
      return tail.length > maxChars ? tail.slice(-maxChars) : tail;
    };

    const withNpxExecDiagnostics = (
      result: JustBashExecResult,
      executionTarget: string
    ): JustBashExecResult => {
      if (result.exitCode === 0) return result;
      const stderrText = result.stderr || '';
      const firstStderrLine = stderrText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find((line) => line.length > 0);

      let diagnostic =
        `npx: command "${binName}" exited with code ${result.exitCode} while running ${executionTarget}\n`;
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
        binPath: binPaths.find((p) => currentVfs!.existsSync(p)) ?? null,
        resolvedBinTarget: getPackageBinTarget(pkgName, binName, normalizedCwd),
      };
    };

    const installPackage = async (installCwd: string) => {
      const { PackageManager } = await import('../npm/index');
      const pm = new PackageManager(currentVfs!, { cwd: installCwd || '/' });
      await pm.install(installSpec, { onProgress: emitInstallProgress });
    };

    let { binPath, resolvedBinTarget } = resolveBin(ctx.cwd);

    // Install in cwd first if command is missing, or if @latest was requested.
    if (forceLatestInstall || (!binPath && !resolvedBinTarget)) {
      try {
        await installPackage(ctx.cwd);
        ({ binPath, resolvedBinTarget } = resolveBin(ctx.cwd));

        // Fallback: some flows install into root node_modules.
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

    // Prefer executing the actual bin entry directly to avoid PATH quirks.
    if (resolvedBinTarget) {
      const fullCommand = [
        'node',
        resolvedBinTarget,
        ...commandArgs,
      ].map((value) => quoteArg(value)).join(' ');
      const result = await ctx.exec(fullCommand, { cwd: ctx.cwd, env: ctx.env });
      return withNpxExecDiagnostics(result, `node ${resolvedBinTarget}`);
    }

    if (!binPath) {
      return { stdout: '', stderr: `npx: command not found: ${binName}\n`, exitCode: 1 };
    }

    // Fallback to bin stub
    const fullCommand = [binPath, ...commandArgs].map((value) => quoteArg(value)).join(' ');
    const result = await ctx.exec(fullCommand, { cwd: ctx.cwd, env: ctx.env });
    return withNpxExecDiagnostics(result, binPath);
  });

  const tarCommand = defineCommand('tar', async (args, ctx) => {
    if (!currentVfs) {
      return { stdout: '', stderr: 'VFS not initialized\n', exitCode: 1 };
    }

    const parsed = parseTarOptions(args, ctx.cwd);
    if (!parsed.options) {
      return { stdout: '', stderr: `tar: ${parsed.error || 'invalid arguments'}\n`, exitCode: 2 };
    }

    const { archivePath, destPath, verbose } = parsed.options;

    if (!currentVfs.existsSync(archivePath)) {
      return { stdout: '', stderr: `tar: ${archivePath}: Cannot open: No such file or directory\n`, exitCode: 1 };
    }

    try {
      currentVfs.mkdirSync(destPath, { recursive: true });
      const archiveData = currentVfs.readFileSync(archivePath);
      const extracted = extractTarball(archiveData, currentVfs, destPath, {
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
    if (!currentVfs) {
      return { stdout: '', stderr: 'VFS not initialized\n', exitCode: 1 };
    }

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
      return execInstalledPackageBin('next', 'next', args, ctx);
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
      if (arg === '--turbopack' || arg === '--turbo') {
        continue;
      }
    }

    const key = `next:${port}`;
    stopManagedFrameworkServersOnPort(port);

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
      const server = new NextDevServer(currentVfs, {
        port,
        root,
        pagesDir: `${root}/pages`.replace(/\/+/g, '/'),
        appDir: `${root}/app`.replace(/\/+/g, '/'),
        publicDir: `${root}/public`.replace(/\/+/g, '/'),
        env: { ...ctx.env },
      });

      bridge.registerServer(createBridgeServerWrapper(server), port);
      server.start();

      const url = `${bridge.getServerUrl(port)}/`;
      const startup = `next dev server running at ${url} (host: ${hostname}, root: ${root})\n`;
      emitStreamData(startup, 'stdout');

      _frameworkDevServers.set(key, {
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

      if (_abortSignal) {
        await waitForAbort(_abortSignal);
        stopManagedFrameworkServer(key);
        return { stdout: startup, stderr: '', exitCode: 130 };
      }

      return { stdout: startup, stderr: '', exitCode: 0 };
    } catch (error) {
      stopManagedFrameworkServer(key);
      const message = error instanceof Error ? error.message : String(error);
      return { stdout: '', stderr: `next: failed to start dev server: ${message}\n`, exitCode: 1 };
    }
  });

  const viteCommand = defineCommand('vite', async (args, ctx) => {
    if (!currentVfs) {
      return { stdout: '', stderr: 'VFS not initialized\n', exitCode: 1 };
    }

    const normalizedCwd = normalizeCommandCwd(ctx.cwd);
    let root = normalizedCwd;
    let devArgs = args;

    const firstArg = args[0];
    if (firstArg && !firstArg.startsWith('-')) {
      if (firstArg === 'build' || firstArg === 'preview' || firstArg === 'optimize' || firstArg === 'optimizeDeps') {
        return execInstalledPackageBin('vite', 'vite', args, ctx);
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
    stopManagedFrameworkServersOnPort(port);

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

      const server = new ViteDevServer(currentVfs, {
        port,
        root,
      });

      bridge.registerServer(createBridgeServerWrapper(server), port);
      server.start();

      const url = `${bridge.getServerUrl(port)}/`;
      const startup = `vite dev server running at ${url} (host: ${host}, root: ${root})\n`;
      emitStreamData(startup, 'stdout');

      _frameworkDevServers.set(key, {
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

      if (_abortSignal) {
        await waitForAbort(_abortSignal);
        stopManagedFrameworkServer(key);
        return { stdout: startup, stderr: '', exitCode: 130 };
      }

      return { stdout: startup, stderr: '', exitCode: 0 };
    } catch (error) {
      stopManagedFrameworkServer(key);
      const message = error instanceof Error ? error.message : String(error);
      return { stdout: '', stderr: `vite: failed to start dev server: ${message}\n`, exitCode: 1 };
    }
  });

  bashInstance = new Bash({
    fs: vfsAdapter,
    cwd: '/',
    env: {
      HOME: '/home/user',
      USER: 'user',
      PATH: '/usr/local/bin:/usr/bin:/bin:/node_modules/.bin',
      NODE_ENV: 'development',
    },
    logger: {
      info: (message, data) => {
        if (message === 'stderr' || message === 'stdout') {
          emitBashLog(message, data);
        }
      },
      debug: (message, data) => {
        if (message === 'stdout' || message === 'stderr') {
          emitBashLog(message, data);
        }
      },
    },
    customCommands: [nodeCommand, npmCommand, npxCommand, tarCommand, nextCommand, viteCommand],
  });
}

/**
 * Read and parse package.json from the VFS
 */
function readPackageJson(cwd: string): { pkgJson: PackageJson; error?: undefined } | { pkgJson?: undefined; error: JustBashExecResult } {
  const pkgJsonPath = `${cwd}/package.json`.replace(/\/+/g, '/');

  if (!currentVfs!.existsSync(pkgJsonPath)) {
    return {
      error: {
        stdout: '',
        stderr: 'npm ERR! no package.json found\n',
        exitCode: 1,
      },
    };
  }

  try {
    const pkgJson = JSON.parse(currentVfs!.readFileSync(pkgJsonPath, 'utf8')) as PackageJson;
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
function getPackageBinTarget(pkgName: string, binName: string, cwd: string): string | null {
  const searchDirs = [
    `${cwd}/node_modules`.replace(/\/+/g, '/'),
    '/node_modules',
  ];

  for (const dir of searchDirs) {
    const packageDir = `${dir}/${pkgName}`.replace(/\/+/g, '/');
    const pkgJsonPath = `${packageDir}/package.json`;
    if (!currentVfs!.existsSync(pkgJsonPath)) continue;

    try {
      const pkgJson = JSON.parse(currentVfs!.readFileSync(pkgJsonPath, 'utf8')) as { bin?: Record<string, string> | string };

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
      if (currentVfs!.existsSync(resolved)) {
        return resolved;
      }
    } catch {
      continue;
    }
  }

  return null;
}

async function execInstalledPackageBin(
  pkgName: string,
  binName: string,
  args: string[],
  ctx: CommandContext
): Promise<JustBashExecResult> {
  if (!currentVfs) {
    return { stdout: '', stderr: 'VFS not initialized\n', exitCode: 1 };
  }
  if (!ctx.exec) {
    return { stdout: '', stderr: `${binName}: execution context unavailable\n`, exitCode: 1 };
  }

  const normalizedCwd = normalizeCommandCwd(ctx.cwd);
  const resolvedTarget = getPackageBinTarget(pkgName, binName, normalizedCwd)
    || getPackageBinTarget(pkgName, binName, '/');

  if (resolvedTarget) {
    const fullCommand = ['node', resolvedTarget, ...args].map((value) => shellQuote(value)).join(' ');
    return ctx.exec(fullCommand, { cwd: normalizedCwd, env: ctx.env });
  }

  const binCandidates = [
    `${normalizedCwd}/node_modules/.bin/${binName}`.replace(/\/+/g, '/'),
    `/node_modules/.bin/${binName}`,
  ];
  const binPath = binCandidates.find((candidate) => currentVfs!.existsSync(candidate));
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
async function handleNpmRun(args: string[], ctx: CommandContext): Promise<JustBashExecResult> {
  const scriptName = args[0];

  // "npm run" with no script name: list available scripts
  if (!scriptName) {
    return listScripts(ctx);
  }

  const result = readPackageJson(ctx.cwd);
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
function listScripts(ctx: CommandContext): JustBashExecResult {
  const result = readPackageJson(ctx.cwd);
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
async function handleNpmInstall(args: string[], ctx: CommandContext): Promise<JustBashExecResult> {
  const { PackageManager } = await import('../npm/index');
  const pm = new PackageManager(currentVfs!, { cwd: ctx.cwd });

  let stdout = '';
  const emitProgress = (message: string) => {
    const line = `${message}\n`;
    stdout += line;
    emitStreamData(line, 'stdout');
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
async function handleNpmList(ctx: CommandContext): Promise<JustBashExecResult> {
  const { PackageManager } = await import('../npm/index');
  const pm = new PackageManager(currentVfs!, { cwd: ctx.cwd });
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

function getSyntheticExecFileSyncOutput(file: string, args: string[]): string | null {
  const command = path.basename(file).toLowerCase();
  const arch = getCurrentProcessArch();
  const bitness = ['x64', 'arm64', 'ppc64', 'riscv64'].includes(arch) ? '64' : '32';

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

/**
 * Execute a command in a shell
 */
export function exec(
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

  // Execute asynchronously
  (async () => {
    if (!bashInstance) {
      const error = new Error('child_process not initialized');
      child.emit('error', error);
      if (cb) cb(error, '', '');
      return;
    }

    _activeShellChildren++;
    try {
      const resolvedCwd = options.cwd ?? getDefaultProcessCwd();
      const resolvedEnv = options.env ?? getDefaultProcessEnv();
      const result = await bashInstance!.exec(command, {
        cwd: resolvedCwd,
        env: resolvedEnv,
      });

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
      _activeShellChildren = Math.max(0, _activeShellChildren - 1);
    }
  })();

  return child;
}

/**
 * Execute a command synchronously
 */
export function execSync(
  command: string,
  options?: ExecOptions
): string | Buffer {
  if (!bashInstance) {
    throw new Error('child_process not initialized');
  }

  // Note: just-bash exec is async, so we can't truly do sync execution
  // This is a limitation of the browser environment
  // For now, throw an error suggesting to use exec() instead
  throw new Error(
    'execSync is not supported in browser environment. Use exec() with async/await or callbacks instead.'
  );
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  shell?: boolean | string;
  stdio?: 'pipe' | 'inherit' | 'ignore' | Array<'pipe' | 'inherit' | 'ignore'>;
}

/**
 * Spawn a new process
 */
export function spawn(
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

  // Build the full command
  const fullCommand = spawnArgs.length > 0
    ? `${command} ${spawnArgs.map(arg =>
        arg.includes(' ') ? `"${arg}"` : arg
      ).join(' ')}`
    : command;

  // Execute asynchronously
  (async () => {
    if (!bashInstance) {
      const error = new Error('child_process not initialized');
      child.emit('error', error);
      return;
    }

    _activeShellChildren++;
    try {
      const resolvedCwd = spawnOptions.cwd ?? getDefaultProcessCwd();
      const resolvedEnv = spawnOptions.env ?? getDefaultProcessEnv();
      const result = await bashInstance!.exec(fullCommand, {
        cwd: resolvedCwd,
        env: resolvedEnv,
      });

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
    } catch (error) {
      child.emit('error', error);
    } finally {
      _activeShellChildren = Math.max(0, _activeShellChildren - 1);
    }
  })();

  return child;
}

/**
 * Spawn a new process synchronously
 */
export function spawnSync(
  command: string,
  args?: string[],
  options?: SpawnOptions
): { stdout: Buffer; stderr: Buffer; status: number; error?: Error } {
  throw new Error(
    'spawnSync is not supported in browser environment. Use spawn() instead.'
  );
}

/**
 * Execute a file
 */
export function execFile(
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

  const command = execArgs.length > 0 ? `${file} ${execArgs.join(' ')}` : file;
  return exec(command, execOptions, cb);
}

/**
 * Execute a file synchronously.
 * This browser runtime cannot execute shell commands synchronously, so we provide
 * deterministic results for common architecture probes used by npm packages.
 */
export function execFileSync(
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

/**
 * Fork — runs a Node.js module in a simulated child process using a new Runtime.
 * In the browser, there's no real process forking. Instead we:
 * 1. Create a ChildProcess with IPC (send/on('message'))
 * 2. Create a new Runtime to execute the module
 * 3. Wire up bidirectional IPC between parent and child
 */
export function fork(
  modulePath: string,
  argsOrOptions?: string[] | Record<string, unknown>,
  options?: Record<string, unknown>
): ChildProcess {
  if (!currentVfs) {
    throw new Error('VFS not initialized');
  }

  // Parse overloaded arguments
  let args: string[] = [];
  let opts: Record<string, unknown> = {};
  if (Array.isArray(argsOrOptions)) {
    args = argsOrOptions;
    opts = options || {};
  } else if (argsOrOptions) {
    opts = argsOrOptions;
  }

  const cwd = (opts.cwd as string) || getDefaultProcessCwd();
  const env = (opts.env as Record<string, string>) || getDefaultProcessEnv();
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
  const childRuntime = new Runtime(currentVfs!, {
    cwd,
    env,
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
  _activeForkedChildren++;

  const notifyChildExit = () => {
    _activeForkedChildren--;
    _onForkedChildExit?.();
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
