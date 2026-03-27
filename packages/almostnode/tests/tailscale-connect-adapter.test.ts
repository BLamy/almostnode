import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTailscaleConnectAdapterFactory } from '../src/network/tailscale-connect-adapter';
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

    if (originalSessionStorage) {
      Object.defineProperty(globalThis, 'sessionStorage', originalSessionStorage);
    } else {
      delete (globalThis as { sessionStorage?: MemorySessionStorage }).sessionStorage;
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
        corsProxy: null,
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

  it('explicitly logs out before a fresh login attempt', async () => {
    Object.defineProperty(globalThis, 'sessionStorage', {
      value: new MemorySessionStorage(),
      configurable: true,
    });

    const adapterFactory = createTailscaleConnectAdapterFactory();
    const adapter = await adapterFactory(
      {
        provider: 'tailscale',
        authMode: 'interactive',
        useExitNode: true,
        exitNodeId: null,
        corsProxy: null,
      },
      () => {},
    );

    await adapter.login();
    const worker = FakeWorker.lastInstance;

    expect(worker?.messages[0]).toMatchObject({
      type: 'hydrateStorage',
    });
    expect(worker?.messages[1]).toMatchObject({
      type: 'configure',
    });
    expect(worker?.messages[2]).toMatchObject({
      type: 'logout',
    });
    expect(worker?.messages[3]).toMatchObject({
      type: 'login',
    });
  });
});
