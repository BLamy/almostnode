import { EventEmitter } from "../../../../packages/almostnode/src/shims/events.ts";

export interface ProcessEnv {
  [key: string]: string | undefined;
}

function normalizeProcessPath(input: string): string {
  const parts = input.split("/").filter(Boolean);
  const resolved: string[] = [];

  for (const part of parts) {
    if (part === ".") {
      continue;
    }

    if (part === "..") {
      resolved.pop();
      continue;
    }

    resolved.push(part);
  }

  return resolved.length > 0 ? `/${resolved.join("/")}` : "/";
}

function resolveProcessPath(currentDir: string, nextDir: string): string {
  if (!nextDir) {
    return currentDir;
  }

  if (nextDir.startsWith("/")) {
    return normalizeProcessPath(nextDir);
  }

  return normalizeProcessPath(`${currentDir}/${nextDir}`);
}

type Listener = (...args: unknown[]) => void;

interface ProcessStream {
  isTTY: boolean;
  readable: boolean;
  writable: boolean;
  destroyed: boolean;
  columns?: number;
  rows?: number;
  write: (data: string | Uint8Array, encoding?: string, callback?: () => void) => boolean;
  end: (data?: string | Uint8Array, callback?: () => void) => void;
  on: (event: string, listener: Listener) => ProcessStream;
  once: (event: string, listener: Listener) => ProcessStream;
  off: (event: string, listener: Listener) => ProcessStream;
  emit: (event: string, ...args: unknown[]) => boolean;
  addListener: (event: string, listener: Listener) => ProcessStream;
  removeListener: (event: string, listener: Listener) => ProcessStream;
  removeAllListeners: (event?: string) => ProcessStream;
  setMaxListeners: (n: number) => ProcessStream;
  getMaxListeners: () => number;
  listenerCount: (event: string) => number;
  listeners: (event: string) => Listener[];
  rawListeners: (event: string) => Listener[];
  prependListener: (event: string, listener: Listener) => ProcessStream;
  prependOnceListener: (event: string, listener: Listener) => ProcessStream;
  eventNames: () => string[];
  pause: () => ProcessStream;
  resume: () => ProcessStream;
  setEncoding: (encoding: string) => ProcessStream;
  read: () => string | Uint8Array | null;
  setRawMode: (mode: boolean) => ProcessStream;
  ref: () => ProcessStream;
  unref: () => ProcessStream;
  destroy: () => ProcessStream;
  cursorTo: (x: number, y?: number | (() => void), callback?: () => void) => boolean;
  moveCursor: (dx: number, dy: number, callback?: () => void) => boolean;
  clearLine: (dir: number, callback?: () => void) => boolean;
  clearScreenDown: (callback?: () => void) => boolean;
  getColorDepth: () => number;
  hasColors: () => boolean;
}

const noop = () => {};
const DEFAULT_BROWSER_PROCESS_ENV: ProcessEnv = {
  NODE_ENV: "development",
  PATH: "/usr/local/bin:/usr/bin:/bin",
  HOME: "/home/user",
  USER: "user",
  SHELL: "/bin/bash",
  TERM: "xterm-256color",
  COLORTERM: "truecolor",
  FORCE_COLOR: "3",
};

interface BrowserProcess {
  env: ProcessEnv;
  argv: string[];
  argv0: string;
  execArgv: string[];
  execPath: string;
  version: string;
  versions: {
    node: string;
    v8: string;
    uv: string;
  };
  pid: number;
  ppid: number;
  platform: string;
  arch: string;
  title: string;
  browser: boolean;
  release: { name: string };
  cwd: () => string;
  chdir: (directory: string) => void;
  exit: (_code?: number) => never;
  nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) => void;
  stdout: ProcessStream;
  stderr: ProcessStream;
  stdin: ProcessStream;
  on: (event: string, listener: Listener) => BrowserProcess;
  once: (event: string, listener: Listener) => BrowserProcess;
  off: (event: string, listener: Listener) => BrowserProcess;
  emit: (event: string, ...args: unknown[]) => boolean;
  addListener: (event: string, listener: Listener) => BrowserProcess;
  removeListener: (event: string, listener: Listener) => BrowserProcess;
  removeAllListeners: (event?: string) => BrowserProcess;
  setMaxListeners: (n: number) => BrowserProcess;
  getMaxListeners: () => number;
  listenerCount: (event: string) => number;
  listeners: (event: string) => Listener[];
  rawListeners: (event: string) => Listener[];
  prependListener: (event: string, listener: Listener) => BrowserProcess;
  prependOnceListener: (event: string, listener: Listener) => BrowserProcess;
  eventNames: () => string[];
  emitWarning: (warning: string | Error) => void;
  binding: (name: string) => never;
  memoryUsage: () => {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
    arrayBuffers: number;
  };
  uptime: () => number;
  hrtime: ((previous?: [number, number]) => [number, number]) & {
    bigint: () => bigint;
  };
  cpuUsage: () => { user: number; system: number };
  getuid: () => number;
  getgid: () => number;
  geteuid: () => number;
  getegid: () => number;
  umask: () => number;
}

