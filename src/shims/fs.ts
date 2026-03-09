/**
 * Node.js fs module shim
 * Wraps VirtualFS to provide Node.js compatible API
 */

import { VirtualFS, createNodeError } from '../virtual-fs';
import type { Stats, FSWatcher, WatchListener, WatchEventType } from '../virtual-fs';
import { uint8ToBase64, uint8ToHex } from '../utils/binary-encoding';

export type { Stats, FSWatcher, WatchListener, WatchEventType };

const _decoder = new TextDecoder();
const _encoder = new TextEncoder();

export type PathLike = string | URL;
export type TimeLike = string | number | Date;

export interface FsShim {
  readFileSync(path: PathLike): Buffer;
  readFileSync(path: PathLike, encoding: 'utf8' | 'utf-8'): string;
  readFileSync(path: PathLike, options: { encoding: 'utf8' | 'utf-8' }): string;
  readFileSync(path: PathLike, options: { encoding?: null }): Buffer;
  writeFileSync(path: PathLike, data: string | Uint8Array): void;
  existsSync(path: PathLike): boolean;
  mkdirSync(path: PathLike, options?: { recursive?: boolean }): void;
  readdirSync(path: PathLike): string[];
  readdirSync(path: PathLike, options: { withFileTypes: true }): Dirent[];
  readdirSync(path: PathLike, options?: { withFileTypes?: boolean; encoding?: string } | string): string[] | Dirent[];
  statSync(path: PathLike): Stats;
  lstatSync(path: PathLike): Stats;
  fstatSync(fd: number): Stats;
  unlinkSync(path: PathLike): void;
  rmdirSync(path: PathLike): void;
  renameSync(oldPath: PathLike, newPath: PathLike): void;
  realpathSync(path: PathLike): string;
  accessSync(path: PathLike, mode?: number): void;
  copyFileSync(src: PathLike, dest: PathLike): void;
  utimesSync(path: PathLike, atime: TimeLike, mtime: TimeLike): void;
  openSync(path: string, flags: string | number, mode?: number): number;
  closeSync(fd: number): void;
  readSync(fd: number, buffer: Buffer | Uint8Array, offset: number, length: number, position: number | null): number;
  writeSync(fd: number, buffer: Buffer | Uint8Array | string, offset?: number, length?: number, position?: number | null): number;
  ftruncateSync(fd: number, len?: number): void;
  fsyncSync(fd: number): void;
  fdatasyncSync(fd: number): void;
  mkdtempSync(prefix: string): string;
  mkdtemp(prefix: string, callback: (err: Error | null, directory?: string) => void): void;
  rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void;
  watch(filename: string, options?: { persistent?: boolean; recursive?: boolean }, listener?: WatchListener): FSWatcher;
  watch(filename: string, listener?: WatchListener): FSWatcher;
  readFile(path: string, callback: (err: Error | null, data?: Uint8Array) => void): void;
  readFile(path: string, options: string, callback: (err: Error | null, data?: string | Uint8Array) => void): void;
  readFile(path: string, options: { encoding: string }, callback: (err: Error | null, data?: string) => void): void;
  writeFile(path: string, data: string | Uint8Array, callback: (err: Error | null) => void): void;
  writeFile(path: string, data: string | Uint8Array, options: { encoding?: string; mode?: number; flag?: string }, callback: (err: Error | null) => void): void;
  stat(path: string, callback: (err: Error | null, stats?: Stats) => void): void;
  stat(path: string, options: unknown, callback: (err: Error | null, stats?: Stats) => void): void;
  lstat(path: string, callback: (err: Error | null, stats?: Stats) => void): void;
  lstat(path: string, options: unknown, callback: (err: Error | null, stats?: Stats) => void): void;
  readdir(path: string, callback: (err: Error | null, files?: string[]) => void): void;
  mkdir(path: string, callback: (err: Error | null) => void): void;
  mkdir(path: string, options: { recursive?: boolean; mode?: number }, callback: (err: Error | null) => void): void;
  unlink(path: string, callback: (err: Error | null) => void): void;
  rmdir(path: string, callback: (err: Error | null) => void): void;
  rename(oldPath: string, newPath: string, callback: (err: Error | null) => void): void;
  copyFile(src: string, dest: string, callback: (err: Error | null) => void): void;
  rm(path: string, callback: (err: Error | null) => void): void;
  rm(path: string, options: { recursive?: boolean; force?: boolean }, callback: (err: Error | null) => void): void;
  realpath(path: string, callback: (err: Error | null, resolvedPath?: string) => void): void;
  realpath(path: string, options: unknown, callback: (err: Error | null, resolvedPath?: string) => void): void;
  access(path: string, callback: (err: Error | null) => void): void;
  access(path: string, mode: number, callback: (err: Error | null) => void): void;
  utimes(path: string, atime: TimeLike, mtime: TimeLike, callback: (err: Error | null) => void): void;
  createReadStream(path: string): unknown;
  createWriteStream(path: string): unknown;
  promises: FsPromises;
  constants: FsConstants;
}

