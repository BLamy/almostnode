/**
 * Node.js zlib module shim
 * Provides basic compression utilities
 */

import { Buffer, Transform } from './stream';
import pako from 'pako';

// Brotli WASM instance - loaded lazily
type BrotliModule = { compress: (data: Uint8Array) => Uint8Array; decompress: (data: Uint8Array) => Uint8Array };
let brotliModule: BrotliModule | null = null;
let brotliLoadPromise: Promise<BrotliModule | null> | null = null;

async function loadBrotli(): Promise<BrotliModule | null> {
  if (brotliModule) return brotliModule;
  if (!brotliLoadPromise) {
    brotliLoadPromise = (async () => {
      try {
        // Dynamic import - brotli-wasm handles environment detection automatically
        // In Node.js: returns sync module
        // In browser: returns promise that resolves after WASM init
        const brotliWasmModule = await import('brotli-wasm');
        // The default export is a promise that resolves to the module
        brotliModule = await brotliWasmModule.default;
        console.log('[zlib] brotli-wasm loaded successfully');
        return brotliModule;
      } catch (error) {
        console.error('[zlib] Failed to load brotli-wasm:', error);
        return null;
      }
    })();
  }
  return brotliLoadPromise;
}

export function gzip(
  buffer: Buffer | string,
  callback: (error: Error | null, result: Buffer) => void
): void {
  try {
    const input = typeof buffer === 'string' ? Buffer.from(buffer) : buffer;
    const result = pako.gzip(input);
    callback(null, Buffer.from(result));
  } catch (error) {
    callback(error as Error, Buffer.alloc(0));
  }
}

export function gunzip(
  buffer: Buffer,
  callback: (error: Error | null, result: Buffer) => void
): void {
  try {
    const result = pako.ungzip(buffer);
    callback(null, Buffer.from(result));
  } catch (error) {
    callback(error as Error, Buffer.alloc(0));
  }
}

export function deflate(
  buffer: Buffer | string,
  callback: (error: Error | null, result: Buffer) => void
): void {
  try {
    const input = typeof buffer === 'string' ? Buffer.from(buffer) : buffer;
    const result = pako.deflate(input);
    callback(null, Buffer.from(result));
  } catch (error) {
    callback(error as Error, Buffer.alloc(0));
  }
}

export function inflate(
  buffer: Buffer,
  callback: (error: Error | null, result: Buffer) => void
): void {
  try {
    const result = pako.inflate(buffer);
    callback(null, Buffer.from(result));
  } catch (error) {
    callback(error as Error, Buffer.alloc(0));
  }
}

export function deflateRaw(
  buffer: Buffer | string,
  callback: (error: Error | null, result: Buffer) => void
): void {
  try {
    const input = typeof buffer === 'string' ? Buffer.from(buffer) : buffer;
    const result = pako.deflateRaw(input);
    callback(null, Buffer.from(result));
  } catch (error) {
    callback(error as Error, Buffer.alloc(0));
  }
}

export function inflateRaw(
  buffer: Buffer,
  callback: (error: Error | null, result: Buffer) => void
): void {
  try {
    const result = pako.inflateRaw(buffer);
    callback(null, Buffer.from(result));
  } catch (error) {
    callback(error as Error, Buffer.alloc(0));
  }
}

// Brotli compression using brotli-wasm
export function brotliCompress(
  buffer: Buffer | string,
  options: unknown,
  callback: (error: Error | null, result: Buffer) => void
): void {
  // Handle overload where options is the callback
  if (typeof options === 'function') {
    callback = options as (error: Error | null, result: Buffer) => void;
  }

  loadBrotli().then(brotli => {
    if (!brotli) {
      callback(new Error('Brotli WASM failed to load'), Buffer.alloc(0));
      return;
    }
    try {
      const input = typeof buffer === 'string' ? Buffer.from(buffer) : buffer;
      const result = brotli.compress(new Uint8Array(input));
      callback(null, Buffer.from(result));
    } catch (error) {
      callback(error as Error, Buffer.alloc(0));
    }
  }).catch(error => {
    callback(error as Error, Buffer.alloc(0));
  });
}

export function brotliDecompress(
  buffer: Buffer,
  options: unknown,
  callback: (error: Error | null, result: Buffer) => void
): void {
  // Handle overload where options is the callback
  if (typeof options === 'function') {
    callback = options as (error: Error | null, result: Buffer) => void;
  }

  loadBrotli().then(brotli => {
    if (!brotli) {
      callback(new Error('Brotli WASM failed to load'), Buffer.alloc(0));
      return;
    }
    try {
      const result = brotli.decompress(new Uint8Array(buffer));
      callback(null, Buffer.from(result));
    } catch (error) {
      callback(error as Error, Buffer.alloc(0));
    }
  }).catch(error => {
    callback(error as Error, Buffer.alloc(0));
  });
}

