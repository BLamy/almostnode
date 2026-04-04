import type {
  NetworkController,
  NetworkOptions,
  NetworkProxyOptions,
  NetworkRoute,
  NetworkWebSocketInit,
  ResolvedNetworkOptions,
  ResolvedNetworkPolicy,
} from './types';

export const DEFAULT_CORS_PROXY_URL =
  'https://almostnode-cors-proxy.langtail.workers.dev/?url=';
export const NETWORK_CA_BUNDLE_PATH = '/etc/ssl/almostnode/proxy-ca-bundle.pem';
export const LOCAL_CORS_PROXY_PATH = '/__api/cors-proxy';
export const LOCAL_WS_RELAY_PATH = '/__api/ws-relay';
export const NETWORK_ENV_KEYS = [
  'HTTP_PROXY',
  'http_proxy',
  'HTTPS_PROXY',
  'https_proxy',
  'NO_PROXY',
  'no_proxy',
  'SSL_CERT_FILE',
  'NODE_EXTRA_CA_CERTS',
  'REQUESTS_CA_BUNDLE',
  'CURL_CA_BUNDLE',
  'CORS_PROXY_URL',
] as const;

const TAILSCALE_IPV4_CIDR_PREFIX = 10;
const TAILSCALE_IPV4_BASE = ipv4ToInt('100.64.0.0');
const TAILSCALE_IPV4_MASK = 0xffffffff << (32 - TAILSCALE_IPV4_CIDR_PREFIX);
const TAILSCALE_IPV6_PREFIX = 'fd7a:115c:a1e0:';
const MODULE_RESOLUTION_HOST_SUFFIXES = [
  'npmjs.org',
  'npmjs.com',
  'esm.sh',
  'unpkg.com',
  'jsdelivr.net',
  'skypack.dev',
];

function trimToNull(value: string | null | undefined): string | null {
  const next = value?.trim();
  return next ? next : null;
}

function trimOptionalToOptionalNull(value: string | null | undefined): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  return trimToNull(value);
}

function getProcessEnvValue(key: string): string | null {
  const value = (globalThis as { process?: { env?: Record<string, unknown> } })
    .process?.env?.[key];
  return typeof value === 'string' ? trimToNull(value) : null;
}

function getStoredCorsProxy(): string | null {
  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return trimToNull(localStorage.getItem('__corsProxyUrl'));
  } catch {
    return null;
  }
}

function normalizeProxyOptions(
  proxy: NetworkProxyOptions | ResolvedNetworkOptions['proxy'] | undefined,
): ResolvedNetworkOptions['proxy'] {
  return {
    httpUrl: trimToNull(proxy?.httpUrl),
    httpsUrl: trimToNull(proxy?.httpsUrl),
    noProxy: trimToNull(proxy?.noProxy),
    caBundlePem: trimToNull(proxy?.caBundlePem),
  };
}

export function normalizeNetworkOptions(
  options: NetworkOptions | ResolvedNetworkOptions = {},
): ResolvedNetworkOptions {
  const record = options as NetworkOptions & {
    proxy?: NetworkProxyOptions | ResolvedNetworkOptions['proxy'];
    activeExitNodeId?: string | null;
  };
  const hasActiveExitNodeId = Object.prototype.hasOwnProperty.call(record, 'activeExitNodeId');
  return {
    provider: record.provider || 'browser',
    authMode: record.authMode || 'interactive',
    useExitNode: Boolean(record.useExitNode),
    exitNodeId: record.exitNodeId?.trim() || null,
    acceptDns: record.acceptDns !== false,
    corsProxy: trimToNull(record.corsProxy),
    proxy: normalizeProxyOptions(record.proxy),
    tailscaleConnected: Boolean(record.tailscaleConnected),
    ...(hasActiveExitNodeId
      ? {
          activeExitNodeId: trimOptionalToOptionalNull(record.activeExitNodeId),
        }
      : {}),
  };
}

