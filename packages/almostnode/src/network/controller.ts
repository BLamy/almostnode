import { browserFetch } from './fetch';
import {
  selectNetworkRouteForHost,
  selectNetworkRouteForUrl,
} from './routing';
import {
  normalizeNetworkOptions,
  resolveBrowserWebSocketTarget,
  resolveNetworkPolicy,
  selectWebSocketRouteForUrl,
} from './policy';
import { createNativeTailscaleConnectAdapter } from './tailscale-connect-adapter';
import { getBrowserNativeWebSocket } from './browser-websocket';
import type { TailscaleWorkerErrorDebug } from './tailscale-worker-types';
import type {
  NetworkIntegration,
  NetworkController,
  NetworkFetchRequest,
  NetworkFetchResponse,
  NetworkLookupResult,
  NetworkOptions,
  NetworkStatus,
  NetworkWebSocketConnection,
  NetworkWebSocketInit,
  PersistedNetworkSession,
  ResolvedNetworkOptions,
  ResolvedNetworkPolicy,
  TailscaleAdapter,
  TailscaleAdapterFactory,
  TailscaleAdapterStatus,
} from './types';

let tailscaleAdapterFactory: TailscaleAdapterFactory | null = null;
let defaultNetworkController: NetworkController | null = null;
let defaultNetworkControllerImplicit = false;
let tailscaleAdapterFactoryPromise: Promise<TailscaleAdapterFactory | null> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function formatTailscaleError(error: unknown): {
  code: string | null;
  message: string;
  debug: TailscaleWorkerErrorDebug | null;
} {
  if (error instanceof Error) {
    const withCode = error as Error & { code?: unknown; debug?: unknown };
    return {
      code: typeof withCode.code === 'string' ? withCode.code : null,
      message: error.message,
      debug: withCode.debug && typeof withCode.debug === 'object'
        ? withCode.debug as TailscaleWorkerErrorDebug
        : null,
    };
  }

  if (error && typeof error === 'object') {
    const record = error as Record<string, unknown>;
    return {
      code: typeof record.code === 'string' ? record.code : null,
      message:
        typeof record.message === 'string'
          ? record.message
          : String(error),
      debug: record.debug && typeof record.debug === 'object'
        ? record.debug as TailscaleWorkerErrorDebug
        : null,
    };
  }

  return {
    code: null,
    message: String(error),
    debug: null,
  };
}

function buildBrowserStatus(options: ResolvedNetworkOptions): NetworkStatus {
  return {
    provider: options.provider,
    state: options.provider === 'tailscale' ? 'needs-login' : 'browser',
    active: options.provider !== 'tailscale',
    canLogin: options.provider === 'tailscale',
    canLogout: false,
    adapterAvailable: true,
    dnsEnabled: false,
    dnsHealthy: null,
    exitNodes: [],
    selectedExitNodeId: null,
    updatedAt: nowIso(),
  };
}

function mergeStatus(
  options: ResolvedNetworkOptions,
  status: TailscaleAdapterStatus | null,
): NetworkStatus {
  if (options.provider !== 'tailscale') {
    return buildBrowserStatus(options);
  }

  if (!status) {
    return {
      provider: 'tailscale',
      state: 'needs-login',
      active: false,
      canLogin: true,
      canLogout: false,
      adapterAvailable: true,
      dnsEnabled: options.acceptDns,
      dnsHealthy: null,
      dnsDetail: undefined,
      exitNodes: [],
      selectedExitNodeId: null,
      updatedAt: nowIso(),
    };
  }

  const state = status.state || 'needs-login';
  return {
    provider: 'tailscale',
    state,
    active: state === 'running',
    canLogin: state !== 'running' && state !== 'starting',
    canLogout: state === 'running' || state === 'starting',
    adapterAvailable: true,
    dnsEnabled: status.dnsEnabled ?? options.acceptDns,
    dnsHealthy: status.dnsHealthy ?? null,
    dnsDetail: status.dnsDetail,
    exitNodes: status.exitNodes || [],
    selectedExitNodeId: status.selectedExitNodeId ?? null,
    detail: status.detail,
    loginUrl: status.loginUrl,
    selfName: status.selfName,
    tailnetName: status.tailnetName,
    updatedAt: nowIso(),
  };
}

