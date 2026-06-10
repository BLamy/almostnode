type DispatcherOptions = Record<string, unknown> | undefined;
type UndiciBody = {
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
  json(): Promise<unknown>;
  [Symbol.asyncIterator](): AsyncIterator<Uint8Array>;
};

export class Dispatcher {
  readonly options: DispatcherOptions;

  constructor(options?: DispatcherOptions) {
    this.options = options;
  }

  dispatch(): boolean {
    throw new Error('undici Dispatcher.dispatch is not implemented in almostnode');
  }

  close(callback?: () => void): Promise<void> | void {
    if (callback) {
      queueMicrotask(callback);
      return;
    }
    return Promise.resolve();
  }

  destroy(_error?: Error, callback?: () => void): Promise<void> | void {
    if (callback) {
      queueMicrotask(callback);
      return;
    }
    return Promise.resolve();
  }
}

let globalDispatcher: Dispatcher = new Dispatcher();

export class Agent extends Dispatcher {}
export class Pool extends Dispatcher {}
export class BalancedPool extends Dispatcher {}
export class Client extends Dispatcher {}
export class ProxyAgent extends Dispatcher {}
export class EnvHttpProxyAgent extends Dispatcher {}

export class MockAgent extends Dispatcher {
  disableNetConnect(): void {}
  enableNetConnect(): void {}
}

export function setGlobalDispatcher(dispatcher: Dispatcher): void {
  globalDispatcher = dispatcher;
}

export function getGlobalDispatcher(): Dispatcher {
  return globalDispatcher;
}

export const fetch: typeof globalThis.fetch = (input, init) =>
  globalThis.fetch(input, init);
export const Headers = globalThis.Headers;
export const Request = globalThis.Request;
export const Response = globalThis.Response;
export const FormData = globalThis.FormData;
export const WebSocket = globalThis.WebSocket;
export const File = globalThis.File;

export function install(): void {
  const target = globalThis as typeof globalThis & {
    fetch?: typeof fetch;
    Headers?: typeof Headers;
    Request?: typeof Request;
    Response?: typeof Response;
    FormData?: typeof FormData;
    File?: typeof File;
    WebSocket?: typeof WebSocket;
  };

  target.fetch ??= fetch;
  target.Headers ??= Headers;
  target.Request ??= Request;
  target.Response ??= Response;
  target.FormData ??= FormData;
  if (File) target.File ??= File;
  if (WebSocket) target.WebSocket ??= WebSocket;
}

export async function request(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<{
  statusCode: number;
  headers: Record<string, string>;
  body: UndiciBody;
  trailers: Record<string, string>;
  opaque: null;
  context: null;
}> {
  const response = await fetch(input, init);
  const bodyBytes = new Uint8Array(await response.arrayBuffer());
  const headers: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    headers[key] = value;
  });

  return {
    statusCode: response.status,
    headers,
    body: createBody(bodyBytes),
    trailers: {},
    opaque: null,
    context: null,
  };
}

function createBody(bytes: Uint8Array): UndiciBody {
  return {
    async arrayBuffer() {
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      return copy.buffer;
    },
    async text() {
      return new TextDecoder().decode(bytes);
    },
    async json() {
      return JSON.parse(await this.text());
    },
    async *[Symbol.asyncIterator]() {
      yield bytes;
    },
  };
}

export async function stream(
  input: RequestInfo | URL,
  initOrFactory?: RequestInit | ((data: { statusCode: number; headers: Record<string, string> }) => unknown),
  maybeFactory?: (data: { statusCode: number; headers: Record<string, string> }) => unknown,
): Promise<unknown> {
  const init = typeof initOrFactory === 'function' ? {} : initOrFactory ?? {};
  const factory = typeof initOrFactory === 'function' ? initOrFactory : maybeFactory;
  const result = await request(input, init);
  return factory?.({ statusCode: result.statusCode, headers: result.headers }) ?? result.body;
}

export async function pipeline(
  input: RequestInfo | URL,
  initOrHandler?: RequestInit | ((data: { statusCode: number; headers: Record<string, string> }) => unknown),
  maybeHandler?: (data: { statusCode: number; headers: Record<string, string> }) => unknown,
): Promise<unknown> {
  return stream(input, initOrHandler, maybeHandler);
}

export async function connect(): Promise<never> {
  throw new Error('undici connect is not implemented in almostnode');
}

export function upgrade(): never {
  throw new Error('undici upgrade is not implemented in almostnode');
}

export const errors = {};

export default {
  Agent,
  BalancedPool,
  Client,
  Dispatcher,
  EnvHttpProxyAgent,
  MockAgent,
  Pool,
  ProxyAgent,
  Headers,
  Request,
  Response,
  FormData,
  File,
  WebSocket,
  connect,
  errors,
  fetch,
  getGlobalDispatcher,
  install,
  pipeline,
  request,
  setGlobalDispatcher,
  stream,
  upgrade,
};
