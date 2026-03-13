/**
 * Node.js tty module shim
 * Provides terminal detection utilities
 */

import { Readable, Writable } from './stream';

export class ReadStream extends Readable {
  isTTY: boolean = false;
  isRaw: boolean = false;

  setRawMode(mode: boolean): this {
    this.isRaw = mode;
    return this;
  }
}

export class WriteStream extends Writable {
  isTTY: boolean = false;
  columns: number = 80;
  rows: number = 24;

  clearLine(dir: number, callback?: () => void): boolean {
    if (callback) callback();
    return true;
  }

  clearScreenDown(callback?: () => void): boolean {
    if (callback) callback();
    return true;
  }

  cursorTo(x: number, y?: number, callback?: () => void): boolean {
    if (callback) callback();
    return true;
  }

  moveCursor(dx: number, dy: number, callback?: () => void): boolean {
    if (callback) callback();
    return true;
  }

  getColorDepth(env?: object): number {
    return this.isTTY ? 8 : 1;
  }

  hasColors(count?: number | object, env?: object): boolean {
    if (!this.isTTY) return false;
    const depth = this.getColorDepth(typeof count === 'object' ? count : env);
    const needed = typeof count === 'number' ? count : 16;
    return (2 ** depth) >= needed;
  }

  getWindowSize(): [number, number] {
    return [this.columns, this.rows];
  }
}

export function isatty(fd: number): boolean {
  try {
    const proc = (globalThis as any).process;
    if (!proc) return false;
    if (fd === 0) return !!proc.stdin?.isTTY;
    if (fd === 1) return !!proc.stdout?.isTTY;
    if (fd === 2) return !!proc.stderr?.isTTY;
  } catch {
    // fall through
  }
  return false;
}

export default {
  ReadStream,
  WriteStream,
  isatty,
};
