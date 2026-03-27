export type NetworkProvider = 'browser' | 'tailscale';

export type NetworkAuthMode = 'interactive';

export interface NetworkOptions {
  provider?: NetworkProvider;
  authMode?: NetworkAuthMode;
  useExitNode?: boolean;
  exitNodeId?: string | null;
  corsProxy?: string | null;
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

export interface NetworkController {
  getConfig(): Required<NetworkOptions>;
  configure(options: Partial<NetworkOptions>): Promise<NetworkStatus>;
  getStatus(): Promise<NetworkStatus>;
  login(): Promise<NetworkStatus>;
  logout(): Promise<NetworkStatus>;
  fetch(request: NetworkFetchRequest): Promise<NetworkFetchResponse>;
  lookup(
    hostname: string,
    options?: NetworkLookupOptions,
  ): Promise<NetworkLookupResult>;
  subscribe(listener: (status: NetworkStatus) => void): () => void;
}

export interface TailscaleAdapterStatus {
  state?: Exclude<NetworkState, 'browser'>;
  exitNodes?: NetworkExitNode[];
  selectedExitNodeId?: string | null;
  detail?: string;
  loginUrl?: string | null;
  selfName?: string | null;
  tailnetName?: string | null;
}

export interface TailscaleAdapter {
  configure?(options: Required<NetworkOptions>): Promise<void>;
  getStatus(): Promise<TailscaleAdapterStatus>;
  login(): Promise<TailscaleAdapterStatus>;
  logout(): Promise<TailscaleAdapterStatus>;
  fetch(request: NetworkFetchRequest): Promise<NetworkFetchResponse>;
  lookup(
    hostname: string,
    options?: NetworkLookupOptions,
  ): Promise<NetworkLookupResult>;
  dispose?(): Promise<void> | void;
}

export type TailscaleAdapterFactory = (
  options: Required<NetworkOptions>,
  onStatus: (status: TailscaleAdapterStatus) => void,
) => Promise<TailscaleAdapter>;
