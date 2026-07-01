import { useEffect, useState } from "react";
import type { NetworkStatus } from "@agent-wasm/core";
import { useOsRuntime } from "../../runtime/OsRuntimeProvider";
import { CORS_PROXY_URL, getTailscaleConfig } from "./tailscale-config";

export interface NetworkApi {
  status: NetworkStatus | null;
  connected: boolean;
  busy: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  setExitNode: (id: string | null) => Promise<void>;
}

/** Subscribe to the shared container's Tailscale/network controller. */
export function useNetwork(): NetworkApi {
  const { workspace, ready } = useOsRuntime();
  const [status, setStatus] = useState<NetworkStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const net = workspace.container.network;
    let alive = true;
    void net
      .getStatus()
      .then((s) => {
        if (alive) setStatus(s);
      })
      .catch(() => {});
    const unsubscribe = net.subscribe((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [ready, workspace]);

  const net = workspace.container.network;
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } catch (error) {
      console.error("[tailscale]", error);
    } finally {
      setBusy(false);
    }
  };

  return {
    status,
    // Only "connected" when Tailscale itself is up — the browser provider
    // reports active/running but that's NOT a tailnet connection.
    connected:
      status?.provider === "tailscale" &&
      (status?.state === "running" || status?.active === true),
    busy,
    connect: () =>
      run(async () => {
        const config = getTailscaleConfig();
        await net.configure({
          provider: "tailscale",
          authMode: "interactive",
          // Official → public Tailscale control plane (login.tailscale.com).
          // WireGuard → your own Headscale/WireGuard control server.
          controlUrl: config.backend === "wireguard" ? config.controlUrl || null : null,
        });
        await net.login();
      }),
    disconnect: () =>
      run(async () => {
        await net.logout();
        // Back to "off": browser transport routed through the CORS proxy.
        await net.configure({ provider: "browser", corsProxy: CORS_PROXY_URL });
      }),
    setExitNode: (id) => run(() => net.configure({ exitNodeId: id })),
  };
}