function getResolvedOptions(
  options: NetworkOptions | ResolvedNetworkOptions,
): ResolvedNetworkOptions {
  return normalizeNetworkOptions(options);
}

function shouldRoutePublicTrafficThroughTailscale(
  options: Pick<
    ResolvedNetworkOptions,
    'useExitNode' | 'tailscaleConnected'
  >,
): boolean {
  return Boolean(
    options.useExitNode
    && options.tailscaleConnected
  );
}

function ipv4ToInt(input: string): number {
  return input
    .split('.')
    .map((segment) => Number.parseInt(segment, 10))
    .reduce((value, segment) => ((value << 8) | segment) >>> 0, 0);
}

function isLikelyIpv4(hostname: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
}

function isLikelyIpv6(hostname: string): boolean {
  return hostname.includes(':');
}

export function isTailnetIpv4(hostname: string): boolean {
  if (!isLikelyIpv4(hostname)) {
    return false;
  }

  const value = ipv4ToInt(hostname);
  return (value & TAILSCALE_IPV4_MASK) === (TAILSCALE_IPV4_BASE & TAILSCALE_IPV4_MASK);
}

export function isTailnetIpv6(hostname: string): boolean {
  return hostname.toLowerCase().startsWith(TAILSCALE_IPV6_PREFIX);
}

export function isTailscaleHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  if (!normalized) {
    return false;
  }

  if (normalized.endsWith('.ts.net')) {
    return true;
  }

  if (isTailnetIpv4(normalized) || isTailnetIpv6(normalized)) {
    return true;
  }

  if (
    !normalized.includes('.')
    && normalized !== 'localhost'
    && normalized !== '127.0.0.1'
    && normalized !== '::1'
  ) {
    return true;
  }

  return false;
}

export function isModuleResolutionHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return MODULE_RESOLUTION_HOST_SUFFIXES.some((suffix) => (
    normalized === suffix || normalized.endsWith(`.${suffix}`)
  ));
}

export function isLocalBrowserTarget(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === 'localhost'
    || hostname === '127.0.0.1'
    || hostname === '::1'
    || hostname === '[::1]'
  );
}

function isSameOrigin(
  url: URL,
  locationLike?: Pick<Location, 'origin'> | null,
): boolean {
  if (!locationLike?.origin) {
    return false;
  }
  return url.origin === locationLike.origin;
}

export function getPreferredHttpProxyUrl(
  proxy: Pick<ResolvedNetworkOptions['proxy'], 'httpUrl' | 'httpsUrl'>,
): string | null {
  return proxy.httpUrl || proxy.httpsUrl || null;
}

export function getPreferredHttpsProxyUrl(
  proxy: Pick<ResolvedNetworkOptions['proxy'], 'httpUrl' | 'httpsUrl'>,
): string | null {
  return proxy.httpsUrl || proxy.httpUrl || null;
}

export function hasConfiguredTransportProxy(
  options: Pick<NetworkOptions | ResolvedNetworkOptions, 'proxy'>,
): boolean {
  const proxy = normalizeProxyOptions(options.proxy);
  return Boolean(
    proxy.httpUrl
    || proxy.httpsUrl,
  );
}

function looksLikeBrowserProxyUrl(rawUrl: string): boolean {
  return (
    rawUrl.includes('?url=')
    || rawUrl.includes(LOCAL_CORS_PROXY_PATH)
    || rawUrl.includes('almostnode-cors-proxy')
  );
}

function resolveCorsProxyUrl(
  options: ResolvedNetworkOptions,
): string | null {
  if (options.corsProxy) {
    return options.corsProxy;
  }

  const preferredProxyUrl = getPreferredHttpsProxyUrl(options.proxy);
  if (preferredProxyUrl && looksLikeBrowserProxyUrl(preferredProxyUrl)) {
    return preferredProxyUrl;
  }

  return (
    getProcessEnvValue('CORS_PROXY_URL')
    || getStoredCorsProxy()
    || DEFAULT_CORS_PROXY_URL
  );
}

