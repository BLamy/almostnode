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
  activeExitNodeId?: string | null;
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

export interface ResolvedNetworkOptions
  extends Omit<Required<NetworkOptions>, 'proxy' | 'activeExitNodeId'> {
  proxy: ResolvedNetworkProxyOptions;
  activeExitNodeId?: string | null;
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

export const NETWORK_DIAGNOSTIC_FAILURE_BUCKETS = [
  'dns_loopback',
  'direct_ip_fallback_failed',
  'structured_fetch_missing_body_base64',
  'body_read_timeout',
  'fetch_timeout_other',
  'runtime_panic',
  'runtime_unavailable_other',
  'tls_sni_failed',
] as const;

export type NetworkDiagnosticsFailureBucket =
  typeof NETWORK_DIAGNOSTIC_FAILURE_BUCKETS[number];

export interface NetworkDiagnosticsRequestShape {
  method: string;
  hasBody: boolean;
  contentType: string | null;
  acceptsEventStream: boolean;
}

export interface NetworkDiagnosticsFailureEntry {
  seenAt: string;
  host: string | null;
  targetType: 'public' | 'tailnet' | 'unknown';
  bucket: NetworkDiagnosticsFailureBucket;
  errorCode: string | null;
  message: string;
  phase: string | null;
  requestShape: NetworkDiagnosticsRequestShape;
  useExitNode: boolean;
  exitNodeId: string | null;
  runtimeGeneration: number;
  runtimeResetCount: number;
  lastRuntimeResetReason: string | null;
}

export interface NetworkDiagnosticsCounters {
  totalFetches: number;
  publicFetches: number;
  tailnetFetches: number;
  structuredFetches: number;
  directIpFallbacks: number;
  runtimeResets: number;
  recoveriesAttempted: number;
  successes: number;
  failures: number;
}

export interface NetworkDiagnosticsSnapshot {
  provider: NetworkProvider;
  available: boolean;
  state: NetworkState;
  counters: NetworkDiagnosticsCounters;
  failureBuckets: Record<NetworkDiagnosticsFailureBucket, number>;
  dominantFailureBucket: NetworkDiagnosticsFailureBucket | null;
  recentFailures: NetworkDiagnosticsFailureEntry[];
  runtimeGeneration: number;
  runtimeResetCount: number;
  lastRuntimeResetReason: string | null;
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
  getDiagnostics(): Promise<NetworkDiagnosticsSnapshot>;
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
  getDiagnostics?(): Promise<NetworkDiagnosticsSnapshot>;
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
