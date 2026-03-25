export interface ProcessEnv {
  [key: string]: string | undefined;
}

type Listener = (...args: unknown[]) => void;

interface ProcessStream {
  isTTY: boolean;
  readable: boolean;
  writable: boolean;
  destroyed: boolean;
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
}

const noop = () => {};

function createProcessStream(): ProcessStream {
  const chain = () => stream;
  const stream: ProcessStream = {
    isTTY: false,
    readable: true,
    writable: true,
    destroyed: false,
    write(_data, _encoding, callback) {
      callback?.();
      return true;
    },
    end(_data, callback) {
      callback?.();
    },
    on: chain,
    once: chain,
    off: chain,
    emit: () => false,
    addListener: chain,
    removeListener: chain,
    removeAllListeners: chain,
    setMaxListeners: chain,
    getMaxListeners: () => 0,
    listenerCount: () => 0,
    listeners: () => [],
    rawListeners: () => [],
    prependListener: chain,
    prependOnceListener: chain,
    eventNames: () => [],
  };
  return stream;
}

const startTime = Date.now();
const stdout = createProcessStream();
const stderr = createProcessStream();
const stdin = createProcessStream();

const processValue = {
  env: {} as ProcessEnv,
  argv: [],
  argv0: "browser",
  execArgv: [],
  execPath: "/usr/bin/node",
  version: "v20.0.0",
  versions: {
    node: "20.0.0",
    v8: "12.0.0",
    uv: "1.0.0",
  },
  pid: 1,
  ppid: 0,
  platform: "browser",
  arch: "wasm32",
  title: "browser",
  browser: true,
  release: { name: "node" },
  cwd: () => "/",
  chdir: (_directory: string) => {
    throw new Error("process.chdir is not supported in the browser");
  },
  exit: (_code?: number): never => {
    throw new Error("process.exit is not supported in the browser");
  },
  nextTick(callback: (...args: unknown[]) => void, ...args: unknown[]) {
    queueMicrotask(() => callback(...args));
  },
  stdout,
  stderr,
  stdin,
  on: () => processValue,
  once: () => processValue,
  off: () => processValue,
  emit: () => false,
  addListener: () => processValue,
  removeListener: () => processValue,
  removeAllListeners: () => processValue,
  setMaxListeners: () => processValue,
  getMaxListeners: () => 0,
  listenerCount: () => 0,
  listeners: () => [] as Listener[],
  rawListeners: () => [] as Listener[],
  prependListener: () => processValue,
  prependOnceListener: () => processValue,
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
};

void noop;

export { processValue as process };
export default processValue;
