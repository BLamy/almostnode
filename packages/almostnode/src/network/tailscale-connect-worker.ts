import type {
  TailscaleConnectIPN,
  TailscaleConnectStateStorage,
} from '@tailscale/connect';
import tailscaleWasmUrl from '@tailscale/connect/main.wasm?url';
import { almostnodeDebugError, almostnodeDebugLog, almostnodeDebugWarn } from '../utils/debug';
import { NETWORK_DIAGNOSTIC_FAILURE_BUCKETS } from './types';
import type {
  NetworkDiagnosticsCounters,
  NetworkDiagnosticsFailureBucket,
  NetworkDiagnosticsFailureEntry,
  NetworkDiagnosticsRequestShape,
  NetworkDiagnosticsSnapshot,
  NetworkExitNode,
  NetworkFetchRequest,
  NetworkFetchResponse,
  NetworkLookupOptions,
  NetworkLookupResult,
  NetworkOptions,
  ResolvedNetworkOptions,
  TailscaleAdapterStatus,
} from './types';
import { createFsShim, type Stats } from '../shims/fs';
import pathShim from '../shims/path';
import { VirtualFS } from '../virtual-fs';
import type {
  TailscaleWorkerErrorCode,
  TailscaleWorkerErrorDebug,
  TailscaleWorkerErrorPayload,
  TailscaleWorkerEvent,
  TailscaleWorkerRequestWithId,
} from './tailscale-worker-types';
import {
  createTailscaleSessionStateStore,
  type TailscaleStateSnapshot,
} from './tailscale-session-storage';
import {
  installTailscaleRuntimeCertificates,
  withTailscaleCertificateEnv,
} from './tailscale-runtime-certificates';

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

interface TailscaleBridgeCapabilities {
  canLookup: boolean;
  canReconfigure: boolean;
  canStructuredFetch: boolean;
}

class ClassifiedTailscaleWorkerError extends Error {
  readonly code: TailscaleWorkerErrorCode;
  readonly debug?: TailscaleWorkerErrorDebug;

  constructor(
    code: TailscaleWorkerErrorCode,
    message: string,
    debug?: TailscaleWorkerErrorDebug,
  ) {
    super(message);
    this.name = 'ClassifiedTailscaleWorkerError';
    this.code = code;
    this.debug = debug;
  }
}

const defaultOptions: ResolvedNetworkOptions = {
  provider: 'tailscale',
  authMode: 'interactive',
  useExitNode: false,
  exitNodeId: null,
  acceptDns: true,
  corsProxy: null,
  proxy: {
    httpUrl: null,
    httpsUrl: null,
    noProxy: null,
    caBundlePem: null,
  },
  tailscaleConnected: false,
};
const TAILSCALE_DEFAULT_DNS_IP = '100.100.100.100';
const TAILSCALE_DEFAULT_DNS_IPV6 = 'fd7a:115c:a1e0::53';
const PUBLIC_DNS_JSON_ENDPOINT = 'https://cloudflare-dns.com/dns-query';
const TAILSCALE_RUNTIME_ROOT = '/tailscale';
const TAILSCALE_RUNTIME_LOGS_DIR = `${TAILSCALE_RUNTIME_ROOT}/logs`;
const TAILSCALE_RUNTIME_CACHE_DIR = `${TAILSCALE_RUNTIME_ROOT}/cache`;
const TAILSCALE_RUNTIME_TMP_DIR = `${TAILSCALE_RUNTIME_ROOT}/tmp`;
const TAILSCALE_RUNTIME_STDIN_PATH = `${TAILSCALE_RUNTIME_ROOT}/stdin`;
const TAILSCALE_RUNTIME_STDOUT_PATH = `${TAILSCALE_RUNTIME_ROOT}/stdout`;
const TAILSCALE_RUNTIME_STDERR_PATH = `${TAILSCALE_RUNTIME_ROOT}/stderr`;
const DIAGNOSTIC_RECENT_FAILURE_LIMIT = 20;

let options = defaultOptions;
let ipnPromise: Promise<TailscaleConnectIPN> | null = null;
let ipnStartScheduled = false;
let ipnStarted = false;
let ipnStartPromise: Promise<void> | null = null;
let ipnGeneration = 0;
let ipnResetCount = 0;
let lastRuntimeResetReason: string | null = null;
let tailscaleConnectModulePromise: Promise<typeof import('@tailscale/connect')> | null = null;
let state: TailscaleConnectState = 'NoState';
let netMap: TailscaleConnectNetMap | null = null;
let loginUrl: string | null = null;
let panicError: string | null = null;
let recoveringFromRuntimeFailure = false;
let dnsHealthy: boolean | null = null;
let dnsDetail: string | null = null;
let lastRuntimeFailureSignal:
  | { message: string; seenAt: number }
  | null = null;
let tailscaleRuntimeCwd = TAILSCALE_RUNTIME_ROOT;
let allowSnapshotClear = false;
const fetchIpMap = new Map<string, string>();
let diagnosticsCounters = createEmptyDiagnosticsCounters();
let diagnosticFailureBuckets = createEmptyFailureBuckets();
const recentDiagnosticFailures: NetworkDiagnosticsFailureEntry[] = [];
const tailscaleStateStorageInner = createTailscaleSessionStateStore(
  null,
  (snapshot) => {
    if (snapshot === null) {
      if (!allowSnapshotClear) {
        return;
      }
      allowSnapshotClear = false;
    }

    const event: TailscaleWorkerEvent = {
      type: 'storageUpdate',
      snapshot,
    };
    self.postMessage(event);
  },
);

/**
 * Wrapper around the state store that intercepts Go's setState writes for
 * profile keys.  When Go writes profile prefs (e.g. after a control-server
 * login handshake), it may reset CorpDNS to false.  We force it back to
 * true so the Go DNS resolver has upstream resolvers configured — without
 * this, hostname-based fetch through the Tailscale WASM panics with
 * `ValueOf: invalid value` because Go's DNS fails and creates an
 * un-serializable error.
 */
const tailscaleStateStorage = {
  getState(id: string): string {
    return tailscaleStateStorageInner.getState(id);
  },
  setState(id: string, value: string): void {
    if (id.startsWith('profile-') && value && getEffectiveAcceptDns(options)) {
      try {
        const decoded = hexToString(value);
        const prefs = JSON.parse(decoded);
        if (typeof prefs === 'object' && prefs !== null) {
          let patched = false;
          if (prefs.CorpDNS === false) {
            prefs.CorpDNS = true;
            patched = true;
          }
          if (options.useExitNode && prefs.RouteAll === false) {
            prefs.RouteAll = true;
            patched = true;
          }
          if (patched) {
            value = stringToHex(JSON.stringify(prefs, null, '\t'));
          }
        }
      } catch {
        // Not a JSON profile entry — pass through unchanged.
      }
    }
    tailscaleStateStorageInner.setState(id, value);
  },
  clear(): void {
    tailscaleStateStorageInner.clear();
  },
  replace(snapshot: TailscaleStateSnapshot | null): void {
    tailscaleStateStorageInner.replace(snapshot);
  },
  snapshot(): TailscaleStateSnapshot | null {
    return tailscaleStateStorageInner.snapshot();
  },
};

function hasHydratedStateStorageSnapshot(): boolean {
  const snapshot = tailscaleStateStorage.snapshot();
  return Boolean(snapshot && Object.keys(snapshot).length > 0);
}

function getEffectiveAcceptDns(
  nextOptions: Pick<NetworkOptions, 'acceptDns' | 'useExitNode'>,
): boolean {
  // In the browser runtime there is no host OS resolver to fall back to when
  // public traffic is forced through an exit node. Treat exit-node mode as
  // requiring Tailscale-managed DNS so the engine always has upstreams.
  return Boolean(nextOptions.acceptDns) || Boolean(nextOptions.useExitNode);
}

