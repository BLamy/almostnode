import type {
  NetworkFetchRequest,
  NetworkFetchResponse,
  NetworkLookupOptions,
  NetworkLookupResult,
  NetworkOptions,
  PersistedNetworkSession,
  TailscaleAdapter,
  TailscaleAdapterFactory,
  TailscaleAdapterStatus,
} from './types';
import type {
  TailscaleWorkerErrorDebug,
  TailscaleWorkerErrorPayload,
  TailscaleWorkerEvent,
  TailscaleWorkerRequest,
} from './tailscale-worker-types';
import {
  createTailscaleSessionPersistence,
  type StorageLike,
  type TailscaleStateSnapshot,
} from './tailscale-session-storage';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

class TailscaleAdapterError extends Error {
  readonly code?: string;
  readonly debug?: TailscaleWorkerErrorDebug;

  constructor(error: TailscaleWorkerErrorPayload | string) {
    const message = typeof error === 'string' ? error : error.message;
    super(message);
    this.name = 'TailscaleAdapterError';
    this.code = typeof error === 'string' ? undefined : error.code;
    this.debug = typeof error === 'string' ? undefined : error.debug;
  }
}

interface TailscaleConnectAdapterHooks {
  initialSnapshot?: TailscaleStateSnapshot | null;
  onAuthUrl?: (url: string | null) => void;
  onPersistedSessionChange?: (session: PersistedNetworkSession | null) => void;
}

class TailscaleConnectAdapter implements TailscaleAdapter {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private workerConfigured = false;
  private workerHydrated = false;
  private workerHydrationPromise: Promise<void> | null = null;
  private status: TailscaleAdapterStatus = { state: 'needs-login' };
  private lastAuthUrl: string | null = null;
  private sessionSnapshot: TailscaleStateSnapshot | null;

  constructor(
    private options: Required<NetworkOptions>,
    private readonly onStatus: (status: TailscaleAdapterStatus) => void,
    private readonly hooks: TailscaleConnectAdapterHooks = {},
  ) {
    this.sessionSnapshot = hooks.initialSnapshot ?? null;
  }

  async configure(options: Required<NetworkOptions>): Promise<void> {
    this.options = options;
    await this.sendRequest<null>({
      type: 'configure',
      options: this.options,
    });
  }

  async getStatus(): Promise<TailscaleAdapterStatus> {
    try {
      this.status = await this.sendRequest<TailscaleAdapterStatus>({
        type: 'getStatus',
      });
      this.handleAuthUrl(this.status.loginUrl ?? null);
      this.onStatus(this.status);
    } catch (error) {
      this.status = {
        state: 'error',
        detail: error instanceof Error ? error.message : String(error),
      };
      this.onStatus(this.status);
    }

    return this.status;
  }

  async login(): Promise<TailscaleAdapterStatus> {
    this.status = await this.sendRequest<TailscaleAdapterStatus>({
      type: 'login',
    });
    this.handleAuthUrl(this.status.loginUrl ?? null);
    this.onStatus(this.status);
    return this.status;
  }

  async logout(): Promise<TailscaleAdapterStatus> {
    this.status = await this.sendRequest<TailscaleAdapterStatus>({
      type: 'logout',
    });
    this.handleAuthUrl(this.status.loginUrl ?? null);
    this.onStatus(this.status);
    return this.status;
  }

  async fetch(request: NetworkFetchRequest): Promise<NetworkFetchResponse> {
    return this.sendRequest<NetworkFetchResponse>({
      type: 'fetch',
      request,
    });
  }

  async lookup(
    hostname: string,
    options?: NetworkLookupOptions,
  ): Promise<NetworkLookupResult> {
    return this.sendRequest<NetworkLookupResult>({
      type: 'lookup',
      hostname,
      options,
    });
  }

  getSessionSnapshot(): TailscaleStateSnapshot | null {
    return this.sessionSnapshot;
  }

