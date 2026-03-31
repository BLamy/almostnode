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

  toString(encoding: BufferEncoding = "utf8", start?: number, end?: number): string {
    const normalized = normalizeEncoding(encoding);
    const startIndex = Math.max(0, Math.trunc(start ?? 0));
    const endIndex = Math.min(this.length, Math.trunc(end ?? this.length));
    const slice =
      endIndex <= startIndex
        ? new Uint8Array(0)
        : Uint8Array.prototype.subarray.call(this, startIndex, endIndex);

    if (normalized === "base64") {
      return toBase64(slice);
    }
    if (normalized === "base64url") {
      return toBase64(slice).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    }
    if (normalized === "hex") {
      return toHex(slice);
    }
    if (normalized === "latin1" || normalized === "binary") {
      return toLatin1(slice);
    }
    return decoder.decode(slice);
  }

  slice(start?: number, end?: number): BufferPolyfill {
    return new BufferPolyfill(super.slice(start, end));
  }

  subarray(start?: number, end?: number): BufferPolyfill {
    return new BufferPolyfill(super.subarray(start, end));
  }

  write(value: string, offset = 0, length?: number, encoding?: BufferEncoding): number {
    const bytes = BufferPolyfill.from(value, encoding).subarray(
      0,
      length === undefined ? undefined : Math.max(0, length),
    );
    this.set(bytes, offset);
    return bytes.length;
  }

  copy(target: Uint8Array, targetStart = 0, sourceStart = 0, sourceEnd = this.length): number {
    const source = this.subarray(sourceStart, sourceEnd);
    target.set(source, targetStart);
    return source.length;
  }

  compare(otherBuffer: Uint8Array): number {
    const length = Math.min(this.length, otherBuffer.length);
    for (let index = 0; index < length; index += 1) {
      if (this[index] < otherBuffer[index]) return -1;
      if (this[index] > otherBuffer[index]) return 1;
    }
    if (this.length < otherBuffer.length) return -1;
    if (this.length > otherBuffer.length) return 1;
    return 0;
  }

  equals(otherBuffer: Uint8Array): boolean {
    return this.compare(otherBuffer) === 0;
  }

  readUInt8(offset: number): number {
    return this[offset];
  }

  readUInt16BE(offset: number): number {
    return (this[offset] << 8) | this[offset + 1];
  }

  readUInt16LE(offset: number): number {
    return this[offset] | (this[offset + 1] << 8);
  }

  readUInt32BE(offset: number): number {
    return (
      (this[offset] * 0x1000000)
      + ((this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3])
    ) >>> 0;
  }

  readUInt32LE(offset: number): number {
    return (
      this[offset]
      | (this[offset + 1] << 8)
      | (this[offset + 2] << 16)
      | (this[offset + 3] * 0x1000000)
    ) >>> 0;
  }

  writeUInt8(value: number, offset: number): number {
    this[offset] = value & 0xff;
    return offset + 1;
  }

  writeUInt16BE(value: number, offset: number): number {
    this[offset] = (value >> 8) & 0xff;
    this[offset + 1] = value & 0xff;
    return offset + 2;
  }

  writeUInt16LE(value: number, offset: number): number {
    this[offset] = value & 0xff;
    this[offset + 1] = (value >> 8) & 0xff;
    return offset + 2;
  }

  writeUInt32BE(value: number, offset: number): number {
    this[offset] = (value >>> 24) & 0xff;
    this[offset + 1] = (value >>> 16) & 0xff;
    this[offset + 2] = (value >>> 8) & 0xff;
    this[offset + 3] = value & 0xff;
    return offset + 4;
  }

  writeUInt32LE(value: number, offset: number): number {
    this[offset] = value & 0xff;
    this[offset + 1] = (value >>> 8) & 0xff;
    this[offset + 2] = (value >>> 16) & 0xff;
    this[offset + 3] = (value >>> 24) & 0xff;
    return offset + 4;
  }

  readUint8(offset: number): number {
    return this.readUInt8(offset);
  }

  readUint16BE(offset: number): number {
    return this.readUInt16BE(offset);
  }

  readUint16LE(offset: number): number {
    return this.readUInt16LE(offset);
  }

  readUint32BE(offset: number): number {
    return this.readUInt32BE(offset);
  }

  readUint32LE(offset: number): number {
    return this.readUInt32LE(offset);
  }

  writeUint8(value: number, offset: number): number {
    return this.writeUInt8(value, offset);
  }

  writeUint16BE(value: number, offset: number): number {
    return this.writeUInt16BE(value, offset);
  }

  writeUint16LE(value: number, offset: number): number {
    return this.writeUInt16LE(value, offset);
  }

  writeUint32BE(value: number, offset: number): number {
    return this.writeUInt32BE(value, offset);
  }

  writeUint32LE(value: number, offset: number): number {
    return this.writeUInt32LE(value, offset);
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
