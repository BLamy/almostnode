import { browserFetch } from './fetch';
import { selectNetworkRouteForHost, selectNetworkRouteForUrl } from './routing';
import type {
  NetworkController,
  NetworkFetchRequest,
  NetworkFetchResponse,
  NetworkLookupResult,
  NetworkOptions,
  NetworkStatus,
  TailscaleAdapter,
  TailscaleAdapterFactory,
  TailscaleAdapterStatus,
} from './types';

let tailscaleAdapterFactory: TailscaleAdapterFactory | null = null;
let defaultNetworkController: NetworkController | null = null;
let tailscaleAdapterFactoryPromise: Promise<TailscaleAdapterFactory | null> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeOptions(options: NetworkOptions = {}): Required<NetworkOptions> {
  return {
    provider: options.provider || 'browser',
    authMode: options.authMode || 'interactive',
    useExitNode: Boolean(options.useExitNode),
    exitNodeId: options.exitNodeId?.trim() || null,
    corsProxy: options.corsProxy ?? null,
  };
}

function buildBrowserStatus(options: Required<NetworkOptions>): NetworkStatus {
  return {
    provider: options.provider,
    state: options.provider === 'tailscale' ? 'needs-login' : 'browser',
    active: options.provider !== 'tailscale',
    canLogin: options.provider === 'tailscale',
    canLogout: false,
    adapterAvailable: tailscaleAdapterFactory !== null,
    exitNodes: [],
    selectedExitNodeId: null,
    updatedAt: nowIso(),
  };
}

function mergeStatus(
  options: Required<NetworkOptions>,
  status: TailscaleAdapterStatus | null,
): NetworkStatus {
  if (options.provider !== 'tailscale') {
    return buildBrowserStatus(options);
  }

  if (!status) {
    return {
      provider: 'tailscale',
      state: tailscaleAdapterFactory ? 'needs-login' : 'unavailable',
      active: false,
      canLogin: true,
      canLogout: false,
      adapterAvailable: tailscaleAdapterFactory !== null,
      exitNodes: [],
      selectedExitNodeId: null,
      detail: tailscaleAdapterFactory
        ? undefined
        : 'No Tailscale adapter registered for this runtime.',
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
  private options: Required<NetworkOptions>;
  private listeners = new Set<(status: NetworkStatus) => void>();
  private adapter: TailscaleAdapter | null = null;
  private adapterPromise: Promise<TailscaleAdapter> | null = null;
  private adapterStatus: TailscaleAdapterStatus | null = null;

  constructor(options: NetworkOptions = {}) {
    this.options = normalizeOptions(options);
  }

  getConfig(): Required<NetworkOptions> {
    return { ...this.options };
  }

  subscribe(listener: (status: NetworkStatus) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async configure(options: Partial<NetworkOptions>): Promise<NetworkStatus> {
    const previousProvider = this.options.provider;
    this.options = normalizeOptions({ ...this.options, ...options });

    if (this.adapter?.configure) {
      await this.adapter.configure(this.options);
    }

    if (previousProvider === 'tailscale' && this.options.provider !== 'tailscale') {
      this.emit();
    }

    const status = await this.getStatus();
    this.emit(status);
    return status;
  }

  async getStatus(): Promise<NetworkStatus> {
    if (this.options.provider !== 'tailscale') {
      return buildBrowserStatus(this.options);
    }

    if (!this.adapter) {
      if (!(await ensureTailscaleAdapterFactory())) {
        return mergeStatus(this.options, null);
      }

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

    return mergeStatus(this.options, this.adapterStatus);
  }

  async login(): Promise<NetworkStatus> {
    if (this.options.provider !== 'tailscale') {
      this.options = normalizeOptions({ ...this.options, provider: 'tailscale' });
    }

    const adapter = await this.ensureAdapter();
    this.adapterStatus = await adapter.login();
    const status = mergeStatus(this.options, this.adapterStatus);
    this.emit(status);
    return status;
  }

  async logout(): Promise<NetworkStatus> {
    if (!this.adapter) {
      const status = await this.getStatus();
      this.emit(status);
      return status;
    }

    this.adapterStatus = await this.adapter.logout();
    const status = mergeStatus(this.options, this.adapterStatus);
    this.emit(status);
    return status;
  }

  async fetch(request: NetworkFetchRequest): Promise<NetworkFetchResponse> {
    const route = selectNetworkRouteForUrl(request.url, this.options);
    if (route === 'tailscale') {
      const adapter = await this.ensureAdapter();
      return adapter.fetch(request);
    }
    return browserFetch(request, this.options);
  }

  async lookup(
    hostname: string,
    options: { family?: number; all?: boolean } = {},
  ): Promise<NetworkLookupResult> {
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return {
        hostname,
        addresses: [{ address: '127.0.0.1', family: 4 }],
      };
    }

    const route = selectNetworkRouteForHost(hostname, this.options);
    if (route === 'tailscale') {
      const adapter = await this.ensureAdapter();
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

    const adapterFactory = await ensureTailscaleAdapterFactory();
    if (!adapterFactory) {
      throw new Error('No Tailscale adapter registered for this runtime.');
    }

    if (!this.adapterPromise) {
      this.adapterPromise = adapterFactory(this.options, (status) => {
        this.adapterStatus = status;
        this.emit();
      }).then((adapter) => {
        this.adapter = adapter;
        return adapter;
      }).catch((error) => {
        this.adapterPromise = null;
        throw error;
      });
    }

    return this.adapterPromise;
  }

  private emit(status = mergeStatus(this.options, this.adapterStatus)): void {
    for (const listener of this.listeners) {
      listener(status);
    }
  }
}

export function createNetworkController(options: NetworkOptions = {}): NetworkController {
  return new DefaultNetworkController(options);
}

export function getDefaultNetworkController(): NetworkController {
  if (!defaultNetworkController) {
    defaultNetworkController = createNetworkController();
  }
  return defaultNetworkController;
}

export function setDefaultNetworkController(
  controller: NetworkController | null,
): void {
  defaultNetworkController = controller;
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

  if (!tailscaleAdapterFactoryPromise) {
    tailscaleAdapterFactoryPromise = import('./tailscale-connect-adapter')
      .then((module) => {
        tailscaleAdapterFactory = module.createTailscaleConnectAdapterFactory();
        return tailscaleAdapterFactory;
      })
      .catch(() => null);
  }

  return tailscaleAdapterFactoryPromise;
}
