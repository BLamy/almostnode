import type {
  TailscaleConnectIPN,
  TailscaleConnectStateStorage,
} from '@tailscale/connect';
import tailscaleWasmUrl from '@tailscale/connect/main.wasm?url';
import type {
  NetworkExitNode,
  NetworkFetchRequest,
  NetworkFetchResponse,
  NetworkLookupOptions,
  NetworkLookupResult,
  NetworkOptions,
  TailscaleAdapterStatus,
} from './types';
import { createFsShim, type Stats } from '../shims/fs';
import pathShim from '../shims/path';
import { VirtualFS } from '../virtual-fs';
import type {
  TailscaleWorkerEvent,
  TailscaleWorkerRequestWithId,
} from './tailscale-worker-types';
import {
  createTailscaleSessionStateStore,
  type TailscaleStateSnapshot,
} from './tailscale-session-storage';

type TailscaleConnectState =
  | 'NoState'
  | 'InUseOtherUser'
  | 'NeedsLogin'
  | 'NeedsMachineAuth'
  | 'Stopped'
  | 'Starting'
  | 'Running';

interface TailscaleConnectNode {
  id?: string;
  name: string;
  addresses: string[];
  online?: boolean;
  nodeKey?: string;
  machineKey?: string;
  machineStatus?: string;
  exitNodeOption?: boolean;
}

interface TailscaleConnectNetMap {
  self: TailscaleConnectNode;
  peers: TailscaleConnectNode[];
  lockedOut?: boolean;
  selectedExitNodeId?: string | null;
}

const defaultOptions: Required<NetworkOptions> = {
  provider: 'tailscale',
  authMode: 'interactive',
  useExitNode: false,
  exitNodeId: null,
  corsProxy: null,
};
const TAILSCALE_RUNTIME_ROOT = '/tailscale';
const TAILSCALE_RUNTIME_LOGS_DIR = `${TAILSCALE_RUNTIME_ROOT}/logs`;
const TAILSCALE_RUNTIME_CACHE_DIR = `${TAILSCALE_RUNTIME_ROOT}/cache`;
const TAILSCALE_RUNTIME_TMP_DIR = `${TAILSCALE_RUNTIME_ROOT}/tmp`;
const TAILSCALE_RUNTIME_STDIN_PATH = `${TAILSCALE_RUNTIME_ROOT}/stdin`;
const TAILSCALE_RUNTIME_STDOUT_PATH = `${TAILSCALE_RUNTIME_ROOT}/stdout`;
const TAILSCALE_RUNTIME_STDERR_PATH = `${TAILSCALE_RUNTIME_ROOT}/stderr`;

let options = defaultOptions;
let ipnPromise: Promise<TailscaleConnectIPN> | null = null;
let ipnStartScheduled = false;
let ipnStarted = false;
let tailscaleConnectModulePromise: Promise<typeof import('@tailscale/connect')> | null = null;
let state: TailscaleConnectState = 'NoState';
let netMap: TailscaleConnectNetMap | null = null;
let loginUrl: string | null = null;
let panicError: string | null = null;
let tailscaleRuntimeCwd = TAILSCALE_RUNTIME_ROOT;
const tailscaleStateStorage = createTailscaleSessionStateStore(
  null,
  (snapshot) => {
    const event: TailscaleWorkerEvent = {
      type: 'storageUpdate',
      snapshot,
    };
    self.postMessage(event);
  },
);

const tailscaleRuntimeVfs = new VirtualFS();
tailscaleRuntimeVfs.mkdirSync(TAILSCALE_RUNTIME_ROOT, { recursive: true });
tailscaleRuntimeVfs.mkdirSync(TAILSCALE_RUNTIME_LOGS_DIR, { recursive: true });
tailscaleRuntimeVfs.mkdirSync(TAILSCALE_RUNTIME_CACHE_DIR, { recursive: true });
tailscaleRuntimeVfs.mkdirSync(TAILSCALE_RUNTIME_TMP_DIR, { recursive: true });
tailscaleRuntimeVfs.writeFileSync(TAILSCALE_RUNTIME_STDIN_PATH, new Uint8Array(0));
tailscaleRuntimeVfs.writeFileSync(TAILSCALE_RUNTIME_STDOUT_PATH, new Uint8Array(0));
tailscaleRuntimeVfs.writeFileSync(TAILSCALE_RUNTIME_STDERR_PATH, new Uint8Array(0));