export class DefaultNetworkController implements NetworkController {
  private options: ResolvedNetworkOptions;
  private readonly initialOptionKeys: ReadonlySet<string>;
  private readonly integration: NetworkIntegration | null;
  private listeners = new Set<(status: NetworkStatus) => void>();
  private adapter: TailscaleAdapter | null = null;
  private adapterPromise: Promise<TailscaleAdapter> | null = null;
  private adapterStatus: TailscaleAdapterStatus | null = null;
  private persistedSession: PersistedNetworkSession | null = null;
  private sessionHydrationPromise: Promise<void> | null = null;
  private shouldClearPersistedSession = false;

  constructor(
    options: NetworkOptions = {},
    integration: NetworkIntegration | null = null,
  ) {
    this.options = normalizeNetworkOptions(options);
    this.initialOptionKeys = new Set(Object.keys(options));
    this.integration = integration;
  }

  getConfig(): ResolvedNetworkOptions {
    return this.getResolvedOptions();
  }

  getResolvedPolicy(): ResolvedNetworkPolicy {
    return resolveNetworkPolicy(this.getResolvedOptions());
  }

  subscribe(listener: (status: NetworkStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async configure(options: Partial<NetworkOptions>): Promise<NetworkStatus> {
    await this.ensureSessionHydrated();
    const previousProvider = this.options.provider;
    this.options = normalizeNetworkOptions({
      ...this.options,
      ...options,
      proxy: {
        ...this.options.proxy,
        ...(options.proxy || {}),
      },
    });
    this.shouldClearPersistedSession = false;

    if (this.adapter?.configure) {
      await this.adapter.configure(this.options);
    }

    if (previousProvider === 'tailscale' && this.options.provider !== 'tailscale') {
      this.emit();
    }

    const status = await this.getStatus();
    this.emit(status);
    await this.persistSession();
    return status;
  }

  async getStatus(): Promise<NetworkStatus> {
    await this.ensureSessionHydrated();
    if (this.options.provider !== 'tailscale') {
      return buildBrowserStatus(this.options);
    }

    if (!this.adapter) {
      try {
        await this.ensureAdapter();
      } catch (error) {
        this.adapterStatus = {
          state: 'error',
          detail: error instanceof Error ? error.message : String(error),
        };
        return mergeStatus(this.options, this.adapterStatus);
      }
    }

    if (this.adapter) {
      try {
        this.adapterStatus = await this.adapter.getStatus();
      } catch (error) {
        this.adapterStatus = {
          state: 'error',
          detail: error instanceof Error ? error.message : String(error),
        };
      }
    }

    await this.syncResolvedExitNodeSelection();
    return mergeStatus(this.options, this.adapterStatus);
  }

  async login(): Promise<NetworkStatus> {
    await this.ensureSessionHydrated();
    if (this.options.provider !== 'tailscale') {
      this.options = normalizeNetworkOptions({ ...this.options, provider: 'tailscale' });
    }
    this.shouldClearPersistedSession = false;

    const adapter = await this.ensureAdapter();
    this.adapterStatus = await adapter.login();
    await this.syncResolvedExitNodeSelection();
    const status = mergeStatus(this.options, this.adapterStatus);
    this.emit(status);
    await this.persistSession();
    return status;
  }

  async logout(): Promise<NetworkStatus> {
    await this.ensureSessionHydrated();
    if (!this.adapter) {
      const status = await this.getStatus();
      this.emit(status);
      return status;
    }

    this.shouldClearPersistedSession = true;
    this.adapterStatus = await this.adapter.logout();
    const status = mergeStatus(this.options, this.adapterStatus);
    this.emit(status);
    await this.persistSession();
    return status;
  }

  async fetch(request: NetworkFetchRequest): Promise<NetworkFetchResponse> {
    await this.ensureSessionHydrated();
    if (this.options.provider === 'tailscale' && this.adapterStatus === null) {
      await this.getStatus();
    }

    const options = this.getResolvedOptions();
    const route = selectNetworkRouteForUrl(request.url, options);
    if (route === 'tailscale') {
      try {
        const adapter = await this.ensureAdapter();
        await this.syncResolvedExitNodeSelection();
        return await adapter.fetch(request);
      } catch (error) {
        const hostname = this.extractHostname(request.url);
        const formatted = formatTailscaleError(error);
        const target = hostname || request.url;
        console.warn(
          `[network] Tailscale fetch failed for ${target}${formatted.code ? ` (${formatted.code})` : ''}`,
          formatted.debug
            ? {
                message: formatted.message,
                debug: formatted.debug,
              }
            : formatted.message,
        );
        throw error;
      }
    }
    return browserFetch(request, this.getResolvedPolicy());
  }

  async connectWebSocket(
    url: string,
    init: NetworkWebSocketInit = {},
  ): Promise<NetworkWebSocketConnection> {
    await this.ensureSessionHydrated();
    if (this.options.provider === 'tailscale' && this.adapterStatus === null) {
      await this.getStatus();
    }

    const policy = this.getResolvedPolicy();
    const route = selectWebSocketRouteForUrl(
      url,
      policy,
      typeof location !== 'undefined' ? location : null,
    );
    if (route === 'tailscale') {
      throw new Error(
        `Tailscale-routed WebSocket connections are not yet supported for ${url}`,
      );
    }

    const NativeWS = getBrowserNativeWebSocket();
    if (!NativeWS) {
      throw new TypeError('Failed to fetch');
    }

    const target = resolveBrowserWebSocketTarget(
      url,
      policy,
      init,
      typeof location !== 'undefined' ? location : null,
    );

    if (!target.proxied && init.headers && Object.keys(init.headers).length > 0) {
      console.warn(
        `[network] Ignoring custom WebSocket headers for direct browser connection to ${url}`,
      );
    }

    const socket = target.constructorProtocols !== undefined
      ? new NativeWS(target.url, target.constructorProtocols)
      : new NativeWS(target.url);
    socket.binaryType = 'arraybuffer';

    return {
      socket,
      url: target.url,
      route,
      proxied: target.proxied,
    };
  }

  async lookup(
    hostname: string,
    options: { family?: number; all?: boolean } = {},
  ): Promise<NetworkLookupResult> {
    await this.ensureSessionHydrated();
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return {
        hostname,
        addresses: [{ address: '127.0.0.1', family: 4 }],
      };
    }

    const route = selectNetworkRouteForHost(hostname, this.getResolvedOptions());
    if (route === 'tailscale') {
      const adapter = await this.ensureAdapter();
      await this.syncResolvedExitNodeSelection();
      return adapter.lookup(hostname, options);
    }

    if (options.family === 6) {
      return {
        hostname,
        addresses: [{ address: '::1', family: 6 }],
      };
    }

    return {
      hostname,
      addresses: [{ address: '0.0.0.0', family: 4 }],
    };
  }

  private async ensureAdapter(): Promise<TailscaleAdapter> {
    if (this.adapter) {
      return this.adapter;
    }

    if (!this.adapterPromise) {
      this.adapterPromise = this.createAdapter().catch((error) => {
        this.adapterPromise = null;
        throw error;
      });
    }

    return this.adapterPromise;
  }

  private getResolvedOptions(): ResolvedNetworkOptions {
    const tailscaleConnected = this.adapterStatus?.state === 'running';

    if (
      this.options.provider !== 'tailscale' ||
      !this.options.useExitNode ||
      this.options.exitNodeId
    ) {
      return {
        ...this.options,
        tailscaleConnected,
      };
    }

    const selectedExitNodeId = this.adapterStatus?.selectedExitNodeId?.trim() || null;
    return {
      ...this.options,
      exitNodeId: selectedExitNodeId,
      tailscaleConnected,
    };
  }

  private extractHostname(rawUrl: string): string | null {
    try {
      return new URL(
        rawUrl,
        typeof location !== 'undefined' && location.origin ? location.origin : undefined,
      ).hostname || null;
    } catch {
      return null;
    }
  }

  private emit(status = mergeStatus(this.options, this.adapterStatus)): void {
    for (const listener of this.listeners) {
      listener(status);
    }
  }

  private async syncResolvedExitNodeSelection(): Promise<void> {
    if (
      this.options.provider !== 'tailscale'
      || !this.options.useExitNode
      || this.options.exitNodeId
    ) {
      return;
    }

    const selectedExitNodeId = this.adapterStatus?.selectedExitNodeId?.trim() || null;
    if (!selectedExitNodeId) {
      return;
    }

    this.options = normalizeNetworkOptions({
      ...this.options,
      exitNodeId: selectedExitNodeId,
    });

    if (this.adapter?.configure) {
      await this.adapter.configure(this.options);
    }
  }

  private async createAdapter(): Promise<TailscaleAdapter> {
    const adapterFactory = await ensureTailscaleAdapterFactory();
    if (adapterFactory) {
      const adapter = await adapterFactory(this.options, (status) => {
        this.adapterStatus = status;
        this.emit();
        void this.persistSession();
      });
      this.adapter = adapter;
      return adapter;
    }

    const adapter = createNativeTailscaleConnectAdapter(
      this.options,
      (status) => {
        this.adapterStatus = status;
        this.emit();
        void this.persistSession();
      },
      {
        initialSnapshot: this.persistedSession?.stateSnapshot ?? null,
        onAuthUrl: (url) => {
          this.integration?.onAuthUrl?.(url);
        },
        onPersistedSessionChange: (session) => {
          if (session) {
            this.persistedSession = session;
            this.shouldClearPersistedSession = false;
          } else if (!this.shouldClearPersistedSession) {
            this.persistedSession = this.buildPersistedSession();
          }
          void this.persistSession();
        },
      },
    );
    this.adapter = adapter;
    return adapter;
  }

  private async ensureSessionHydrated(): Promise<void> {
    if (!this.integration?.loadSession) {
      return;
    }

    if (!this.sessionHydrationPromise) {
      this.sessionHydrationPromise = Promise.resolve(this.integration.loadSession())
        .then((session) => {
          this.persistedSession = session;
          if (!session || session.provider !== 'tailscale') {
            return;
          }

          const nextOptions = { ...this.options };
          if (!this.initialOptionKeys.has('provider')) {
            nextOptions.provider = session.provider;
          }
          if (!this.initialOptionKeys.has('useExitNode')) {
            nextOptions.useExitNode = session.useExitNode;
          }
          if (!this.initialOptionKeys.has('exitNodeId')) {
            nextOptions.exitNodeId = session.exitNodeId;
          }
          if (!this.initialOptionKeys.has('acceptDns')) {
            nextOptions.acceptDns = session.acceptDns;
          }
          this.options = normalizeNetworkOptions(nextOptions);
        })
        .catch(() => {
          this.persistedSession = null;
        });
    }

    await this.sessionHydrationPromise;
  }

  private buildPersistedSession(): PersistedNetworkSession | null {
    const resolvedOptions = this.getResolvedOptions();
    if (resolvedOptions.provider !== 'tailscale' || this.shouldClearPersistedSession) {
      return null;
    }

    return {
      provider: 'tailscale',
      useExitNode: resolvedOptions.useExitNode,
      exitNodeId: resolvedOptions.exitNodeId,
      acceptDns: resolvedOptions.acceptDns,
      stateSnapshot: this.adapter?.getSessionSnapshot?.()
        ?? this.persistedSession?.stateSnapshot
        ?? null,
    };
  }

  private async persistSession(): Promise<void> {
    if (!this.integration?.saveSession) {
      return;
    }

    const session = this.buildPersistedSession();
    this.persistedSession = session;
    await this.integration.saveSession(session);
  }
}

export function createNetworkController(
  options: NetworkOptions = {},
  integration: NetworkIntegration | null = null,
): NetworkController {
  return new DefaultNetworkController(options, integration);
}

export function hasExplicitDefaultNetworkController(): boolean {
  return Boolean(defaultNetworkController) && !defaultNetworkControllerImplicit;
}

export function getDefaultNetworkController(): NetworkController {
  if (!defaultNetworkController) {
    defaultNetworkController = createNetworkController();
    defaultNetworkControllerImplicit = true;
  }
  return defaultNetworkController;
}

export function setDefaultNetworkController(
  controller: NetworkController | null,
  implicit = false,
): void {
  defaultNetworkController = controller;
  defaultNetworkControllerImplicit = Boolean(controller) && implicit;
}

export function setTailscaleAdapterFactory(
  factory: TailscaleAdapterFactory | null,
): void {
  tailscaleAdapterFactory = factory;
  tailscaleAdapterFactoryPromise = null;
}

async function ensureTailscaleAdapterFactory(): Promise<TailscaleAdapterFactory | null> {
  if (tailscaleAdapterFactory) {
    return tailscaleAdapterFactory;
  }

  return tailscaleAdapterFactoryPromise;
}