const tailscaleRuntimeVfs = new VirtualFS();
tailscaleRuntimeVfs.mkdirSync(TAILSCALE_RUNTIME_ROOT, { recursive: true });
tailscaleRuntimeVfs.mkdirSync(TAILSCALE_RUNTIME_LOGS_DIR, { recursive: true });
tailscaleRuntimeVfs.mkdirSync(TAILSCALE_RUNTIME_CACHE_DIR, { recursive: true });
tailscaleRuntimeVfs.mkdirSync(TAILSCALE_RUNTIME_TMP_DIR, { recursive: true });
tailscaleRuntimeVfs.writeFileSync(TAILSCALE_RUNTIME_STDIN_PATH, new Uint8Array(0));
tailscaleRuntimeVfs.writeFileSync(TAILSCALE_RUNTIME_STDOUT_PATH, new Uint8Array(0));
tailscaleRuntimeVfs.writeFileSync(TAILSCALE_RUNTIME_STDERR_PATH, new Uint8Array(0));
installTailscaleRuntimeCertificates(tailscaleRuntimeVfs);

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

function createEmptyDiagnosticsCounters(): NetworkDiagnosticsCounters {
  return {
    totalFetches: 0,
    publicFetches: 0,
    tailnetFetches: 0,
    structuredFetches: 0,
    directIpFallbacks: 0,
    runtimeResets: 0,
    recoveriesAttempted: 0,
    successes: 0,
    failures: 0,
  };
}

function createEmptyFailureBuckets(): Record<NetworkDiagnosticsFailureBucket, number> {
  return Object.fromEntries(
    NETWORK_DIAGNOSTIC_FAILURE_BUCKETS.map((bucket) => [bucket, 0]),
  ) as Record<NetworkDiagnosticsFailureBucket, number>;
}

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

function updateDnsHealth(healthy: boolean | null, detail?: string | null): void {
  const nextDetail = detail?.trim() || null;
  const changed = dnsHealthy !== healthy || dnsDetail !== nextDetail;
  dnsHealthy = healthy;
  dnsDetail = nextDetail;
  if (changed) {
    emitStatus();
  }
}

function processRuntimeLog(text: string): void {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (isFatalRuntimeMessage(line)) {
      lastRuntimeFailureSignal = {
        message: line,
        seenAt: Date.now(),
      };
    }

    if (
      line.includes('dns: resolver: forward: no upstream resolvers set')
      || line.includes('lookup ') && line.includes(' via DoH fallback failed:')
      || line.includes('error resolving ')
    ) {
      updateDnsHealth(false, line);
      continue;
    }

    if (
      line.includes('dns_query_fwd_success')
      || line.includes('dns_resolve_local_ok')
      || line.includes('resolving ') && line.includes(' using fallback resolver')
    ) {
      updateDnsHealth(true, null);
    }
  }
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
      processRuntimeLog(text);
      if (fd === 2) {
        almostnodeDebugError('tailscale', '[tailscale-worker][runtime][stderr]', text.trimEnd());
      } else {
        almostnodeDebugLog('tailscale', '[tailscale-worker][runtime][stdout]', text.trimEnd());
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
          almostnodeDebugError('tailscale', '[tailscale-worker][runtime][stderr]', text.trimEnd());
        } else {
          almostnodeDebugLog('tailscale', '[tailscale-worker][runtime][stdout]', text.trimEnd());
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
  acceptDns: boolean;
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

function isRealNodeProcess(value: unknown): boolean {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const processLike = value as {
    release?: { name?: unknown };
    platform?: unknown;
    versions?: { node?: unknown };
  };

  return processLike.release?.name === 'node'
    && typeof processLike.platform === 'string'
    && typeof processLike.versions?.node === 'string';
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
      const restoreProcess = isRealNodeProcess(
        (globalThis as { process?: unknown }).process,
      )
        ? () => {}
        : overrideGlobalProperty('process', undefined);
      const restoreFs = overrideGlobalProperty('fs', undefined);
      const restorePath = overrideGlobalProperty('path', undefined);
      try {
        return await import('@tailscale/connect');
      } finally {
        restoreNavigator();
        restoreProcess();
        restoreFs();
        restorePath();
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
  const existingProcess = (globalThis as { process?: unknown }).process;
  const preservedProcess =
    isRealNodeProcess(existingProcess) && existingProcess && typeof existingProcess === 'object'
      ? existingProcess as Record<string, unknown>
      : null;
  const processValue = {
    ...(preservedProcess || {}),
    env: withTailscaleCertificateEnv({
      ...(
        preservedProcess?.env && typeof preservedProcess.env === 'object'
          ? preservedProcess.env as Record<string, string>
          : {}
      ),
      HOME: TAILSCALE_RUNTIME_ROOT,
      TMPDIR: TAILSCALE_RUNTIME_TMP_DIR,
      TS_LOGS_DIR: TAILSCALE_RUNTIME_LOGS_DIR,
      XDG_CACHE_HOME: TAILSCALE_RUNTIME_CACHE_DIR,
    }),
    argv: Array.isArray(preservedProcess?.argv)
      ? [...preservedProcess.argv as unknown[]]
      : ['tailscale-connect-worker'],
    pid: typeof preservedProcess?.pid === 'number' ? preservedProcess.pid : 1,
    ppid: typeof preservedProcess?.ppid === 'number' ? preservedProcess.ppid : 0,
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
      this.env = withTailscaleCertificateEnv({
        ...(this.env || {}),
        HOME: TAILSCALE_RUNTIME_ROOT,
        TMPDIR: TAILSCALE_RUNTIME_TMP_DIR,
        TS_LOGS_DIR: TAILSCALE_RUNTIME_LOGS_DIR,
        XDG_CACHE_HOME: TAILSCALE_RUNTIME_CACHE_DIR,
      });
    }
  };

  const restoreGo = overrideGlobalProperty('Go', AlmostnodeTailscaleGo);
  try {
    const acceptDns = getEffectiveAcceptDns(config);
    almostnodeDebugLog('tailscale', '[tailscale-worker][ipn] create', {
      exitNodeId: config.exitNodeId,
      routeAll: config.useExitNode,
      acceptDns,
      ipMapEntries: fetchIpMap.size,
    });
    // The Go WASM reads PascalCase property names (CorpDNS, RouteAll,
    // ExitNodeID) while the TypeScript types use camelCase.  Include
    // both forms so the Go engine actually picks up DNS/routing config.
    const ipn = await tailscaleConnect.createIPN({
      authKey: config.authKey,
      hostname: config.hostname,
      stateStorage: config.stateStorage,
      useExitNode: config.useExitNode,
      routeAll: config.useExitNode,
      RouteAll: config.useExitNode,
      exitNodeId: config.exitNodeId,
      exitNodeID: config.exitNodeId,
      ExitNodeID: config.exitNodeId,
      acceptDns,
      corpDns: acceptDns,
      corpDNS: acceptDns,
      CorpDNS: acceptDns,
      dns: acceptDns,
      dnsIP: acceptDns ? TAILSCALE_DEFAULT_DNS_IP : null,
      dnsIp: acceptDns ? TAILSCALE_DEFAULT_DNS_IP : null,
      bootstrapDns: acceptDns
        ? [TAILSCALE_DEFAULT_DNS_IP, TAILSCALE_DEFAULT_DNS_IPV6]
        : [],
      ipMap: fetchIpMap.size > 0 ? Object.fromEntries(fetchIpMap) : undefined,
      wasmURL: config.wasmURL ?? tailscaleWasmUrl,
      panicHandler: config.panicHandler,
    } as Parameters<typeof tailscaleConnect.createIPN>[0]);
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
  const resolvedDnsDetail = dnsDetail ?? undefined;
  const dnsEnabled = getEffectiveAcceptDns(options);

  if (recoveringFromRuntimeFailure) {
    return {
      state: 'starting',
      dnsEnabled,
      dnsHealthy,
      dnsDetail: resolvedDnsDetail ?? panicError ?? undefined,
      exitNodes,
      selectedExitNodeId,
      detail: panicError
        ? `Recovering Tailscale runtime after failure: ${panicError}`
        : 'Recovering Tailscale runtime.',
      loginUrl,
      selfName: netMap?.self?.name || null,
      tailnetName: extractTailnetName(netMap?.self?.name),
    };
  }

  if (panicError) {
    return {
      state: 'error',
      dnsEnabled,
      dnsHealthy,
      dnsDetail: resolvedDnsDetail ?? panicError,
      exitNodes,
      selectedExitNodeId,
      detail: panicError,
      loginUrl,
    };
  }

  if (netMap?.lockedOut) {
      return {
        state: 'locked',
        dnsEnabled,
        dnsHealthy,
        dnsDetail: resolvedDnsDetail,
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
        dnsEnabled,
        dnsHealthy,
        dnsDetail: resolvedDnsDetail,
        exitNodes,
        selectedExitNodeId,
        loginUrl,
        selfName: netMap?.self?.name || null,
        tailnetName: extractTailnetName(netMap?.self?.name),
      };
    case 'NeedsMachineAuth':
      return {
        state: 'needs-machine-auth',
        dnsEnabled,
        dnsHealthy,
        dnsDetail: resolvedDnsDetail,
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
        dnsEnabled,
        dnsHealthy,
        dnsDetail: resolvedDnsDetail,
        exitNodes,
        selectedExitNodeId,
        loginUrl,
        selfName: netMap?.self?.name || null,
        tailnetName: extractTailnetName(netMap?.self?.name),
      };
    case 'Starting':
      return {
        state: 'starting',
        dnsEnabled,
        dnsHealthy,
        dnsDetail: resolvedDnsDetail,
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
        dnsEnabled,
        dnsHealthy,
        dnsDetail: resolvedDnsDetail,
        exitNodes,
        selectedExitNodeId,
        loginUrl,
        selfName: netMap?.self?.name || null,
        tailnetName: extractTailnetName(netMap?.self?.name),
      };
    case 'InUseOtherUser':
      return {
        state: 'error',
        dnsEnabled,
        dnsHealthy,
        dnsDetail: resolvedDnsDetail,
        exitNodes,
        selectedExitNodeId,
        detail: 'The Tailscale session is in use by a different user.',
        loginUrl,
      };
    case 'NoState':
    default:
      return {
        state: 'needs-login',
        dnsEnabled,
        dnsHealthy,
        dnsDetail: resolvedDnsDetail,
        exitNodes,
        selectedExitNodeId,
        loginUrl,
        selfName: netMap?.self?.name || null,
        tailnetName: extractTailnetName(netMap?.self?.name),
      };
  }
}

function resetIpnRuntime(reason: string): void {
  const detail = reason.trim() || 'Unknown Tailscale runtime failure.';
  const hadLiveIpn = Boolean(ipnPromise || ipnStartPromise || ipnStarted || ipnStartScheduled);

  if (hadLiveIpn) {
    ipnResetCount += 1;
    diagnosticsCounters.runtimeResets += 1;
    lastRuntimeResetReason = detail;
    almostnodeDebugWarn('tailscale', '[tailscale-worker][runtime] resetting live IPN runtime', {
      reason: detail,
      generation: ipnGeneration,
      resetCount: ipnResetCount,
    });
  }

  ipnPromise = null;
  ipnStartPromise = null;
  ipnStarted = false;
  ipnStartScheduled = false;
  panicError = detail;
  recoveringFromRuntimeFailure = hadLiveIpn;
  if (recoveringFromRuntimeFailure) {
    state = 'Starting';
  }
  lastRuntimeFailureSignal = {
    message: detail,
    seenAt: Date.now(),
  };
  emitStatus();
}

function handleIpnError(error: unknown): void {
  resetIpnRuntime(error instanceof Error ? error.message : String(error));
}

async function applyCurrentIpnConfig(ipn: TailscaleConnectIPN): Promise<void> {
  const configurableIpn = ipn as TailscaleConnectIPN & {
    configure?: (config: TailscaleConfigureOptions) => Promise<void>;
  };
  if (typeof configurableIpn.configure !== 'function') {
    almostnodeDebugWarn('tailscale', '[tailscale-worker][ipn] configure() unavailable');
    return;
  }
  const config = buildIpnConfig();
  const configRecord = config as Record<string, unknown>;
  almostnodeDebugLog('tailscale', '[tailscale-worker][ipn] configure', {
    routeAll: configRecord.RouteAll,
    exitNodeId: configRecord.ExitNodeID,
    corpDns: configRecord.CorpDNS,
  });
  await configurableIpn.configure(config);
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
      if (state === 'Running' && getEffectiveAcceptDns(options) && dnsHealthy === null) {
        updateDnsHealth(null, null);
      }
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
      updateDnsHealth(false, error);
      resetIpnRuntime(error);
    },
  };
}

