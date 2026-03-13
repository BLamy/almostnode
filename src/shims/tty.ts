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
    if (this.isTTY) {
      if (dir === -1) this.write('\x1b[1K');
      else if (dir === 1) this.write('\x1b[0K');
      else this.write('\x1b[2K');
    }
    if (callback) callback();
    return true;
  }

  clearScreenDown(callback?: () => void): boolean {
    if (this.isTTY) {
      this.write('\x1b[0J');
    }
    if (callback) callback();
    return true;
  }

  cursorTo(x: number, y?: number, callback?: () => void): boolean {
    if (this.isTTY) {
      if (y != null) {
        this.write(`\x1b[${y + 1};${x + 1}H`);
      } else {
        this.write(`\x1b[${x + 1}G`);
      }
    }
    if (callback) callback();
    return true;
  }

  moveCursor(dx: number, dy: number, callback?: () => void): boolean {
    if (this.isTTY) {
      let seq = '';
      if (dx > 0) seq += `\x1b[${dx}C`;
      else if (dx < 0) seq += `\x1b[${-dx}D`;
      if (dy > 0) seq += `\x1b[${dy}B`;
      else if (dy < 0) seq += `\x1b[${-dy}A`;
      if (seq) this.write(seq);
    }
    if (callback) callback();
    return true;
  }

  getColorDepth(env?: object): number {
    return this.isTTY ? 24 : 1;
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
