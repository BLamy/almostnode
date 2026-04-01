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
          value: {
            state: 'running',
            selectedExitNodeId: 'node-sfo',
          },
        });
        break;
      case 'login':
        this.emitMessage({
          type: 'response',
          id: message.id,
          ok: true,
          value: {
            state: 'needs-login',
            loginUrl: 'https://login.tailscale.test',
          },
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
  const originalSessionStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    'sessionStorage',
  );

  beforeEach(() => {
    FakeWorker.lastInstance = null;
    globalThis.Worker = FakeWorker as unknown as typeof Worker;
  });

  afterEach(() => {
    globalThis.Worker = originalWorker;

    if (originalOpen) {
      Object.defineProperty(globalThis, 'open', originalOpen);
    } else {
      delete (globalThis as typeof globalThis & { open?: typeof globalThis.open }).open;
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

  it('logs in directly from a hydrated session without a synthetic logout', async () => {
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
    expect(popup.document.write).toHaveBeenCalled();
    expect(popup.location.replace).toHaveBeenCalledWith('https://login.tailscale.test');
    expect(popup.focus).toHaveBeenCalledTimes(1);
    expect(popup.opener).toBeNull();
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
});
