export {
  createNetworkController,
  getDefaultNetworkController,
  hasExplicitDefaultNetworkController,
  setDefaultNetworkController,
  setTailscaleAdapterFactory,
  DefaultNetworkController,
} from './controller';
export {
  createNetworkSessionPersistence,
  parsePersistedNetworkSession,
  PERSISTED_NETWORK_SESSION_STORAGE_KEY,
  serializePersistedNetworkSession,
} from './session';
export {
  createTailscaleSessionPersistence,
  parseTailscaleStateSnapshot,
  serializeTailscaleStateSnapshot,
  TAILSCALE_SESSION_STORAGE_KEY,
} from './tailscale-session-storage';
export {
  networkFetch,
  serializeFetchRequest,
  createResponseFromNetwork,
  base64ToUint8Array,
  headersToRecord,
} from './fetch';
export {
  selectNetworkRouteForHost,
  selectNetworkRouteForUrl,
  isTailscaleHostname,
  isModuleResolutionHostname,
  isTailnetIpv4,
  isTailnetIpv6,
} from './routing';
export {
  DEFAULT_CORS_PROXY_URL,
  LOCAL_CORS_PROXY_PATH,
  LOCAL_WS_RELAY_PATH,
  NETWORK_CA_BUNDLE_PATH,
  NETWORK_ENV_KEYS,
  getResolvedPolicy,
  normalizeNetworkOptions,
  resolveBrowserFetchTarget,
  resolveBrowserWebSocketTarget,
  resolveNetworkPolicy,
  selectWebSocketRouteForUrl,
  shouldBypassProxy,
} from './policy';
export type {
  NetworkController,
  NetworkDiagnosticsCounters,
  NetworkDiagnosticsFailureBucket,
  NetworkDiagnosticsFailureEntry,
  NetworkDiagnosticsRequestShape,
  NetworkDiagnosticsSnapshot,
  NetworkExitNode,
  NetworkFetchRequest,
  NetworkFetchResponse,
  NetworkIntegration,
  NetworkLookupAddress,
  NetworkLookupOptions,
  NetworkLookupResult,
  NetworkOptions,
  NetworkProxyOptions,
  NetworkProvider,
  NetworkWebSocketConnection,
  NetworkWebSocketInit,
  PersistedNetworkSession,
  NetworkRoute,
  NetworkState,
  NetworkStatus,
  ResolvedNetworkOptions,
  ResolvedNetworkPolicy,
  TailscaleAdapter,
  TailscaleAdapterFactory,
  TailscaleAdapterStatus,
} from './types';
export { NETWORK_DIAGNOSTIC_FAILURE_BUCKETS } from './types';