function ensureIpnStarted(ipn: TailscaleConnectIPN): Promise<void> {
  if (ipnStarted) {
    return Promise.resolve();
  }

  if (ipnStartPromise) {
    return ipnStartPromise;
  }

  ipnStartScheduled = true;
  ipnStartPromise = new Promise((resolve, reject) => {
    setTimeout(() => {
      ipnStartScheduled = false;
      if (ipnStarted) {
        ipnStartPromise = null;
        resolve();
        return;
      }

      ipnStarted = true;
      try {
        ipn.run(createIpnCallbacks());
        resolve();
      } catch (error) {
        ipnStarted = false;
        handleIpnError(error);
        reject(error);
      } finally {
        ipnStartPromise = null;
      }
    }, 0);
  });

  return ipnStartPromise;
}

function hexToString(hex: string): string {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return new TextDecoder().decode(bytes);
}

function stringToHex(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let hex = '';
  for (const byte of bytes) {
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * Patches persisted Tailscale profile prefs in the state snapshot so that
 * DNS-related settings match the current worker options.  The Go IPN engine
 * loads prefs from state storage and they take precedence over the config
 * passed to `createIPN`.  If a previous session stored `CorpDNS: false`
 * the engine will start without upstream resolvers, causing SERVFAIL errors
 * that can trigger a WASM panic in `makePromise`.
 */
function patchSnapshotDnsPrefs(
  snapshot: TailscaleStateSnapshot | null,
): TailscaleStateSnapshot | null {
  if (!snapshot) {
    return null;
  }

  const acceptDns = getEffectiveAcceptDns(options);
  if (!acceptDns) {
    return snapshot;
  }

  const patched = { ...snapshot };
  for (const [key, hexValue] of Object.entries(patched)) {
    if (!key.startsWith('profile-') || !hexValue) {
      continue;
    }

    try {
      const decoded = hexToString(hexValue);
      const prefs = JSON.parse(decoded);
      if (typeof prefs !== 'object' || prefs === null) {
        continue;
      }
      if (prefs.CorpDNS === false || prefs.RouteAll !== options.useExitNode) {
        prefs.CorpDNS = true;
        prefs.RouteAll = options.useExitNode;
        patched[key] = stringToHex(JSON.stringify(prefs, null, '\t'));
      }
    } catch {
      // Not a JSON profile entry – leave as-is.
    }
  }

  return patched;
}

function hydrateStateStorage(snapshot: TailscaleStateSnapshot | null): void {
  allowSnapshotClear = false;
  tailscaleStateStorage.replace(patchSnapshotDnsPrefs(snapshot));
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

type TailscaleConfigureOptions = Parameters<TailscaleConnectIPN['configure']>[0];

function buildIpnConfig(
  overrides: Partial<TailscaleConfigureOptions> = {},
): TailscaleConfigureOptions {
  const acceptDns = getEffectiveAcceptDns(options);
  // The Go WASM reads PascalCase property names (CorpDNS, RouteAll,
  // ExitNodeID) while the TypeScript types use camelCase.  Include both
  // forms so the config works regardless of which the runtime reads.
  const base: Record<string, unknown> = {
    useExitNode: options.useExitNode,
    routeAll: options.useExitNode,
    RouteAll: options.useExitNode,
    exitNodeId: options.exitNodeId,
    exitNodeID: options.exitNodeId,
    ExitNodeID: options.exitNodeId,
    acceptDns,
    corpDns: acceptDns,
    corpDNS: acceptDns,
    CorpDNS: acceptDns,
    dns: acceptDns,
    dnsIP: acceptDns ? TAILSCALE_DEFAULT_DNS_IP : null,
    dnsIp: acceptDns ? TAILSCALE_DEFAULT_DNS_IP : null,
    bootstrapDns: acceptDns
      ? [TAILSCALE_DEFAULT_DNS_IP, TAILSCALE_DEFAULT_DNS_IPV6]
      : [],
    ipMap: fetchIpMap.size > 0 ? Object.fromEntries(fetchIpMap) : undefined,
  };
  return { ...base, ...overrides } as TailscaleConfigureOptions;
}

function extractRequestHostname(input: string): string | null {
  try {
    const url = new URL(input);
    return url.hostname || null;
  } catch {
    return null;
  }
}

function applyWorkerDebugRaw(raw: string | null): void {
  const workerGlobal = globalThis as typeof globalThis & {
    __almostnodeDebug?: string;
  };
  if (raw && raw.trim()) {
    workerGlobal.__almostnodeDebug = raw;
    return;
  }

  delete workerGlobal.__almostnodeDebug;
}

function getHeaderValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | null {
  if (!headers) {
    return null;
  }

  const normalized = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalized) {
      return value;
    }
  }
  return null;
}

function buildDiagnosticsRequestShape(
  request: NetworkFetchRequest,
): NetworkDiagnosticsRequestShape {
  const method = (request.method || 'GET').toUpperCase();
  const contentType = getHeaderValue(request.headers, 'content-type');
  const accept = getHeaderValue(request.headers, 'accept');

  return {
    method,
    hasBody: typeof request.bodyBase64 === 'string' && request.bodyBase64.length > 0,
    contentType: contentType?.trim() || null,
    acceptsEventStream: Boolean(
      accept?.toLowerCase().split(',').some((part) => part.trim().startsWith('text/event-stream')),
    ),
  };
}

function getDiagnosticsTargetType(
  hostname: string | null,
): NetworkDiagnosticsFailureEntry['targetType'] {
  if (!hostname) {
    return 'unknown';
  }
  if (isTailscaleInternalHostname(hostname)) {
    return 'tailnet';
  }
  if (isIPv4(hostname) || isIPv6(hostname)) {
    return 'unknown';
  }
  return 'public';
}

function classifyDiagnosticsFailureBucket(
  formatted: Pick<TailscaleWorkerErrorPayload, 'code' | 'message' | 'debug'>,
): NetworkDiagnosticsFailureBucket {
  if (formatted.message.includes('direct-IP retry failed')) {
    return 'direct_ip_fallback_failed';
  }

  if (
    formatted.message.includes('structured fetch response omitted bodyBase64')
    || Boolean(formatted.debug?.expectedBodyBase64 && formatted.debug.hadBodyBase64 === false)
  ) {
    return 'structured_fetch_missing_body_base64';
  }

  if (
    formatted.message.includes('Tailscale response body read failed')
    || isBodyReadFailureMessage(formatted.message)
  ) {
    return 'body_read_timeout';
  }

  if (
    formatted.code === 'runtime_panic'
    || Boolean(
      formatted.debug?.recentRuntimeSignal
      && isFatalRuntimeMessage(formatted.debug.recentRuntimeSignal),
    )
    || /\bpanic\b/i.test(formatted.message)
  ) {
    return 'runtime_panic';
  }

  if (formatted.code === 'tls_sni_failed') {
    return 'tls_sni_failed';
  }

  if (isLoopbackDnsFailure(formatted.message, formatted.debug?.hostname ?? null)) {
    return 'dns_loopback';
  }

  if (formatted.code === 'fetch_timeout') {
    return 'fetch_timeout_other';
  }

  return 'runtime_unavailable_other';
}

function recordDiagnosticFailure(
  formatted: Pick<TailscaleWorkerErrorPayload, 'code' | 'message' | 'debug'>,
  request: NetworkFetchRequest,
  requestShape: NetworkDiagnosticsRequestShape,
): void {
  const bucket = classifyDiagnosticsFailureBucket(formatted);
  diagnosticFailureBuckets[bucket] += 1;

  const host = formatted.debug?.hostname ?? extractRequestHostname(request.url);
  recentDiagnosticFailures.unshift({
    seenAt: new Date().toISOString(),
    host,
    targetType: getDiagnosticsTargetType(host),
    bucket,
    errorCode: formatted.code,
    message: formatted.message,
    phase: formatted.debug?.phase ?? null,
    requestShape,
    useExitNode: formatted.debug?.useExitNode ?? options.useExitNode,
    exitNodeId: formatted.debug?.exitNodeId ?? options.exitNodeId,
    runtimeGeneration: formatted.debug?.runtimeGeneration ?? ipnGeneration,
    runtimeResetCount: formatted.debug?.runtimeResetCount ?? ipnResetCount,
    lastRuntimeResetReason:
      formatted.debug?.lastRuntimeResetReason ?? lastRuntimeResetReason,
  });

  if (recentDiagnosticFailures.length > DIAGNOSTIC_RECENT_FAILURE_LIMIT) {
    recentDiagnosticFailures.length = DIAGNOSTIC_RECENT_FAILURE_LIMIT;
  }
}

function getDominantFailureBucket():
  | NetworkDiagnosticsFailureBucket
  | null {
  let dominant: NetworkDiagnosticsFailureBucket | null = null;
  let dominantCount = 0;

  for (const bucket of NETWORK_DIAGNOSTIC_FAILURE_BUCKETS) {
    const count = diagnosticFailureBuckets[bucket];
    if (count > dominantCount) {
      dominant = bucket;
      dominantCount = count;
    }
  }

  return dominantCount > 0 ? dominant : null;
}

function getDiagnosticsSnapshot(): NetworkDiagnosticsSnapshot {
  return {
    provider: 'tailscale',
    available: true,
    state: mapState().state ?? 'needs-login',
    counters: { ...diagnosticsCounters },
    failureBuckets: { ...diagnosticFailureBuckets },
    dominantFailureBucket: getDominantFailureBucket(),
    recentFailures: recentDiagnosticFailures.map((entry) => ({
      ...entry,
      requestShape: { ...entry.requestShape },
    })),
    runtimeGeneration: ipnGeneration,
    runtimeResetCount: ipnResetCount,
    lastRuntimeResetReason,
  };
}

function pushResolvedAddress(
  entries: Array<{ address: string; family: 4 | 6 }>,
  address: string,
): void {
  if (isIPv4(address)) {
    entries.push({ address, family: 4 });
    return;
  }
  if (isIPv6(address)) {
    entries.push({ address, family: 6 });
  }
}

async function resolveHostnameViaPublicDnsJson(
  hostname: string,
  family?: 4 | 6,
): Promise<Array<{ address: string; family: 4 | 6 }>> {
  const requestedFamilies = family ? [family] : [4, 6];
  const addresses: Array<{ address: string; family: 4 | 6 }> = [];
  let lastError: Error | null = null;

  for (const currentFamily of requestedFamilies) {
    const endpoint = new URL(PUBLIC_DNS_JSON_ENDPOINT);
    endpoint.searchParams.set('name', hostname);
    endpoint.searchParams.set('type', currentFamily === 6 ? 'AAAA' : 'A');

    try {
      const response = await fetch(endpoint.toString(), {
        headers: {
          accept: 'application/dns-json',
        },
      });

      if (!response.ok) {
        throw new Error(
          `Public DNS query failed for '${hostname}': HTTP ${response.status}.`,
        );
      }

      const payload = await response.json() as {
        Status?: number;
        Answer?: Array<{ type?: number; data?: string }>;
      };

      const expectedType = currentFamily === 6 ? 28 : 1;
      const answers = Array.isArray(payload.Answer) ? payload.Answer : [];
      for (const answer of answers) {
        if (answer?.type !== expectedType || typeof answer.data !== 'string') {
          continue;
        }
        pushResolvedAddress(addresses, answer.data);
      }

      if (addresses.length > 0) {
        return addresses;
      }

      if (payload.Status && payload.Status !== 0) {
        lastError = new Error(
          `Public DNS query failed for '${hostname}': status ${payload.Status}.`,
        );
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (lastError) {
    throw lastError;
  }

  return addresses;
}

async function resolveHostnameWithoutIpn(
  hostname: string,
  lookupOptions?: NetworkLookupOptions,
): Promise<NetworkLookupResult | null> {
  const fromNetMap = collectLookupAddresses(hostname, lookupOptions);
  if (fromNetMap && fromNetMap.addresses.length > 0) {
    return fromNetMap;
  }

  const normalizedHost = normalizeName(hostname);
  const cachedAddress = fetchIpMap.get(normalizedHost);
  if (cachedAddress) {
    const family = isIPv6(cachedAddress) ? 6 : 4;
    const requestedFamily = lookupOptions?.family;
    if (!requestedFamily || requestedFamily === family) {
      almostnodeDebugLog(
        'tailscale',
        `[tailscale-worker][dns] public cache hit: host=${hostname} ip=${cachedAddress}`,
      );
      return {
        hostname,
        addresses: [{ address: cachedAddress, family }],
      };
    }
  }

  const requestedFamily =
    lookupOptions?.family === 6 ? 6 : lookupOptions?.family === 4 ? 4 : undefined;
  almostnodeDebugLog(
    'tailscale',
    `[tailscale-worker][dns] resolving public hostname via DoH: host=${hostname} family=${requestedFamily ?? 'auto'}`,
  );
  const addresses = await resolveHostnameViaPublicDnsJson(hostname, requestedFamily);
  if (addresses.length === 0) {
    return null;
  }

  return {
    hostname,
    addresses,
  };
}

function isSimpleUrlOnlyFetchRequest(request: NetworkFetchRequest): boolean {
  const method = (request.method || 'GET').toUpperCase();
  if (method !== 'GET') {
    return false;
  }

  if (request.bodyBase64) {
    return false;
  }

  if (request.redirect === 'manual' || request.redirect === 'error') {
    return false;
  }

  if (request.credentials && request.credentials !== 'omit' && request.credentials !== 'same-origin') {
    return false;
  }

  return !request.headers || Object.keys(request.headers).length === 0;
}

function getTailscaleBridgeCapabilities(
  ipn: TailscaleConnectIPN,
): TailscaleBridgeCapabilities {
  const ipnRecord = ipn as unknown as Record<string, unknown>;
  const canReconfigure = typeof ipnRecord.configure === 'function';
  const canLookup =
    typeof ipnRecord.lookup === 'function'
    || typeof ipnRecord.resolve === 'function';

  return {
    canLookup,
    canReconfigure,
    canStructuredFetch: canReconfigure || canLookup,
  };
}

function isTlsSniFailure(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('tls')
    || normalized.includes('x509')
    || normalized.includes('certificate')
    || normalized.includes('server name')
    || normalized.includes('hostname')
  );
}

function normalizeWorkerDebug(debug: unknown): TailscaleWorkerErrorDebug | undefined {
  return debug && typeof debug === 'object'
    ? debug as TailscaleWorkerErrorDebug
    : undefined;
}

function toTailscaleWorkerErrorPayload(
  error: unknown,
  fallbackCode: TailscaleWorkerErrorCode,
  fallbackDebug?: TailscaleWorkerErrorDebug,
): TailscaleWorkerErrorPayload {
  if (error instanceof ClassifiedTailscaleWorkerError) {
    return {
      code: error.code,
      message: error.message,
      debug: error.debug ?? fallbackDebug,
    };
  }

  const message = getErrorMessage(error);
  const errorDebug =
    error instanceof Error
      ? normalizeWorkerDebug((error as Error & { debug?: unknown }).debug)
      : error && typeof error === 'object'
        ? normalizeWorkerDebug((error as Record<string, unknown>).debug)
        : undefined;
  const debug = errorDebug ?? fallbackDebug;

  if (message.includes('only supports simple GET requests')) {
    return { code: 'unsupported_fetch_shape', message, debug };
  }
  if (message.includes('Tailscale fetch timed out after')) {
    return { code: 'fetch_timeout', message, debug };
  }
  if (isBodyReadFailureMessage(message)) {
    return { code: 'fetch_timeout', message, debug };
  }
  if (
    message.includes('Tailscale DNS could not resolve')
    || message.includes('Public DNS query failed')
    || isLoopbackDnsFailure(message, debug?.hostname ?? null)
  ) {
    return { code: 'dns_resolution_failed', message, debug };
  }
  if (
    message.includes('ValueOf: invalid value')
    || (panicError && message.includes(panicError))
    || /\bpanic\b/i.test(message)
  ) {
    return { code: 'runtime_panic', message, debug };
  }
  if (isTlsSniFailure(message)) {
    return { code: 'tls_sni_failed', message, debug };
  }
  return { code: fallbackCode, message, debug };
}

function getMinimalRuntimeFetchError(): string {
  return (
    'The bundled @tailscale/connect runtime only supports simple GET requests ' +
    'without custom headers, bodies, or redirect overrides.'
  );
}

/**
 * Extracts the hostname from the hydrated state storage so that the IPN
 * can reuse the existing machine identity instead of re-registering under
 * a new random name (which causes the Go engine to discard persisted prefs
 * like CorpDNS and recreate the profile from scratch).
 */
function extractHostnameFromStateStorage(): string | null {
  const currentProfileHex = tailscaleStateStorage.getState('_current-profile');
  if (!currentProfileHex) {
    return null;
  }

  try {
    const profileKey = hexToString(currentProfileHex);
    const profileHex = tailscaleStateStorage.getState(profileKey);
    if (!profileHex) {
      return null;
    }
    const prefs = JSON.parse(hexToString(profileHex));
    if (typeof prefs?.Hostname === 'string' && prefs.Hostname) {
      return prefs.Hostname;
    }
  } catch {
    // Fall through to random hostname.
  }
  return null;
}

async function ensureIpn(): Promise<TailscaleConnectIPN> {
  if (!ipnPromise) {
    const recoveringReason = panicError;
    if (recoveringReason) {
      diagnosticsCounters.recoveriesAttempted += 1;
      almostnodeDebugWarn('tailscale', '[tailscale-worker][runtime] recreating IPN after failure', {
        reason: recoveringReason,
        previousGeneration: ipnGeneration,
        resetCount: ipnResetCount,
      });
      recoveringFromRuntimeFailure = true;
      state = 'Starting';
      emitStatus();
    } else if (state === 'NoState' && hasHydratedStateStorageSnapshot()) {
      state = 'Starting';
      emitStatus();
    }

    const storedHostname = extractHostnameFromStateStorage();
    lastRuntimeFailureSignal = null;
    ipnGeneration += 1;
    ipnPromise = createWorkerIpn({
      authKey: '',
      hostname: storedHostname || `almostnode-${Math.random().toString(36).slice(2, 8)}`,
      stateStorage: tailscaleStateStorage as TailscaleConnectStateStorage,
      useExitNode: options.useExitNode,
      exitNodeId: options.exitNodeId,
      acceptDns: options.acceptDns,
      wasmURL: tailscaleWasmUrl,
      panicHandler: (error: string) => {
        updateDnsHealth(false, error);
        resetIpnRuntime(error);
      },
    })
      .then((ipn) => {
        if (!ipn || typeof ipn.run !== 'function') {
          throw new Error('Tailscale IPN initialization failed.');
        }
        panicError = null;
        recoveringFromRuntimeFailure = false;
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

/**
 * Returns true when the hostname belongs to the Tailscale tailnet (matches a
 * known node name or ends with `.ts.net`) and can be resolved by Go's internal
 * DNS without risk of the WASM panic.
 */
function isTailscaleInternalHostname(hostname: string): boolean {
  const normalized = normalizeName(hostname);
  if (normalized.endsWith('.ts.net')) {
    return true;
  }
  if (netMap) {
    const candidates = [netMap.self, ...netMap.peers];
    for (const node of candidates) {
      const nodeName = normalizeName(node.name);
      if (nodeName === normalized || nodeName.split('.')[0] === normalized) {
        return true;
      }
    }
  }
  return false;
}

async function preparePublicHostnameIpMap(url: string): Promise<{
  hostname: string | null;
  ipAddress: string | null;
  mappingChanged: boolean;
}> {
  const hostname = extractRequestHostname(url);
  if (!hostname || isIPv4(hostname) || isIPv6(hostname) || isTailscaleInternalHostname(hostname)) {
    return {
      hostname,
      ipAddress: null,
      mappingChanged: false,
    };
  }

  const resolved = await resolveHostnameWithoutIpn(hostname);
  const ipAddress =
    resolved?.addresses.find((address) => address.family === 4)?.address
    ?? resolved?.addresses[0]?.address
    ?? null;

  if (!ipAddress) {
    throw new ClassifiedTailscaleWorkerError(
      'dns_resolution_failed',
      `Tailscale DNS could not resolve public hostname '${hostname}'.`,
    );
  }

  const normalizedHost = normalizeName(hostname);
  const previousAddress = fetchIpMap.get(normalizedHost) ?? null;
  const mappingChanged = previousAddress !== ipAddress;
  fetchIpMap.set(normalizedHost, ipAddress);

  almostnodeDebugLog(
    'tailscale',
    `[tailscale-worker][dns] prepared public route: host=${hostname} ip=${ipAddress} changed=${mappingChanged ? 'yes' : 'no'}`,
  );

  return {
    hostname,
    ipAddress,
    mappingChanged,
  };
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isLoopbackDnsFailure(message: string, hostname: string | null): boolean {
  const normalized = message.toLowerCase();
  if (
    !normalized.includes(' on [::1]:53')
    && !normalized.includes(' on 127.0.0.1:53')
    && !normalized.includes(' on localhost:53')
  ) {
    return false;
  }

  if (!hostname) {
    return true;
  }

  return normalized.includes(`lookup ${hostname.toLowerCase()}`);
}

function isFatalRuntimeMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('unexpected shutdown')
    || normalized.includes('go program has already exited')
    || normalized.includes('use of closed network connection')
    || normalized.includes('close received after close')
    || normalized.includes('syscall/js.value')
  );
}

function isBodyReadFailureMessage(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('reading response body')
    || normalized.includes('while reading body')
    || normalized.includes('client.timeout or context cancellation while reading body')
    || normalized.includes('context deadline exceeded')
  );
}

function getRecentRuntimeFailureSignal(
  maxAgeMs = 60_000,
): { message: string; ageMs: number } | null {
  if (!lastRuntimeFailureSignal) {
    return null;
  }

  const ageMs = Date.now() - lastRuntimeFailureSignal.seenAt;
  if (ageMs > maxAgeMs) {
    return null;
  }

  return {
    message: lastRuntimeFailureSignal.message,
    ageMs,
  };
}

function shouldResetRuntimeAfterError(
  formatted: Pick<TailscaleWorkerErrorPayload, 'code' | 'message' | 'debug'>,
): boolean {
  return (
    formatted.code === 'runtime_panic'
    || isFatalRuntimeMessage(formatted.message)
    || isBodyReadFailureMessage(formatted.message)
    || Boolean(
      formatted.debug?.expectedBodyBase64
      && formatted.debug.hadBodyBase64 === false,
    )
    || Boolean(
      formatted.debug?.recentRuntimeSignal
      && isFatalRuntimeMessage(formatted.debug.recentRuntimeSignal),
    )
  );
}

function buildDirectIpFallbackRequest(
  request: NetworkFetchRequest,
  hostname: string,
  ipAddress: string,
): Parameters<TailscaleConnectIPN['fetch']>[0] {
  const url = new URL(request.url);
  const originalHostHeader = url.host;
  url.hostname = ipAddress;

  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(request.headers || {})) {
    if (key.toLowerCase() === 'host') {
      continue;
    }
    headers[key] = value;
  }
  headers.Host = originalHostHeader;

  const fallbackRequest: Exclude<Parameters<TailscaleConnectIPN['fetch']>[0], string> = {
    url: url.toString(),
    method: request.method,
    headers,
    bodyBase64: request.bodyBase64,
    redirect: request.redirect === 'manual' || request.redirect === 'error'
      ? request.redirect
      : 'follow',
  };

  if (url.protocol === 'https:') {
    fallbackRequest.tlsServerName = hostname;
  }

  return fallbackRequest;
}

function shouldRetryWithResolvedIp(
  error: unknown,
  request: NetworkFetchRequest,
  preparedRoute: {
    hostname: string | null;
    ipAddress: string | null;
  },
  capabilities: TailscaleBridgeCapabilities,
): preparedRoute is { hostname: string; ipAddress: string } {
  if (!preparedRoute.hostname || !preparedRoute.ipAddress || !capabilities.canStructuredFetch) {
    return false;
  }

  try {
    const url = new URL(request.url);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false;
    }
  } catch {
    return false;
  }

  return isLoopbackDnsFailure(getErrorMessage(error), preparedRoute.hostname);
}

const TAILSCALE_DEFAULT_FETCH_TIMEOUT_MS = 30_000;
const TAILSCALE_LONG_RUNNING_FETCH_TIMEOUT_MS = 300_000;

function getTailscaleFetchTimeoutMs(
  request: NetworkFetchRequest,
  _mode: 'primary' | 'fallback',
): number {
  const method = (request.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return TAILSCALE_DEFAULT_FETCH_TIMEOUT_MS;
  }

  return TAILSCALE_LONG_RUNNING_FETCH_TIMEOUT_MS;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(
        new ClassifiedTailscaleWorkerError(
          'fetch_timeout',
          `Tailscale fetch timed out after ${ms}ms: ${label}`,
        ),
      ), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function handleFetch(
  request: NetworkFetchRequest,
): Promise<NetworkFetchResponse> {
  const hadLiveIpn = ipnPromise !== null;
  const recentRuntimeSignal = getRecentRuntimeFailureSignal();
  const requestShape = buildDiagnosticsRequestShape(request);
  const fetchLabel = `${request.method || 'GET'} ${request.url}`;
  diagnosticsCounters.totalFetches += 1;
  const requestHostname = extractRequestHostname(request.url);
  const targetType = getDiagnosticsTargetType(requestHostname);
  if (targetType === 'public') {
    diagnosticsCounters.publicFetches += 1;
  } else if (targetType === 'tailnet') {
    diagnosticsCounters.tailnetFetches += 1;
  }
  almostnodeDebugLog('tailscale', `[tailscale-worker][fetch] start: ${fetchLabel}`, {
    requestShape,
    targetType,
  });
  const fetchStart = Date.now();
  let fetchDebug: TailscaleWorkerErrorDebug = {
    phase: 'prepare_public_dns',
    url: request.url,
    useExitNode: options.useExitNode,
    exitNodeId: options.exitNodeId,
    hadLiveIpn,
    runtimeGeneration: ipnGeneration,
    runtimeResetCount: ipnResetCount,
    lastRuntimeResetReason,
    recentRuntimeSignal: recentRuntimeSignal?.message ?? null,
    recentRuntimeSignalAgeMs: recentRuntimeSignal?.ageMs ?? null,
  };

  try {
    const preparedRoute = await preparePublicHostnameIpMap(request.url);
    fetchDebug = {
      ...fetchDebug,
      hostname: preparedRoute.hostname,
      ipAddress: preparedRoute.ipAddress,
    };
    fetchDebug = {
      ...fetchDebug,
      phase: 'ipn_start',
    };
    const ipn = await ensureIpn();
    await ensureIpnStarted(ipn);

    const capabilities = getTailscaleBridgeCapabilities(ipn);
    const primaryTimeoutMs = getTailscaleFetchTimeoutMs(request, 'primary');
    fetchDebug = {
      ...fetchDebug,
      phase: 'primary_fetch',
      capabilities,
      timeoutMs: primaryTimeoutMs,
      runtimeGeneration: ipnGeneration,
      runtimeResetCount: ipnResetCount,
      lastRuntimeResetReason,
      attemptedIpMapSync: Boolean(preparedRoute.mappingChanged && capabilities.canReconfigure),
    };
    almostnodeDebugLog(
      'tailscale',
      `[tailscale-worker][fetch] capabilities: structured=${capabilities.canStructuredFetch ? 'yes' : 'no'} reconfigure=${capabilities.canReconfigure ? 'yes' : 'no'} lookup=${capabilities.canLookup ? 'yes' : 'no'} liveIpn=${hadLiveIpn ? 'yes' : 'no'}`,
    );

    if (preparedRoute.mappingChanged) {
      if (!capabilities.canReconfigure) {
        if (hadLiveIpn) {
          throw new ClassifiedTailscaleWorkerError(
            'runtime_unavailable',
            `Active Tailscale runtime cannot refresh public-host routing for '${preparedRoute.hostname}'.`,
          );
        }
      } else {
        almostnodeDebugLog(
          'tailscale',
          `[tailscale-worker][fetch] syncing ipMap before fetch: host=${preparedRoute.hostname} ip=${preparedRoute.ipAddress}`,
        );
        await applyCurrentIpnConfig(ipn);
      }
    }

    let response: Awaited<ReturnType<TailscaleConnectIPN['fetch']>>;
    let usedDirectIpFallback = false;
    let usedStructuredFetch = false;
    if (capabilities.canStructuredFetch) {
      usedStructuredFetch = true;
      diagnosticsCounters.structuredFetches += 1;
      const fetchReq: Parameters<TailscaleConnectIPN['fetch']>[0] = {
        url: request.url,
        method: request.method,
        headers: request.headers,
        bodyBase64: request.bodyBase64,
        redirect: request.redirect === 'manual' || request.redirect === 'error'
          ? request.redirect
          : 'follow',
      };
      try {
        response = await withTimeout(ipn.fetch(fetchReq), primaryTimeoutMs, fetchLabel);
      } catch (primaryError) {
        if (!shouldRetryWithResolvedIp(primaryError, request, preparedRoute, capabilities)) {
          throw primaryError;
        }

        const primaryErrorMessage = getErrorMessage(primaryError);
        const fallbackRequest = buildDirectIpFallbackRequest(
          request,
          preparedRoute.hostname,
          preparedRoute.ipAddress,
        );
        const fallbackLabel = `${fetchLabel} [direct-ip fallback]`;
        const fallbackTimeoutMs = getTailscaleFetchTimeoutMs(request, 'fallback');
        fetchDebug = {
          ...fetchDebug,
          phase: 'fallback_fetch',
          timeoutMs: fallbackTimeoutMs,
          fallbackAttempted: true,
          fallbackStrategy: 'rewrite_to_resolved_ip',
          primaryError: primaryErrorMessage,
        };
        almostnodeDebugWarn(
          'tailscale',
          `[tailscale-worker][fetch] primary fetch hit loopback DNS despite ipMap; retrying direct IP: host=${preparedRoute.hostname} ip=${preparedRoute.ipAddress}`,
          fetchDebug,
        );

        try {
          response = await withTimeout(
            ipn.fetch(fallbackRequest),
            fallbackTimeoutMs,
            fallbackLabel,
          );
          usedDirectIpFallback = true;
          diagnosticsCounters.directIpFallbacks += 1;
        } catch (fallbackError) {
          const fallbackMessage = getErrorMessage(fallbackError);
          const fallbackPayload = toTailscaleWorkerErrorPayload(
            fallbackError,
            'runtime_unavailable',
            {
              ...fetchDebug,
              fallbackError: fallbackMessage,
            },
          );
          throw new ClassifiedTailscaleWorkerError(
            fallbackPayload.code,
            `Tailscale runtime ignored ipMap for '${preparedRoute.hostname}' and direct-IP retry failed. Primary error: ${primaryErrorMessage}. Fallback error: ${fallbackPayload.message}`,
            fallbackPayload.debug,
          );
        }
      }
    } else {
      if (!isSimpleUrlOnlyFetchRequest(request)) {
        throw new ClassifiedTailscaleWorkerError(
          'unsupported_fetch_shape',
          getMinimalRuntimeFetchError(),
        );
      }
      response = await withTimeout(
        ipn.fetch(request.url),
        getTailscaleFetchTimeoutMs(request, 'primary'),
        fetchLabel,
      );
    }

    const elapsed = Date.now() - fetchStart;
    diagnosticsCounters.successes += 1;
    almostnodeDebugLog(
      'tailscale',
      `[tailscale-worker][fetch] complete: ${response.status} in ${elapsed}ms: ${fetchLabel}${usedDirectIpFallback ? ' (direct-ip fallback)' : ''}`,
    );

    fetchDebug = {
      ...fetchDebug,
      phase: 'read_body',
      responseUrl: response.url || request.url,
      responseStatus: response.status,
      hadBodyBase64: typeof response.bodyBase64 === 'string',
      expectedBodyBase64: usedStructuredFetch,
    };

    let bodyBase64: string;
    if (typeof response.bodyBase64 === 'string') {
      bodyBase64 = response.bodyBase64;
    } else if (usedStructuredFetch) {
      throw new ClassifiedTailscaleWorkerError(
        'runtime_unavailable',
        'Tailscale structured fetch response omitted bodyBase64.',
        fetchDebug,
      );
    } else {
      try {
        bodyBase64 = encodeTextBody(await response.text());
      } catch (bodyReadError) {
        const bodyReadMessage = getErrorMessage(bodyReadError);
        throw new ClassifiedTailscaleWorkerError(
          isBodyReadFailureMessage(bodyReadMessage)
            ? 'fetch_timeout'
            : 'runtime_unavailable',
          `Tailscale response body read failed: ${bodyReadMessage}`,
          {
            ...fetchDebug,
            bodyReadError: bodyReadMessage,
          },
        );
      }
    }

    if (getEffectiveAcceptDns(options)) {
      updateDnsHealth(true, null);
    }

    return {
      url: usedDirectIpFallback ? request.url : (response.url || request.url),
      status: response.status,
      statusText: response.statusText,
      headers: response.headers || {},
      bodyBase64,
    };
  } catch (error) {
    const elapsed = Date.now() - fetchStart;
    const recentRuntimeSignalNow = getRecentRuntimeFailureSignal();
    diagnosticsCounters.failures += 1;
    let formatted = toTailscaleWorkerErrorPayload(error, 'runtime_unavailable', fetchDebug);
    if (recentRuntimeSignalNow) {
      formatted = {
        ...formatted,
        debug: {
          ...formatted.debug,
          recentRuntimeSignal: recentRuntimeSignalNow.message,
          recentRuntimeSignalAgeMs: recentRuntimeSignalNow.ageMs,
        },
      };
    }
    if (shouldResetRuntimeAfterError(formatted)) {
      resetIpnRuntime(formatted.message);
      formatted = {
        ...formatted,
        debug: {
          ...formatted.debug,
          runtimeGeneration: ipnGeneration,
          runtimeResetCount: ipnResetCount,
          lastRuntimeResetReason,
        },
      };
    }
    recordDiagnosticFailure(formatted, request, requestShape);
    almostnodeDebugWarn(
      'tailscale',
      `[tailscale-worker][fetch] failed after ${elapsed}ms (${formatted.code}): ${fetchLabel}`,
      formatted.debug
        ? {
            message: formatted.message,
            debug: formatted.debug,
          }
        : formatted.message,
    );
    throw new ClassifiedTailscaleWorkerError(
      formatted.code,
      formatted.message,
      formatted.debug,
    );
  }
}

function normalizeLookupAddresses(
  hostname: string,
  value: unknown,
  family?: number,
): NetworkLookupResult | null {
  const requestedFamily = family === 6 ? 6 : family === 4 ? 4 : null;

  const pushAddress = (
    entries: Array<{ address: string; family: 4 | 6 }>,
    address: unknown,
  ): void => {
    if (typeof address !== 'string' || !address) {
      return;
    }

    const detectedFamily = isIPv6(address) ? 6 : isIPv4(address) ? 4 : null;
    if (!detectedFamily) {
      return;
    }
    if (requestedFamily && detectedFamily !== requestedFamily) {
      return;
    }
    entries.push({ address, family: detectedFamily });
  };

  const addresses: Array<{ address: string; family: 4 | 6 }> = [];
  if (typeof value === 'string') {
    pushAddress(addresses, value);
  } else if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === 'string') {
        pushAddress(addresses, entry);
        continue;
      }
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        pushAddress(addresses, record.address ?? record.ip ?? record.value);
      }
    }
  } else if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.addresses)) {
      for (const entry of record.addresses) {
        if (entry && typeof entry === 'object') {
          const addressRecord = entry as Record<string, unknown>;
          pushAddress(
            addresses,
            addressRecord.address ?? addressRecord.ip ?? addressRecord.value,
          );
        } else {
          pushAddress(addresses, entry);
        }
      }
    } else {
      pushAddress(addresses, record.address ?? record.ip ?? record.value);
    }
  }

  if (addresses.length === 0) {
    return null;
  }

  return {
    hostname,
    addresses,
  };
}