function resolveWsRelayUrl(
  corsProxyUrl: string | null,
  locationLike: Pick<Location, 'origin'> | null,
): string | null {
  if (!corsProxyUrl || !locationLike?.origin) {
    return null;
  }

  try {
    const absoluteProxyUrl = new URL(corsProxyUrl, locationLike.origin);
    if (absoluteProxyUrl.origin !== locationLike.origin) {
      return null;
    }

    if (!absoluteProxyUrl.pathname.endsWith(LOCAL_CORS_PROXY_PATH)) {
      return null;
    }

    const relayUrl = new URL(LOCAL_WS_RELAY_PATH, locationLike.origin);
    relayUrl.protocol = relayUrl.protocol === 'https:' ? 'wss:' : 'ws:';
    return relayUrl.toString();
  } catch {
    return null;
  }
}

function appendEnv(
  env: Record<string, string>,
  key: string,
  value: string | null,
): void {
  if (value) {
    env[key] = value;
  }
}

function buildProjectedEnv(policy: Omit<ResolvedNetworkPolicy, 'env'>): Record<string, string> {
  const env: Record<string, string> = {};
  const httpProxyUrl = getPreferredHttpProxyUrl(policy.proxy);
  const httpsProxyUrl = getPreferredHttpsProxyUrl(policy.proxy);

  appendEnv(env, 'HTTP_PROXY', httpProxyUrl);
  appendEnv(env, 'http_proxy', httpProxyUrl);
  appendEnv(env, 'HTTPS_PROXY', httpsProxyUrl);
  appendEnv(env, 'https_proxy', httpsProxyUrl);
  appendEnv(env, 'NO_PROXY', policy.proxy.noProxy);
  appendEnv(env, 'no_proxy', policy.proxy.noProxy);
  appendEnv(env, 'SSL_CERT_FILE', policy.proxy.caBundlePath);
  appendEnv(env, 'NODE_EXTRA_CA_CERTS', policy.proxy.caBundlePath);
  appendEnv(env, 'REQUESTS_CA_BUNDLE', policy.proxy.caBundlePath);
  appendEnv(env, 'CURL_CA_BUNDLE', policy.proxy.caBundlePath);
  appendEnv(env, 'CORS_PROXY_URL', policy.browser.corsProxyUrl);

  return env;
}

export function resolveNetworkPolicy(
  options: NetworkOptions | ResolvedNetworkOptions,
  locationLike: Pick<Location, 'origin'> | null =
    typeof location !== 'undefined' ? location : null,
): ResolvedNetworkPolicy {
  const resolvedOptions = getResolvedOptions(options);
  const policyWithoutEnv = {
    options: resolvedOptions,
    proxy: {
      ...resolvedOptions.proxy,
      caBundlePath: resolvedOptions.proxy.caBundlePem ? NETWORK_CA_BUNDLE_PATH : null,
    },
    browser: {
      corsProxyUrl: resolveCorsProxyUrl(resolvedOptions),
      wsRelayUrl: null as string | null,
    },
  };

  const policy: ResolvedNetworkPolicy = {
    ...policyWithoutEnv,
    browser: {
      ...policyWithoutEnv.browser,
      wsRelayUrl: resolveWsRelayUrl(
        policyWithoutEnv.browser.corsProxyUrl,
        locationLike,
      ),
    },
    env: {},
  };
  policy.env = buildProjectedEnv(policy);
  return policy;
}

