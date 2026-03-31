import type { NetworkOptions, NetworkRoute, ResolvedNetworkOptions } from './types';
import {
  isModuleResolutionHostname,
  isTailnetIpv4,
  isTailnetIpv6,
  isTailscaleHostname,
  selectNetworkRouteForHost as selectRouteForHost,
  selectNetworkRouteForUrl as selectRouteForUrl,
} from './policy';

export {
  isModuleResolutionHostname,
  isTailnetIpv4,
  isTailnetIpv6,
  isTailscaleHostname,
};

export function selectNetworkRouteForUrl(
  rawUrl: string,
  options: NetworkOptions | ResolvedNetworkOptions,
  locationLike: Pick<Location, 'origin'> | null =
    typeof location !== 'undefined' ? location : null,
): NetworkRoute {
  return selectRouteForUrl(rawUrl, options, locationLike);
}

export function selectNetworkRouteForHost(
  hostname: string,
  options: NetworkOptions | ResolvedNetworkOptions,
): NetworkRoute {
  return selectRouteForHost(hostname, options);
}