async function lookupViaDynamicIpnMethod(
  ipn: TailscaleConnectIPN,
  hostname: string,
  lookupOptions?: NetworkLookupOptions,
): Promise<NetworkLookupResult | null> {
  const capabilities = getTailscaleBridgeCapabilities(ipn);
  if (!capabilities.canLookup) {
    return null;
  }

  const ipnRecord = ipn as unknown as Record<string, unknown>;
  const candidateMethods = ['lookup', 'resolve'];

  for (const methodName of candidateMethods) {
    const method = ipnRecord[methodName];
    if (typeof method !== 'function') {
      continue;
    }

    try {
      const value = await (method as (hostname: string) => Promise<unknown>)(hostname);
      const normalized = normalizeLookupAddresses(
        hostname,
        value,
        lookupOptions?.family,
      );
      if (normalized) {
        return normalized;
      }
    } catch (error) {
      updateDnsHealth(false, error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  return null;
}

async function handleLookup(
  hostname: string,
  lookupOptions?: NetworkLookupOptions,
): Promise<NetworkLookupResult> {
  const ipn = await ensureIpn();
  await ensureIpnStarted(ipn);

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
    updateDnsHealth(true, null);
    return fromNetMap;
  }

  const fromResolver = await resolveHostnameWithoutIpn(hostname, lookupOptions);
  if (fromResolver && fromResolver.addresses.length > 0) {
    updateDnsHealth(true, null);
    return fromResolver;
  }

  const fromIpn = await lookupViaDynamicIpnMethod(ipn, hostname, lookupOptions);
  if (fromIpn && fromIpn.addresses.length > 0) {
    updateDnsHealth(true, null);
    return fromIpn;
  }

  const detail = `Tailscale DNS could not resolve '${hostname}'.`;
  updateDnsHealth(false, detail);
  throw new Error(detail);
}

type TailscaleWorkerResponseValue = Extract<
  TailscaleWorkerEvent,
  { type: 'response'; ok: true }
>['value'];

function sendResponse(id: number, ok: true, value: TailscaleWorkerResponseValue): void;
function sendResponse(id: number, ok: false, error: TailscaleWorkerErrorPayload): void;
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
        error: valueOrError as TailscaleWorkerErrorPayload,
      };
  self.postMessage(message);
}

