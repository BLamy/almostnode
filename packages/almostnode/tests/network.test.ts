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
  NetworkDiagnosticsSnapshot,
  NetworkFetchRequest,
  NetworkFetchResponse,
  NetworkLookupResult,
  NetworkOptions,
  ResolvedNetworkOptions,
  TailscaleAdapter,
  TailscaleAdapterStatus,
} from '../src/network/types';

function buildDiagnostics(
  overrides: Partial<NetworkDiagnosticsSnapshot> = {},
): NetworkDiagnosticsSnapshot {
  return {
    provider: 'tailscale',
    available: true,
    state: 'running',
    counters: {
      totalFetches: 0,
      publicFetches: 0,
      tailnetFetches: 0,
      structuredFetches: 0,
      directIpFallbacks: 0,
      runtimeResets: 0,
      recoveriesAttempted: 0,
      successes: 0,
      failures: 0,
    },
    failureBuckets: {
      dns_loopback: 0,
      direct_ip_fallback_failed: 0,
      structured_fetch_missing_body_base64: 0,
      body_read_timeout: 0,
      fetch_timeout_other: 0,
      runtime_panic: 0,
      runtime_unavailable_other: 0,
      tls_sni_failed: 0,
    },
    dominantFailureBucket: null,
    recentFailures: [],
    runtimeGeneration: 1,
    runtimeResetCount: 0,
    lastRuntimeResetReason: null,
    ...overrides,
  };
}

class FakeTailscaleAdapter implements TailscaleAdapter {
  private status: TailscaleAdapterStatus = { state: 'needs-login' };
  public diagnostics: NetworkDiagnosticsSnapshot = buildDiagnostics();
  public fetches: NetworkFetchRequest[] = [];
  public getStatusCalls = 0;
  public configuredOptions: ResolvedNetworkOptions[] = [];

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

  async configure(options: ResolvedNetworkOptions): Promise<void> {
    this.configuredOptions.push({ ...options });
  }