export function brotliCompressSync(buffer: Buffer | string, _options?: unknown): Buffer {
  if (!brotliModule) {
    throw new Error('Brotli WASM not loaded. Call brotliCompress first to initialize.');
  }
  const input = typeof buffer === 'string' ? Buffer.from(buffer) : buffer;
  return Buffer.from(brotliModule.compress(new Uint8Array(input)));
}

export function brotliDecompressSync(buffer: Buffer, _options?: unknown): Buffer {
  if (!brotliModule) {
    throw new Error('Brotli WASM not loaded. Call brotliDecompress first to initialize.');
  }
  return Buffer.from(brotliModule.decompress(new Uint8Array(buffer)));
}

// Sync versions
export function gzipSync(buffer: Buffer | string): Buffer {
  const input = typeof buffer === 'string' ? Buffer.from(buffer) : buffer;
  return Buffer.from(pako.gzip(input));
}

export function gunzipSync(buffer: Buffer): Buffer {
  return Buffer.from(pako.ungzip(buffer));
}

export function deflateSync(buffer: Buffer | string): Buffer {
  const input = typeof buffer === 'string' ? Buffer.from(buffer) : buffer;
  return Buffer.from(pako.deflate(input));
}

export function inflateSync(buffer: Buffer): Buffer {
  return Buffer.from(pako.inflate(buffer));
}

export function deflateRawSync(buffer: Buffer | string): Buffer {
  const input = typeof buffer === 'string' ? Buffer.from(buffer) : buffer;
  return Buffer.from(pako.deflateRaw(input));
}

export function inflateRawSync(buffer: Buffer): Buffer {
  return Buffer.from(pako.inflateRaw(buffer));
}

// Streaming factory functions — return Transform streams that collect input
// and decompress/compress on flush. Used by node-fetch, got, etc.

class ZlibTransform extends Transform {
  private _chunks: Uint8Array[] = [];
  private _processor: (buf: Uint8Array) => Uint8Array;

  constructor(processor: (buf: Uint8Array) => Uint8Array) {
    super();
    this._processor = processor;
  }

  _transform(
    chunk: Buffer | Uint8Array,
    _encoding: string,
    callback: (error?: Error | null, data?: Buffer | Uint8Array) => void
  ): void {
    this._chunks.push(new Uint8Array(chunk));
    callback();
  }

  _flush(callback: (error?: Error | null, data?: Buffer) => void): void {
    try {
      const totalLen = this._chunks.reduce((sum, c) => sum + c.length, 0);
      const combined = new Uint8Array(totalLen);
      let offset = 0;
      for (const chunk of this._chunks) {
        combined.set(chunk, offset);
        offset += chunk.length;
      }
      const result = this._processor(combined);
      callback(null, Buffer.from(result));
    } catch (error) {
      callback(error as Error);
    }
  }
}

class BrotliTransform extends Transform {
  private _chunks: Uint8Array[] = [];
  private _mode: 'compress' | 'decompress';

  constructor(mode: 'compress' | 'decompress') {
    super();
    this._mode = mode;
  }

  _transform(
    chunk: Buffer | Uint8Array,
    _encoding: string,
    callback: (error?: Error | null, data?: Buffer | Uint8Array) => void
  ): void {
    this._chunks.push(new Uint8Array(chunk));
    callback();
  }

