/**
 * Node.js stream/consumers shim
 * Consumes readable inputs into text, buffers, JSON, ArrayBuffers, or Blobs.
 */

import { Buffer } from './stream';

function isReadableStreamLike(value: unknown): value is ReadableStream<unknown> {
  return !!value && typeof (value as { getReader?: unknown }).getReader === 'function';
}

function isArrayBufferLike(value: unknown): value is ArrayBuffer {
  return value instanceof ArrayBuffer;
}

function isArrayBufferViewLike(value: unknown): value is ArrayBufferView {
  return ArrayBuffer.isView(value);
}

function isBlobLike(value: unknown): value is Blob {
  return typeof Blob !== 'undefined' && value instanceof Blob;
}

function isAsyncIterableLike(value: unknown): value is AsyncIterable<unknown> {
  return !!value && typeof (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator] === 'function';
}

function isIterableLike(value: unknown): value is Iterable<unknown> {
  return !!value && typeof (value as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function';
}

async function* iterateReadableStream(stream: ReadableStream<unknown>): AsyncIterable<unknown> {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock?.();
  }
}

async function* iterateInput(input: unknown): AsyncIterable<unknown> {
  const source = input && typeof input === 'object' && 'body' in input
    ? (input as { body?: unknown }).body ?? input
    : input;

  if (typeof source === 'string' || isArrayBufferLike(source) || isArrayBufferViewLike(source) || isBlobLike(source)) {
    yield source;
    return;
  }

  if (isReadableStreamLike(source)) {
    yield* iterateReadableStream(source);
    return;
  }

  if (isAsyncIterableLike(source)) {
    yield* source;
    return;
  }

  if (isIterableLike(source)) {
    yield* source;
    return;
  }

  throw new TypeError('The "stream" argument must be a readable stream, iterable, or binary-like value');
}

async function chunkToBuffer(chunk: unknown): Promise<InstanceType<typeof Buffer>> {
  if (typeof chunk === 'string') {
    return Buffer.from(chunk);
  }

  if (isArrayBufferLike(chunk)) {
    return Buffer.from(new Uint8Array(chunk));
  }

  if (isArrayBufferViewLike(chunk)) {
    return Buffer.from(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
  }

  if (isBlobLike(chunk)) {
    return Buffer.from(new Uint8Array(await chunk.arrayBuffer()));
  }

  throw new TypeError(`Unsupported stream chunk type: ${typeof chunk}`);
}

export async function buffer(stream: unknown): Promise<InstanceType<typeof Buffer>> {
  const chunks: Array<InstanceType<typeof Buffer>> = [];

  for await (const chunk of iterateInput(stream)) {
    if (chunk == null) {
      continue;
    }
    chunks.push(await chunkToBuffer(chunk));
  }

  return Buffer.concat(chunks);
}

export async function arrayBuffer(stream: unknown): Promise<ArrayBuffer> {
  const data = await buffer(stream);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}

export async function text(stream: unknown): Promise<string> {
  const data = await buffer(stream);
  return data.toString('utf8');
}

export async function json(stream: unknown): Promise<unknown> {
  return JSON.parse(await text(stream));
}

export async function blob(stream: unknown): Promise<Blob> {
  const data = await buffer(stream);
  return new Blob([data]);
}

const streamConsumersModule = {
  text,
  buffer,
  arrayBuffer,
  json,
  blob,
};

export default streamConsumersModule;
