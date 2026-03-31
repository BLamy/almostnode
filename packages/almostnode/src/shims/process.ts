/**
 * Node.js process shim
 * Provides minimal process object for browser environment
 * Process is an EventEmitter in Node.js
 */

import { EventEmitter, EventListener } from './events';
import { homedir, userInfo } from './os';
import { DEFAULT_POSIX_SHELL } from './synthetic-shells';
import { almostnodeDebugWarn } from '../utils/debug';

export interface ProcessEnv {
  [key: string]: string | undefined;
}

// Stream-like interface with EventEmitter methods
interface ProcessStream {
  isTTY: boolean;
  readable: boolean;
  writable: boolean;
  destroyed: boolean;
  on: (event: string, listener: EventListener) => ProcessStream;
  once: (event: string, listener: EventListener) => ProcessStream;
  off: (event: string, listener: EventListener) => ProcessStream;
  emit: (event: string, ...args: unknown[]) => boolean;
  addListener: (event: string, listener: EventListener) => ProcessStream;
  removeListener: (event: string, listener: EventListener) => ProcessStream;
  removeAllListeners: (event?: string) => ProcessStream;
  setMaxListeners: (n: number) => ProcessStream;
  getMaxListeners: () => number;
  listenerCount: (event: string) => number;
  listeners: (event: string) => EventListener[];
  rawListeners: (event: string) => EventListener[];
  prependListener: (event: string, listener: EventListener) => ProcessStream;
  prependOnceListener: (event: string, listener: EventListener) => ProcessStream;
  eventNames: () => string[];
  pause?: () => ProcessStream;
  resume?: () => ProcessStream;
  setEncoding?: (encoding: string) => ProcessStream;
  ref?: () => ProcessStream;
  unref?: () => ProcessStream;
  destroy?: () => ProcessStream;
}

interface ProcessWritableStream extends ProcessStream {
  write: (data: string | Buffer, encoding?: string, callback?: () => void) => boolean;
  end?: (data?: string, callback?: () => void) => void;
  cursorTo?: (x: number, y?: number | (() => void), callback?: () => void) => boolean;
  moveCursor?: (dx: number, dy: number, callback?: () => void) => boolean;
  clearLine?: (dir: number, callback?: () => void) => boolean;
  clearScreenDown?: (callback?: () => void) => boolean;
  columns?: number;
  rows?: number;
  getColorDepth?: () => number;
  hasColors?: () => boolean;
}

interface ProcessReadableStream extends ProcessStream {
  read?: (size?: number) => string | Buffer | null;
  setRawMode?: (mode: boolean) => ProcessReadableStream;
}

let nextProcessId = 1000;

function allocateProcessId(): number {
  nextProcessId += 1;
  return nextProcessId;
}

export interface Process {
  env: ProcessEnv;
  cwd: () => string;
  chdir: (directory: string) => void;
  arch: string;
  platform: string;
  version: string;
  versions: { node: string; v8: string; uv: string };
  argv: string[];
  argv0: string;
  execPath: string;
  execArgv: string[];
  pid: number;
  ppid: number;
  getuid: () => number;
  getgid: () => number;
  geteuid: () => number;
  getegid: () => number;
  exit: (code?: number) => never;
  nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => void;
  stdout: ProcessWritableStream;
  stderr: ProcessWritableStream;
  stdin: ProcessReadableStream;
  hrtime: {
    (time?: [number, number]): [number, number];
    bigint: () => bigint;
  };
  memoryUsage: () => { rss: number; heapTotal: number; heapUsed: number; external: number; arrayBuffers: number };
  uptime: () => number;
  cpuUsage: () => { user: number; system: number };
  // EventEmitter methods
  on: (event: string, listener: EventListener) => Process;
  once: (event: string, listener: EventListener) => Process;
  off: (event: string, listener: EventListener) => Process;
  emit: (event: string, ...args: unknown[]) => boolean;
  addListener: (event: string, listener: EventListener) => Process;
  removeListener: (event: string, listener: EventListener) => Process;
  removeAllListeners: (event?: string) => Process;
  listeners: (event: string) => EventListener[];
  listenerCount: (event: string) => number;
  prependListener: (event: string, listener: EventListener) => Process;
  prependOnceListener: (event: string, listener: EventListener) => Process;
  eventNames: () => string[];
  setMaxListeners: (n: number) => Process;
  getMaxListeners: () => number;
  emitWarning: (warning: string | Error, typeOrOptions?: string | { type?: string; code?: string }, code?: string) => void;
  // IPC support (used by child_process.fork)
  send?: (message: unknown, callback?: (error: Error | null) => void) => boolean;
  connected?: boolean;
  // Internal field kept for backward compatibility with previous runtime code.
  _cwdCallCount?: number;
}

