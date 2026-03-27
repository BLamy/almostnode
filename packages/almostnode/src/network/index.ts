export {
  createNetworkController,
  getDefaultNetworkController,
  setDefaultNetworkController,
  setTailscaleAdapterFactory,
  DefaultNetworkController,
} from './controller';
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
  isTailnetIpv4,
  isTailnetIpv6,
} from './routing';
export type {
  NetworkController,
  NetworkExitNode,
  NetworkFetchRequest,
  NetworkFetchResponse,
  NetworkLookupAddress,
  NetworkLookupOptions,
  NetworkLookupResult,
  NetworkOptions,
  NetworkProvider,
  NetworkRoute,
  NetworkState,
  NetworkStatus,
  TailscaleAdapter,
  TailscaleAdapterFactory,
  TailscaleAdapterStatus,
} from './types';
