import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createNativeTailscaleConnectAdapter,
  createTailscaleConnectAdapterFactory,
} from '../src/network/tailscale-connect-adapter';
import {
  parseTailscaleStateSnapshot,
  TAILSCALE_SESSION_STORAGE_KEY,
} from '../src/network/tailscale-session-storage';

class MemorySessionStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class FakeWorker {
  static lastInstance: FakeWorker | null = null;
  static getStatusValue: Record<string, unknown> = {
    state: 'running',
    selectedExitNodeId: 'node-sfo',
  };
  static loginValue: Record<string, unknown> = {
    state: 'needs-login',
    loginUrl: 'https://login.tailscale.test',
  };
  static diagnosticsValue: Record<string, unknown> = {
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
  };

  readonly messages: Array<Record<string, unknown>> = [];
  private readonly listeners = {
    error: new Set<(event: { message?: string }) => void>(),
    message: new Set<(event: { data: unknown }) => void>(),
    messageerror: new Set<() => void>(),
  };

  constructor(_url: URL, _options?: WorkerOptions) {
    FakeWorker.lastInstance = this;
  }

  addEventListener(
    type: 'message' | 'error' | 'messageerror',
    listener: ((event: { data: unknown }) => void)
      | ((event: { message?: string }) => void)
      | (() => void),
  ): void {
    (this.listeners[type] as Set<typeof listener>).add(listener);
  }

  postMessage(message: Record<string, unknown>): void {
    this.messages.push(message);

    switch (message.type) {
      case 'setDebug':
      case 'hydrateStorage':
      case 'configure':
        this.emitMessage({
          type: 'response',
          id: message.id,
          ok: true,
          value: null,
        });
        break;
      case 'getStatus':
        this.emitMessage({
          type: 'response',
          id: message.id,
          ok: true,
          value: FakeWorker.getStatusValue,
        });
        break;
      case 'getDiagnostics':
        this.emitMessage({
          type: 'response',
          id: message.id,
          ok: true,
          value: FakeWorker.diagnosticsValue,
        });
        break;
      case 'login':
        this.emitMessage({
          type: 'response',
          id: message.id,
          ok: true,
          value: FakeWorker.loginValue,
        });
        break;
      case 'logout':
        this.emitMessage({
          type: 'storageUpdate',
          snapshot: null,
        });
        this.emitMessage({
          type: 'response',
          id: message.id,
          ok: true,
          value: {
            state: 'needs-login',
          },
        });
        break;
    }
  }

  emitMessage(data: unknown): void {
    for (const listener of this.listeners.message) {
      listener({ data });
    }
  }

  terminate(): void {}
}

