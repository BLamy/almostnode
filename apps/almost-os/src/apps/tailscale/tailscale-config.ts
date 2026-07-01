import { useSyncExternalStore } from "react";

export type TailscaleBackend = "official" | "wireguard";

export interface TailscaleConfig {
  /** Which control plane to connect through. */
  backend: TailscaleBackend;
  /** Control-server URL for the self-hosted WireGuard/Headscale backend. */
  controlUrl: string;
}

export const CORS_PROXY_URL = "/__api/cors-proxy?url=";

const STORAGE_KEY = "almostos.tailscale.config";
const DEFAULT: TailscaleConfig = { backend: "official", controlUrl: "" };

function load(): TailscaleConfig {
  if (typeof localStorage === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw) as Partial<TailscaleConfig>;
    return {
      backend: parsed.backend === "wireguard" ? "wireguard" : "official",
      controlUrl: typeof parsed.controlUrl === "string" ? parsed.controlUrl : "",
    };
  } catch {
    return DEFAULT;
  }
}

let state: TailscaleConfig = load();
const listeners = new Set<() => void>();

function commit(next: TailscaleConfig) {
  state = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable */
  }
  for (const listener of listeners) listener();
}

export function getTailscaleConfig(): TailscaleConfig {
  return state;
}

export function setBackend(backend: TailscaleBackend): void {
  commit({ ...state, backend });
}

export function setControlUrl(controlUrl: string): void {
  commit({ ...state, controlUrl });
}

export function useTailscaleConfig(): TailscaleConfig {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => state,
    () => state,
  );
}
