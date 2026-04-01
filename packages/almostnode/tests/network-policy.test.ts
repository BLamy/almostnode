import { describe, expect, it } from 'vitest';
import {
  normalizeNetworkOptions,
  resolveBrowserWebSocketTarget,
  resolveNetworkPolicy,
  selectNetworkRouteForUrl,
  selectWebSocketRouteForUrl,
  shouldBypassProxy,
} from '../src/network';

describe('network policy', () => {
  it('matches NO_PROXY entries for exact hosts, suffixes, wildcards, and ports', () => {
    expect(shouldBypassProxy('https://api.example.com/v1', 'api.example.com')).toBe(true);
    expect(shouldBypassProxy('https://api.example.com/v1', '.example.com')).toBe(true);
    expect(shouldBypassProxy('https://api.example.com/v1', '*.example.com')).toBe(true);
    expect(shouldBypassProxy('https://example.com:8443/v1', 'example.com:8443')).toBe(true);
    expect(shouldBypassProxy('https://example.com:443/v1', 'example.com:8443')).toBe(false);
    expect(shouldBypassProxy('https://api.example.com/v1', '*')).toBe(true);
    expect(shouldBypassProxy('https://api.example.com/v1', 'internal.local')).toBe(false);
  });

  it('projects proxy and CA environment variables from the resolved policy', () => {
    const policy = resolveNetworkPolicy(
      normalizeNetworkOptions({
        proxy: {
          httpUrl: 'http://proxy.internal:8080',
          httpsUrl: 'http://proxy.internal:8443',
          noProxy: 'localhost,.example.com',
          caBundlePem: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n',
        },
        corsProxy: 'https://proxy.example/?url=',
      }),
      { origin: 'https://app.example.com' },
    );

    expect(policy.env).toMatchObject({
      HTTP_PROXY: 'http://proxy.internal:8080',
      http_proxy: 'http://proxy.internal:8080',
      HTTPS_PROXY: 'http://proxy.internal:8443',
      https_proxy: 'http://proxy.internal:8443',
      NO_PROXY: 'localhost,.example.com',
      no_proxy: 'localhost,.example.com',
      SSL_CERT_FILE: '/etc/ssl/almostnode/proxy-ca-bundle.pem',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/almostnode/proxy-ca-bundle.pem',
      REQUESTS_CA_BUNDLE: '/etc/ssl/almostnode/proxy-ca-bundle.pem',
      CURL_CA_BUNDLE: '/etc/ssl/almostnode/proxy-ca-bundle.pem',
      CORS_PROXY_URL: 'https://proxy.example/?url=',
    });
  });

  it('keeps Anthropic public hosts on browser transport until an exit node is active', () => {
    const baseOptions = normalizeNetworkOptions({
      provider: 'tailscale',
      tailscaleConnected: true,
      useExitNode: true,
      exitNodeId: null,
    });

    expect(
      selectNetworkRouteForUrl(
        'https://api.anthropic.com/v1/messages',
        baseOptions,
        { origin: 'https://app.example.com' },
      ),
    ).toBe('browser');
    expect(
      selectNetworkRouteForUrl(
        'https://platform.claude.com/oauth/token',
        baseOptions,
        { origin: 'https://app.example.com' },
      ),
    ).toBe('browser');

    const websocketPolicy = resolveNetworkPolicy(
      baseOptions,
      { origin: 'https://app.example.com' },
    );
    expect(
      selectWebSocketRouteForUrl(
        'wss://platform.claude.com/socket',
        websocketPolicy,
        { origin: 'https://app.example.com' },
      ),
    ).toBe('browser');

    expect(
      selectNetworkRouteForUrl(
        'https://db.ts.net/status',
        baseOptions,
        { origin: 'https://app.example.com' },
      ),
    ).toBe('tailscale');
  });

  it('routes proxied WebSockets through the local relay unless NO_PROXY bypasses them', () => {
    const policy = resolveNetworkPolicy(
      normalizeNetworkOptions({
        corsProxy: 'https://app.example.com/__api/cors-proxy?url=',
      }),
      { origin: 'https://app.example.com' },
    );

    const proxied = resolveBrowserWebSocketTarget(
      'wss://api.anthropic.com/socket',
      policy,
      {
        protocols: ['json', 'chat'],
        headers: {
          Authorization: 'Bearer test',
        },
      },
      { origin: 'https://app.example.com' },
    );

    expect(proxied.proxied).toBe(true);
    expect(proxied.url).toContain('/__api/ws-relay?');
    expect(decodeURIComponent(proxied.url)).toContain('wss://api.anthropic.com/socket');

    const bypassedPolicy = resolveNetworkPolicy(
      normalizeNetworkOptions({
        corsProxy: 'https://app.example.com/__api/cors-proxy?url=',
        proxy: {
          noProxy: 'api.anthropic.com',
        },
      }),
      { origin: 'https://app.example.com' },
    );

    expect(
      resolveBrowserWebSocketTarget(
        'wss://api.anthropic.com/socket',
        bypassedPolicy,
        {},
        { origin: 'https://app.example.com' },
      ),
    ).toMatchObject({
      url: 'wss://api.anthropic.com/socket',
      proxied: false,
    });
  });
});