// Helper to create a stream-like object with EventEmitter methods
function createProcessStream(
  isWritable: boolean,
  writeImpl?: (data: string) => boolean
): ProcessWritableStream | ProcessReadableStream {
  const emitter = new EventEmitter();
  const queuedReads: Array<string | Buffer> = [];

  const stream: ProcessWritableStream & ProcessReadableStream = {
    isTTY: false,
    readable: !isWritable,
    writable: isWritable,
    destroyed: false,
    columns: 80,
    rows: 24,

    on(event: string, listener: EventListener) {
      emitter.on(event, listener);
      return stream;
    },
    once(event: string, listener: EventListener) {
      emitter.once(event, listener);
      return stream;
    },
    off(event: string, listener: EventListener) {
      emitter.off(event, listener);
      return stream;
    },
    emit(event: string, ...args: unknown[]) {
      return emitter.emit(event, ...args);
    },
    addListener(event: string, listener: EventListener) {
      emitter.addListener(event, listener);
      return stream;
    },
    removeListener(event: string, listener: EventListener) {
      emitter.removeListener(event, listener);
      return stream;
    },
    removeAllListeners(event?: string) {
      emitter.removeAllListeners(event);
      return stream;
    },
    setMaxListeners(n: number) {
      emitter.setMaxListeners(n);
      return stream;
    },
    getMaxListeners() {
      return emitter.getMaxListeners();
    },
    listenerCount(event: string) {
      return emitter.listenerCount(event);
    },
    listeners(event: string) {
      return emitter.listeners(event);
    },
    rawListeners(event: string) {
      return emitter.rawListeners(event);
    },
    prependListener(event: string, listener: EventListener) {
      emitter.prependListener(event, listener);
      return stream;
    },
    prependOnceListener(event: string, listener: EventListener) {
      emitter.prependOnceListener(event, listener);
      return stream;
    },
    eventNames() {
      return emitter.eventNames();
    },
    pause() {
      return stream;
    },
    resume() {
      return stream;
    },
    setEncoding(_encoding: string) {
      return stream;
    },
    // Default write implementation (no-op for readable streams)
    write(_data: string | Buffer, _encoding?: string, callback?: () => void) {
      if (callback) queueMicrotask(callback);
      return true;
    },
    end(_data?: string, callback?: () => void) {
      if (callback) queueMicrotask(callback);
    },
    // Default read implementation (for stdin)
    read() {
      return queuedReads.length > 0 ? queuedReads.shift()! : null;
    },
    setRawMode(_mode: boolean) {
      return stream;
    },
    ref() {
      return stream;
    },
    unref() {
      return stream;
    },
    destroy() {
      stream.destroyed = true;
      stream.readable = false;
      stream.writable = false;
      emitter.emit('close');
      return stream;
    },
    cursorTo(x: number, yOrCb?: number | (() => void), callback?: () => void) {
      const cb = typeof yOrCb === 'function' ? yOrCb : callback;
      const y = typeof yOrCb === 'number' ? yOrCb : undefined;
      if (stream.isTTY) {
        if (y != null) {
          stream.write(`\x1b[${y + 1};${x + 1}H`);
        } else {
          stream.write(`\x1b[${x + 1}G`);
        }
      }
      if (cb) queueMicrotask(cb);
      return true;
    },
    moveCursor(dx: number, dy: number, callback?: () => void) {
      if (stream.isTTY) {
        let seq = '';
        if (dx > 0) seq += `\x1b[${dx}C`;
        else if (dx < 0) seq += `\x1b[${-dx}D`;
        if (dy > 0) seq += `\x1b[${dy}B`;
        else if (dy < 0) seq += `\x1b[${-dy}A`;
        if (seq) stream.write(seq);
      }
      if (callback) queueMicrotask(callback);
      return true;
    },
    clearLine(dir: number, callback?: () => void) {
      if (stream.isTTY) {
        if (dir === -1) stream.write('\x1b[1K');
        else if (dir === 1) stream.write('\x1b[0K');
        else stream.write('\x1b[2K');
      }
      if (callback) queueMicrotask(callback);
      return true;
    },
    clearScreenDown(callback?: () => void) {
      if (stream.isTTY) {
        stream.write('\x1b[0J');
      }
      if (callback) queueMicrotask(callback);
      return true;
    },
    getColorDepth() {
      return stream.isTTY ? 24 : 1;
    },
    hasColors() {
      return stream.isTTY;
    },
  };

  // Override write for actual writable streams
  if (isWritable && writeImpl) {
    stream.write = (data: string | Buffer, _encoding?: string, callback?: () => void) => {
      const result = writeImpl(typeof data === 'string' ? data : data.toString());
      if (callback) queueMicrotask(callback);
      return result;
    };
  }

  Object.defineProperty(stream, '__almostnodePushInput', {
    value: (data: string | Buffer) => {
      if (stream.destroyed) return;
      queuedReads.push(data);
      emitter.emit('readable');
    },
    configurable: true,
  });

  return stream;
}

