/**
 * tls shim - TLS/SSL is not available in browser
 * Provides stubs that allow code to load without crashing
 */

import { EventEmitter } from './events';
import * as net from './net';

class JSStreamSocket extends net.Socket {
  _handle: Record<string, unknown>;
  encrypted: boolean;
  private _stream?: {
    on?: (event: string, listener: (...args: unknown[]) => void) => unknown;
    write?: (...args: unknown[]) => unknown;
    end?: (...args: unknown[]) => unknown;
    destroy?: (...args: unknown[]) => unknown;
  };

  constructor(stream?: unknown) {
    super();
    this._stream = stream as JSStreamSocket['_stream'];
    this._handle = {};
    this.encrypted = false;

    if (this._stream && typeof this._stream.on === 'function') {
      this._stream.on('data', (chunk: unknown) => this.emit('data', chunk));
      this._stream.on('end', () => this.emit('end'));
      this._stream.on('close', (hadError?: unknown) => this.emit('close', hadError));
      this._stream.on('error', (error: unknown) => this.emit('error', error));
    }
  }

  write(
    chunk: unknown,
    encodingOrCallback?: string | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void
  ): boolean {
    if (this._stream && typeof this._stream.write === 'function') {
      if (typeof encodingOrCallback === 'function') {
        this._stream.write(chunk, encodingOrCallback);
      } else if (callback) {
        this._stream.write(chunk, encodingOrCallback, callback);
      } else {
        this._stream.write(chunk, encodingOrCallback);
      }
      return true;
    }

    return super.write(
      chunk as Uint8Array | string,
      encodingOrCallback,
      callback
    );
  }

  end(
    chunkOrCallback?: Uint8Array | string | (() => void),
    encodingOrCallback?: string | (() => void),
    callback?: () => void
  ): this {
    if (this._stream && typeof this._stream.end === 'function') {
      this._stream.end(chunkOrCallback, encodingOrCallback, callback);
    }
    return super.end(chunkOrCallback, encodingOrCallback, callback);
  }

  destroy(error?: Error): this {
    if (this._stream && typeof this._stream.destroy === 'function') {
      this._stream.destroy(error);
    }
    return super.destroy(error);
  }
}

export class TLSSocket extends EventEmitter {
  authorized = false;
  encrypted = true;
  _handle: { _parentWrap: { constructor: typeof JSStreamSocket } };

  constructor(_socket?: unknown, _options?: unknown) {
    super();
    // Compatibility shape used by http2-wrapper to discover JSStreamSocket.
    this._handle = {
      _parentWrap: {
        constructor: JSStreamSocket,
      },
    };
  }

  getPeerCertificate(_detailed?: boolean): object {
    return {};
  }

  getCipher(): { name: string; version: string } | null {
    return null;
  }

  getProtocol(): string | null {
    return null;
  }

  setServername(_name: string): void {}

  renegotiate(_options: unknown, _callback: (err: Error | null) => void): boolean {
    return false;
  }
}

export class Server extends EventEmitter {
  constructor(_options?: unknown, _connectionListener?: (socket: TLSSocket) => void) {
    super();
  }

  listen(..._args: unknown[]): this {
    return this;
  }

  close(_callback?: (err?: Error) => void): this {
    return this;
  }

  address(): { port: number; family: string; address: string } | string | null {
    return null;
  }

  getTicketKeys(): Buffer {
    return Buffer.from('');
  }

  setTicketKeys(_keys: Buffer): void {}

  setSecureContext(_options: unknown): void {}
}

export function createServer(_options?: unknown, _connectionListener?: (socket: TLSSocket) => void): Server {
  return new Server(_options, _connectionListener);
}

export function connect(_options: unknown, _callback?: () => void): TLSSocket {
  const socket = new TLSSocket();
  if (_callback) {
    setTimeout(_callback, 0);
  }
  return socket;
}

export const createSecureContext = (_options?: unknown) => ({});

export const getCiphers = () => ['TLS_AES_256_GCM_SHA384', 'TLS_AES_128_GCM_SHA256'];

export const DEFAULT_ECDH_CURVE = 'auto';
export const DEFAULT_MAX_VERSION = 'TLSv1.3';
export const DEFAULT_MIN_VERSION = 'TLSv1.2';

export const rootCertificates: string[] = [];

export default {
  TLSSocket,
  Server,
  createServer,
  connect,
  createSecureContext,
  getCiphers,
  DEFAULT_ECDH_CURVE,
  DEFAULT_MAX_VERSION,
  DEFAULT_MIN_VERSION,
  rootCertificates,
};
