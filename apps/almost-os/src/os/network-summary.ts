import {
  setBackend,
  setControlUrl,
  useTailscaleConfig,
} from "../apps/tailscale/tailscale-config";
import { useNetwork, type NetworkApi } from "../apps/tailscale/use-network";

export type NetworkKind = "proxy" | "official" | "headscale";

export interface NetworkOption {
  kind: NetworkKind;
  label: string;
  description: string;
}

export const NETWORK_OPTIONS: NetworkOption[] = [
  {
    kind: "proxy",
    label: "CORS Proxy",
    description: "Direct browsing through the built-in proxy (default)",
  },
  {
    kind: "official",
    label: "Official Tailscale",
    description: "Your Tailscale account · login.tailscale.com",
  },
  {
    kind: "headscale",
    label: "Headscale",
    description: "Your own WireGuard / Headscale control server",
  },
];

export interface NetworkSummary {
  net: NetworkApi;
  /** The network the traffic is currently on. */
  activeKind: NetworkKind;
  activeLabel: string;
  /** Tailscale is mid-handshake or awaiting sign-in. */
  connecting: boolean;
  controlUrl: string;
  setControlUrl: (url: string) => void;
  /** Switch networks (proxy = disconnect Tailscale). */
  select: (kind: NetworkKind) => Promise<void>;
}

export function useNetworkSummary(): NetworkSummary {
  const net = useNetwork();
  const config = useTailscaleConfig();

  const tsConnected = net.connected;
  const activeKind: NetworkKind = tsConnected
    ? config.backend === "wireguard"
      ? "headscale"
      : "official"
    : "proxy";
  const state = net.status?.state;
  const connecting =
    net.status?.provider === "tailscale" &&
    (state === "starting" || state === "needs-login");

  return {
    net,
    activeKind,
    activeLabel: NETWORK_OPTIONS.find((o) => o.kind === activeKind)!.label,
    connecting,
    controlUrl: config.controlUrl,
    setControlUrl,
    select: async (kind) => {
      if (kind === "proxy") {
        await net.disconnect();
        return;
      }
      setBackend(kind === "headscale" ? "wireguard" : "official");
      await net.connect();
    },
  };
}
