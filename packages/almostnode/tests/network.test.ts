import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as dnsPromises } from '../src/shims/dns';
import { runCurlCommand } from '../src/shims/curl-command';
import { VirtualFS } from '../src/virtual-fs';
import {
  createNetworkController,
  selectNetworkRouteForUrl,
  setDefaultNetworkController,
  setTailscaleAdapterFactory,
} from '../src/network';
import type {
  NetworkFetchRequest,
  NetworkFetchResponse,
  NetworkLookupResult,
  TailscaleAdapter,
  TailscaleAdapterStatus,
} from '../src/network/types';

class FakeTailscaleAdapter implements TailscaleAdapter {
  private status: TailscaleAdapterStatus = { state: 'needs-login' };
  public fetches: NetworkFetchRequest[] = [];
  public getStatusCalls = 0;

  constructor(
    private readonly onStatus: (status: TailscaleAdapterStatus) => void,
  ) {}

  async getStatus(): Promise<TailscaleAdapterStatus> {
    this.getStatusCalls += 1;
    return this.status;
  }

  async login(): Promise<TailscaleAdapterStatus> {
    this.status = {
      state: 'running',
      selectedExitNodeId: 'node-sfo',
      selfName: 'almostnode-test',
      tailnetName: 'example.ts.net',
    };
    this.onStatus(this.status);
    return this.status;
  }

  async logout(): Promise<TailscaleAdapterStatus> {
    this.status = { state: 'stopped' };
    this.onStatus(this.status);
    return this.status;
  }

  async fetch(request: NetworkFetchRequest): Promise<NetworkFetchResponse> {
    this.fetches.push(request);
    return {
      url: request.url,
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'text/plain' },
      bodyBase64: Buffer.from('tailnet-response').toString('base64'),
    };
  }

  async lookup(): Promise<NetworkLookupResult> {
    return {
      hostname: 'db.ts.net',
      addresses: [{ address: '100.100.100.100', family: 4 }],
    };
  }
}