const tailscaleRuntimeFs = createFsShim(
  tailscaleRuntimeVfs,
  () => tailscaleRuntimeCwd,
);
const tailscaleRuntimeFsRecord = tailscaleRuntimeFs as unknown as Record<string, unknown>;
const tailscaleRuntimeFsWithGoMethods = tailscaleRuntimeFs as typeof tailscaleRuntimeFs & {
  close?: (fd: number, callback: (err: Error | null) => void) => void;
  fchmod?: (fd: number, mode: number, callback: (err: Error | null) => void) => void;
  fchown?: (
    fd: number,
    uid: number,
    gid: number,
    callback: (err: Error | null) => void,
  ) => void;
  fsync?: (fd: number, callback: (err: Error | null) => void) => void;
  open?: (
    path: string,
    flags: string | number,
    mode: number,
    callback: (err: Error | null, fd?: number) => void,
  ) => void;
  read?: (
    fd: number,
    buffer: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
    callback: (err: Error | null, bytesRead?: number, buffer?: Uint8Array) => void,
  ) => void;
  write?: (
    fd: number,
    buffer: Uint8Array | string,
    offset: number,
    length: number,
    position: number | null,
    callback: (err: Error | null, written?: number, buffer?: Uint8Array | string) => void,
  ) => void;
};

function queueFsCallback<T extends unknown[]>(
  callback: ((...args: T) => void) | undefined,
  ...args: T
): void {
  if (!callback) {
    return;
  }

  callback(...args);
}

function toFsError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function runFsVoid(
  callback: ((err: Error | null) => void) | undefined,
  fn: () => void,
): void {
  try {
    fn();
    queueFsCallback(callback, null);
  } catch (error) {
    queueFsCallback(callback, toFsError(error));
  }
}

function runFsValue<T>(
  callback: ((err: Error | null, value?: T) => void) | undefined,
  fn: () => T,
): void {
  try {
    queueFsCallback(callback, null, fn());
  } catch (error) {
    queueFsCallback(callback, toFsError(error));
  }
}

function getStdioStats(fd: number): Stats {
  switch (fd) {
    case 0:
      return tailscaleRuntimeVfs.statSync(TAILSCALE_RUNTIME_STDIN_PATH);
    case 1:
      return tailscaleRuntimeVfs.statSync(TAILSCALE_RUNTIME_STDOUT_PATH);
    case 2:
      return tailscaleRuntimeVfs.statSync(TAILSCALE_RUNTIME_STDERR_PATH);
    default:
      return tailscaleRuntimeFs.fstatSync(fd);
  }
}

function decodeStdioChunk(
  buffer: Uint8Array | string,
  offset?: number,
  length?: number,
): string {
  if (typeof buffer === 'string') {
    return buffer;
  }

  const start = offset ?? 0;
  const end = start + (length ?? (buffer.length - start));
  return new TextDecoder().decode(buffer.slice(start, end));
}

const tailscaleRuntimeWriteSync = tailscaleRuntimeFs.writeSync.bind(
  tailscaleRuntimeFs,
);
tailscaleRuntimeFs.writeSync = ((fd, buffer, offset, length, position) => {
  if (fd === 1 || fd === 2) {
    const text = decodeStdioChunk(
      buffer as Uint8Array | string,
      offset,
      length,
    );
    if (text) {
      if (fd === 2) {
        console.error(text);
      } else {
        console.log(text);
      }
    }
    return typeof buffer === 'string' ? buffer.length : length ?? buffer.length;
  }

  return tailscaleRuntimeWriteSync(fd, buffer, offset, length, position);
}) as typeof tailscaleRuntimeFs.writeSync;