export interface FsPromises {
  readFile(path: PathLike): Promise<Buffer>;
  readFile(path: PathLike, encoding: 'utf8' | 'utf-8'): Promise<string>;
  readFile(path: PathLike, options: { encoding: 'utf8' | 'utf-8' }): Promise<string>;
  open(path: PathLike, flags?: string | number, mode?: number): Promise<FileHandle>;
  appendFile(path: PathLike, data: string | Uint8Array): Promise<void>;
  writeFile(path: PathLike, data: string | Uint8Array): Promise<void>;
  stat(path: PathLike): Promise<Stats>;
  lstat(path: PathLike): Promise<Stats>;
  readdir(path: PathLike): Promise<string[]>;
  mkdir(path: PathLike, options?: { recursive?: boolean }): Promise<void>;
  unlink(path: PathLike): Promise<void>;
  rmdir(path: PathLike): Promise<void>;
  rename(oldPath: PathLike, newPath: PathLike): Promise<void>;
  rm(path: PathLike, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
  access(path: PathLike, mode?: number): Promise<void>;
  realpath(path: PathLike): Promise<string>;
  copyFile(src: PathLike, dest: PathLike): Promise<void>;
  utimes(path: PathLike, atime: TimeLike, mtime: TimeLike): Promise<void>;
}

export interface FileHandle {
  readonly fd: number;
  stat(): Promise<Stats>;
  read<T extends Buffer | Uint8Array>(
    buffer: T,
    offset?: number,
    length?: number,
    position?: number | null
  ): Promise<{ bytesRead: number; buffer: T }>;
  appendFile(data: string | Uint8Array): Promise<void>;
  writeFile(data: string | Uint8Array): Promise<void>;
  close(): Promise<void>;
}

export interface FsConstants {
  F_OK: number;
  R_OK: number;
  W_OK: number;
  X_OK: number;
  O_RDONLY: number;
  O_WRONLY: number;
  O_RDWR: number;
  O_CREAT: number;
  O_EXCL: number;
  O_TRUNC: number;
  O_APPEND: number;
  O_NOFOLLOW: number;
}

/**
 * Dirent class - represents a directory entry returned by readdirSync with withFileTypes: true
 */
export class Dirent {
  name: string;
  private _isDirectory: boolean;
  private _isFile: boolean;

  constructor(name: string, isDirectory: boolean, isFile: boolean) {
    this.name = name;
    this._isDirectory = isDirectory;
    this._isFile = isFile;
  }

  isDirectory(): boolean {
    return this._isDirectory;
  }

  isFile(): boolean {
    return this._isFile;
  }

  isBlockDevice(): boolean {
    return false;
  }

  isCharacterDevice(): boolean {
    return false;
  }

  isFIFO(): boolean {
    return false;
  }

  isSocket(): boolean {
    return false;
  }

