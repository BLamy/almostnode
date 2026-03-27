import { selectNetworkRouteForUrl } from './routing';
import type {
  NetworkController,
  NetworkFetchRequest,
  NetworkFetchResponse,
  NetworkOptions,
} from './types';

const DEFAULT_CORS_PROXY = 'https://almostnode-cors-proxy.langtail.workers.dev/?url=';
const MAX_REDIRECTS = 10;
const PROXY_UPSTREAM_STATUS_HEADER = 'x-almostnode-upstream-status';
const PROXY_UPSTREAM_STATUS_TEXT_HEADER = 'x-almostnode-upstream-status-text';

type FetchLike = typeof globalThis.fetch;

function getNativeFetch(): FetchLike {
  const candidate = (globalThis as { __almostnodeNativeFetch?: FetchLike }).__almostnodeNativeFetch;
  if (candidate) {
    return candidate;
  }
  return globalThis.fetch.bind(globalThis);
}

function normalizeProxyUrl(explicitProxy?: string | null): string {
  if (explicitProxy && explicitProxy.trim()) {
    return explicitProxy.trim();
  }

  const envProxy = (globalThis as { process?: { env?: Record<string, unknown> } }).process?.env?.CORS_PROXY_URL;
  if (typeof envProxy === 'string' && envProxy.trim()) {
    return envProxy.trim();
  }

  if (typeof localStorage !== 'undefined') {
    const override = localStorage.getItem('__corsProxyUrl');
    if (override?.trim()) {
      return override.trim();
    }
  }

  return DEFAULT_CORS_PROXY;
}

