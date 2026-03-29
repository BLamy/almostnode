import type { NetworkOptions, NetworkRoute } from './types';

const TAILSCALE_IPV4_CIDR_PREFIX = 10;
const TAILSCALE_IPV4_BASE = ipv4ToInt('100.64.0.0');
const TAILSCALE_IPV4_MASK = 0xffffffff << (32 - TAILSCALE_IPV4_CIDR_PREFIX);
const TAILSCALE_IPV6_PREFIX = 'fd7a:115c:a1e0:';
const EXIT_NODE_PUBLIC_HOST_SUFFIXES = [
  'anthropic.com',
  'claude.ai',
  'claude.com',
];

/**
 * Hostnames used for npm/npx package **downloading and module resolution**.
 * These stay on the browser transport even when Tailscale exit-node routing is
 * active, because they are infrastructure traffic, not application traffic.
 * Once a downloaded module is executing, any fetch it performs will go through
 * Tailscale as normal.
 */
const MODULE_RESOLUTION_HOST_SUFFIXES = [
  'npmjs.org',
  'npmjs.com',
  'esm.sh',
  'unpkg.com',
  'jsdelivr.net',
  'skypack.dev',
];

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
    !normalized.includes('.') &&
    normalized !== 'localhost' &&
    normalized !== '127.0.0.1' &&
    normalized !== '::1'
  ) {
    return true;
  }

  return false;
}

export function isLocalBrowserTarget(url: URL): boolean {
  const hostname = url.hostname.toLowerCase();
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

function isExitNodePublicHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return EXIT_NODE_PUBLIC_HOST_SUFFIXES.some((suffix) => (
    normalized === suffix || normalized.endsWith(`.${suffix}`)
  ));
}

export function isModuleResolutionHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return MODULE_RESOLUTION_HOST_SUFFIXES.some((suffix) => (
    normalized === suffix || normalized.endsWith(`.${suffix}`)
  ));
}

function isSameOrigin(url: URL, locationLike?: Pick<Location, 'origin'> | null): boolean {
  if (!locationLike?.origin) {
    return false;
  }
  return url.origin === locationLike.origin;
}

export function selectNetworkRouteForUrl(
  rawUrl: string,
  options: Required<NetworkOptions>,
  locationLike: Pick<Location, 'origin'> | null = typeof location !== 'undefined' ? location : null,
): NetworkRoute {
  if (options.provider !== 'tailscale') {
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

  if (options.useExitNode && options.tailscaleConnected) {
    return 'tailscale';
  }

  return options.useExitNode && Boolean(options.exitNodeId) && isExitNodePublicHostname(url.hostname)
    ? 'tailscale'
    : 'browser';
}

export function selectNetworkRouteForHost(
  hostname: string,
  options: Required<NetworkOptions>,
): NetworkRoute {
  if (options.provider !== 'tailscale') {
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

  if (options.useExitNode && options.tailscaleConnected) {
    return 'tailscale';
  }

  return options.useExitNode && Boolean(options.exitNodeId) && isExitNodePublicHostname(hostname)
    ? 'tailscale'
    : 'browser';
}
