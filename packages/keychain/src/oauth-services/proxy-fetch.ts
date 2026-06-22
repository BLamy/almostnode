/**
 * `oauthFetch` — try a request directly first, then fall back to the
 * configured CORS proxy if the direct attempt fails (network error or
 * non-OK response).
 *
 * Mirrors the dev-vs-prod proxy resolution from `opencode-cors-proxy.ts` and
 * the direct-then-proxy fallback from `workbench-host.ts#fetchGitHubApi`.
 *
 * Many OAuth servers serve `.well-known/*` and token endpoints with
 * permissive CORS, so trying direct first avoids the latency and obfuscation
 * of an unconditional proxy hop. The proxy still catches everything else.
 */

const INTERNAL_CORS_PROXY_PATH = "/__api/cors-proxy?url=";
const DEFAULT_CORS_PROXY_URL = "https://almostnode-cors-proxy.langtail.workers.dev/?url=";
const CORS_PROXY_STORAGE_KEY = "__corsProxyUrl";

interface BrowserLocationLike {
  hostname: string;
  origin: string;
}

interface StorageLike {
  getItem(key: string): string | null;
}

function isLocalHostname(hostname: string): boolean {
  return (
    hostname === "localhost"
    || hostname === "127.0.0.1"
    || hostname === "::1"
    || hostname === "[::1]"
  );
}

function normalizeProxyBase(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function getDefaultLocation(): BrowserLocationLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  return {
    hostname: window.location.hostname,
    origin: window.location.origin,
  };
}

function getDefaultStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * Resolve which CORS proxy to use as a fallback. Order: explicit override →
 * `localStorage["__corsProxyUrl"]` → environment-provided proxy → internal
 * `/__api/cors-proxy` on localhost → public Cloudflare worker.
 */
export function resolveOAuthCorsProxyUrl(options: {
  location?: BrowserLocationLike | null;
  storage?: StorageLike | null;
  envProxy?: string | null;
} = {}): string {
  const stored = normalizeProxyBase(options.storage?.getItem(CORS_PROXY_STORAGE_KEY)
    ?? getDefaultStorage()?.getItem(CORS_PROXY_STORAGE_KEY)
    ?? null);
  if (stored) {
    return stored;
  }

  const env = normalizeProxyBase(options.envProxy);
  if (env) {
    return env;
  }

  const location = options.location ?? getDefaultLocation();
  if (location && isLocalHostname(location.hostname)) {
    return `${location.origin}${INTERNAL_CORS_PROXY_PATH}`;
  }

  return DEFAULT_CORS_PROXY_URL;
}

/**
 * Build the proxied URL for a target OAuth endpoint. Supports both the
 * `?url=` style proxies and the path-mirroring style.
 */
export function buildOAuthProxyUrl(proxyBase: string, targetUrl: string): string {
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

/**
 * Structural fetch shape used by the helper. We deliberately don't use
 * `typeof fetch` because Bun's lib.dom typings include a static `preconnect`
 * method that any test double would have to stub — and we never call it.
 */
export type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface OAuthFetchOptions {
  /**
   * If true (default), try the direct URL first, then fall back to the proxy.
   * If false, only the proxy is used.
   */
  tryDirectFirst?: boolean;
  /** Override the proxy resolution result. */
  proxyBase?: string;
  /** Inject a fetch implementation (for tests). */
  fetchImpl?: FetchLike;
}

const DEFAULT_FETCH: FetchLike = (input, init) => fetch(input, init);

/**
 * Fetch with direct-then-proxy fallback semantics. Returns the first
 * `response.ok` response, or — if every attempt was non-OK — the last
 * non-OK response. Throws only when every attempt threw a network error.
 */
export async function oauthFetch(
  url: string,
  init: RequestInit = {},
  options: OAuthFetchOptions = {},
): Promise<Response> {
  const fetchImpl = options.fetchImpl ?? DEFAULT_FETCH;
  const proxyBase = options.proxyBase ?? resolveOAuthCorsProxyUrl();
  const tryDirectFirst = options.tryDirectFirst ?? true;

  const attempts: string[] = [];
  if (tryDirectFirst) {
    attempts.push(url);
  }
  if (proxyBase) {
    const proxied = buildOAuthProxyUrl(proxyBase, url);
    if (!attempts.includes(proxied)) {
      attempts.push(proxied);
    }
  }
  if (attempts.length === 0) {
    attempts.push(url);
  }

  let lastResponse: Response | null = null;
  let lastError: unknown = null;

  for (let index = 0; index < attempts.length; index += 1) {
    const candidate = attempts[index]!;
    try {
      const response = await fetchImpl(candidate, init);
      if (response.ok || index === attempts.length - 1) {
        return response;
      }
      lastResponse = response;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastResponse) {
    return lastResponse;
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`OAuth fetch failed for ${url}`);
}