  dispose(): void {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error('Tailscale adapter disposed.'));
    }
    this.pendingRequests.clear();
    this.workerConfigured = false;
    this.workerHydrated = false;
    this.workerHydrationPromise = null;
    this.worker?.terminate();
    this.worker = null;
  }

  private async ensureWorker(): Promise<Worker> {
    if (this.worker) {
      return this.worker;
    }

    const worker = new Worker(
      new URL('./tailscale-connect-worker.ts', import.meta.url),
      {
        type: 'module',
        name: 'almostnode-tailscale',
      },
    );

    worker.addEventListener('message', (event: MessageEvent<TailscaleWorkerEvent>) => {
      const message = event.data;
      if (message.type === 'storageUpdate') {
        this.sessionSnapshot = message.snapshot;
        this.hooks.onPersistedSessionChange?.(this.buildPersistedSession());
        if (message.snapshot) {
          this.onStatus(this.status);
          return;
        }

        this.onStatus(this.status);
        return;
      }

      if (message.type === 'status') {
        this.status = message.status;
        this.handleAuthUrl(message.status.loginUrl ?? null);
        this.onStatus(this.status);
        return;
      }

      const pending = this.pendingRequests.get(message.id);
      if (!pending) {
        return;
      }

      this.pendingRequests.delete(message.id);
      if (message.ok) {
        pending.resolve(message.value);
      } else {
        pending.reject(new TailscaleAdapterError(message.error));
      }
    });

    const handleWorkerFailure = (detail: string) => {
      this.status = { state: 'error', detail };
      this.onStatus(this.status);
      this.workerConfigured = false;
      this.workerHydrated = false;
      this.workerHydrationPromise = null;
      for (const pending of this.pendingRequests.values()) {
        pending.reject(new TailscaleAdapterError({
          code: 'runtime_unavailable',
          message: detail,
        }));
      }
      this.pendingRequests.clear();
      this.worker?.terminate();
      this.worker = null;
    };

    worker.addEventListener('error', (event) => {
      handleWorkerFailure(event.message || 'Tailscale worker crashed.');
    });

    worker.addEventListener('messageerror', () => {
      handleWorkerFailure('Tailscale worker sent an invalid message.');
    });

    this.worker = worker;
    return worker;
  }

  private async ensureWorkerHydrated(): Promise<void> {
    if (this.workerHydrated) {
      return;
    }

    if (!this.workerHydrationPromise) {
      this.workerHydrationPromise = this.postRequest<null>({
        type: 'hydrateStorage',
        snapshot: this.sessionSnapshot,
      }).then(() => {
        this.workerHydrated = true;
      }).finally(() => {
        this.workerHydrationPromise = null;
      });
    }

    await this.workerHydrationPromise;
  }

  private async postRequest<T>(request: TailscaleWorkerRequest): Promise<T> {
    const worker = await this.ensureWorker();
    const id = this.nextRequestId++;
    const message = { ...request, id };

    return new Promise<T>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
      });
      worker.postMessage(message);
    });
  }

  private async sendRequest<T>(request: TailscaleWorkerRequest): Promise<T> {
    await this.ensureWorkerHydrated();

    if (!this.workerConfigured && request.type !== 'configure') {
      await this.postRequest<null>({
        type: 'configure',
        options: this.options,
      });
      this.workerConfigured = true;
    }

    const value = await this.postRequest<T>(request);
    if (request.type === 'configure') {
      this.workerConfigured = true;
    }
    return value;
  }

  private handleAuthUrl(url: string | null): void {
    if (url === this.lastAuthUrl) {
      return;
    }
    this.lastAuthUrl = url;
    this.hooks.onAuthUrl?.(url);
  }

  private buildPersistedSession(): PersistedNetworkSession | null {
    if (this.options.provider !== 'tailscale') {
      return null;
    }

    return {
      provider: 'tailscale',
      useExitNode: this.options.useExitNode,
      exitNodeId: this.options.exitNodeId,
      acceptDns: this.options.acceptDns,
      stateSnapshot: this.sessionSnapshot,
    };
  }
}

export function createTailscaleConnectAdapterFactory(): TailscaleAdapterFactory {
  return async (options, onStatus) => {
    const storage = getBrowserSessionStorage();
    const persistence = createTailscaleSessionPersistence(storage);
    return new TailscaleConnectAdapter(options, onStatus, {
      initialSnapshot: persistence.load(),
      onAuthUrl: (url) => {
        if (!url) {
          return;
        }
        try {
          globalThis.open?.(url, '_blank', 'noopener,noreferrer');
        } catch {
          // Ignore popup failures; the UI/status still exposes the URL.
        }
      },
      onPersistedSessionChange: (session) => {
        if (!session?.stateSnapshot) {
          persistence.clear();
          return;
        }
        persistence.save(session.stateSnapshot);
      },
    });
  };
}

export function createNativeTailscaleConnectAdapter(
  options: Required<NetworkOptions>,
  onStatus: (status: TailscaleAdapterStatus) => void,
  hooks: TailscaleConnectAdapterHooks = {},
): TailscaleAdapter {
  return new TailscaleConnectAdapter(options, onStatus, hooks);
}

function getBrowserSessionStorage(): StorageLike | null {
  try {
    if (typeof sessionStorage === 'undefined') {
      return null;
    }
    return sessionStorage;
  } catch {
    return null;
  }
}