describe('tailscale connect adapter', () => {
  const originalWorker = globalThis.Worker;
  const originalOpen = Object.getOwnPropertyDescriptor(globalThis, 'open');
  const originalDebug = Object.getOwnPropertyDescriptor(globalThis, '__almostnodeDebug');
  const originalSessionStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    'sessionStorage',
  );

  beforeEach(() => {
    FakeWorker.lastInstance = null;
    FakeWorker.getStatusValue = {
      state: 'running',
      selectedExitNodeId: 'node-sfo',
    };
    FakeWorker.loginValue = {
      state: 'needs-login',
      loginUrl: 'https://login.tailscale.test',
    };
    FakeWorker.diagnosticsValue = {
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
    };
    globalThis.Worker = FakeWorker as unknown as typeof Worker;
  });

  afterEach(() => {
    globalThis.Worker = originalWorker;

    if (originalOpen) {
      Object.defineProperty(globalThis, 'open', originalOpen);
    } else {
      delete (globalThis as typeof globalThis & { open?: typeof globalThis.open }).open;
    }

    if (originalDebug) {
      Object.defineProperty(globalThis, '__almostnodeDebug', originalDebug);
    } else {
      delete (globalThis as typeof globalThis & { __almostnodeDebug?: string }).__almostnodeDebug;
    }

    if (originalSessionStorage) {
      Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
    } else {
      delete (globalThis as unknown as { sessionStorage?: MemorySessionStorage }).sessionStorage;
    }
  });

  it('hydrates worker storage from sessionStorage and persists storage updates', async () => {
    const storage = new MemorySessionStorage();
    storage.setItem(
      TAILSCALE_SESSION_STORAGE_KEY,
      JSON.stringify({ profile: 'alpha' }),
    );
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: storage,
      configurable: true,
    });

    const adapterFactory = createTailscaleConnectAdapterFactory();
    const adapter = await adapterFactory(
      {
        provider: 'tailscale',
        authMode: 'interactive',
        useExitNode: true,
        exitNodeId: 'node-sfo',
        acceptDns: true,
        corsProxy: null,
        tailscaleConnected: false,
      },
      () => {},
    );

    const status = await adapter.getStatus();
    const worker = FakeWorker.lastInstance;

    expect(worker?.messages[0]).toMatchObject({
      type: 'hydrateStorage',
      snapshot: { profile: 'alpha' },
    });
    expect(worker?.messages[1]).toMatchObject({
      type: 'configure',
    });
    expect(worker?.messages[2]).toMatchObject({
      type: 'getStatus',
    });
    expect(status.state).toBe('running');

    worker?.emitMessage({
      type: 'storageUpdate',
      snapshot: { profile: 'beta', machine: '123' },
    });
    expect(
      parseTailscaleStateSnapshot(
        storage.getItem(TAILSCALE_SESSION_STORAGE_KEY),
      ),
    ).toEqual({ profile: 'beta', machine: '123' });

    worker?.emitMessage({
      type: 'storageUpdate',
      snapshot: null,
    });
    expect(storage.getItem(TAILSCALE_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('reuses a hydrated running session without forcing a new login', async () => {
    const storage = new MemorySessionStorage();
    storage.setItem(
      TAILSCALE_SESSION_STORAGE_KEY,
      JSON.stringify({ profile: 'alpha' }),
    );
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: storage,
      configurable: true,
    });

    const adapterFactory = createTailscaleConnectAdapterFactory();
    const adapter = await adapterFactory(
      {
        provider: 'tailscale',
        authMode: 'interactive',
        useExitNode: true,
        exitNodeId: null,
        acceptDns: true,
        corsProxy: null,
        tailscaleConnected: false,
      },
      () => {},
    );

    await adapter.login();
    const worker = FakeWorker.lastInstance;

    expect(worker?.messages).toHaveLength(3);
    expect(worker?.messages[0]).toMatchObject({
      type: 'hydrateStorage',
      snapshot: { profile: 'alpha' },
    });
    expect(worker?.messages[1]).toMatchObject({
      type: 'configure',
    });
    expect(worker?.messages[2]).toMatchObject({
      type: 'getStatus',
    });
  });

  it('logs out stale hydrated sessions before requesting a new login', async () => {
    const storage = new MemorySessionStorage();
    storage.setItem(
      TAILSCALE_SESSION_STORAGE_KEY,
      JSON.stringify({ profile: 'alpha' }),
    );
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: storage,
      configurable: true,
    });
    FakeWorker.getStatusValue = {
      state: 'needs-login',
    };

    const adapterFactory = createTailscaleConnectAdapterFactory();
    const adapter = await adapterFactory(
      {
        provider: 'tailscale',
        authMode: 'interactive',
        useExitNode: true,
        exitNodeId: null,
        acceptDns: true,
        corsProxy: null,
        tailscaleConnected: false,
      },
      () => {},
    );

    await adapter.login();
    const worker = FakeWorker.lastInstance;

    expect(worker?.messages).toHaveLength(5);
    expect(worker?.messages[0]).toMatchObject({
      type: 'hydrateStorage',
      snapshot: { profile: 'alpha' },
    });
    expect(worker?.messages[1]).toMatchObject({
      type: 'configure',
    });
    expect(worker?.messages[2]).toMatchObject({
      type: 'getStatus',
    });
    expect(worker?.messages[3]).toMatchObject({
      type: 'logout',
    });
    expect(worker?.messages[4]).toMatchObject({
      type: 'login',
    });
  });

  it('pre-opens and reuses an auth popup when the login URL arrives asynchronously', async () => {
    const popup = {
      closed: false,
      close: vi.fn(),
      document: {
        close: vi.fn(),
        open: vi.fn(),
        write: vi.fn(),
      },
      focus: vi.fn(),
      location: {
        replace: vi.fn(),
      },
      opener: { current: true },
    };
    const open = vi.fn(() => popup as unknown as Window);
    Object.defineProperty(globalThis, 'open', {
      value: open,
      configurable: true,
      writable: true,
    });

    const onAuthUrl = vi.fn();
    const adapter = createNativeTailscaleConnectAdapter(
      {
        provider: 'tailscale',
        authMode: 'interactive',
        useExitNode: true,
        exitNodeId: null,
        acceptDns: true,
        corsProxy: null,
        tailscaleConnected: false,
      },
      () => {},
      { onAuthUrl },
    );

    await adapter.login();

    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(popup.document.write).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('Waiting for Tailscale login'),
    );
    expect(popup.document.write).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('Continue to Tailscale login'),
    );
    expect(popup.document.write).toHaveBeenLastCalledWith(
      expect.stringContaining('https://login.tailscale.test'),
    );
    expect(popup.location.replace).toHaveBeenCalledWith('https://login.tailscale.test');
    expect(popup.focus).toHaveBeenCalledTimes(1);
    expect(popup.opener).toBeNull();
    expect(onAuthUrl).not.toHaveBeenCalled();
  });

  it('keeps the popup actionable when scripted navigation to the auth URL fails', async () => {
    const popup = {
      closed: false,
      close: vi.fn(),
      document: {
        close: vi.fn(),
        open: vi.fn(),
        write: vi.fn(),
      },
      focus: vi.fn(),
      location: {
        replace: vi.fn(() => {
          throw new Error('navigation blocked');
        }),
      },
      opener: { current: true },
    };
    const open = vi.fn(() => popup as unknown as Window);
    Object.defineProperty(globalThis, 'open', {
      value: open,
      configurable: true,
      writable: true,
    });

    const onAuthUrl = vi.fn();
    const adapter = createNativeTailscaleConnectAdapter(
      {
        provider: 'tailscale',
        authMode: 'interactive',
        useExitNode: true,
        exitNodeId: null,
        acceptDns: true,
        corsProxy: null,
        tailscaleConnected: false,
      },
      () => {},
      { onAuthUrl },
    );

    await adapter.login();

    expect(popup.document.write).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('Continue to Tailscale login'),
    );
    expect(popup.document.write).toHaveBeenLastCalledWith(
      expect.stringContaining('https://login.tailscale.test'),
    );
    expect(popup.close).not.toHaveBeenCalled();
    expect(onAuthUrl).not.toHaveBeenCalled();
  });

  it('falls back to the auth hook when the browser blocks the pre-opened popup', async () => {
    const open = vi.fn(() => null);
    Object.defineProperty(globalThis, 'open', {
      value: open,
      configurable: true,
      writable: true,
    });

    const onAuthUrl = vi.fn();
    const adapter = createNativeTailscaleConnectAdapter(
      {
        provider: 'tailscale',
        authMode: 'interactive',
        useExitNode: true,
        exitNodeId: null,
        acceptDns: true,
        corsProxy: null,
        tailscaleConnected: false,
      },
      () => {},
      { onAuthUrl },
    );

    await adapter.login();

    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(onAuthUrl).toHaveBeenCalledWith('https://login.tailscale.test');
  });

  it('clears persisted state on explicit logout', async () => {
    const storage = new MemorySessionStorage();
    storage.setItem(
      TAILSCALE_SESSION_STORAGE_KEY,
      JSON.stringify({ profile: 'alpha' }),
    );
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: storage,
      configurable: true,
    });

    const adapterFactory = createTailscaleConnectAdapterFactory();
    const adapter = await adapterFactory(
      {
        provider: 'tailscale',
        authMode: 'interactive',
        useExitNode: true,
        exitNodeId: null,
        acceptDns: true,
        corsProxy: null,
        tailscaleConnected: false,
      },
      () => {},
    );

    await adapter.logout();
    const worker = FakeWorker.lastInstance;

    expect(worker?.messages[2]).toMatchObject({
      type: 'logout',
    });
    expect(storage.getItem(TAILSCALE_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('preserves worker error codes when requests fail', async () => {
    const adapterFactory = createTailscaleConnectAdapterFactory();
    const adapter = await adapterFactory(
      {
        provider: 'tailscale',
        authMode: 'interactive',
        useExitNode: true,
        exitNodeId: null,
        acceptDns: true,
        corsProxy: null,
        tailscaleConnected: false,
      },
      () => {},
    );

    const fetchPromise = adapter.fetch({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      bodyBase64: Buffer.from('{}').toString('base64'),
    });

    await vi.waitFor(() => {
      expect(FakeWorker.lastInstance?.messages.at(-1)).toMatchObject({ type: 'fetch' });
    });
    const worker = FakeWorker.lastInstance;
    const fetchMessage = worker?.messages.at(-1);

    worker?.emitMessage({
      type: 'response',
      id: fetchMessage?.id,
      ok: false,
      error: {
        code: 'fetch_timeout',
        message: 'Tailscale fetch timed out after 15000ms: POST https://api.anthropic.com/v1/messages',
        debug: {
          phase: 'fallback_fetch',
          hostname: 'api.anthropic.com',
          ipAddress: '104.18.33.45',
          fallbackAttempted: true,
          fallbackStrategy: 'rewrite_to_resolved_ip',
        },
      },
    });

    await expect(fetchPromise).rejects.toMatchObject({
      code: 'fetch_timeout',
      message: 'Tailscale fetch timed out after 15000ms: POST https://api.anthropic.com/v1/messages',
      debug: {
        phase: 'fallback_fetch',
        hostname: 'api.anthropic.com',
        ipAddress: '104.18.33.45',
        fallbackAttempted: true,
        fallbackStrategy: 'rewrite_to_resolved_ip',
      },
    });
  });

  it('forwards diagnostics and propagates the debug selector to the worker', async () => {
    Object.defineProperty(globalThis, '__almostnodeDebug', {
      value: 'tailscale,network,http',
      configurable: true,
      writable: true,
    });

    const adapterFactory = createTailscaleConnectAdapterFactory();
    const adapter = await adapterFactory(
      {
        provider: 'tailscale',
        authMode: 'interactive',
        useExitNode: true,
        exitNodeId: null,
        acceptDns: true,
        corsProxy: null,
        tailscaleConnected: false,
      },
      () => {},
    );

    const diagnostics = await adapter.getDiagnostics();
    const worker = FakeWorker.lastInstance;

    expect(worker?.messages[0]).toMatchObject({
      type: 'setDebug',
      raw: 'tailscale,network,http',
    });
    expect(worker?.messages[1]).toMatchObject({
      type: 'hydrateStorage',
    });
    expect(worker?.messages[2]).toMatchObject({
      type: 'configure',
    });
    expect(worker?.messages[3]).toMatchObject({
      type: 'getDiagnostics',
    });
    expect(diagnostics).toMatchObject({
      provider: 'tailscale',
      available: true,
      state: 'running',
    });

    delete (globalThis as typeof globalThis & { __almostnodeDebug?: string }).__almostnodeDebug;
  });
});