tailscaleRuntimeFsWithGoMethods.open = ((
  path,
  flags,
  mode,
  callback,
) => {
  try {
    const fd = tailscaleRuntimeFs.openSync(path, flags, mode);
    queueFsCallback(callback, null, fd);
  } catch (error) {
    queueFsCallback(
      callback,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}) as NonNullable<typeof tailscaleRuntimeFsWithGoMethods.open>;

tailscaleRuntimeFsWithGoMethods.close = ((
  fd,
  callback,
) => {
  try {
    if (fd !== 0 && fd !== 1 && fd !== 2) {
      tailscaleRuntimeFs.closeSync(fd);
    }
    queueFsCallback(callback, null);
  } catch (error) {
    queueFsCallback(
      callback,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}) as NonNullable<typeof tailscaleRuntimeFsWithGoMethods.close>;

tailscaleRuntimeFsWithGoMethods.read = ((
  fd,
  buffer,
  offset,
  length,
  position,
  callback,
) => {
  try {
    const bytesRead =
      fd === 0
        ? 0
        : tailscaleRuntimeFs.readSync(fd, buffer, offset, length, position);
    queueFsCallback(callback, null, bytesRead, buffer);
  } catch (error) {
    queueFsCallback(
      callback,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}) as NonNullable<typeof tailscaleRuntimeFsWithGoMethods.read>;

tailscaleRuntimeFsWithGoMethods.write = ((
  fd,
  buffer,
  offset,
  length,
  position,
  callback,
) => {
  if (fd === 1 || fd === 2) {
    try {
      const text = decodeStdioChunk(
        buffer as Uint8Array | string,
        offset,
        length,
      );
      if (text) {
        if (fd === 2) {
          console.error(text);
        } else {
          console.log(text);
        }
      }
      const written =
        typeof buffer === 'string' ? buffer.length : length ?? buffer.length;
      queueFsCallback(callback, null, written, buffer);
    } catch (error) {
      queueFsCallback(
        callback,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    return;
  }

  try {
    const written = tailscaleRuntimeFs.writeSync(
      fd,
      buffer,
      offset,
      length,
      position,
    );
    queueFsCallback(callback, null, written, buffer);
  } catch (error) {
    queueFsCallback(
      callback,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}) as NonNullable<typeof tailscaleRuntimeFsWithGoMethods.write>;

tailscaleRuntimeFsWithGoMethods.fsync = ((
  fd,
  callback,
) => {
  try {
    tailscaleRuntimeFs.fsyncSync(fd);
    queueFsCallback(callback, null);
  } catch (error) {
    queueFsCallback(
      callback,
      error instanceof Error ? error : new Error(String(error)),
    );
  }
}) as NonNullable<typeof tailscaleRuntimeFsWithGoMethods.fsync>;

tailscaleRuntimeFsWithGoMethods.fchmod = ((
  _fd,
  _mode,
  callback,
) => {
  queueFsCallback(callback, null);
}) as NonNullable<typeof tailscaleRuntimeFsWithGoMethods.fchmod>;

tailscaleRuntimeFsWithGoMethods.fchown = ((
  _fd,
  _uid,
  _gid,
  callback,
) => {
  queueFsCallback(callback, null);
}) as NonNullable<typeof tailscaleRuntimeFsWithGoMethods.fchown>;

tailscaleRuntimeFsRecord.fstat = (
  fd: number,
  callback: ((err: Error | null, stats?: Stats) => void) | undefined,
) => {
  runFsValue(callback, () => getStdioStats(fd));
};

tailscaleRuntimeFsRecord.stat = (
  path: string,
  callback: ((err: Error | null, stats?: Stats) => void) | undefined,
) => {
  runFsValue(callback, () => tailscaleRuntimeFs.statSync(path));
};

tailscaleRuntimeFsRecord.lstat = (
  path: string,
  callback: ((err: Error | null, stats?: Stats) => void) | undefined,
) => {
  runFsValue(callback, () => tailscaleRuntimeFs.lstatSync(path));
};

tailscaleRuntimeFsRecord.readdir = (
  path: string,
  callback: ((err: Error | null, files?: string[]) => void) | undefined,
) => {
  runFsValue(callback, () => tailscaleRuntimeFs.readdirSync(path) as string[]);
};

tailscaleRuntimeFsRecord.mkdir = (
  path: string,
  options: { recursive?: boolean; mode?: number } | number | undefined,
  callback: ((err: Error | null) => void) | undefined,
) => {
  const resolvedCallback =
    typeof options === 'function'
      ? (options as unknown as (err: Error | null) => void)
      : callback;
  const mkdirOptions =
    typeof options === 'object' && options !== null
      ? options
      : undefined;
  runFsVoid(resolvedCallback, () => {
    tailscaleRuntimeFs.mkdirSync(path, mkdirOptions);
  });
};

tailscaleRuntimeFsRecord.unlink = (
  path: string,
  callback: ((err: Error | null) => void) | undefined,
) => {
  runFsVoid(callback, () => {
    tailscaleRuntimeFs.unlinkSync(path);
  });
};

tailscaleRuntimeFsRecord.rmdir = (
  path: string,
  callback: ((err: Error | null) => void) | undefined,
) => {
  runFsVoid(callback, () => {
    tailscaleRuntimeFs.rmdirSync(path);
  });
};

tailscaleRuntimeFsRecord.rename = (
  from: string,
  to: string,
  callback: ((err: Error | null) => void) | undefined,
) => {
  runFsVoid(callback, () => {
    tailscaleRuntimeFs.renameSync(from, to);
  });
};

tailscaleRuntimeFsRecord.readlink = (
  path: string,
  callback: ((err: Error | null, linkString?: string) => void) | undefined,
) => {
  runFsValue(callback, () => tailscaleRuntimeFs.readlinkSync(path));
};

tailscaleRuntimeFsRecord.realpath = (
  path: string,
  callback: ((err: Error | null, resolvedPath?: string) => void) | undefined,
) => {
  runFsValue(callback, () => tailscaleRuntimeFs.realpathSync(path));
};

tailscaleRuntimeFsRecord.access = (
  path: string,
  mode: number | ((err: Error | null) => void) | undefined,
  callback: ((err: Error | null) => void) | undefined,
) => {
  const resolvedCallback =
    typeof mode === 'function'
      ? mode
      : callback;
  const accessMode = typeof mode === 'number' ? mode : undefined;
  runFsVoid(resolvedCallback, () => {
    tailscaleRuntimeFs.accessSync(path, accessMode);
  });
};

tailscaleRuntimeFsRecord.truncate = (
  path: string,
  length: number | ((err: Error | null) => void) | undefined,
  callback: ((err: Error | null) => void) | undefined,
) => {
  const resolvedCallback =
    typeof length === 'function'
      ? length
      : callback;
  const truncateLength = typeof length === 'number' ? length : 0;
  runFsVoid(resolvedCallback, () => {
    tailscaleRuntimeFs.truncateSync(path, truncateLength);
  });
};

tailscaleRuntimeFsRecord.ftruncate = (
  fd: number,
  length: number | ((err: Error | null) => void) | undefined,
  callback: ((err: Error | null) => void) | undefined,
) => {
  const resolvedCallback =
    typeof length === 'function'
      ? length
      : callback;
  const truncateLength = typeof length === 'number' ? length : 0;
  runFsVoid(resolvedCallback, () => {
    tailscaleRuntimeFs.ftruncateSync(fd, truncateLength);
  });
};

tailscaleRuntimeFsRecord.chmod = (
  path: string,
  mode: number,
  callback: ((err: Error | null) => void) | undefined,
) => {
  runFsVoid(callback, () => {
    tailscaleRuntimeFs.chmodSync(path, mode);
  });
};

tailscaleRuntimeFsRecord.chown = (
  path: string,
  uid: number,
  gid: number,
  callback: ((err: Error | null) => void) | undefined,
) => {
  runFsVoid(callback, () => {
    tailscaleRuntimeFs.chownSync(path, uid, gid);
  });
};

tailscaleRuntimeFsRecord.utimes = (
  path: string,
  atime: string | number | Date,
  mtime: string | number | Date,
  callback: ((err: Error | null) => void) | undefined,
) => {
  runFsVoid(callback, () => {
    tailscaleRuntimeFs.utimesSync(path, atime, mtime);
  });
};

tailscaleRuntimeFsRecord.link = (
  existingPath: string,
  newPath: string,
  callback: ((err: Error | null) => void) | undefined,
) => {
  runFsVoid(callback, () => {
    tailscaleRuntimeFs.linkSync(existingPath, newPath);
  });
};

tailscaleRuntimeFsRecord.symlink = (
  target: string,
  path: string,
  type: string | ((err: Error | null) => void) | undefined,
  callback: ((err: Error | null) => void) | undefined,
) => {
  const resolvedCallback =
    typeof type === 'function'
      ? type
      : callback;
  const linkType = typeof type === 'string' ? type : undefined;
  runFsVoid(resolvedCallback, () => {
    tailscaleRuntimeFs.symlinkSync(target, path, linkType);
  });
};

tailscaleRuntimeFsRecord.lchown = (
  _path: string,
  _uid: number,
  _gid: number,
  callback: ((err: Error | null) => void) | undefined,
) => {
  queueFsCallback(callback, null);
};

tailscaleRuntimeFsRecord.fdatasync = (
  fd: number,
  callback: ((err: Error | null) => void) | undefined,
) => {
  runFsVoid(callback, () => {
    tailscaleRuntimeFs.fdatasyncSync(fd);
  });
};

interface TailscaleConnectGoRuntime {
  env?: Record<string, string>;
}

interface TailscaleConnectBootstrapConfig {
  authKey: string;
  hostname: string;
  stateStorage: TailscaleConnectStateStorage;
  useExitNode: boolean;
  exitNodeId: string | null;
  wasmURL?: string;
  panicHandler: (error: string) => void;
}

function overrideGlobalProperty<K extends PropertyKey>(
  key: K,
  value: unknown,
): () => void {
  const target = globalThis as Record<PropertyKey, unknown>;
  const descriptor = Object.getOwnPropertyDescriptor(target, key);

  Object.defineProperty(target, key, {
    value,
    configurable: true,
    writable: true,
  });

  return () => {
    if (descriptor) {
      Object.defineProperty(target, key, descriptor);
      return;
    }
    delete target[key];
  };
}

async function loadTailscaleConnectModule(): Promise<typeof import('@tailscale/connect')> {
  if (!tailscaleConnectModulePromise) {
    tailscaleConnectModulePromise = (async () => {
      // The Tailscale bundle treats any navigator-bearing environment as a
      // windowed browser and eagerly touches document/window during module init.
      // Force worker mode for the import so createIPN can run inside a Worker.
      // Also clear Node-ish globals long enough for wasm_exec to install the
      // stubs it expects instead of inheriting browser polyfills from Vite.
      const restoreNavigator = overrideGlobalProperty('navigator', undefined);
      overrideGlobalProperty('process', undefined);
      overrideGlobalProperty('fs', undefined);
      overrideGlobalProperty('path', undefined);
      try {
        return await import('@tailscale/connect');
      } finally {
        restoreNavigator();
      }
    })();
  }

  return tailscaleConnectModulePromise;
}

function getTailscaleGoRuntimeConstructor():
  | (new () => TailscaleConnectGoRuntime)
  | null {
  const value = (globalThis as { Go?: new () => TailscaleConnectGoRuntime }).Go;
  return typeof value === 'function' ? value : null;
}

function installTailscaleRuntimeGlobals(): void {
  const processValue = {
    env: {
      HOME: TAILSCALE_RUNTIME_ROOT,
      TMPDIR: TAILSCALE_RUNTIME_TMP_DIR,
      TS_LOGS_DIR: TAILSCALE_RUNTIME_LOGS_DIR,
      XDG_CACHE_HOME: TAILSCALE_RUNTIME_CACHE_DIR,
    },
    argv: ['tailscale-connect-worker'],
    pid: 1,
    ppid: 0,
    cwd: () => tailscaleRuntimeCwd,
    chdir: (nextPath: string) => {
      tailscaleRuntimeCwd = pathShim.resolve(nextPath);
      tailscaleRuntimeVfs.mkdirSync(tailscaleRuntimeCwd, { recursive: true });
    },
    getuid: () => -1,
    getgid: () => -1,
    geteuid: () => -1,
    getegid: () => -1,
    getgroups: () => [],
    umask: () => 0,
  };

  (globalThis as unknown as { process?: typeof processValue }).process = processValue;
  (globalThis as unknown as { fs?: typeof tailscaleRuntimeFs }).fs = tailscaleRuntimeFs;
  (globalThis as unknown as { path?: typeof pathShim }).path = pathShim;
}

async function createWorkerIpn(
  config: TailscaleConnectBootstrapConfig,
): Promise<TailscaleConnectIPN> {
  const tailscaleConnect = await loadTailscaleConnectModule();
  installTailscaleRuntimeGlobals();

  const GoRuntime = getTailscaleGoRuntimeConstructor();
  if (!GoRuntime) {
    throw new Error('Tailscale Go runtime failed to initialize.');
  }

  const AlmostnodeTailscaleGo = class extends GoRuntime {
    constructor() {
      super();
      this.env = {
        ...(this.env || {}),
        HOME: TAILSCALE_RUNTIME_ROOT,
        TMPDIR: TAILSCALE_RUNTIME_TMP_DIR,
        TS_LOGS_DIR: TAILSCALE_RUNTIME_LOGS_DIR,
        XDG_CACHE_HOME: TAILSCALE_RUNTIME_CACHE_DIR,
      };
    }
  };

  const restoreGo = overrideGlobalProperty('Go', AlmostnodeTailscaleGo);
  try {
    const ipn = await tailscaleConnect.createIPN({
      authKey: config.authKey,
      hostname: config.hostname,
      stateStorage: config.stateStorage,
      useExitNode: config.useExitNode,
      exitNodeId: config.exitNodeId,
      wasmURL: config.wasmURL ?? tailscaleWasmUrl,
      panicHandler: config.panicHandler,
    });
    return ipn;
  } finally {
    restoreGo();
  }
}

function extractTailnetName(name?: string | null): string | null {
  if (!name) {
    return null;
  }
  const segments = name.split('.');
  if (segments.length <= 1) {
    return null;
  }
  return segments.slice(1).join('.');
}

function extractExitNodes(currentNetMap: TailscaleConnectNetMap | null): NetworkExitNode[] {
  if (!currentNetMap) {
    return [];
  }

  const selectedExitNodeId = currentNetMap.selectedExitNodeId ?? null;
  return currentNetMap.peers
    .filter((peer) => peer.exitNodeOption && peer.id)
    .map((peer) => ({
      id: peer.id as string,
      name: peer.name,
      online: Boolean(peer.online),
      selected: peer.id === selectedExitNodeId,
    }))
    .sort((left, right) => {
      if (left.selected !== right.selected) {
        return left.selected ? -1 : 1;
      }
      if (left.online !== right.online) {
        return left.online ? -1 : 1;
      }
      return left.name.localeCompare(right.name);
    });
}

function mapState(): TailscaleAdapterStatus {
  const exitNodes = extractExitNodes(netMap);
  const selectedExitNodeId = netMap?.selectedExitNodeId ?? null;

  if (panicError) {
    return {
      state: 'error',
      exitNodes,
      selectedExitNodeId,
      detail: panicError,
      loginUrl,
    };
  }

  if (netMap?.lockedOut) {
    return {
      state: 'locked',
      exitNodes,
      selectedExitNodeId,
      detail: 'Tailnet lock approval required for this device.',
      loginUrl,
      selfName: netMap.self?.name || null,
      tailnetName: extractTailnetName(netMap.self?.name),
    };
  }

  switch (state) {
    case 'NeedsLogin':
      return {
        state: 'needs-login',
        exitNodes,
        selectedExitNodeId,
        loginUrl,
        selfName: netMap?.self?.name || null,
        tailnetName: extractTailnetName(netMap?.self?.name),
      };
    case 'NeedsMachineAuth':
      return {
        state: 'needs-machine-auth',
        exitNodes,
        selectedExitNodeId,
        detail: 'A tailnet administrator must approve this device.',
        loginUrl,
        selfName: netMap?.self?.name || null,
        tailnetName: extractTailnetName(netMap?.self?.name),
      };
    case 'Running':
      return {
        state: 'running',
        exitNodes,
        selectedExitNodeId,
        loginUrl,
        selfName: netMap?.self?.name || null,
        tailnetName: extractTailnetName(netMap?.self?.name),
      };
    case 'Starting':
      return {
        state: 'starting',
        exitNodes,
        selectedExitNodeId,
        detail: 'Starting Tailscale session.',
        loginUrl,
        selfName: netMap?.self?.name || null,
        tailnetName: extractTailnetName(netMap?.self?.name),
      };
    case 'Stopped':
      return {
        state: 'stopped',
        exitNodes,
        selectedExitNodeId,
        loginUrl,
        selfName: netMap?.self?.name || null,
        tailnetName: extractTailnetName(netMap?.self?.name),
      };
    case 'InUseOtherUser':
      return {
        state: 'error',
        exitNodes,
        selectedExitNodeId,
        detail: 'The Tailscale session is in use by a different user.',
        loginUrl,
      };
    case 'NoState':
    default:
      return {
        state: 'needs-login',
        exitNodes,
        selectedExitNodeId,
        loginUrl,
        selfName: netMap?.self?.name || null,
        tailnetName: extractTailnetName(netMap?.self?.name),
      };
  }
}

function handleIpnError(error: unknown): void {
  panicError = error instanceof Error ? error.message : String(error);
  emitStatus();
}

function emitStatus(): void {
  const event: TailscaleWorkerEvent = {
    type: 'status',
    status: mapState(),
  };
  self.postMessage(event);
}

function createIpnCallbacks(): Parameters<TailscaleConnectIPN['run']>[0] {
  return {
    notifyState: (nextState) => {
      state = nextState as TailscaleConnectState;
      emitStatus();
    },
    notifyNetMap: (netMapStr) => {
      try {
        netMap = JSON.parse(netMapStr) as TailscaleConnectNetMap;
      } catch {
        netMap = null;
      }
      emitStatus();
    },
    notifyBrowseToURL: (url) => {
      loginUrl = url;
      emitStatus();
    },
    notifyPanicRecover: (error) => {
      panicError = error;
      emitStatus();
    },
  };
}

function ensureIpnStarted(ipn: TailscaleConnectIPN): void {
  if (ipnStarted || ipnStartScheduled) {
    return;
  }

  ipnStartScheduled = true;
  setTimeout(() => {
    ipnStartScheduled = false;
    if (ipnStarted) {
      return;
    }

    ipnStarted = true;
    try {
      ipn.run(createIpnCallbacks());
    } catch (error) {
      ipnStarted = false;
      handleIpnError(error);
    }
  }, 0);
}

function hydrateStateStorage(snapshot: TailscaleStateSnapshot | null): void {
  tailscaleStateStorage.replace(snapshot);
}

function isIPv4(address: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(address);
}

function isIPv6(address: string): boolean {
  return address.includes(':');
}

function normalizeName(input: string): string {
  return input.trim().toLowerCase().replace(/\.$/, '');
}

function collectLookupAddresses(
  hostname: string,
  lookupOptions?: NetworkLookupOptions,
): NetworkLookupResult | null {
  if (!netMap) {
    return null;
  }

  const normalizedHost = normalizeName(hostname);
  const candidates = [netMap.self, ...netMap.peers];
  const node = candidates.find((entry) => {
    const normalizedName = normalizeName(entry.name);
    if (normalizedName === normalizedHost) {
      return true;
    }

    const shortName = normalizedName.split('.')[0];
    return shortName === normalizedHost;
  });

  if (!node) {
    return null;
  }

  const requestedFamily = lookupOptions?.family;
  const addresses = node.addresses
    .filter((address) => {
      if (requestedFamily === 4) {
        return isIPv4(address);
      }
      if (requestedFamily === 6) {
        return isIPv6(address);
      }
      return isIPv4(address) || isIPv6(address);
    })
    .map((address) => ({
      address,
      family: (isIPv6(address) ? 6 : 4) as 4 | 6,
    }));

  return {
    hostname,
    addresses,
  };
}

function encodeTextBody(text: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(text, 'utf8').toString('base64');
  }
  return btoa(unescape(encodeURIComponent(text)));
}

async function ensureIpn(): Promise<TailscaleConnectIPN> {
  if (!ipnPromise) {
    ipnPromise = createWorkerIpn({
      authKey: '',
      hostname: `almostnode-${Math.random().toString(36).slice(2, 8)}`,
      stateStorage: tailscaleStateStorage as TailscaleConnectStateStorage,
      useExitNode: options.useExitNode,
      exitNodeId: options.exitNodeId,
      wasmURL: tailscaleWasmUrl,
      panicHandler: (error: string) => {
        panicError = error;
        emitStatus();
      },
    })
      .then((ipn) => {
        if (!ipn || typeof ipn.run !== 'function') {
          throw new Error('Tailscale IPN initialization failed.');
        }
        emitStatus();
        return ipn;
      })
      .catch((error) => {
        handleIpnError(error);
        ipnPromise = null;
        throw error;
      });
  }

  return ipnPromise;
}

async function handleFetch(
  request: NetworkFetchRequest,
): Promise<NetworkFetchResponse> {
  const ipn = await ensureIpn();
  const response = await ipn.fetch({
    url: request.url,
    method: request.method,
    headers: request.headers,
    bodyBase64: request.bodyBase64,
    redirect: request.redirect === 'manual' || request.redirect === 'error'
      ? request.redirect
      : 'follow',
  });
  const bodyBase64 = response.bodyBase64 || encodeTextBody(await response.text());

  return {
    url: response.url || request.url,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers || {},
    bodyBase64,
  };
}

async function handleLookup(
  hostname: string,
  lookupOptions?: NetworkLookupOptions,
): Promise<NetworkLookupResult> {
  await ensureIpn();

  if (isIPv4(hostname)) {
    return {
      hostname,
      addresses: [{ address: hostname, family: 4 }],
    };
  }

  if (isIPv6(hostname)) {
    return {
      hostname,
      addresses: [{ address: hostname, family: 6 }],
    };
  }

  const fromNetMap = collectLookupAddresses(hostname, lookupOptions);
  if (fromNetMap && fromNetMap.addresses.length > 0) {
    return fromNetMap;
  }

  throw new Error(`Tailscale peer not found for '${hostname}'.`);
}

type TailscaleWorkerResponseValue = Extract<
  TailscaleWorkerEvent,
  { type: 'response'; ok: true }
>['value'];

function sendResponse(id: number, ok: true, value: TailscaleWorkerResponseValue): void;
function sendResponse(id: number, ok: false, error: string): void;
function sendResponse(id: number, ok: boolean, valueOrError: unknown): void {
  const message: TailscaleWorkerEvent = ok
    ? {
        type: 'response',
        id,
        ok: true,
        value: valueOrError as TailscaleWorkerResponseValue,
      }
    : {
        type: 'response',
        id,
        ok: false,
        error: String(valueOrError),
      };
  self.postMessage(message);
}

self.addEventListener('message', async (event: MessageEvent<TailscaleWorkerRequestWithId>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'hydrateStorage':
        hydrateStateStorage(request.snapshot);
        sendResponse(request.id, true, null);
        break;
      case 'configure':
        options = request.options;
        if (ipnPromise) {
          const ipn = await ipnPromise;
          await ipn.configure({
            useExitNode: options.useExitNode,
            exitNodeId: options.exitNodeId,
          });
          emitStatus();
        }
        sendResponse(request.id, true, null);
        break;
      case 'getStatus':
        if (options.provider === 'tailscale') {
          const ipn = await ensureIpn();
          ensureIpnStarted(ipn);
        }
        sendResponse(request.id, true, mapState());
        break;
      case 'login': {
        const ipn = await ensureIpn();
        sendResponse(request.id, true, mapState());
        ensureIpnStarted(ipn);
        setTimeout(() => {
          try {
            ipn.login();
          } catch (error) {
            handleIpnError(error);
          }
        }, 0);
        break;
      }
      case 'logout':
        if (ipnPromise) {
          const ipn = await ipnPromise;
          ipn.logout();
        }
        state = 'NeedsLogin';
        loginUrl = null;
        tailscaleStateStorage.clear();
        emitStatus();
        sendResponse(request.id, true, mapState());
        break;
      case 'fetch':
        sendResponse(request.id, true, await handleFetch(request.request));
        break;
      case 'lookup':
        sendResponse(
          request.id,
          true,
          await handleLookup(request.hostname, request.options),
        );
        break;
    }
  } catch (error) {
    sendResponse(
      request.id,
      false,
      error instanceof Error ? error.message : String(error),
    );
  }
});
