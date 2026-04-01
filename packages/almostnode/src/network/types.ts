export type NetworkProvider = 'browser' | 'tailscale';

export type NetworkAuthMode = 'interactive';

export interface NetworkProxyOptions {
  httpUrl?: string | null;
  httpsUrl?: string | null;
  noProxy?: string | null;
  caBundlePem?: string | null;
}

export interface NetworkOptions {
  provider?: NetworkProvider;
  authMode?: NetworkAuthMode;
  useExitNode?: boolean;
  exitNodeId?: string | null;
  acceptDns?: boolean;
  corsProxy?: string | null;
  proxy?: NetworkProxyOptions;
  tailscaleConnected?: boolean;
}

export interface ResolvedNetworkProxyOptions {
  httpUrl: string | null;
  httpsUrl: string | null;
  noProxy: string | null;
  caBundlePem: string | null;
}

export interface ResolvedNetworkOptions extends Omit<Required<NetworkOptions>, 'proxy'> {
  proxy: ResolvedNetworkProxyOptions;
}

export interface NetworkExitNode {
  id: string;
  name: string;
  online: boolean;
  selected: boolean;
}

export type NetworkState =
  | 'browser'
  | 'stopped'
  | 'needs-login'
  | 'starting'
  | 'running'
  | 'needs-machine-auth'
  | 'locked'
  | 'unavailable'
  | 'error';

export interface NetworkStatus {
  provider: NetworkProvider;
  state: NetworkState;
  active: boolean;
  canLogin: boolean;
  canLogout: boolean;
  adapterAvailable: boolean;
  dnsEnabled: boolean;
  dnsHealthy: boolean | null;
  dnsDetail?: string;
  exitNodes: NetworkExitNode[];
  selectedExitNodeId: string | null;
  detail?: string;
  loginUrl?: string | null;
  selfName?: string | null;
  tailnetName?: string | null;
  updatedAt: string;
}

export interface NetworkFetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  bodyBase64?: string;
  redirect?: RequestRedirect;
  credentials?: RequestCredentials;
  retryOnTailscaleRecovery?: boolean;
}

export interface NetworkFetchResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBase64: string;
}

export interface NetworkLookupAddress {
  address: string;
  family: 4 | 6;
}

export interface NetworkLookupOptions {
  family?: number;
  all?: boolean;
}

export interface NetworkLookupResult {
  hostname: string;
  addresses: NetworkLookupAddress[];
}

export type NetworkRoute = 'browser' | 'tailscale';

export interface ResolvedNetworkPolicy {
  options: ResolvedNetworkOptions;
  proxy: ResolvedNetworkProxyOptions & {
    caBundlePath: string | null;
  };
  browser: {
    corsProxyUrl: string | null;
    wsRelayUrl: string | null;
  };
  env: Record<string, string>;
}

export interface NetworkWebSocketInit {
  protocols?: string | string[];
  headers?: Record<string, string>;
}

export interface NetworkWebSocketConnection {
  socket: WebSocket;
  url: string;
  route: NetworkRoute;
  proxied: boolean;
}

export interface NetworkController {
  getConfig(): ResolvedNetworkOptions;
  getResolvedPolicy(): ResolvedNetworkPolicy;
  configure(options: Partial<NetworkOptions>): Promise<NetworkStatus>;
  getStatus(): Promise<NetworkStatus>;
  login(): Promise<NetworkStatus>;
  logout(): Promise<NetworkStatus>;
  fetch(request: NetworkFetchRequest): Promise<NetworkFetchResponse>;
  connectWebSocket(
    url: string,
    init?: NetworkWebSocketInit,
  ): Promise<NetworkWebSocketConnection>;
  lookup(
    hostname: string,
    options?: NetworkLookupOptions,
  ): Promise<NetworkLookupResult>;
  subscribe(listener: (status: NetworkStatus) => void): () => void;
}

export interface TailscaleAdapterStatus {
  state?: Exclude<NetworkState, 'browser'>;
  dnsEnabled?: boolean;
  dnsHealthy?: boolean | null;
  dnsDetail?: string;
  exitNodes?: NetworkExitNode[];
  selectedExitNodeId?: string | null;
  detail?: string;
  loginUrl?: string | null;
  selfName?: string | null;
  tailnetName?: string | null;
}

export interface PersistedNetworkSession {
  provider: 'tailscale';
  useExitNode: boolean;
  exitNodeId: string | null;
  acceptDns: boolean;
  stateSnapshot: Record<string, string> | null;
}

export interface NetworkIntegration {
  loadSession?: () =>
    | PersistedNetworkSession
    | null
    | Promise<PersistedNetworkSession | null>;
  saveSession?: (
    session: PersistedNetworkSession | null,
  ) => void | Promise<void>;
  onAuthUrl?: (url: string | null) => void;
}

export interface TailscaleAdapter {
  configure?(options: ResolvedNetworkOptions): Promise<void>;
  getStatus(): Promise<TailscaleAdapterStatus>;
  login(): Promise<TailscaleAdapterStatus>;
  logout(): Promise<TailscaleAdapterStatus>;
  fetch(request: NetworkFetchRequest): Promise<NetworkFetchResponse>;
  lookup(
    hostname: string,
    options?: NetworkLookupOptions,
  ): Promise<NetworkLookupResult>;
  getSessionSnapshot?(): Record<string, string> | null;
  dispose?(): Promise<void> | void;
}

export type TailscaleAdapterFactory = (
  options: ResolvedNetworkOptions,
  onStatus: (status: TailscaleAdapterStatus) => void,
) => Promise<TailscaleAdapter>;
