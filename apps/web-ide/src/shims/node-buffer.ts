type BufferEncoding =
  | "utf8"
  | "utf-8"
  | "hex"
  | "base64"
  | "base64url"
  | "latin1"
  | "binary"
  | string;

type TranscodeEncoding = string;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function normalizeEncoding(encoding?: string): BufferEncoding {
  return (encoding ?? "utf8").toLowerCase();
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}

function fromBase64(value: string, encoding: "base64" | "base64url"): Uint8Array {
  let normalized = value;
  if (encoding === "base64url") {
    normalized = normalized.replace(/-/g, "+").replace(/_/g, "/");
    while (normalized.length % 4 !== 0) {
      normalized += "=";
    }
  }
  const binary = globalThis.atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function fromHex(value: string): Uint8Array {
  const bytes = new Uint8Array(Math.ceil(value.length / 2));
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function toLatin1(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
}

function fromLatin1(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

class BufferPolyfill extends Uint8Array {
  static readonly BYTES_PER_ELEMENT = 1;

  static from(value: string, encoding?: BufferEncoding): BufferPolyfill;
  static from(value: ArrayBuffer | ArrayLike<number> | Iterable<number> | Uint8Array): BufferPolyfill;
  static from(
    value: string | ArrayBuffer | ArrayLike<number> | Iterable<number> | Uint8Array,
    encoding?: BufferEncoding,
  ): BufferPolyfill {
    if (typeof value === "string") {
      const normalized = normalizeEncoding(encoding);
      if (normalized === "base64" || normalized === "base64url") {
        return new BufferPolyfill(fromBase64(value, normalized));
      }
      if (normalized === "hex") {
        return new BufferPolyfill(fromHex(value));
      }
      if (normalized === "latin1" || normalized === "binary") {
        return new BufferPolyfill(fromLatin1(value));
      }
      return new BufferPolyfill(encoder.encode(value));
    }

    if (value instanceof ArrayBuffer) {
      return new BufferPolyfill(new Uint8Array(value));
    }

    return new BufferPolyfill(Array.from(value));
  }

  static alloc(size: number, fill?: string | number): BufferPolyfill {
    const buffer = new BufferPolyfill(size);
    if (fill !== undefined) {
      if (typeof fill === "number") {
        buffer.fill(fill);
      } else {
        buffer.set(BufferPolyfill.from(fill).subarray(0, size));
      }
    }
    return buffer;
  }

  static allocUnsafe(size: number): BufferPolyfill {
    return new BufferPolyfill(size);
  }

  static allocUnsafeSlow(size: number): BufferPolyfill {
    return new BufferPolyfill(size);
  }

  static byteLength(value: string, encoding?: BufferEncoding): number {
    const normalized = normalizeEncoding(encoding);
    if (normalized === "hex") {
      return Math.ceil(value.length / 2);
    }
    if (normalized === "base64" || normalized === "base64url") {
      return fromBase64(value, normalized).length;
    }
    if (normalized === "latin1" || normalized === "binary") {
      return value.length;
    }
    return encoder.encode(value).length;
  }

  static concat(buffers: Array<Uint8Array | BufferPolyfill>): BufferPolyfill {
    const total = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
    const result = new BufferPolyfill(total);
    let offset = 0;
    for (const buffer of buffers) {
      result.set(buffer, offset);
      offset += buffer.length;
    }
    return result;
  }

  static isBuffer(value: unknown): value is BufferPolyfill {
    return value instanceof BufferPolyfill;
  }

  static isEncoding(encoding: string): boolean {
    return ["utf8", "utf-8", "hex", "base64", "base64url", "latin1", "binary"].includes(
      normalizeEncoding(encoding),
    );
  }

  toString(encoding: BufferEncoding = "utf8"): string {
    const normalized = normalizeEncoding(encoding);
    if (normalized === "base64") {
      return toBase64(this);
    }
    if (normalized === "base64url") {
      return toBase64(this).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    }
    if (normalized === "hex") {
      return toHex(this);
    }
    if (normalized === "latin1" || normalized === "binary") {
      return toLatin1(this);
    }
    return decoder.decode(this);
  }

  slice(start?: number, end?: number): BufferPolyfill {
    return new BufferPolyfill(super.slice(start, end));
  }
}

const Blob = globalThis.Blob;

const BrowserFile =
  globalThis.File ??
  class FilePolyfill extends Blob {
    readonly name: string;
    readonly lastModified: number;

    constructor(bits: BlobPart[], name: string, options?: FilePropertyBag) {
      super(bits, options);
      this.name = name;
      this.lastModified = options?.lastModified ?? Date.now();
    }
  };

const Buffer = BufferPolyfill;
const SlowBuffer = BufferPolyfill;
const File = BrowserFile;
const INSPECT_MAX_BYTES = 50;
const kMaxLength = 2_147_483_647;
const kStringMaxLength = 536_870_888;
const constants = {
  MAX_LENGTH: kMaxLength,
  MAX_STRING_LENGTH: kStringMaxLength,
};

function transcode(source: Uint8Array, _from: TranscodeEncoding, _to: TranscodeEncoding): BufferPolyfill {
  return Buffer.from(source);
}

function resolveObjectURL(id: string): string | undefined {
  void id;
  return undefined;
}

function atob(data: string): string {
  return globalThis.atob(data);
}

function btoa(data: string): string {
  return globalThis.btoa(data);
}

function isAscii(value: ArrayBufferView): boolean {
  return Array.from(new Uint8Array(value.buffer, value.byteOffset, value.byteLength)).every((byte) => byte < 0x80);
}

function isUtf8(_value: ArrayBufferView): boolean {
  return true;
}

type BlobOptions = BlobPropertyBag;
type FileOptions = FilePropertyBag;

export {
  Blob,
  Buffer,
  BrowserFile as File,
  INSPECT_MAX_BYTES,
  SlowBuffer,
  atob,
  btoa,
  constants,
  isAscii,
  isUtf8,
  kMaxLength,
  kStringMaxLength,
  resolveObjectURL,
  transcode,
};

export type { BlobOptions, FileOptions, TranscodeEncoding };

export default Buffer;