  isSymbolicLink(): boolean {
    return false;
  }
}

/**
 * Create a Buffer-like object from Uint8Array
 * This is a minimal Buffer implementation for browser compatibility
 */
function createBuffer(data: Uint8Array): Buffer {
  const buffer = data as Buffer;

  // Add Buffer-specific methods
  Object.defineProperty(buffer, 'toString', {
    value: function (encoding?: string) {
      if (encoding === 'utf8' || encoding === 'utf-8' || !encoding) {
        return _decoder.decode(this);
      }
      if (encoding === 'base64') {
        return uint8ToBase64(this);
      }
      if (encoding === 'hex') {
        return uint8ToHex(this);
      }
      throw new Error(`Unsupported encoding: ${encoding}`);
    },
    writable: true,
    configurable: true,
  });

  return buffer;
}

/**
 * Convert a path-like value to a string path
 * Handles URL objects (file:// protocol) and Buffer
 */

function toPath(pathLike: unknown, getCwd?: () => string): string {
  let path: string;

  if (typeof pathLike === 'string') {
    path = pathLike;
  } else if (pathLike instanceof URL) {
    // Handle file:// URLs
    if (pathLike.protocol === 'file:') {
      // Remove file:// prefix and decode
      path = decodeURIComponent(pathLike.pathname);
    } else {
      throw new Error(`Unsupported URL protocol: ${pathLike.protocol}`);
    }
  } else if (Buffer.isBuffer(pathLike)) {
    path = pathLike.toString('utf8');
  } else if (pathLike && typeof pathLike === 'object' && 'toString' in pathLike) {
    path = String(pathLike);
  } else {
    throw new TypeError(`Path must be a string, URL, or Buffer. Received: ${typeof pathLike}`);
  }

  // Resolve relative paths against cwd
  if (!path.startsWith('/') && getCwd) {
    const cwd = getCwd();
    path = cwd.endsWith('/') ? cwd + path : cwd + '/' + path;
  }

  return path;
}

// File descriptor tracking
interface FileDescriptor {
  path: string;
  position: number;
  flags: string;
  writable: boolean;
  append: boolean;
  content: Uint8Array;
  vfs: VirtualFS;
}

const fdMap = new Map<number, FileDescriptor>();
let nextFd = 3; // Start at 3 (0, 1, 2 are stdin, stdout, stderr)

function getOpenFileDescriptor(fd: number): FileDescriptor {
  const entry = fdMap.get(fd);
  if (!entry) {
    const err = new Error(`EBADF: bad file descriptor, write`) as Error & { code: string; errno: number };
    err.code = 'EBADF';
    err.errno = -9;
    throw err;
  }
  return entry;
}

function persistFileDescriptor(entry: FileDescriptor): void {
  if (entry.writable) {
    entry.vfs.writeFileSync(entry.path, entry.content);
  }
}

export function writeToFdSync(
  fd: number,
  buffer: Buffer | Uint8Array | string,
  offset?: number,
  length?: number,
  position?: number | null
): number {
  const entry = getOpenFileDescriptor(fd);

  let data: Uint8Array;
  if (typeof buffer === 'string') {
    data = _encoder.encode(buffer);
    offset = 0;
    length = data.length;
  } else {
    data = buffer;
    offset = offset ?? 0;
    length = length ?? (data.length - offset);
  }

  const writePos =
    position !== null && position !== undefined
      ? position
      : entry.append
        ? entry.content.length
        : entry.position;
  const endPos = writePos + length;

  if (endPos > entry.content.length) {
    const newContent = new Uint8Array(endPos);
    newContent.set(entry.content);
    entry.content = newContent;
  }

  for (let i = 0; i < length; i++) {
    entry.content[writePos + i] = data[offset + i];
  }

  if (position === null || position === undefined) {
    entry.position = endPos;
  }

  persistFileDescriptor(entry);
  return length;
}

export function writeFileDescriptorSync(fd: number, data: string | Uint8Array): void {
  const entry = getOpenFileDescriptor(fd);
  const bytes = typeof data === 'string' ? _encoder.encode(data) : data;
  entry.content = new Uint8Array(bytes);
  entry.position = bytes.length;
  persistFileDescriptor(entry);
}

export function truncateFdSync(fd: number, len: number = 0): void {
  const entry = getOpenFileDescriptor(fd);

  if (len < entry.content.length) {
    entry.content = entry.content.slice(0, len);
  } else if (len > entry.content.length) {
    const newContent = new Uint8Array(len);
    newContent.set(entry.content);
    entry.content = newContent;
  }

  if (entry.position > len) {
    entry.position = len;
  }

  persistFileDescriptor(entry);
}

// Call tracking for infinite loop detection
const callTracker = {
  statSync: new Map<string, number>(),
  readdirSync: new Map<string, number>(),
  lastReset: Date.now(),
};

function trackCall(method: 'statSync' | 'readdirSync', path: string): void {
  // Reset counters every 500ms to allow legitimate repeated calls
  const now = Date.now();
  if (now - callTracker.lastReset > 500) {
    callTracker.statSync.clear();
    callTracker.readdirSync.clear();
    callTracker.lastReset = now;
  }

  const map = callTracker[method];
  const count = (map.get(path) || 0) + 1;
  map.set(path, count);

  // Log at different thresholds to understand the pattern
  if (count === 10 && path.includes('_generated')) {
    console.warn(`[fs] ${method} called ${count}x on ${path}`);
    // Print full stack trace at 10 calls to see the call path
    const err = new Error();
    console.log(`[fs] Stack at ${count} calls:`, err.stack?.split('\n').slice(1, 10).join('\n'));
  }
  if (count === 50) {
    console.warn(`[fs] Potential infinite loop: ${method} called ${count}+ times on ${path}`);
  }
}

interface NormalizedOpenFlags {
  flagStr: string;
  readable: boolean;
  writable: boolean;
  create: boolean;
  exclusive: boolean;
  truncate: boolean;
  append: boolean;
}

function normalizeStringOpenFlags(flags: string): NormalizedOpenFlags {
  const normalizedFlags = flags.replace(/[bs]/g, '');
  const append = normalizedFlags.startsWith('a');
  const truncate = normalizedFlags.startsWith('w');
  const readable = normalizedFlags.startsWith('r') || normalizedFlags.includes('+');
  const writable = append || truncate || normalizedFlags.includes('+');
  const create = append || truncate;
  const exclusive = normalizedFlags.includes('x');

  return {
    flagStr: normalizedFlags,
    readable,
    writable,
    create,
    exclusive,
    truncate,
    append,
  };
}

function normalizeNumericOpenFlags(flags: number, constants: FsConstants): NormalizedOpenFlags {
  const accessMode = flags & 3;
  const append = (flags & constants.O_APPEND) !== 0;
  const truncate = (flags & constants.O_TRUNC) !== 0;
  const create = (flags & constants.O_CREAT) !== 0;
  const exclusive = (flags & constants.O_EXCL) !== 0;
  const readable = accessMode === constants.O_RDONLY || accessMode === constants.O_RDWR;
  const writable = accessMode === constants.O_WRONLY || accessMode === constants.O_RDWR;

  let flagStr = 'r';
  if (append) {
    flagStr = readable ? 'a+' : 'a';
  } else if (truncate) {
    flagStr = readable ? 'w+' : 'w';
  } else if (readable && writable) {
    flagStr = 'r+';
  } else if (writable) {
    flagStr = 'w';
  }

  return {
    flagStr,
    readable,
    writable,
    create,
    exclusive,
    truncate,
    append,
  };
}

function normalizeOpenFlags(flags: string | number, constants: FsConstants): NormalizedOpenFlags {
  return typeof flags === 'number'
    ? normalizeNumericOpenFlags(flags, constants)
    : normalizeStringOpenFlags(flags);
}

export function createFsShim(vfs: VirtualFS, getCwd?: () => string): FsShim {
  // Helper to resolve paths with cwd
  const resolvePath = (pathLike: unknown) => toPath(pathLike, getCwd);
  let shim!: FsShim;
  const constants: FsConstants = {
    F_OK: 0,
    R_OK: 4,
    W_OK: 2,
    X_OK: 1,
    O_RDONLY: 0,
    O_WRONLY: 1,
    O_RDWR: 2,
    O_CREAT: 64,
    O_EXCL: 128,
    O_TRUNC: 512,
    O_APPEND: 1024,
    O_NOFOLLOW: 131072,
  };

  const promises: FsPromises = {
    readFile(pathLike: unknown, encodingOrOptions?: string | { encoding?: string | null }): Promise<Buffer | string> {
      return new Promise((resolve, reject) => {
        try {
          const path = resolvePath(pathLike);
          let encoding: string | undefined;
          if (typeof encodingOrOptions === 'string') {
            encoding = encodingOrOptions;
          } else if (encodingOrOptions?.encoding) {
            encoding = encodingOrOptions.encoding;
          }

          if (encoding === 'utf8' || encoding === 'utf-8') {
            resolve(vfs.readFileSync(path, 'utf8'));
          } else {
            resolve(createBuffer(vfs.readFileSync(path)));
          }
        } catch (err) {
          reject(err);
        }
      });
    },
    open(pathLike: unknown, flags: string | number = 'r', mode?: number): Promise<FileHandle> {
      return new Promise((resolve, reject) => {
        try {
          const fd = shim.openSync(resolvePath(pathLike), flags, mode);
          resolve({
            get fd() {
              return fd;
            },
            async stat(): Promise<Stats> {
              return shim.fstatSync(fd);
            },
            async read<T extends Buffer | Uint8Array>(
              buffer: T,
              offset: number = 0,
              length: number = buffer.byteLength - offset,
              position: number | null = null
            ): Promise<{ bytesRead: number; buffer: T }> {
              const bytesRead = shim.readSync(fd, buffer, offset, length, position);
              return { bytesRead, buffer };
            },
            async appendFile(data: string | Uint8Array): Promise<void> {
              const entry = fdMap.get(fd);
              const position = entry?.append ? null : entry?.content.length ?? null;
              shim.writeSync(fd, data, undefined, undefined, position);
            },
            async writeFile(data: string | Uint8Array): Promise<void> {
              shim.ftruncateSync(fd, 0);
              shim.writeSync(fd, data, undefined, undefined, 0);
            },
            async close(): Promise<void> {
              shim.closeSync(fd);
            },
          });
        } catch (err) {
          reject(err);
        }
      });
    },
    appendFile(pathLike: unknown, data: string | Uint8Array): Promise<void> {
      return new Promise((resolve, reject) => {
        let fd: number | undefined;
        try {
          fd = shim.openSync(resolvePath(pathLike), 'a');
          shim.writeSync(fd, data);
          shim.closeSync(fd);
          resolve();
        } catch (err) {
          if (fd !== undefined) {
            try {
              shim.closeSync(fd);
            } catch {
              // Ignore close failures while surfacing the original append error.
            }
          }
          reject(err);
        }
      });
    },
    writeFile(pathLike: unknown, data: string | Uint8Array): Promise<void> {
      return new Promise((resolve, reject) => {
        try {
          vfs.writeFileSync(resolvePath(pathLike), data);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    },
    stat(pathLike: string | unknown): Promise<Stats> {
      return new Promise((resolve, reject) => {
        try {
          const path = typeof pathLike === 'string' ? pathLike : resolvePath(pathLike);
          resolve(vfs.statSync(path));
        } catch (err) {
          reject(err);
        }
      });
    },
    lstat(pathLike: unknown): Promise<Stats> {
      return this.stat(resolvePath(pathLike));
    },
    readdir(pathLike: unknown, options?: { withFileTypes?: boolean } | string): Promise<string[] | Dirent[]> {
      return new Promise((resolve, reject) => {
        try {
          const path = resolvePath(pathLike);
          const entries = vfs.readdirSync(path);
          const opts = typeof options === 'string' ? {} : options;
          if (opts?.withFileTypes) {
            const dirents = entries.map(name => {
              const entryPath = path.endsWith('/') ? path + name : path + '/' + name;
              let isDir = false;
              let isFile = false;
              try {
                const stat = vfs.statSync(entryPath);
                isDir = stat.isDirectory();
                isFile = stat.isFile();
              } catch {
                isFile = true;
              }
              return new Dirent(name, isDir, isFile);
            });
            resolve(dirents);
          } else {
            resolve(entries);
          }
        } catch (err) {
          reject(err);
        }
      });
    },
    mkdir(pathLike: unknown, options?: { recursive?: boolean }): Promise<void> {
      return new Promise((resolve, reject) => {
        try {
          vfs.mkdirSync(resolvePath(pathLike), options);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    },
    unlink(pathLike: unknown): Promise<void> {
      return new Promise((resolve, reject) => {
        try {
          vfs.unlinkSync(resolvePath(pathLike));
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    },
    rmdir(path: string): Promise<void> {
      return new Promise((resolve, reject) => {
        try {
          vfs.rmdirSync(path);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    },
    rename(oldPath: string, newPath: string): Promise<void> {
      return new Promise((resolve, reject) => {
        try {
          vfs.renameSync(oldPath, newPath);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    },
    rm(pathLike: unknown, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
      return new Promise((resolve, reject) => {
        try {
          const path = resolvePath(pathLike);
          const opts = options || {};

          if (!vfs.existsSync(path)) {
            if (opts.force) {
              resolve();
              return;
            }
            reject(createNodeError('ENOENT', 'rm', path));
            return;
          }

          const removeRecursive = (target: string) => {
            const stats = vfs.statSync(target);
            if (!stats.isDirectory()) {
              vfs.unlinkSync(target);
              return;
            }

            const entries = vfs.readdirSync(target);
            for (const entry of entries) {
              const child = target.endsWith('/') ? `${target}${entry}` : `${target}/${entry}`;
              removeRecursive(child);
            }
            vfs.rmdirSync(target);
          };

          const stats = vfs.statSync(path);
          if (stats.isDirectory()) {
            if (!opts.recursive) {
              reject(createNodeError('EISDIR', 'rm', path));
              return;
            }
            removeRecursive(path);
            resolve();
            return;
          }

          vfs.unlinkSync(path);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    },
    mkdtemp(prefix: string): Promise<string> {
      return new Promise((resolve, reject) => {
        try {
          const suffix = Math.random().toString(36).slice(2, 8);
          const tempDir = resolvePath(`${prefix}${suffix}`);
          vfs.mkdirSync(tempDir, { recursive: true });
          resolve(tempDir);
        } catch (err) {
          reject(err);
        }
      });
    },
    access(path: string, mode?: number): Promise<void> {
      return new Promise((resolve, reject) => {
        try {
          console.log(`[almostnode DEBUG] fs.promises.access start: ${path}`);
          vfs.accessSync(path, mode);
          console.log(`[almostnode DEBUG] fs.promises.access ok: ${path}`);
          resolve();
        } catch (err) {
          console.log(`[almostnode DEBUG] fs.promises.access error: ${path} -> ${(err as Error).message}`);
          reject(err);
        }
      });
    },
    realpath(path: string): Promise<string> {
      return new Promise((resolve, reject) => {
        try {
          resolve(vfs.realpathSync(path));
        } catch (err) {
          reject(err);
        }
      });
    },
    copyFile(src: string, dest: string): Promise<void> {
      return new Promise((resolve, reject) => {
        try {
          vfs.copyFileSync(src, dest);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    },
    utimes(pathLike: unknown, _atime: TimeLike, _mtime: TimeLike): Promise<void> {
      return new Promise((resolve, reject) => {
        try {
          const path = resolvePath(pathLike);
          if (!vfs.existsSync(path)) {
            reject(createNodeError('ENOENT', 'utimes', path));
            return;
          }
          // No-op: VirtualFS does not currently persist explicit atime/mtime updates.
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    },
  } as FsPromises;

  shim = {
    readFileSync(
      pathLike: unknown,
      encodingOrOptions?: string | { encoding?: string | null }
    ): Buffer | string {
      const path = resolvePath(pathLike);
      let encoding: string | undefined;

      if (typeof encodingOrOptions === 'string') {
        encoding = encodingOrOptions;
      } else if (encodingOrOptions?.encoding) {
        encoding = encodingOrOptions.encoding;
      }

      if (encoding === 'utf8' || encoding === 'utf-8') {
        return vfs.readFileSync(path, 'utf8');
      }

      const data = vfs.readFileSync(path);
      return createBuffer(data);
    },

    writeFileSync(pathLike: unknown, data: string | Uint8Array): void {
      // Handle file descriptor
      if (typeof pathLike === 'number') {
        const fd = pathLike;
        const entry = fdMap.get(fd);
        if (!entry) {
          const err = new Error(`EBADF: bad file descriptor, write`) as Error & { code: string; errno: number };
          err.code = 'EBADF';
          err.errno = -9;
          throw err;
        }
        writeFileDescriptorSync(fd, data);
        return;
      }
      const path = resolvePath(pathLike);
      vfs.writeFileSync(path, data);
    },

    existsSync(pathLike: unknown): boolean {
      return vfs.existsSync(resolvePath(pathLike));
    },

    mkdirSync(pathLike: unknown, options?: { recursive?: boolean }): void {
      const path = resolvePath(pathLike);
      vfs.mkdirSync(path, options);
    },

    readdirSync(pathLike: unknown, options?: { withFileTypes?: boolean; encoding?: string } | string): string[] | Dirent[] {
      const path = resolvePath(pathLike);
      trackCall('readdirSync', path);
      const entries = vfs.readdirSync(path);

      // Handle withFileTypes option - returns Dirent objects instead of strings
      const opts = typeof options === 'string' ? { encoding: options } : options;
      if (opts?.withFileTypes) {
        const dirents: Dirent[] = entries.map(name => {
          const entryPath = path.endsWith('/') ? path + name : path + '/' + name;
          let isDir = false;
          let isFile = false;
          try {
            const stat = vfs.statSync(entryPath);
            isDir = stat.isDirectory();
            isFile = stat.isFile();
          } catch {
            isFile = true; // Default to file if stat fails
          }
          return new Dirent(name, isDir, isFile);
        });
        // Debug: Log readdirSync results for _generated
        if (path.includes('_generated')) {
          console.log(`[fs] readdirSync(${path}, withFileTypes) -> [${dirents.map(d => d.name).join(', ')}]`);
        }
        return dirents;
      }

      // Debug: Log readdirSync results for _generated
      if (path.includes('_generated')) {
        console.log(`[fs] readdirSync(${path}) -> [${entries.join(', ')}]`);
      }
      return entries;
    },

    statSync(pathLike: unknown): Stats {
      const origPath = typeof pathLike === 'string' ? pathLike : String(pathLike);
      const path = resolvePath(pathLike);
      trackCall('statSync', path);
      const result = vfs.statSync(path);
      // Debug: Log all statSync calls on _generated paths (show if path was modified)
      if (path.includes('_generated')) {
        const wasRemapped = origPath !== path;
        console.log(`[fs] statSync(${origPath}${wasRemapped ? ' -> ' + path : ''}) -> isDir: ${result.isDirectory()}`);
      }
      return result;
    },

    lstatSync(pathLike: unknown): Stats {
      return vfs.lstatSync(resolvePath(pathLike));
    },

    fstatSync(fd: number): Stats {
      const entry = fdMap.get(fd);
      if (!entry) {
        const err = new Error(`EBADF: bad file descriptor, fstat`) as Error & { code: string; errno: number };
        err.code = 'EBADF';
        err.errno = -9;
        throw err;
      }
      return vfs.statSync(entry.path);
    },

    openSync(pathLike: unknown, flags: string | number, _mode?: number): number {
      const path = resolvePath(pathLike);
      const normalizedFlags = normalizeOpenFlags(flags, constants);

      let exists = vfs.existsSync(path);

      if (exists && normalizedFlags.create && normalizedFlags.exclusive) {
        throw createNodeError('EEXIST', 'open', path);
      }

      if (!exists && !normalizedFlags.create) {
        const err = new Error(`ENOENT: no such file or directory, open '${path}'`) as Error & { code: string; errno: number; path: string };
        err.code = 'ENOENT';
        err.errno = -2;
        err.path = path;
        throw err;
      }

      if ((normalizedFlags.writable || normalizedFlags.create) && !exists) {
        const parentPath = path.substring(0, path.lastIndexOf('/')) || '/';
        if (!vfs.existsSync(parentPath)) {
          vfs.mkdirSync(parentPath, { recursive: true });
        }
      }

      if (!exists && normalizedFlags.create) {
        vfs.writeFileSync(path, new Uint8Array(0));
        exists = true;
      }

      let content = exists ? vfs.readFileSync(path) : new Uint8Array(0);
      if (normalizedFlags.truncate) {
        content = new Uint8Array(0);
        vfs.writeFileSync(path, content);
      }

      const fd = nextFd++;
      fdMap.set(fd, {
        path,
        position: normalizedFlags.append ? content.length : 0,
        flags: normalizedFlags.flagStr,
        writable: normalizedFlags.writable,
        append: normalizedFlags.append,
        content: new Uint8Array(content),
        vfs,
      });
      return fd;
    },

    closeSync(fd: number): void {
      const entry = fdMap.get(fd);
      if (!entry) {
        return; // Silently ignore
      }
      // Write back content if it was opened for writing
      persistFileDescriptor(entry);
      fdMap.delete(fd);
    },

    readSync(fd: number, buffer: Buffer | Uint8Array, offset: number, length: number, position: number | null): number {
      const entry = fdMap.get(fd);
      if (!entry) {
        const err = new Error(`EBADF: bad file descriptor, read`) as Error & { code: string; errno: number };
        err.code = 'EBADF';
        err.errno = -9;
        throw err;
      }

      const readPos = position !== null ? position : entry.position;
      const bytesToRead = Math.min(length, entry.content.length - readPos);

      if (bytesToRead <= 0) {
        return 0;
      }

      for (let i = 0; i < bytesToRead; i++) {
        buffer[offset + i] = entry.content[readPos + i];
      }

      if (position === null) {
        entry.position += bytesToRead;
      }

      return bytesToRead;
    },

    writeSync(fd: number, buffer: Buffer | Uint8Array | string, offset?: number, length?: number, position?: number | null): number {
      return writeToFdSync(fd, buffer, offset, length, position);
    },

    ftruncateSync(fd: number, len: number = 0): void {
      truncateFdSync(fd, len);
    },

    fsyncSync(_fd: number): void {
      // No-op - our virtual FS doesn't have disk buffering
    },

    fdatasyncSync(_fd: number): void {
      // No-op - our virtual FS doesn't have disk buffering
    },

    mkdtempSync(prefix: string): string {
      // Generate a unique suffix
      const suffix = Math.random().toString(36).slice(2, 8);
      const tempDir = `${prefix}${suffix}`;
      const resolvedPath = resolvePath(tempDir);
      vfs.mkdirSync(resolvedPath, { recursive: true });
      return resolvedPath;
    },

    rmSync(pathLike: unknown, options?: { recursive?: boolean; force?: boolean }): void {
      const path = resolvePath(pathLike);
      if (!vfs.existsSync(path)) {
        if (options?.force) return;
        throw createNodeError('ENOENT', 'rm', path);
      }
      const stats = vfs.statSync(path);
      if (stats.isDirectory()) {
        if (options?.recursive) {
          // Recursively delete directory contents
          const entries = vfs.readdirSync(path);
          for (const entry of entries) {
            const entryPath = path.endsWith('/') ? path + entry : path + '/' + entry;
            this.rmSync(entryPath, options);
          }
          vfs.rmdirSync(path);
        } else {
          throw createNodeError('EISDIR', 'rm', path);
        }
      } else {
        vfs.unlinkSync(path);
      }
    },

    unlinkSync(pathLike: unknown): void {
      const path = resolvePath(pathLike);
      // Debug: Log unlink calls on _generated
      if (path.includes('_generated')) {
        console.log(`[fs] unlinkSync(${path})`);
      }
      vfs.unlinkSync(path);
    },

    rmdirSync(pathLike: unknown): void {
      vfs.rmdirSync(resolvePath(pathLike));
    },

    renameSync(oldPathLike: unknown, newPathLike: unknown): void {
      vfs.renameSync(resolvePath(oldPathLike), resolvePath(newPathLike));
    },

    realpathSync: Object.assign(
      function realpathSync(pathLike: unknown): string {
        return vfs.realpathSync(resolvePath(pathLike));
      },
      {
        native(pathLike: unknown): string {
          return vfs.realpathSync(resolvePath(pathLike));
        },
      }
    ),

    accessSync(pathLike: unknown, _mode?: number): void {
      const path = resolvePath(pathLike);
      console.log(`[almostnode DEBUG] fs.accessSync: ${path}`);
      vfs.accessSync(path);
    },

    copyFileSync(srcLike: unknown, destLike: unknown): void {
      const src = resolvePath(srcLike);
      const dest = resolvePath(destLike);
      const data = vfs.readFileSync(src);
      vfs.writeFileSync(dest, data);
    },

    utimesSync(pathLike: unknown, _atime: TimeLike, _mtime: TimeLike): void {
      const path = resolvePath(pathLike);
      if (!vfs.existsSync(path)) {
        throw createNodeError('ENOENT', 'utimes', path);
      }
      // No-op: VirtualFS does not currently persist explicit atime/mtime updates.
    },

    watch(
      pathLike: unknown,
      optionsOrListener?: { persistent?: boolean; recursive?: boolean } | WatchListener,
      listener?: WatchListener
    ): FSWatcher {
      return vfs.watch(resolvePath(pathLike), optionsOrListener as { persistent?: boolean; recursive?: boolean }, listener);
    },

    readFile(
      pathLike: unknown,
      optionsOrCallback?: string | { encoding?: string } | ((err: Error | null, data?: string | Uint8Array) => void),
      callback?: (err: Error | null, data?: string | Uint8Array) => void
    ): void {
      const path = resolvePath(pathLike);
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      const opts = typeof optionsOrCallback === 'string'
        ? { encoding: optionsOrCallback }
        : (typeof optionsOrCallback === 'object' ? optionsOrCallback : undefined);

      if (!cb) return;
      if (opts) {
        vfs.readFile(path, opts, cb);
      } else {
        vfs.readFile(path, cb);
      }
    },

    writeFile(
      pathLike: unknown,
      data: string | Uint8Array,
      optionsOrCallback?: { encoding?: string; mode?: number; flag?: string } | ((err: Error | null) => void),
      callback?: (err: Error | null) => void
    ): void {
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      try {
        vfs.writeFileSync(resolvePath(pathLike), data);
        if (cb) queueMicrotask(() => cb(null));
      } catch (err) {
        if (cb) queueMicrotask(() => cb(err as Error));
      }
    },

    mkdir(
      pathLike: unknown,
      optionsOrCallback?: { recursive?: boolean; mode?: number } | ((err: Error | null) => void),
      callback?: (err: Error | null) => void
    ): void {
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
      try {
        vfs.mkdirSync(resolvePath(pathLike), options);
        if (cb) queueMicrotask(() => cb(null));
      } catch (err) {
        if (cb) queueMicrotask(() => cb(err as Error));
      }
    },

    mkdtemp(prefix: string, callback: (err: Error | null, directory?: string) => void): void {
      promises.mkdtemp(prefix).then(
        (dir) => queueMicrotask(() => callback(null, dir)),
        (err) => queueMicrotask(() => callback(err as Error))
      );
    },

    stat(
      pathLike: unknown,
      optionsOrCallback: unknown,
      callback?: (err: Error | null, stats?: Stats) => void
    ): void {
      const cb = typeof optionsOrCallback === 'function'
        ? optionsOrCallback as (err: Error | null, stats?: Stats) => void
        : callback;
      if (!cb) return;
      vfs.stat(resolvePath(pathLike), cb);
    },

    lstat(
      pathLike: unknown,
      optionsOrCallback: unknown,
      callback?: (err: Error | null, stats?: Stats) => void
    ): void {
      const cb = typeof optionsOrCallback === 'function'
        ? optionsOrCallback as (err: Error | null, stats?: Stats) => void
        : callback;
      if (!cb) return;
      vfs.lstat(resolvePath(pathLike), cb);
    },

    readdir(
      pathLike: unknown,
      optionsOrCallback?: { withFileTypes?: boolean } | ((err: Error | null, files?: string[] | Dirent[]) => void),
      callback?: (err: Error | null, files?: string[] | Dirent[]) => void
    ): void {
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      const opts = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
      const path = resolvePath(pathLike);
      try {
        const entries = vfs.readdirSync(path);
        if (opts?.withFileTypes) {
          const dirents: Dirent[] = entries.map(name => {
            const entryPath = path.endsWith('/') ? path + name : path + '/' + name;
            let isDir = false;
            let isFile = false;
            try {
              const stat = vfs.statSync(entryPath);
              isDir = stat.isDirectory();
              isFile = stat.isFile();
            } catch {
              isFile = true;
            }
            return new Dirent(name, isDir, isFile);
          });
          cb?.(null, dirents);
        } else {
          cb?.(null, entries);
        }
      } catch (err) {
        cb?.(err as Error);
      }
    },

    realpath: Object.assign(
      function realpath(
        pathLike: unknown,
        optionsOrCallback: unknown,
        callback?: (err: Error | null, resolvedPath?: string) => void
      ): void {
        const cb = typeof optionsOrCallback === 'function'
          ? optionsOrCallback as (err: Error | null, resolvedPath?: string) => void
          : callback;
        if (!cb) return;
        vfs.realpath(resolvePath(pathLike), cb);
      },
      {
        native(
          pathLike: unknown,
          optionsOrCallback: unknown,
          callback?: (err: Error | null, resolvedPath?: string) => void
        ): void {
          const cb = typeof optionsOrCallback === 'function'
            ? optionsOrCallback as (err: Error | null, resolvedPath?: string) => void
            : callback;
          if (!cb) return;
          vfs.realpath(resolvePath(pathLike), cb);
        },
      }
    ),

    unlink(pathLike: unknown, callback: (err: Error | null) => void): void {
      try {
        vfs.unlinkSync(resolvePath(pathLike));
        queueMicrotask(() => callback(null));
      } catch (err) {
        queueMicrotask(() => callback(err as Error));
      }
    },

    rmdir(pathLike: unknown, callback: (err: Error | null) => void): void {
      try {
        vfs.rmdirSync(resolvePath(pathLike));
        queueMicrotask(() => callback(null));
      } catch (err) {
        queueMicrotask(() => callback(err as Error));
      }
    },

    rename(oldPathLike: unknown, newPathLike: unknown, callback: (err: Error | null) => void): void {
      try {
        vfs.renameSync(resolvePath(oldPathLike), resolvePath(newPathLike));
        queueMicrotask(() => callback(null));
      } catch (err) {
        queueMicrotask(() => callback(err as Error));
      }
    },

    copyFile(srcLike: unknown, destLike: unknown, callback: (err: Error | null) => void): void {
      try {
        const src = resolvePath(srcLike);
        const dest = resolvePath(destLike);
        const data = vfs.readFileSync(src);
        vfs.writeFileSync(dest, data);
        queueMicrotask(() => callback(null));
      } catch (err) {
        queueMicrotask(() => callback(err as Error));
      }
    },

    rm(
      pathLike: unknown,
      optionsOrCallback?: { recursive?: boolean; force?: boolean } | ((err: Error | null) => void),
      callback?: (err: Error | null) => void
    ): void {
      const cb = typeof optionsOrCallback === 'function' ? optionsOrCallback : callback;
      const options = typeof optionsOrCallback === 'function' ? undefined : optionsOrCallback;
      if (!cb) return;

      promises.rm(pathLike as PathLike, options).then(
        () => queueMicrotask(() => cb(null)),
        (err) => queueMicrotask(() => cb(err as Error))
      );
    },

    access(
      pathLike: unknown,
      modeOrCallback?: number | ((err: Error | null) => void),
      callback?: (err: Error | null) => void
    ): void {
      const path = resolvePath(pathLike);
      console.log(`[almostnode DEBUG] fs.access: ${path}`);
      vfs.access(path, modeOrCallback, callback);
    },

    utimes(pathLike: unknown, _atime: TimeLike, _mtime: TimeLike, callback: (err: Error | null) => void): void {
      try {
        const path = resolvePath(pathLike);
        if (!vfs.existsSync(path)) {
          queueMicrotask(() => callback(createNodeError('ENOENT', 'utimes', path)));
          return;
        }
        // No-op: VirtualFS does not currently persist explicit atime/mtime updates.
        queueMicrotask(() => callback(null));
      } catch (err) {
        queueMicrotask(() => callback(err as Error));
      }
    },

    createReadStream(pathLike: unknown): unknown {
      return vfs.createReadStream(resolvePath(pathLike));
    },

    createWriteStream(pathLike: unknown): unknown {
      return vfs.createWriteStream(resolvePath(pathLike));
    },

    promises,
    constants,
  } as FsShim;

  return shim;
}

export default createFsShim;