describe('network controller', () => {
  let nativeFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    nativeFetch = vi.fn().mockResolvedValue(
      new Response('browser-response', {
        status: 200,
        headers: { 'content-type': 'text/plain' },
      }),
    );
    (globalThis as { __almostnodeNativeFetch?: typeof globalThis.fetch }).__almostnodeNativeFetch =
      nativeFetch as unknown as typeof globalThis.fetch;
  });

  afterEach(() => {
    setTailscaleAdapterFactory(null);
    setDefaultNetworkController(null);
    delete (globalThis as { __almostnodeNativeFetch?: typeof globalThis.fetch }).__almostnodeNativeFetch;
  });

  it('keeps same-origin URLs on browser transport', () => {
    expect(
      selectNetworkRouteForUrl(
        'https://app.example.com/api/data',
        { provider: 'tailscale', authMode: 'interactive', useExitNode: true, exitNodeId: null, corsProxy: null },
        { origin: 'https://app.example.com' },
      ),
    ).toBe('browser');
  });

  it('routes tailnet URLs through tailscale transport', () => {
    expect(
      selectNetworkRouteForUrl(
        'https://db.ts.net/status',
        { provider: 'tailscale', authMode: 'interactive', useExitNode: false, exitNodeId: null, corsProxy: null },
        { origin: 'https://app.example.com' },
      ),
    ).toBe('tailscale');
  });

  it('routes public URLs through browser unless exit-node mode is enabled', () => {
    const baseOptions = {
      provider: 'tailscale' as const,
      authMode: 'interactive' as const,
      corsProxy: null,
    };

    expect(
      selectNetworkRouteForUrl(
        'https://registry.npmjs.org/react',
        { ...baseOptions, useExitNode: true, exitNodeId: null },
        { origin: 'https://app.example.com' },
      ),
    ).toBe('browser');

    expect(
      selectNetworkRouteForUrl(
        'https://registry.npmjs.org/react',
        { ...baseOptions, useExitNode: false, exitNodeId: null },
        { origin: 'https://app.example.com' },
      ),
    ).toBe('browser');

    expect(
      selectNetworkRouteForUrl(
        'https://registry.npmjs.org/react',
        { ...baseOptions, useExitNode: true, exitNodeId: 'node-sfo' },
        { origin: 'https://app.example.com' },
      ),
    ).toBe('tailscale');
  });

  it('uses the tailscale adapter for fetch, dns, and curl when enabled', async () => {
    const createdAdapters: FakeTailscaleAdapter[] = [];
    setTailscaleAdapterFactory(async (_options, onStatus) => {
      const adapter = new FakeTailscaleAdapter(onStatus);
      createdAdapters.push(adapter);
      return adapter;
    });

    const controller = createNetworkController({ provider: 'tailscale' });
    setDefaultNetworkController(controller);

    const loginStatus = await controller.login();
    expect(loginStatus.state).toBe('running');

    const response = await controller.fetch({
      url: 'https://db.ts.net/status',
      method: 'GET',
      headers: {},
    });
    expect(Buffer.from(response.bodyBase64, 'base64').toString()).toBe('tailnet-response');
    expect(createdAdapters[0]?.fetches).toHaveLength(1);

    const lookup = await dnsPromises.lookup('db.ts.net');
    expect((lookup as { address: string }).address).toBe('100.100.100.100');

    const curlResult = await runCurlCommand(
      ['https://db.ts.net/status'],
      { cwd: '/', env: {} } as never,
      new VirtualFS(),
    );
    expect(curlResult.exitCode).toBe(0);
    expect(curlResult.stdout).toBe('tailnet-response');
  });

  it('routes public fetches through tailscale once login reports a selected exit node', async () => {
    const createdAdapters: FakeTailscaleAdapter[] = [];
    setTailscaleAdapterFactory(async (_options, onStatus) => {
      const adapter = new FakeTailscaleAdapter(onStatus);
      createdAdapters.push(adapter);
      return adapter;
    });

    const controller = createNetworkController({
      provider: 'tailscale',
      useExitNode: true,
    });
    setDefaultNetworkController(controller);

    await controller.login();

    const response = await controller.fetch({
      url: 'https://registry.npmjs.org/react',
      method: 'GET',
      headers: {},
    });

    expect(Buffer.from(response.bodyBase64, 'base64').toString()).toBe('tailnet-response');
    expect(createdAdapters[0]?.fetches).toHaveLength(1);
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(controller.getConfig().exitNodeId).toBe('node-sfo');
  });

  it('boots the tailscale adapter on getStatus when tailscale is already selected', async () => {
    const createdAdapters: FakeTailscaleAdapter[] = [];
    setTailscaleAdapterFactory(async (_options, onStatus) => {
      const adapter = new FakeTailscaleAdapter(onStatus);
      createdAdapters.push(adapter);
      return adapter;
    });

    const controller = createNetworkController({ provider: 'tailscale' });
    const status = await controller.getStatus();

    expect(createdAdapters).toHaveLength(1);
    expect(createdAdapters[0]?.getStatusCalls).toBe(1);
    expect(status.state).toBe('needs-login');
    expect(status.provider).toBe('tailscale');
  });

  it('falls back to browser fetch for public HTTP when tailscale is not selected', async () => {
    const controller = createNetworkController({ provider: 'browser' });
    setDefaultNetworkController(controller);

    const response = await controller.fetch({
      url: 'https://registry.npmjs.org/react',
      method: 'GET',
      headers: {},
    });

    expect(Buffer.from(response.bodyBase64, 'base64').toString()).toBe('browser-response');
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it('follows proxy-encoded redirects on browser transport', async () => {
    nativeFetch
      .mockResolvedValueOnce(
        new Response('', {
          status: 200,
          headers: {
            location: 'https://www.google.com/',
            'x-almostnode-upstream-status': '301',
            'x-almostnode-upstream-status-text': 'Moved Permanently',
          },
        }),
      )
      .mockResolvedValueOnce(
        new Response('redirected-browser-response', {
          status: 200,
          headers: { 'content-type': 'text/plain' },
        }),
      );

    const controller = createNetworkController({
      provider: 'browser',
      corsProxy: 'https://proxy.example/?url=',
    });
    setDefaultNetworkController(controller);

    const response = await controller.fetch({
      url: 'https://google.com',
      method: 'GET',
      headers: {},
    });

    expect(Buffer.from(response.bodyBase64, 'base64').toString()).toBe('redirected-browser-response');
    expect(nativeFetch).toHaveBeenCalledTimes(2);
    expect(nativeFetch.mock.calls[0]?.[0]).toBe(
      'https://proxy.example/?url=' + encodeURIComponent('https://google.com/'),
    );
    expect(nativeFetch.mock.calls[1]?.[0]).toBe(
      'https://proxy.example/?url=' + encodeURIComponent('https://www.google.com/'),
    );
  });

  it('preserves proxy-encoded redirects when redirect following is disabled', async () => {
    nativeFetch.mockResolvedValueOnce(
      new Response('', {
        status: 200,
        headers: {
          location: 'https://www.google.com/',
          'x-almostnode-upstream-status': '301',
          'x-almostnode-upstream-status-text': 'Moved Permanently',
        },
      }),
    );

    const controller = createNetworkController({
      provider: 'browser',
      corsProxy: 'https://proxy.example/?url=',
    });
    setDefaultNetworkController(controller);

    const response = await controller.fetch({
      url: 'https://google.com',
      method: 'GET',
      headers: {},
      redirect: 'manual',
    });

    expect(response.status).toBe(301);
    expect(response.statusText).toBe('Moved Permanently');
    expect(response.headers.location).toBe('https://www.google.com/');
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });
});
