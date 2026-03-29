export {
  createNetworkController,
  getDefaultNetworkController,
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
export type {
  NetworkController,
  NetworkExitNode,
  NetworkFetchRequest,
  NetworkFetchResponse,
  NetworkIntegration,
  NetworkLookupAddress,
  NetworkLookupOptions,
  NetworkLookupResult,
  NetworkOptions,
  NetworkProvider,
  PersistedNetworkSession,
  NetworkRoute,
  NetworkState,
  NetworkStatus,
  TailscaleAdapter,
  TailscaleAdapterFactory,
  TailscaleAdapterStatus,
} from './types';