export function createProcess(options?: {
  cwd?: string;
  env?: ProcessEnv;
  pid?: number;
  ppid?: number;
  uid?: number;
  gid?: number;
  tty?: boolean;
  onExit?: (code: number) => void;
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}): Process {
  let currentDir = options?.cwd || '/';
  const defaultHome = homedir();
  const defaultUser = userInfo();
  const env: ProcessEnv = {
    NODE_ENV: 'development',
    PATH: '/usr/local/bin:/usr/bin:/bin',
    HOME: defaultHome,
    USER: defaultUser.username,
    SHELL: DEFAULT_POSIX_SHELL,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '3',
    ...options?.env,
  };

  const pid = options?.pid ?? allocateProcessId();
  const ppid = options?.ppid ?? 0;
  const uid = options?.uid ?? defaultUser.uid;
  const gid = options?.gid ?? defaultUser.gid;

  // Create an EventEmitter for process events
  const emitter = new EventEmitter();
  const startTime = Date.now();

  const proc: Process = {
    env,

    cwd() {
      return currentDir;
    },

    chdir(directory: string) {
      if (!directory.startsWith('/')) {
        directory = currentDir + '/' + directory;
      }
      currentDir = directory;
    },

    arch: 'x64',
    platform: 'linux', // Pretend to be linux for better compatibility
    version: 'v20.0.0',
    versions: { node: '20.0.0', v8: '11.3.244.8', uv: '1.44.2' },

    argv: ['node', '/index.js'],
    argv0: 'node',
    execPath: '/usr/local/bin/node',
    execArgv: [],

    pid,
    ppid,

    getuid() {
      return uid;
    },

    getgid() {
      return gid;
    },

    geteuid() {
      return uid;
    },

    getegid() {
      return gid;
    },

    exit(code = 0) {
      emitter.emit('exit', code);
      if (options?.onExit) {
        options.onExit(code);
      }
      throw new Error(`Process exited with code ${code}`);
    },

    nextTick(callback, ...args) {
      queueMicrotask(() => callback(...args));
    },

    stdout: createProcessStream(true, (data: string) => {
      if (options?.onStdout) {
        options.onStdout(data);
      } else {
        console.log(data);
      }
      return true;
    }) as ProcessWritableStream,

    stderr: createProcessStream(true, (data: string) => {
      if (options?.onStderr) {
        options.onStderr(data);
      } else {
        console.error(data);
      }
      return true;
    }) as ProcessWritableStream,

    stdin: createProcessStream(false) as ProcessReadableStream,

    hrtime: Object.assign(
      function hrtime(time?: [number, number]): [number, number] {
        const now = performance.now();
        const seconds = Math.floor(now / 1000);
        const nanoseconds = Math.floor((now % 1000) * 1e6);
        if (time) {
          const diffSeconds = seconds - time[0];
          const diffNanos = nanoseconds - time[1];
          return [diffSeconds, diffNanos];
        }
        return [seconds, nanoseconds];
      },
      {
        bigint: (): bigint => BigInt(Math.floor(performance.now() * 1e6)),
      }
    ),

    memoryUsage() {
      // Return mock values since we can't access real memory in browser
      return {
        rss: 50 * 1024 * 1024,
        heapTotal: 30 * 1024 * 1024,
        heapUsed: 20 * 1024 * 1024,
        external: 1 * 1024 * 1024,
        arrayBuffers: 0,
      };
    },

    uptime() {
      return (Date.now() - startTime) / 1000;
    },

    cpuUsage() {
      return { user: 0, system: 0 };
    },

    emitWarning(warning: string | Error, typeOrOptions?: string | { type?: string; code?: string }, code?: string) {
      const msg = warning instanceof Error ? warning.message : warning;
      const type = typeof typeOrOptions === 'string' ? typeOrOptions : typeOrOptions?.type || 'Warning';
      const warnCode = code || (typeof typeOrOptions === 'object' ? typeOrOptions?.code : undefined);
      const prefix = warnCode ? `[${warnCode}] ` : '';
      almostnodeDebugWarn('process', `(node:${proc.pid}) ${type}: ${prefix}${msg}`);
      emitter.emit('warning', warning instanceof Error ? warning : new Error(msg));
    },

    // EventEmitter methods - delegate to emitter but return proc for chaining
    on(event: string, listener: EventListener): Process {
      emitter.on(event, listener);
      return proc;
    },

    once(event: string, listener: EventListener): Process {
      emitter.once(event, listener);
      return proc;
    },

    off(event: string, listener: EventListener): Process {
      emitter.off(event, listener);
      return proc;
    },

    emit(event: string, ...args: unknown[]): boolean {
      return emitter.emit(event, ...args);
    },

    addListener(event: string, listener: EventListener): Process {
      emitter.addListener(event, listener);
      return proc;
    },

    removeListener(event: string, listener: EventListener): Process {
      emitter.removeListener(event, listener);
      return proc;
    },

    removeAllListeners(event?: string): Process {
      emitter.removeAllListeners(event);
      return proc;
    },

    listeners(event: string): EventListener[] {
      return emitter.listeners(event);
    },

    listenerCount(event: string): number {
      return emitter.listenerCount(event);
    },

    prependListener(event: string, listener: EventListener): Process {
      emitter.prependListener(event, listener);
      return proc;
    },

    prependOnceListener(event: string, listener: EventListener): Process {
      emitter.prependOnceListener(event, listener);
      return proc;
    },

    eventNames(): string[] {
      return emitter.eventNames();
    },

    setMaxListeners(n: number): Process {
      emitter.setMaxListeners(n);
      return proc;
    },

    getMaxListeners(): number {
      return emitter.getMaxListeners();
    },
  };

  const enableTty = options?.tty ?? !!(options?.onStdout || options?.onStderr);
  if (enableTty) {
    proc.stdout.isTTY = true;
    proc.stderr.isTTY = true;
  }

  Object.defineProperty(proc, '__almostnodeProcessShim', {
    value: true,
    configurable: true,
  });

  return proc;
}

// Default process instance
export const process = createProcess();

export default process;