self.addEventListener('message', async (event: MessageEvent<TailscaleWorkerRequestWithId>) => {
  const request = event.data;

  try {
    switch (request.type) {
      case 'setDebug':
        applyWorkerDebugRaw(request.raw);
        sendResponse(request.id, true, null);
        break;
      case 'hydrateStorage':
        hydrateStateStorage(request.snapshot);
        sendResponse(request.id, true, null);
        break;
      case 'configure':
        options = request.options;
        panicError = null;
        recoveringFromRuntimeFailure = false;
        if (!getEffectiveAcceptDns(options)) {
          updateDnsHealth(null, null);
        }
        if (ipnPromise) {
          const ipn = await ipnPromise;
          await applyCurrentIpnConfig(ipn);
          emitStatus();
        }
        sendResponse(request.id, true, null);
        break;
      case 'getStatus':
        if (options.provider === 'tailscale') {
          const ipn = await ensureIpn();
          void ensureIpnStarted(ipn).catch(handleIpnError);
        }
        sendResponse(request.id, true, mapState());
        break;
      case 'getDiagnostics':
        sendResponse(request.id, true, getDiagnosticsSnapshot());
        break;
      case 'login': {
        const ipn = await ensureIpn();
        sendResponse(request.id, true, mapState());
        void ensureIpnStarted(ipn).catch(handleIpnError);
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
        allowSnapshotClear = true;
        if (ipnPromise) {
          const ipn = await ipnPromise;
          ipn.logout();
        }
        fetchIpMap.clear();
        state = 'NeedsLogin';
        loginUrl = null;
        tailscaleStateStorage.clear();
        panicError = null;
        recoveringFromRuntimeFailure = false;
        updateDnsHealth(null, null);
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
      toTailscaleWorkerErrorPayload(error, 'runtime_unavailable'),
    );
  }
});