  async getDiagnostics(): Promise<NetworkDiagnosticsSnapshot> {
    return this.diagnostics;
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

function createRecoverableTailscaleError(
  message = 'Tailscale structured fetch response omitted bodyBase64.',
): Error {
  const error = new Error(message) as Error & {
    code?: string;
    debug?: Record<string, unknown>;
  };
  error.code = 'runtime_unavailable';
  error.debug = {
    lastRuntimeResetReason: message,
  };
  return error;
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
        {
          provider: 'tailscale',
          authMode: 'interactive',
          useExitNode: true,
          exitNodeId: null,
          acceptDns: true,
          corsProxy: null,
          tailscaleConnected: true,
        },
        { origin: 'https://app.example.com' },
      ),
    ).toBe('browser');
  });

  it('routes tailnet URLs through tailscale transport', () => {
    expect(
      selectNetworkRouteForUrl(
        'https://db.ts.net/status',
        {
          provider: 'tailscale',
          authMode: 'interactive',
          useExitNode: false,
          exitNodeId: null,
          acceptDns: true,
          corsProxy: null,
          tailscaleConnected: false,
        },
        { origin: 'https://app.example.com' },
      ),
    ).toBe('tailscale');
  });

  it('routes public URLs through tailscale only after the exit-node session is connected', () => {
    const baseOptions = {
      provider: 'tailscale' as const,
      authMode: 'interactive' as const,
      acceptDns: true,
      corsProxy: null,
    };

    expect(
      selectNetworkRouteForUrl(
        'https://registry.npmjs.org/react',
        {
          ...baseOptions,
          useExitNode: true,
          exitNodeId: null,
          tailscaleConnected: false,
        },
        { origin: 'https://app.example.com' },
      ),
    ).toBe('browser');

    expect(
      selectNetworkRouteForUrl(
        'https://platform.claude.com/oauth/token',
        {
          ...baseOptions,
          useExitNode: false,
          exitNodeId: null,
          tailscaleConnected: true,
        },
        { origin: 'https://app.example.com' },
      ),
    ).toBe('browser');

    // npm module resolution stays on browser even when connected
    expect(
      selectNetworkRouteForUrl(
        'https://registry.npmjs.org/react',
        {
          ...baseOptions,
          useExitNode: true,
          exitNodeId: 'node-sfo',
          tailscaleConnected: true,
        },
        { origin: 'https://app.example.com' },
      ),
    ).toBe('browser');

    expect(
      selectNetworkRouteForUrl(
        'https://platform.claude.com/oauth/token',
        {
          ...baseOptions,
          useExitNode: true,
          exitNodeId: 'node-sfo',
          tailscaleConnected: true,
        },
        { origin: 'https://app.example.com' },
      ),
    ).toBe('tailscale');

    expect(
      selectNetworkRouteForUrl(
        'https://api.anthropic.com/v1/messages',
        {
          ...baseOptions,
          useExitNode: true,
          exitNodeId: 'node-sfo',
          tailscaleConnected: true,
        },
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

  it('routes Claude public fetches through tailscale once login reports a selected exit node', async () => {
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
      url: 'https://platform.claude.com/oauth/token',
      method: 'GET',
      headers: {},
    });

    expect(Buffer.from(response.bodyBase64, 'base64').toString()).toBe('tailnet-response');
    expect(createdAdapters[0]?.fetches).toHaveLength(1);
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(controller.getConfig().exitNodeId).toBe('node-sfo');
    expect(createdAdapters[0]?.configuredOptions.at(-1)).toMatchObject({
      exitNodeId: 'node-sfo',
      useExitNode: true,
    });
  });

  it('routes public POST requests through tailscale when exit-node is connected', async () => {
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
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-key',
      },
      bodyBase64: Buffer.from('{"model":"claude-sonnet-4-20250514"}').toString('base64'),
    });

    expect(Buffer.from(response.bodyBase64, 'base64').toString()).toBe('tailnet-response');
    expect(createdAdapters[0]?.fetches).toHaveLength(1);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('keeps npm module resolution on browser transport even when tailscale is connected', async () => {
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

    expect(Buffer.from(response.bodyBase64, 'base64').toString()).toBe('browser-response');
    expect(createdAdapters[0]?.fetches).toHaveLength(0);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces public tailscale fetch failures without browser fallback', async () => {
    setTailscaleAdapterFactory(async (_options, onStatus) => {
      const status = {
        state: 'running' as const,
        selectedExitNodeId: 'node-sfo',
      };
      onStatus(status);
      return {
        async getStatus(): Promise<TailscaleAdapterStatus> {
          return status;
        },
        async login(): Promise<TailscaleAdapterStatus> {
          return status;
        },
        async logout(): Promise<TailscaleAdapterStatus> {
          return { state: 'stopped' };
        },
        async fetch(): Promise<NetworkFetchResponse> {
          throw new Error('TLS certificate validation failed');
        },
        async lookup(): Promise<NetworkLookupResult> {
          return { hostname: '', addresses: [] };
        },
      };
    });

    const controller = createNetworkController({
      provider: 'tailscale',
      useExitNode: true,
    });
    setDefaultNetworkController(controller);

    await expect(controller.fetch({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      bodyBase64: Buffer.from('{}').toString('base64'),
    })).rejects.toThrow('TLS certificate validation failed');
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('surfaces tailnet-internal fetch failures without browser fallback', async () => {
    setTailscaleAdapterFactory(async (_options, onStatus) => {
      const status = {
        state: 'running' as const,
        selectedExitNodeId: 'node-sfo',
      };
      onStatus(status);
      return {
        async getStatus(): Promise<TailscaleAdapterStatus> {
          return status;
        },
        async login(): Promise<TailscaleAdapterStatus> {
          return status;
        },
        async logout(): Promise<TailscaleAdapterStatus> {
          return { state: 'stopped' };
        },
        async fetch(): Promise<NetworkFetchResponse> {
          throw new Error('tailnet peer refused connection');
        },
        async lookup(): Promise<NetworkLookupResult> {
          return { hostname: 'db.ts.net', addresses: [] };
        },
      };
    });

    const controller = createNetworkController({
      provider: 'tailscale',
      useExitNode: true,
    });
    setDefaultNetworkController(controller);

    await expect(controller.fetch({
      url: 'https://db.ts.net/status',
      method: 'GET',
      headers: {},
    })).rejects.toThrow('tailnet peer refused connection');
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('retries one tailscale fetch after runtime recovery only when the request is marked safe to replay', async () => {
    const fetches: NetworkFetchRequest[] = [];
    let getStatusCalls = 0;

    setTailscaleAdapterFactory(async (_options, onStatus) => ({
      async getStatus(): Promise<TailscaleAdapterStatus> {
        getStatusCalls += 1;
        const status = {
          state: 'running' as const,
          selectedExitNodeId: 'node-sfo',
        };
        onStatus(status);
        return status;
      },
      async login(): Promise<TailscaleAdapterStatus> {
        return {
          state: 'running',
          selectedExitNodeId: 'node-sfo',
        };
      },
      async logout(): Promise<TailscaleAdapterStatus> {
        return { state: 'stopped' };
      },
      async fetch(request: NetworkFetchRequest): Promise<NetworkFetchResponse> {
        fetches.push(request);
        if (fetches.length === 1) {
          throw createRecoverableTailscaleError();
        }
        return {
          url: request.url,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/plain' },
          bodyBase64: Buffer.from('tailnet-response').toString('base64'),
        };
      },
      async lookup(): Promise<NetworkLookupResult> {
        return { hostname: 'opencode.ai', addresses: [] };
      },
    }));

    const controller = createNetworkController({
      provider: 'tailscale',
      useExitNode: true,
    });
    setDefaultNetworkController(controller);

    const response = await controller.fetch({
      url: 'https://opencode.ai/install',
      method: 'GET',
      headers: {},
      retryOnTailscaleRecovery: true,
    });

    expect(Buffer.from(response.bodyBase64, 'base64').toString()).toBe('tailnet-response');
    expect(fetches).toHaveLength(2);
    expect(getStatusCalls).toBe(2);
    expect(nativeFetch).not.toHaveBeenCalled();
  });

  it('passes diagnostics through for tailscale sessions and returns empty browser diagnostics otherwise', async () => {
    const createdAdapters: FakeTailscaleAdapter[] = [];
    setTailscaleAdapterFactory(async (_options, onStatus) => {
      const adapter = new FakeTailscaleAdapter(onStatus);
      adapter.diagnostics = buildDiagnostics({
        counters: {
          totalFetches: 3,
          publicFetches: 2,
          tailnetFetches: 1,
          structuredFetches: 2,
          directIpFallbacks: 1,
          runtimeResets: 1,
          recoveriesAttempted: 1,
          successes: 2,
          failures: 1,
        },
        failureBuckets: {
          dns_loopback: 1,
          direct_ip_fallback_failed: 0,
          structured_fetch_missing_body_base64: 0,
          body_read_timeout: 0,
          fetch_timeout_other: 0,
          runtime_panic: 0,
          runtime_unavailable_other: 0,
          tls_sni_failed: 0,
        },
        dominantFailureBucket: 'dns_loopback',
      });
      createdAdapters.push(adapter);
      return adapter;
    });

    const tailscaleController = createNetworkController({
      provider: 'tailscale',
      useExitNode: true,
    });
    await tailscaleController.login();

    await expect(tailscaleController.getDiagnostics()).resolves.toMatchObject({
      provider: 'tailscale',
      available: true,
      dominantFailureBucket: 'dns_loopback',
      counters: {
        totalFetches: 3,
        directIpFallbacks: 1,
      },
    });

    const browserController = createNetworkController({ provider: 'browser' });
    await browserController.fetch({
      url: 'https://registry.npmjs.org/react',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      bodyBase64: Buffer.from('{"probe":true}').toString('base64'),
    });

    await expect(browserController.getDiagnostics()).resolves.toMatchObject({
      provider: 'browser',
      available: false,
      state: 'browser',
      counters: {
        totalFetches: 0,
        failures: 0,
      },
      dominantFailureBucket: null,
    });

    expect(createdAdapters).toHaveLength(1);
  });

  it('surfaces a recoverable tailscale error for opaque POSTs without replaying them', async () => {
    let fetchCalls = 0;
    let getStatusCalls = 0;

    setTailscaleAdapterFactory(async (_options, onStatus) => ({
      async getStatus(): Promise<TailscaleAdapterStatus> {
        getStatusCalls += 1;
        const status = {
          state: getStatusCalls === 1 ? 'running' as const : 'starting' as const,
          selectedExitNodeId: 'node-sfo',
          detail: getStatusCalls === 1
            ? undefined
            : 'Recovering Tailscale runtime after failure.',
        };
        onStatus(status);
        return status;
      },
      async login(): Promise<TailscaleAdapterStatus> {
        return {
          state: 'running',
          selectedExitNodeId: 'node-sfo',
        };
      },
      async logout(): Promise<TailscaleAdapterStatus> {
        return { state: 'stopped' };
      },
      async fetch(): Promise<NetworkFetchResponse> {
        fetchCalls += 1;
        throw createRecoverableTailscaleError();
      },
      async lookup(): Promise<NetworkLookupResult> {
        return { hostname: 'chatgpt.com', addresses: [] };
      },
    }));

    const controller = createNetworkController({
      provider: 'tailscale',
      useExitNode: true,
    });
    setDefaultNetworkController(controller);

    await expect(controller.fetch({
      url: 'https://chatgpt.com/backend-api/codex/responses',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      bodyBase64: Buffer.from('{}').toString('base64'),
    })).rejects.toMatchObject({
      message: expect.stringContaining('not retried automatically because it was not marked safe to replay'),
      code: 'runtime_unavailable',
    });

    expect(fetchCalls).toBe(1);
    expect(nativeFetch).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(getStatusCalls).toBe(2);
    });
  });

  it('routes generic public fetches through tailscale after tailscale login', async () => {
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
      url: 'https://opencode.ai/install',
      method: 'GET',
      headers: {},
    });

    expect(Buffer.from(response.bodyBase64, 'base64').toString()).toBe('tailnet-response');
    expect(createdAdapters[0]?.fetches).toHaveLength(1);
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(controller.getConfig().tailscaleConnected).toBe(true);
  });

  it('refreshes tailscale status before the first public fetch so persisted sessions bypass the proxy', async () => {
    const fetches: NetworkFetchRequest[] = [];
    let getStatusCalls = 0;

    setTailscaleAdapterFactory(async (_options, onStatus) => ({
      async getStatus(): Promise<TailscaleAdapterStatus> {
        getStatusCalls += 1;
        const status = {
          state: 'running' as const,
          selectedExitNodeId: 'node-sfo',
        };
        onStatus(status);
        return status;
      },
      async login(): Promise<TailscaleAdapterStatus> {
        return {
          state: 'running',
          selectedExitNodeId: 'node-sfo',
        };
      },
      async logout(): Promise<TailscaleAdapterStatus> {
        return { state: 'stopped' };
      },
      async fetch(request: NetworkFetchRequest): Promise<NetworkFetchResponse> {
        fetches.push(request);
        return {
          url: request.url,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/plain' },
          bodyBase64: Buffer.from('tailnet-response').toString('base64'),
        };
      },
      async lookup(): Promise<NetworkLookupResult> {
        return {
          hostname: 'db.ts.net',
          addresses: [{ address: '100.100.100.100', family: 4 }],
        };
      },
    }));

    const controller = createNetworkController({
      provider: 'tailscale',
      useExitNode: true,
    });
    setDefaultNetworkController(controller);

    const response = await controller.fetch({
      url: 'https://opencode.ai/install',
      method: 'GET',
      headers: {},
    });

    expect(Buffer.from(response.bodyBase64, 'base64').toString()).toBe('tailnet-response');
    expect(fetches).toHaveLength(1);
    expect(nativeFetch).not.toHaveBeenCalled();
    expect(getStatusCalls).toBe(1);
    expect(controller.getConfig().tailscaleConnected).toBe(true);
  });

  it('waits for runtime-selected exit-node confirmation before routing public fetches through tailscale', async () => {
    const tailscaleFetches: NetworkFetchRequest[] = [];
    const configuredOptions: ResolvedNetworkOptions[] = [];
    let selectedExitNodeId: string | null = null;

    const buildStatus = (): TailscaleAdapterStatus => ({
      state: 'running',
      selectedExitNodeId,
      exitNodes: [
        {
          id: 'node-ord',
          name: 'ord',
          online: false,
          selected: selectedExitNodeId === 'node-ord',
        },
        {
          id: 'node-self',
          name: 'bretts-macbook-air',
          online: true,
          selected: selectedExitNodeId === 'node-self',
        },
      ],
    });

    setTailscaleAdapterFactory(async (_options, onStatus) => ({
      async getStatus(): Promise<TailscaleAdapterStatus> {
        const status = buildStatus();
        onStatus(status);
        return status;
      },
      async login(): Promise<TailscaleAdapterStatus> {
        return buildStatus();
      },
      async logout(): Promise<TailscaleAdapterStatus> {
        return { state: 'stopped' };
      },
      async configure(options: ResolvedNetworkOptions): Promise<void> {
        configuredOptions.push({ ...options });
        selectedExitNodeId = options.exitNodeId;
      },
      async fetch(request: NetworkFetchRequest): Promise<NetworkFetchResponse> {
        tailscaleFetches.push(request);
        return {
          url: request.url,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/plain' },
          bodyBase64: Buffer.from('tailnet-response').toString('base64'),
        };
      },
      async lookup(): Promise<NetworkLookupResult> {
        return { hostname: 'chatgpt.com', addresses: [] };
      },
    }));

    const controller = createNetworkController({
      provider: 'tailscale',
      useExitNode: true,
      exitNodeId: null,
    });
    setDefaultNetworkController(controller);

    const response = await controller.fetch({
      url: 'https://chatgpt.com/backend-api/codex/responses',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      bodyBase64: Buffer.from('{}').toString('base64'),
    });

    expect(Buffer.from(response.bodyBase64, 'base64').toString()).toBe('browser-response');
    expect(tailscaleFetches).toHaveLength(0);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(controller.getConfig().exitNodeId).toBe('node-self');
    expect(controller.getConfig().activeExitNodeId).toBeNull();
    expect(
      selectNetworkRouteForUrl(
        'https://chatgpt.com/backend-api/codex/responses',
        controller.getConfig(),
        { origin: 'https://app.example.com' },
      ),
    ).toBe('browser');
    await expect(controller.getStatus()).resolves.toMatchObject({
      selectedExitNodeId: 'node-self',
      exitNodes: [
        expect.objectContaining({
          id: 'node-ord',
          selected: false,
        }),
        expect.objectContaining({
          id: 'node-self',
          selected: true,
        }),
      ],
    });
    expect(controller.getConfig().activeExitNodeId).toBe('node-self');
    const retriedResponse = await controller.fetch({
      url: 'https://chatgpt.com/backend-api/codex/responses',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      bodyBase64: Buffer.from('{}').toString('base64'),
    });
    expect(Buffer.from(retriedResponse.bodyBase64, 'base64').toString()).toBe('tailnet-response');
    expect(tailscaleFetches).toHaveLength(1);
    expect(nativeFetch).toHaveBeenCalledTimes(1);
    expect(configuredOptions.at(-1)).toMatchObject({
      provider: 'tailscale',
      useExitNode: true,
      exitNodeId: 'node-self',
    });
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

  it('hydrates runtime-owned tailscale sessions and persists updated config', async () => {
    const adapterOptions: Array<Record<string, unknown>> = [];
    const loadSession = vi.fn(async () => ({
      provider: 'tailscale' as const,
      useExitNode: true,
      exitNodeId: 'node-ord',
      acceptDns: false,
      stateSnapshot: { profile: 'alpha' },
    }));
    const saveSession = vi.fn(async () => {});

    setTailscaleAdapterFactory(async (options) => {
      adapterOptions.push({ ...options });
      return {
        async configure(nextOptions): Promise<void> {
          adapterOptions.push({ ...nextOptions });
        },
        async getStatus(): Promise<TailscaleAdapterStatus> {
          return {
            state: 'running',
            selectedExitNodeId: 'node-ord',
            dnsEnabled: false,
            dnsHealthy: true,
          };
        },
        async login(): Promise<TailscaleAdapterStatus> {
          return {
            state: 'running',
            selectedExitNodeId: 'node-ord',
            dnsEnabled: false,
            dnsHealthy: true,
          };
        },
        async logout(): Promise<TailscaleAdapterStatus> {
          return { state: 'stopped' };
        },
        async fetch(request: NetworkFetchRequest): Promise<NetworkFetchResponse> {
          return {
            url: request.url,
            status: 200,
            statusText: 'OK',
            headers: {},
            bodyBase64: '',
          };
        },
        async lookup(): Promise<NetworkLookupResult> {
          return {
            hostname: 'db.ts.net',
            addresses: [{ address: '100.100.100.100', family: 4 }],
          };
        },
      };
    });

    const controller = createNetworkController(
      {},
      {
        loadSession,
        saveSession,
      },
    );

    const status = await controller.getStatus();
    expect(loadSession).toHaveBeenCalledTimes(1);
    expect(status.provider).toBe('tailscale');
    expect(status.dnsEnabled).toBe(false);
    expect(controller.getConfig()).toMatchObject({
      provider: 'tailscale',
      useExitNode: true,
      exitNodeId: 'node-ord',
      acceptDns: false,
    });
    expect(adapterOptions[0]).toMatchObject({
      provider: 'tailscale',
      useExitNode: true,
      exitNodeId: 'node-ord',
      acceptDns: false,
    });

    await controller.configure({ exitNodeId: 'node-sfo' });

    expect(saveSession).toHaveBeenLastCalledWith({
      provider: 'tailscale',
      useExitNode: true,
      exitNodeId: 'node-sfo',
      acceptDns: false,
      stateSnapshot: { profile: 'alpha' },
    });
  });

  it('retains a hydrated tailscale snapshot while status refresh resumes directly to running', async () => {
    const loadSession = vi.fn(async () => ({
      provider: 'tailscale' as const,
      useExitNode: true,
      exitNodeId: 'node-ord',
      acceptDns: false,
      stateSnapshot: { profile: 'alpha' },
    }));
    const saveSession = vi.fn(async () => {});

    setTailscaleAdapterFactory(async (_options, onStatus) => ({
      async getStatus(): Promise<TailscaleAdapterStatus> {
        const status = {
          state: 'running' as const,
          selectedExitNodeId: 'node-ord',
          dnsEnabled: false,
          dnsHealthy: true,
        };
        onStatus(status);
        return status;
      },
      async login(): Promise<TailscaleAdapterStatus> {
        return {
          state: 'running',
          selectedExitNodeId: 'node-ord',
          dnsEnabled: false,
          dnsHealthy: true,
        };
      },
      async logout(): Promise<TailscaleAdapterStatus> {
        return { state: 'stopped' };
      },
      async fetch(request: NetworkFetchRequest): Promise<NetworkFetchResponse> {
        return {
          url: request.url,
          status: 200,
          statusText: 'OK',
          headers: {},
          bodyBase64: '',
        };
      },
      async lookup(): Promise<NetworkLookupResult> {
        return {
          hostname: 'db.ts.net',
          addresses: [{ address: '100.100.100.100', family: 4 }],
        };
      },
    }));

    const controller = createNetworkController(
      {},
      {
        loadSession,
        saveSession,
      },
    );

    const status = await controller.getStatus();

    expect(status.state).toBe('running');
    expect(status.provider).toBe('tailscale');
    await vi.waitFor(() => {
      expect(saveSession).toHaveBeenLastCalledWith({
        provider: 'tailscale',
        useExitNode: true,
        exitNodeId: 'node-ord',
        acceptDns: false,
        stateSnapshot: { profile: 'alpha' },
      });
    });
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
