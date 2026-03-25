const CORS_PROXY_STORAGE_KEY = "__corsProxyUrl";
const INTERNAL_CORS_PROXY_PATH = "/__api/cors-proxy?url=";

export const DEFAULT_OPENCODE_CORS_PROXY_URL = "https://almostnode-cors-proxy.langtail.workers.dev/?url=";

interface BrowserLocationLike {
  hostname: string;
  origin: string;
}

interface StorageLike {
  getItem(key: string): string | null;
}

function normalizeProxyUrl(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "[::1]";
}

function getBrowserLocation(): BrowserLocationLike | null {
  if (typeof window === "undefined") {
    return null;
  }

  return {
    hostname: window.location.hostname,
    origin: window.location.origin,
  };
}

function getBrowserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function resolveOpencodeCorsProxyUrl(
  locationLike?: BrowserLocationLike | null,
  storage?: StorageLike | null,
  envProxy?: string | null,
): string {
  const storedProxy = normalizeProxyUrl(storage?.getItem(CORS_PROXY_STORAGE_KEY));
  if (storedProxy) {
    return storedProxy;
  }

  const configuredProxy = normalizeProxyUrl(envProxy);
  if (configuredProxy) {
    return configuredProxy;
  }

  if (locationLike && isLocalHostname(locationLike.hostname)) {
    return `${locationLike.origin}${INTERNAL_CORS_PROXY_PATH}`;
  }

  return DEFAULT_OPENCODE_CORS_PROXY_URL;
}

export function buildOpencodeProxyUrl(proxyBase: string, targetUrl: string): string {
  if (!proxyBase) {
    return targetUrl;
  }

  if (proxyBase.includes("?url=")) {
    return `${proxyBase}${encodeURIComponent(targetUrl)}`;
  }

  const target = new URL(targetUrl);
  const normalizedBase = proxyBase.endsWith("/") ? proxyBase.slice(0, -1) : proxyBase;
  return `${normalizedBase}${target.pathname}${target.search}`;
}

export const CORS_PROXY_URL = resolveOpencodeCorsProxyUrl(
  getBrowserLocation(),
  getBrowserStorage(),
  import.meta.env.VITE_CORS_PROXY_URL,
);

export function createProxiedFetch(apiKey: string): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);

    if (url.hostname === "api.anthropic.com" && CORS_PROXY_URL) {
      const headers = new Headers(request.headers);
      headers.set("x-api-key", apiKey);
      headers.set("anthropic-version", "2023-06-01");
      headers.delete("anthropic-dangerous-direct-browser-access");

      return fetch(buildOpencodeProxyUrl(CORS_PROXY_URL, url.toString()), {
        method: request.method,
        headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
      });
    }

    return fetch(request);
  };
}
