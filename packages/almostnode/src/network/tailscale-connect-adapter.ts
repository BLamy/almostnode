import type {
  NetworkDiagnosticsSnapshot,
  NetworkFetchRequest,
  NetworkFetchResponse,
  NetworkLookupOptions,
  NetworkLookupResult,
  PersistedNetworkSession,
  ResolvedNetworkOptions,
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

interface AuthPopupWindow {
  closed?: boolean;
  close?: () => void;
  focus?: () => void;
  opener?: unknown;
  location?: {
    href?: string;
    replace?: (url: string) => void;
  };
  document?: {
    body?: { innerHTML?: string };
    close?: () => void;
    open?: () => void;
    title?: string;
    write?: (html: string) => void;
  };
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

function escapeAuthPopupHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function buildAuthPopupHtml(state: 'waiting' | 'redirect', url?: string): string {
  const linkMarkup = state === 'redirect' && url
    ? `<p style="margin: 0 0 16px;">` +
        `If the redirect does not start automatically, use this link:</p>` +
        `<p style="margin: 0;">` +
        `<a href="${escapeAuthPopupHtml(url)}" ` +
          `style="color: #0f766e; font-weight: 600; text-decoration: none;">` +
          `Continue to Tailscale login</a>` +
        `</p>`
    : '';
  const redirectScript = state === 'redirect' && url
    ? `<meta http-equiv="refresh" content="0; url=${escapeAuthPopupHtml(url)}">` +
        `<script>window.location.replace(${JSON.stringify(url)});</script>`
    : '';
  const message = state === 'redirect'
    ? 'Redirecting to Tailscale login...'
    : 'Waiting for Tailscale login...';

  return '<!doctype html>' +
    '<html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>Tailscale Login</title>' +
    redirectScript +
    '</head><body style="' +
      'margin:0;padding:24px;font-family:system-ui,-apple-system,BlinkMacSystemFont,' +
      '\'Segoe UI\',sans-serif;background:#f8fafc;color:#0f172a;">' +
    '<main style="max-width:420px;">' +
    `<p style="margin: 0 0 16px; font-size: 16px; line-height: 1.5;">${message}</p>` +
    linkMarkup +
    '</main></body></html>';
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
  private lastWorkerDebugRaw: string | null | undefined = undefined;
  private sessionSnapshot: TailscaleStateSnapshot | null;
  private pendingAuthPopup: AuthPopupWindow | null = null;

  constructor(
    private options: ResolvedNetworkOptions,
    private readonly onStatus: (status: TailscaleAdapterStatus) => void,
    private readonly hooks: TailscaleConnectAdapterHooks = {},
  ) {
    this.sessionSnapshot = hooks.initialSnapshot ?? null;
  }

  async configure(options: ResolvedNetworkOptions): Promise<void> {
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
      this.syncAuthPopupWithStatus(this.status);
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

  async getDiagnostics(): Promise<NetworkDiagnosticsSnapshot> {
    return this.sendRequest<NetworkDiagnosticsSnapshot>({
      type: 'getDiagnostics',
    });
  }

  async login(): Promise<TailscaleAdapterStatus> {
    this.ensurePendingAuthPopup();
    try {
      if (this.hasPersistedSessionSnapshot()) {
        const currentStatus = await this.refreshStatus();
        if (currentStatus.state === 'running' || currentStatus.state === 'starting') {
          return currentStatus;
        }
        if (this.shouldResetSessionBeforeLogin(currentStatus)) {
          await this.resetSessionBeforeLogin();
        }
      }
      this.status = await this.sendRequest<TailscaleAdapterStatus>({
        type: 'login',
      });
      this.handleAuthUrl(this.status.loginUrl ?? null);
      this.syncAuthPopupWithStatus(this.status);
      this.onStatus(this.status);
      return this.status;
    } catch (error) {
      this.closePendingAuthPopup();
      throw error;
    }
  }

  async logout(): Promise<TailscaleAdapterStatus> {
    this.status = await this.sendRequest<TailscaleAdapterStatus>({
      type: 'logout',
    });
    this.closePendingAuthPopup();
    this.handleAuthUrl(this.status.loginUrl ?? null);
    this.syncAuthPopupWithStatus(this.status);
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
    this.closePendingAuthPopup();
    for (const pending of this.pendingRequests.values()) {
      pending.reject(new Error('Tailscale adapter disposed.'));
    }
    this.pendingRequests.clear();
    this.workerConfigured = false;
    this.workerHydrated = false;
    this.workerHydrationPromise = null;
    this.lastWorkerDebugRaw = undefined;
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
        this.syncAuthPopupWithStatus(this.status);
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
      this.closePendingAuthPopup();
      this.status = { state: 'error', detail };
      this.onStatus(this.status);
      this.workerConfigured = false;
      this.workerHydrated = false;
      this.workerHydrationPromise = null;
      this.lastWorkerDebugRaw = undefined;
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
    await this.ensureWorkerDebugConfigured();
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

  private async ensureWorkerDebugConfigured(): Promise<void> {
    const raw = getActiveAlmostnodeDebugRaw();
    if (raw === this.lastWorkerDebugRaw) {
      return;
    }

    if (raw === null && this.lastWorkerDebugRaw === undefined) {
      this.lastWorkerDebugRaw = null;
      return;
    }

    await this.postRequest<null>({
      type: 'setDebug',
      raw,
    });
    this.lastWorkerDebugRaw = raw;
  }

  private handleAuthUrl(url: string | null): void {
    if (url === this.lastAuthUrl) {
      return;
    }
    this.lastAuthUrl = url;
    if (url && this.navigatePendingAuthPopup(url)) {
      return;
    }
    this.hooks.onAuthUrl?.(url);
  }

  private ensurePendingAuthPopup(): void {
    const existing = this.pendingAuthPopup;
    if (existing && !existing.closed) {
      return;
    }

    let popup: AuthPopupWindow | null = null;
    try {
      popup = globalThis.open?.('', '_blank') as AuthPopupWindow | null;
    } catch {
      popup = null;
    }

    if (!popup) {
      this.pendingAuthPopup = null;
      return;
    }

    this.pendingAuthPopup = popup;
    this.writePendingAuthPopupDocument(buildAuthPopupHtml('waiting'));
  }

  private navigatePendingAuthPopup(url: string): boolean {
    const popup = this.pendingAuthPopup;
    if (!popup) {
      return false;
    }

    if (popup.closed) {
      this.pendingAuthPopup = null;
      return false;
    }

    try {
      popup.opener = null;
    } catch {
      // Ignore opener assignment failures and continue navigation.
    }

    const renderedRedirectPage = this.writePendingAuthPopupDocument(
      buildAuthPopupHtml('redirect', url),
    );
    let navigated = false;
    try {
      if (typeof popup.location?.replace === 'function') {
        popup.location.replace(url);
        navigated = true;
      } else if (popup.location && typeof popup.location.href === 'string') {
        popup.location.href = url;
        navigated = true;
      }
    } catch {
      navigated = false;
    }

    try {
      popup.focus?.();
    } catch {
      // Ignore focus failures.
    }

    if (renderedRedirectPage || navigated) {
      return true;
    }

    try {
      popup.close?.();
    } catch {
      // Ignore popup cleanup failures.
    }
    this.pendingAuthPopup = null;
    return false;
  }

  private closePendingAuthPopup(): void {
    const popup = this.pendingAuthPopup;
    this.pendingAuthPopup = null;
    if (!popup || popup.closed) {
      return;
    }

    try {
      popup.close?.();
    } catch {
      // Ignore popup cleanup failures.
    }
  }

  private syncAuthPopupWithStatus(status: TailscaleAdapterStatus): void {
    if (status.loginUrl) {
      return;
    }

    switch (status.state) {
      case 'needs-login':
      case 'starting':
        return;
      default:
        this.closePendingAuthPopup();
    }
  }

  private async refreshStatus(): Promise<TailscaleAdapterStatus> {
    this.status = await this.sendRequest<TailscaleAdapterStatus>({
      type: 'getStatus',
    });
    this.handleAuthUrl(this.status.loginUrl ?? null);
    this.syncAuthPopupWithStatus(this.status);
    this.onStatus(this.status);
    return this.status;
  }

  private shouldResetSessionBeforeLogin(
    status: TailscaleAdapterStatus,
  ): boolean {
    return status.state === 'needs-login' && this.hasPersistedSessionSnapshot();
  }

  private hasPersistedSessionSnapshot(): boolean {
    return Boolean(this.sessionSnapshot && Object.keys(this.sessionSnapshot).length > 0);
  }

  private async resetSessionBeforeLogin(): Promise<void> {
    this.status = await this.sendRequest<TailscaleAdapterStatus>({
      type: 'logout',
    });
    this.handleAuthUrl(this.status.loginUrl ?? null);
    this.syncAuthPopupWithStatus(this.status);
    this.onStatus(this.status);
  }

  private writePendingAuthPopupDocument(html: string): boolean {
    const popup = this.pendingAuthPopup;
    if (!popup || popup.closed || typeof popup.document?.write !== 'function') {
      return false;
    }

    try {
      popup.document.open?.();
      popup.document.write(html);
      popup.document.close?.();
      return true;
    } catch {
      return false;
    }
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
  options: ResolvedNetworkOptions,
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

function getActiveAlmostnodeDebugRaw(): string | null {
  try {
    const processValue = (globalThis as { process?: { env?: { ALMOSTNODE_DEBUG?: unknown } } }).process
      ?.env?.ALMOSTNODE_DEBUG;
    if (typeof processValue === 'string' && processValue.trim()) {
      return processValue;
    }
  } catch {
    // Ignore process env lookup failures.
  }

  try {
    const globalValue = (globalThis as { __almostnodeDebug?: unknown }).__almostnodeDebug;
    if (typeof globalValue === 'string' && globalValue.trim()) {
      return globalValue;
    }
  } catch {
    // Ignore global debug lookup failures.
  }

  try {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    const storedValue = localStorage.getItem('__almostnodeDebug');
    if (typeof storedValue === 'string' && storedValue.trim()) {
      return storedValue;
    }
  } catch {
    // Ignore storage lookup failures.
  }

  return null;
}