function removeProxyFingerprintHeaders(headers: Headers): void {
  headers.delete('accept-encoding');
  headers.delete('host');

  const keys: string[] = [];
  headers.forEach((_value, key) => {
    keys.push(key);
  });
  for (const key of keys) {
    const lower = key.toLowerCase();
    if (lower.startsWith('sec-fetch-') || lower.startsWith('sec-ch-ua')) {
      headers.delete(key);
    }
  }

  if (!headers.has('user-agent')) {
    headers.set('user-agent', 'node');
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }

  let binary = '';
  for (let index = 0; index < bytes.length; index++) {
    binary += String.fromCharCode(bytes[index]);
  }
  return btoa(binary);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

export function base64ToUint8Array(input: string): Uint8Array {
  if (!input) {
    return new Uint8Array(0);
  }

  if (typeof Buffer !== 'undefined') {
    return Uint8Array.from(Buffer.from(input, 'base64'));
  }

  const binary = atob(input);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function stripProxyMetadataHeaders(headers: Headers): Record<string, string> {
  const next = new Headers(headers);
  next.delete(PROXY_UPSTREAM_STATUS_HEADER);
  next.delete(PROXY_UPSTREAM_STATUS_TEXT_HEADER);
  return headersToRecord(next);
}

function readProxyRedirectMetadata(
  response: Response,
): { status: number; statusText: string } | null {
  const rawStatus = response.headers.get(PROXY_UPSTREAM_STATUS_HEADER);
  if (!rawStatus) {
    return null;
  }

  const status = Number.parseInt(rawStatus, 10);
  if (!Number.isFinite(status) || status < 300 || status >= 400) {
    return null;
  }

  return {
    status,
    statusText: response.headers.get(PROXY_UPSTREAM_STATUS_TEXT_HEADER) || '',
  };
}

async function extractBodyBase64(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<string | undefined> {
  if (init?.body != null && typeof init.body !== 'string' && !(init.body instanceof URLSearchParams)) {
    if (init.body instanceof Blob) {
      return bytesToBase64(new Uint8Array(await init.body.arrayBuffer()));
    }
    if (init.body instanceof ArrayBuffer) {
      return bytesToBase64(new Uint8Array(init.body));
    }
    if (ArrayBuffer.isView(init.body)) {
      return bytesToBase64(new Uint8Array(init.body.buffer, init.body.byteOffset, init.body.byteLength));
    }
  }

  if (typeof init?.body === 'string') {
    return bytesToBase64(new TextEncoder().encode(init.body));
  }

  if (init?.body instanceof URLSearchParams) {
    return bytesToBase64(new TextEncoder().encode(init.body.toString()));
  }

  if (input instanceof Request) {
    const request = input.clone();
    if (request.method === 'GET' || request.method === 'HEAD') {
      return undefined;
    }

    try {
      const buffer = await request.arrayBuffer();
      return bytesToBase64(new Uint8Array(buffer));
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export async function serializeFetchRequest(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<NetworkFetchRequest> {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.href
        : input.url;

  const headers = new Headers(init?.headers);
  if (input instanceof Request) {
    input.headers.forEach((value, key) => {
      if (!headers.has(key)) {
        headers.set(key, value);
      }
    });
  }

  return {
    url,
    method:
      init?.method ||
      (input instanceof Request ? input.method : undefined) ||
      'GET',
    headers: headersToRecord(headers),
    bodyBase64: await extractBodyBase64(input, init),
    redirect:
      init?.redirect ||
      (input instanceof Request ? input.redirect : undefined) ||
      'follow',
    credentials:
      init?.credentials ||
      (input instanceof Request ? input.credentials : undefined) ||
      'same-origin',
  };
}

export function createResponseFromNetwork(result: NetworkFetchResponse): Response {
  const body = base64ToUint8Array(result.bodyBase64);
  const response = new Response(toArrayBuffer(body), {
    status: result.status,
    statusText: result.statusText,
    headers: result.headers,
  });

  try {
    Object.defineProperty(response, 'url', {
      configurable: true,
      value: result.url,
    });
  } catch {
    // Ignore non-configurable Response implementations.
  }

  return response;
}

export async function browserFetch(
  request: NetworkFetchRequest,
  options: Required<NetworkOptions>,
): Promise<NetworkFetchResponse> {
  const locationLike =
    typeof location !== 'undefined' ? location : null;
  const route = selectNetworkRouteForUrl(request.url, options, locationLike);
  const nativeFetch = getNativeFetch();
  const headers = new Headers(request.headers);
  const bodyBytes = base64ToUint8Array(request.bodyBase64 || '');
  const init: RequestInit = {
    method: request.method || 'GET',
    headers,
    credentials: request.credentials,
  };

  if (bodyBytes.byteLength > 0 && init.method !== 'GET' && init.method !== 'HEAD') {
    init.body = toArrayBuffer(bodyBytes);
  }

  if (route === 'tailscale') {
    throw new Error(`Browser transport cannot satisfy Tailscale-routed request for ${request.url}`);
  }

  const proxyUrl = normalizeProxyUrl(options.corsProxy);
  const shouldProxy =
    request.url.startsWith('http://') ||
    request.url.startsWith('https://');
  const targetUrl = shouldProxy ? new URL(request.url, locationLike?.origin).href : request.url;
  const useProxy =
    shouldProxy &&
    !targetUrl.includes('almostnode-cors-proxy') &&
    !(
      locationLike &&
      new URL(targetUrl, locationLike.origin).origin === locationLike.origin
    ) &&
    !(locationLike && targetUrl.startsWith(`${locationLike.origin}/`));

  if (!useProxy) {
    const response = await nativeFetch(targetUrl, init);
    return {
      url: response.url || targetUrl,
      status: response.status,
      statusText: response.statusText,
      headers: headersToRecord(response.headers),
      bodyBase64: bytesToBase64(new Uint8Array(await response.arrayBuffer())),
    };
  }

  removeProxyFingerprintHeaders(headers);

  let currentUrl = targetUrl;
  let currentMethod = init.method || 'GET';
  let currentBody = init.body;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
    const response = await nativeFetch(`${proxyUrl}${encodeURIComponent(currentUrl)}`, {
      ...init,
      method: currentMethod,
      body: currentBody,
      redirect: 'manual',
    });
    const proxyRedirect = readProxyRedirectMetadata(response);
    const responseStatus = proxyRedirect?.status ?? response.status;
    const responseStatusText = proxyRedirect?.statusText ?? response.statusText;
    const responseHeaders = proxyRedirect
      ? stripProxyMetadataHeaders(response.headers)
      : headersToRecord(response.headers);

    const shouldFollow = (request.redirect || 'follow') === 'follow';
    if (
      shouldFollow &&
      responseStatus >= 300 &&
      responseStatus < 400
    ) {
      const locationHeader = response.headers.get('location');
      if (locationHeader) {
        currentUrl = new URL(locationHeader, currentUrl).href;
        if (responseStatus === 303) {
          currentMethod = 'GET';
          currentBody = undefined;
        }
        if (
          (responseStatus === 301 || responseStatus === 302) &&
          currentMethod !== 'GET' &&
          currentMethod !== 'HEAD'
        ) {
          currentMethod = 'GET';
          currentBody = undefined;
        }
        if (redirectCount === MAX_REDIRECTS) {
          throw new TypeError('Failed to fetch: too many redirects');
        }
        continue;
      }
    }

    if (!proxyRedirect && response.status === 0) {
      throw new TypeError('Failed to fetch: proxy returned an opaque response');
    }

    return {
      url: response.url || currentUrl,
      status: responseStatus,
      statusText: responseStatusText,
      headers: responseHeaders,
      bodyBase64: bytesToBase64(new Uint8Array(await response.arrayBuffer())),
    };
  }

  throw new TypeError('Failed to fetch: too many redirects');
}

export async function networkFetch(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  controller: NetworkController,
): Promise<Response> {
  const request = await serializeFetchRequest(input, init);
  const response = await controller.fetch(request);
  return createResponseFromNetwork(response);
}