export function shouldBypassProxy(
  rawUrl: string,
  noProxy: string | null | undefined,
): boolean {
  const normalizedNoProxy = trimToNull(noProxy);
  if (!normalizedNoProxy) {
    return false;
  }

  if (normalizedNoProxy === '*') {
    return true;
  }

  try {
    const url = new URL(rawUrl);
    const hostname = url.hostname.toLowerCase();
    const port = url.port || (url.protocol === 'https:' || url.protocol === 'wss:' ? '443' : '80');
    const hostWithPort = `${hostname}:${port}`;

    return normalizedNoProxy
      .split(/[,\s]+/)
      .filter(Boolean)
      .some((entry) => {
        const pattern = entry.toLowerCase().trim();
        if (!pattern) {
          return false;
        }
        if (pattern === '*') {
          return true;
        }
        if (pattern.includes(':') && hostWithPort === pattern) {
          return true;
        }
        if (pattern.startsWith('*.')) {
          const suffix = pattern.slice(1);
          return hostname.endsWith(suffix);
        }
        if (pattern.startsWith('.')) {
          return hostname === pattern.slice(1) || hostname.endsWith(pattern);
        }
        return hostname === pattern;
      });
  } catch {
    return false;
  }
}

export function selectNetworkRouteForUrl(
  rawUrl: string,
  options: NetworkOptions | ResolvedNetworkOptions,
  locationLike: Pick<Location, 'origin'> | null =
    typeof location !== 'undefined' ? location : null,
): NetworkRoute {
  const resolvedOptions = getResolvedOptions(options);
  if (resolvedOptions.provider !== 'tailscale') {
    return 'browser';
  }

  let url: URL;
  try {
    url = locationLike?.origin
      ? new URL(rawUrl, locationLike.origin)
      : new URL(rawUrl);
  } catch {
    return 'browser';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'browser';
  }

  if (isSameOrigin(url, locationLike) || isLocalBrowserTarget(url)) {
    return 'browser';
  }

  if (isTailscaleHostname(url.hostname)) {
    return 'tailscale';
  }

  if (isModuleResolutionHostname(url.hostname)) {
    return 'browser';
  }

  return shouldRoutePublicTrafficThroughTailscale(resolvedOptions)
    ? 'tailscale'
    : 'browser';
}

export function selectNetworkRouteForHost(
  hostname: string,
  options: NetworkOptions | ResolvedNetworkOptions,
): NetworkRoute {
  const resolvedOptions = getResolvedOptions(options);
  if (resolvedOptions.provider !== 'tailscale') {
    return 'browser';
  }

  if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
    return 'browser';
  }

  if (isTailscaleHostname(hostname)) {
    return 'tailscale';
  }

  if (isModuleResolutionHostname(hostname)) {
    return 'browser';
  }

  return shouldRoutePublicTrafficThroughTailscale(resolvedOptions)
    ? 'tailscale'
    : 'browser';
}

export function selectWebSocketRouteForUrl(
  rawUrl: string,
  policy: ResolvedNetworkPolicy,
  locationLike: Pick<Location, 'origin'> | null =
    typeof location !== 'undefined' ? location : null,
): NetworkRoute {
  if (policy.options.provider !== 'tailscale') {
    return 'browser';
  }

  let url: URL;
  try {
    url = locationLike?.origin
      ? new URL(rawUrl, locationLike.origin)
      : new URL(rawUrl);
  } catch {
    return 'browser';
  }

  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    return 'browser';
  }

  if (isSameOrigin(url, locationLike) || isLocalBrowserTarget(url)) {
    return 'browser';
  }

  if (isTailscaleHostname(url.hostname)) {
    return 'tailscale';
  }

  if (shouldRoutePublicTrafficThroughTailscale(policy.options)) {
    return 'tailscale';
  }

  if (policy.browser.wsRelayUrl && !shouldBypassProxy(rawUrl, policy.proxy.noProxy)) {
    return 'browser';
  }

  return 'browser';
}

function isExternalBrowserRequest(
  targetUrl: string,
  locationLike: Pick<Location, 'origin'> | null,
): boolean {
  if (!(targetUrl.startsWith('http://') || targetUrl.startsWith('https://'))) {
    return false;
  }
  if (targetUrl.includes('almostnode-cors-proxy') || targetUrl.includes(LOCAL_CORS_PROXY_PATH)) {
    return false;
  }
  if (!locationLike?.origin) {
    return true;
  }
  try {
    const absolute = new URL(targetUrl, locationLike.origin);
    return absolute.origin !== locationLike.origin && !targetUrl.startsWith(`${locationLike.origin}/`);
  } catch {
    return true;
  }
}