  _flush(callback: (error?: Error | null, data?: Buffer) => void): void {
    const totalLen = this._chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Uint8Array(totalLen);
    let offset = 0;
    for (const chunk of this._chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    loadBrotli().then(brotli => {
      if (!brotli) {
        callback(new Error('Brotli WASM failed to load'));
        return;
      }
      try {
        const result = this._mode === 'compress'
          ? brotli.compress(combined)
          : brotli.decompress(combined);
        callback(null, Buffer.from(result));
      } catch (error) {
        callback(error as Error);
      }
    }).catch(error => callback(error as Error));
  }
}

export function createGzip(_options?: unknown): Transform {
  return new ZlibTransform((buf) => pako.gzip(buf));
}

export function createGunzip(_options?: unknown): Transform {
  return new ZlibTransform((buf) => pako.ungzip(buf));
}

export function createDeflate(_options?: unknown): Transform {
  return new ZlibTransform((buf) => pako.deflate(buf));
}

export function createInflate(_options?: unknown): Transform {
  return new ZlibTransform((buf) => pako.inflate(buf));
}

export function createDeflateRaw(_options?: unknown): Transform {
  return new ZlibTransform((buf) => pako.deflateRaw(buf));
}

export function createInflateRaw(_options?: unknown): Transform {
  return new ZlibTransform((buf) => pako.inflateRaw(buf));
}

export function createBrotliCompress(_options?: unknown): Transform {
  return new BrotliTransform('compress');
}

export function createBrotliDecompress(_options?: unknown): Transform {
  return new BrotliTransform('decompress');
}

// Unzip handles both gzip and deflate
export function createUnzip(_options?: unknown): Transform {
  return new ZlibTransform((buf) => {
    // Try gzip first, fall back to inflate
    try {
      return pako.ungzip(buf);
    } catch {
      return pako.inflate(buf);
    }
  });
}

// Constants
export const constants = {
  Z_NO_FLUSH: 0,
  Z_PARTIAL_FLUSH: 1,
  Z_SYNC_FLUSH: 2,
  Z_FULL_FLUSH: 3,
  Z_FINISH: 4,
  Z_BLOCK: 5,
  Z_OK: 0,
  Z_STREAM_END: 1,
  Z_NEED_DICT: 2,
  Z_ERRNO: -1,
  Z_STREAM_ERROR: -2,
  Z_DATA_ERROR: -3,
  Z_MEM_ERROR: -4,
  Z_BUF_ERROR: -5,
  Z_VERSION_ERROR: -6,
  Z_NO_COMPRESSION: 0,
  Z_BEST_SPEED: 1,
  Z_BEST_COMPRESSION: 9,
  Z_DEFAULT_COMPRESSION: -1,
  Z_FILTERED: 1,
  Z_HUFFMAN_ONLY: 2,
  Z_RLE: 3,
  Z_FIXED: 4,
  Z_DEFAULT_STRATEGY: 0,
  ZLIB_VERNUM: 4784,
  Z_MIN_WINDOWBITS: 8,
  Z_MAX_WINDOWBITS: 15,
  Z_DEFAULT_WINDOWBITS: 15,
  Z_MIN_CHUNK: 64,
  Z_MAX_CHUNK: Infinity,
  Z_DEFAULT_CHUNK: 16384,
  Z_MIN_MEMLEVEL: 1,
  Z_MAX_MEMLEVEL: 9,
  Z_DEFAULT_MEMLEVEL: 8,
  Z_MIN_LEVEL: -1,
  Z_MAX_LEVEL: 9,
  Z_DEFAULT_LEVEL: -1,
  // Brotli constants
  BROTLI_DECODE: 0,
  BROTLI_ENCODE: 1,
  BROTLI_OPERATION_PROCESS: 0,
  BROTLI_OPERATION_FLUSH: 1,
  BROTLI_OPERATION_FINISH: 2,
  BROTLI_OPERATION_EMIT_METADATA: 3,
  BROTLI_PARAM_MODE: 0,
  BROTLI_MODE_GENERIC: 0,
  BROTLI_MODE_TEXT: 1,
  BROTLI_MODE_FONT: 2,
  BROTLI_PARAM_QUALITY: 1,
  BROTLI_MIN_QUALITY: 0,
  BROTLI_MAX_QUALITY: 11,
  BROTLI_DEFAULT_QUALITY: 11,
  BROTLI_PARAM_LGWIN: 2,
  BROTLI_MIN_WINDOW_BITS: 10,
  BROTLI_MAX_WINDOW_BITS: 24,
  BROTLI_DEFAULT_WINDOW: 22,
  BROTLI_PARAM_LGBLOCK: 3,
  BROTLI_MIN_INPUT_BLOCK_BITS: 16,
  BROTLI_MAX_INPUT_BLOCK_BITS: 24,
};

export default {
  gzip,
  gunzip,
  deflate,
  inflate,
  deflateRaw,
  inflateRaw,
  gzipSync,
  gunzipSync,
  deflateSync,
  inflateSync,
  deflateRawSync,
  inflateRawSync,
  brotliCompress,
  brotliDecompress,
  brotliCompressSync,
  brotliDecompressSync,
  createGzip,
  createGunzip,
  createDeflate,
  createInflate,
  createDeflateRaw,
  createInflateRaw,
  createBrotliCompress,
  createBrotliDecompress,
  createUnzip,
  constants,
};
