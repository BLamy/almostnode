import type {
  NetworkFetchRequest,
  NetworkFetchResponse,
  NetworkLookupOptions,
  NetworkLookupResult,
  NetworkOptions,
  TailscaleAdapter,
  TailscaleAdapterFactory,
  TailscaleAdapterStatus,
} from './types';
import type {
  TailscaleWorkerEvent,
  TailscaleWorkerRequest,
} from './tailscale-worker-types';
import {
  createTailscaleSessionPersistence,
  type StorageLike,
} from './tailscale-session-storage';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

class TailscaleConnectAdapter implements TailscaleAdapter {
  private worker: Worker | null = null;
  private nextRequestId = 1;
  private pendingRequests = new Map<number, PendingRequest>();
  private workerConfigured = false;
  private workerHydrated = false;
  private workerHydrationPromise: Promise<void> | null = null;
  private status: TailscaleAdapterStatus = { state: 'needs-login' };
  private shouldOpenNextLoginUrl = false;

  constructor(
    private options: Required<NetworkOptions>,
    private readonly onStatus: (status: TailscaleAdapterStatus) => void,
  ) {}

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
      this.maybeOpenLoginUrl();
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
    this.shouldOpenNextLoginUrl = true;

    // Tailscale rejects reauthorization when a stale nodekey is still present.
    // Start each fresh login attempt from an explicit logout/reset.
    if (this.status.state !== 'running') {
      try {
        await this.sendRequest<TailscaleAdapterStatus>({
          type: 'logout',
        });
      } catch {
        // A best-effort reset is enough here; proceed with login either way.
      }
    }

    this.status = await this.sendRequest<TailscaleAdapterStatus>({
      type: 'login',
    });
    this.maybeOpenLoginUrl();
    this.onStatus(this.status);
    return this.status;
  }

  async logout(): Promise<TailscaleAdapterStatus> {
    this.status = await this.sendRequest<TailscaleAdapterStatus>({
      type: 'logout',
    });
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

  private maybeOpenLoginUrl(): void {
    if (!this.shouldOpenNextLoginUrl || !this.status.loginUrl) {
      return;
    }

    this.shouldOpenNextLoginUrl = false;
    try {
      globalThis.open?.(this.status.loginUrl, '_blank', 'noopener,noreferrer');
    } catch {
      // Ignore popup failures; the UI/status still exposes the URL.
    }
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
        if (message.snapshot) {
          this.persistence.save(message.snapshot);
        } else {
          this.persistence.clear();
        }
        this.onStatus(this.status);
        return;
      }

      if (message.type === 'status') {
        this.status = message.status;
        this.maybeOpenLoginUrl();
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
        pending.reject(new Error(message.error));
      }
    });

    const handleWorkerFailure = (detail: string) => {
      this.status = { state: 'error', detail };
      this.onStatus(this.status);
      this.workerConfigured = false;
      this.workerHydrated = false;
      this.workerHydrationPromise = null;
      for (const pending of this.pendingRequests.values()) {
        pending.reject(new Error(detail));
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

  private getBrowserSessionStorage(): StorageLike | null {
    try {
      if (typeof sessionStorage === 'undefined') {
        return null;
      }
      return sessionStorage;
    } catch {
      return null;
    }
  }

  private readonly persistence = createTailscaleSessionPersistence(
    this.getBrowserSessionStorage(),
  );

  private async ensureWorkerHydrated(): Promise<void> {
    if (this.workerHydrated) {
      return;
    }

    if (!this.workerHydrationPromise) {
      const snapshot = this.persistence.load();
      this.workerHydrationPromise = this.postRequest<null>({
        type: 'hydrateStorage',
        snapshot,
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
}

export function createTailscaleConnectAdapterFactory(): TailscaleAdapterFactory {
  return async (options, onStatus) => {
    return new TailscaleConnectAdapter(options, onStatus);
  };
}