function normalizeBrowserTargetUrl(
  rawUrl: string,
  locationLike: Pick<Location, 'origin'> | null,
): string {
  try {
    if (locationLike?.origin) {
      return new URL(rawUrl, locationLike.origin).href;
    }
    return new URL(rawUrl).href;
  } catch {
    return rawUrl;
  }
}

export function resolveBrowserFetchTarget(
  rawUrl: string,
  policy: ResolvedNetworkPolicy,
  locationLike: Pick<Location, 'origin'> | null =
    typeof location !== 'undefined' ? location : null,
): {
  targetUrl: string;
  proxied: boolean;
  proxyUrl: string | null;
} {
  const targetUrl = normalizeBrowserTargetUrl(rawUrl, locationLike);
  const proxyUrl = policy.browser.corsProxyUrl;
  const proxied = Boolean(
    proxyUrl
    && isExternalBrowserRequest(targetUrl, locationLike)
    && !shouldBypassProxy(targetUrl, policy.proxy.noProxy)
  );

  return {
    targetUrl,
    proxied,
    proxyUrl: proxied ? proxyUrl : null,
  };
}

export function getResolvedPolicy(
  controller: Pick<NetworkController, 'getConfig'> & Partial<Pick<NetworkController, 'getResolvedPolicy'>>,
  locationLike: Pick<Location, 'origin'> | null =
    typeof location !== 'undefined' ? location : null,
): ResolvedNetworkPolicy {
  if (typeof controller.getResolvedPolicy === 'function') {
    return controller.getResolvedPolicy();
  }

  return resolveNetworkPolicy(controller.getConfig(), locationLike);
}

function encodeRelayJson(value: unknown): string {
  const json = JSON.stringify(value);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(json, 'utf8').toString('base64');
  }

  const bytes = new TextEncoder().encode(json);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export function resolveBrowserWebSocketTarget(
  rawUrl: string,
  policy: ResolvedNetworkPolicy,
  init: NetworkWebSocketInit = {},
  locationLike: Pick<Location, 'origin'> | null =
    typeof location !== 'undefined' ? location : null,
): {
  url: string;
  proxied: boolean;
  constructorProtocols?: string | string[];
} {
  if (
    !policy.browser.wsRelayUrl
    || shouldBypassProxy(rawUrl, policy.proxy.noProxy)
  ) {
    return {
      url: rawUrl,
      proxied: false,
      constructorProtocols: init.protocols,
    };
  }

  let targetUrl: URL;
  try {
    targetUrl = locationLike?.origin
      ? new URL(rawUrl, locationLike.origin)
      : new URL(rawUrl);
  } catch {
    return {
      url: rawUrl,
      proxied: false,
      constructorProtocols: init.protocols,
    };
  }

  if (
    (targetUrl.protocol !== 'ws:' && targetUrl.protocol !== 'wss:')
    || isSameOrigin(targetUrl, locationLike)
    || isLocalBrowserTarget(targetUrl)
    || rawUrl.includes(LOCAL_WS_RELAY_PATH)
  ) {
    return {
      url: rawUrl,
      proxied: false,
      constructorProtocols: init.protocols,
    };
  }

  const relayUrl = new URL(policy.browser.wsRelayUrl);
  relayUrl.searchParams.set('url', targetUrl.toString());
  if (init.protocols) {
    relayUrl.searchParams.set(
      'protocols',
      encodeRelayJson(Array.isArray(init.protocols) ? init.protocols : [init.protocols]),
    );
  }
  if (init.headers && Object.keys(init.headers).length > 0) {
    relayUrl.searchParams.set('headers', encodeRelayJson(init.headers));
  }

  return {
    url: relayUrl.toString(),
    proxied: true,
  };
}