function createProcessStream(options: {
  writable: boolean;
}): ProcessStream {
  const emitter = new EventEmitter();
  const queuedReads: Array<string | Uint8Array> = [];
  const stream: ProcessStream = {
    isTTY: false,
    readable: !options.writable,
    writable: options.writable,
    destroyed: false,
    columns: 80,
    rows: 24,
    write(_data, _encoding, callback) {
      callback?.();
      return true;
    },
    end(_data, callback) {
      callback?.();
    },
    on(event, listener) {
      emitter.on(event, listener);
      return stream;
    },
    once(event, listener) {
      emitter.once(event, listener);
      return stream;
    },
    off(event, listener) {
      emitter.off(event, listener);
      return stream;
    },
    emit(event, ...args) {
      return emitter.emit(event, ...args);
    },
    addListener(event, listener) {
      emitter.addListener(event, listener);
      return stream;
    },
    removeListener(event, listener) {
      emitter.removeListener(event, listener);
      return stream;
    },
    removeAllListeners(event) {
      emitter.removeAllListeners(event);
      return stream;
    },
    setMaxListeners(n) {
      emitter.setMaxListeners(n);
      return stream;
    },
    getMaxListeners() {
      return emitter.getMaxListeners();
    },
    listenerCount(event) {
      return emitter.listenerCount(event);
    },
    listeners(event) {
      return emitter.listeners(event);
    },
    rawListeners(event) {
      return emitter.rawListeners(event);
    },
    prependListener(event, listener) {
      emitter.prependListener(event, listener);
      return stream;
    },
    prependOnceListener(event, listener) {
      emitter.prependOnceListener(event, listener);
      return stream;
    },
    eventNames() {
      return emitter.eventNames() as string[];
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
    read() {
      return queuedReads.length > 0 ? queuedReads.shift() ?? null : null;
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
      emitter.emit("close");
      return stream;
    },
    cursorTo(_x, yOrCallback, callback) {
      const done = typeof yOrCallback === "function" ? yOrCallback : callback;
      done?.();
      return true;
    },
    moveCursor(_dx, _dy, callback) {
      callback?.();
      return true;
    },
    clearLine(_dir, callback) {
      callback?.();
      return true;
    },
    clearScreenDown(callback) {
      callback?.();
      return true;
    },
    getColorDepth() {
      return stream.isTTY ? 24 : 1;
    },
    hasColors() {
      return stream.isTTY;
    },
  };

  Object.defineProperty(stream, "__almostnodePushInput", {
    value: (data: string | Uint8Array) => {
      if (stream.destroyed) return;
      queuedReads.push(data);
      emitter.emit("readable");
    },
    configurable: true,
  });

  return stream;
}

const startTime = Date.now();
let currentDir = "/";

function markManagedProcess(target: BrowserProcess): BrowserProcess {
  Object.defineProperty(target, "__almostnodeProcessShim", {
    value: true,
    configurable: true,
  });
  return target;
}

const fallbackStdout = createProcessStream({ writable: true });
const fallbackStderr = createProcessStream({ writable: true });
const fallbackStdin = createProcessStream({ writable: false });
fallbackStdout.isTTY = true;
fallbackStderr.isTTY = true;
fallbackStdin.isTTY = true;

const fallbackProcess = markManagedProcess({
  env: {
    ...DEFAULT_BROWSER_PROCESS_ENV,
    PWD: currentDir,
  },
  argv: ["node", "/index.js"],
  argv0: "node",
  execArgv: [],
  execPath: "/usr/local/bin/node",
  version: "v20.0.0",
  versions: {
    node: "20.0.0",
    v8: "11.3.244.8",
    uv: "1.44.2",
  },
  pid: 1,
  ppid: 0,
  platform: "linux",
  arch: "x64",
  title: "node",
  browser: false,
  release: { name: "node" },
  cwd: () => currentDir,
  chdir: (directory: string) => {
    currentDir = resolveProcessPath(currentDir, directory);
    fallbackProcess.env.PWD = currentDir;
  },
  exit: (code = 0): never => {
    throw new Error(`Process exited with code ${code}`);
  },
  nextTick(callback: (...args: unknown[]) => void, ...args: unknown[]) {
    queueMicrotask(() => callback(...args));
  },
  stdout: fallbackStdout,
  stderr: fallbackStderr,
  stdin: fallbackStdin,
  on: () => fallbackProcess,
  once: () => fallbackProcess,
  off: () => fallbackProcess,
  emit: () => false,
  addListener: () => fallbackProcess,
  removeListener: () => fallbackProcess,
  removeAllListeners: () => fallbackProcess,
  setMaxListeners: () => fallbackProcess,
  getMaxListeners: () => 0,
  listenerCount: () => 0,
  listeners: () => [] as Listener[],
  rawListeners: () => [] as Listener[],
  prependListener: () => fallbackProcess,
  prependOnceListener: () => fallbackProcess,
  eventNames: () => [] as string[],
  emitWarning(warning: string | Error) {
    console.warn(warning);
  },
  binding(_name: string) {
    throw new Error("process.binding is not supported in the browser");
  },
  memoryUsage: () => ({
    rss: 0,
    heapTotal: 0,
    heapUsed: 0,
    external: 0,
    arrayBuffers: 0,
  }),
  uptime: () => (Date.now() - startTime) / 1000,
  hrtime(previous?: [number, number]): [number, number] {
    const now = performance.now();
    const seconds = Math.floor(now / 1000);
    const nanoseconds = Math.floor((now % 1000) * 1_000_000);
    if (!previous) {
      return [seconds, nanoseconds];
    }

    let diffSeconds = seconds - previous[0];
    let diffNanoseconds = nanoseconds - previous[1];
    if (diffNanoseconds < 0) {
      diffSeconds -= 1;
      diffNanoseconds += 1_000_000_000;
    }
    return [diffSeconds, diffNanoseconds];
  },
  cpuUsage: () => ({ user: 0, system: 0 }),
  getuid: () => 0,
  getgid: () => 0,
  geteuid: () => 0,
  getegid: () => 0,
  umask: () => 0,
});

let processProxy: BrowserProcess;

function isManagedProcess(value: unknown): value is BrowserProcess {
  return Boolean(
    value
      && typeof value === "object"
      && (value as { __almostnodeProcessShim?: boolean }).__almostnodeProcessShim,
  );
}

function resolveProcessTarget(): BrowserProcess {
  const activeProcess = (globalThis as { __almostnodeActiveProcess?: unknown })
    .__almostnodeActiveProcess;
  if (activeProcess && activeProcess !== processProxy && isManagedProcess(activeProcess)) {
    return activeProcess as BrowserProcess;
  }

  const globalProcess = globalThis.process;
  if (globalProcess && globalProcess !== processProxy && isManagedProcess(globalProcess)) {
    return globalProcess as unknown as BrowserProcess;
  }
  return fallbackProcess;
}

processProxy = new Proxy(fallbackProcess as object, {
  get(_target, property, receiver) {
    const target = resolveProcessTarget() as unknown as Record<PropertyKey, unknown>;
    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
  set(_target, property, value, receiver) {
    return Reflect.set(resolveProcessTarget() as unknown as object, property, value, receiver);
  },
  has(_target, property) {
    return Reflect.has(resolveProcessTarget() as unknown as object, property);
  },
  ownKeys() {
    return Reflect.ownKeys(resolveProcessTarget() as unknown as object);
  },
  getOwnPropertyDescriptor(_target, property) {
    const descriptor = Reflect.getOwnPropertyDescriptor(
      resolveProcessTarget() as unknown as object,
      property,
    );
    if (!descriptor) {
      return undefined;
    }
    return {
      ...descriptor,
      configurable: true,
    };
  },
  defineProperty(_target, property, descriptor) {
    return Reflect.defineProperty(resolveProcessTarget() as unknown as object, property, descriptor);
  },
  deleteProperty(_target, property) {
    return Reflect.deleteProperty(resolveProcessTarget() as unknown as object, property);
  },
  getPrototypeOf() {
    return Reflect.getPrototypeOf(resolveProcessTarget() as unknown as object);
  },
  setPrototypeOf(_target, prototype) {
    return Reflect.setPrototypeOf(resolveProcessTarget() as unknown as object, prototype);
  },
}) as BrowserProcess;

export function configureBrowserProcess(options?: {
  cwd?: string;
  env?: ProcessEnv;
}): BrowserProcess {
  if (options?.cwd) {
    currentDir = normalizeProcessPath(options.cwd);
  }

  fallbackProcess.env = {
    ...DEFAULT_BROWSER_PROCESS_ENV,
    ...fallbackProcess.env,
    ...(options?.env || {}),
    PWD: currentDir,
  };

  globalThis.process = processProxy as typeof globalThis.process;
  return processProxy;
}

void noop;

export { processProxy as process };
export default processProxy;
