import type { NetworkIntegration } from "@agent-wasm/core";
import {
  clearStoredTailscaleSessionSnapshot,
  clearStoredWorkbenchNetworkConfig,
  readStoredTailscaleSessionSnapshot,
  readStoredWorkbenchNetworkConfig,
  writeStoredTailscaleSessionSnapshot,
  writeStoredWorkbenchNetworkConfig,
} from "@agent-wasm/keychain";
import { createWorkspace, type WorkspaceController } from "@agent-wasm/sdk";
import { CORS_PROXY_URL } from "../apps/tailscale/tailscale-config";

// Whether the tunnel was actually `running` (fully authenticated) at the last
// status update — only then do we auto-resume Tailscale on the next boot.
// This keeps the app "off by default": an abandoned `needs-login` never marks
// the session established, so it can't keep resuming a half-finished login.
const ESTABLISHED_KEY = "almostos.tailscale.established";
let bootEstablished = false;

function markEstablished(established: boolean): void {
  try {
    if (established) localStorage.setItem(ESTABLISHED_KEY, "1");
    else localStorage.removeItem(ESTABLISHED_KEY);
  } catch {
    /* storage unavailable */
  }
}

function readEstablished(): boolean {
  try {
    return localStorage.getItem(ESTABLISHED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Persist + restore the Tailscale session (config + IPN state snapshot) and
 * open the interactive login popup — mirrors web-ide's wiring so connecting
 * actually establishes a tunnel against the public Tailscale control plane.
 */
const networkIntegration: NetworkIntegration = {
  loadSession: () => {
    // Off by default: only auto-resume a tunnel that was genuinely established.
    if (!bootEstablished) return null;
    const stored = readStoredWorkbenchNetworkConfig();
    if (!stored || stored.provider !== "tailscale") return null;
    const stateSnapshot = readStoredTailscaleSessionSnapshot();
    if (!stateSnapshot || Object.keys(stateSnapshot).length === 0) return null;
    return {
      provider: "tailscale",
      useExitNode: stored.useExitNode,
      exitNodeId: stored.exitNodeId,
      acceptDns: stored.acceptDns ?? false,
      stateSnapshot,
    };
  },
  saveSession: (session) => {
    if (!session) {
      clearStoredWorkbenchNetworkConfig();
      clearStoredTailscaleSessionSnapshot();
      markEstablished(false);
      return;
    }
    writeStoredWorkbenchNetworkConfig({
      provider: session.provider,
      useExitNode: session.useExitNode,
      exitNodeId: session.exitNodeId,
      acceptDns: session.acceptDns,
    });
    if (session.stateSnapshot) {
      writeStoredTailscaleSessionSnapshot(session.stateSnapshot);
    }
  },
  onAuthUrl: (url) => {
    if (url) globalThis.open?.(url, "_blank", "noopener,noreferrer");
  },
};

/**
 * The single, central almostnode runtime for the whole desktop. Every window
 * (Finder, Terminal, VS Code) and the OpenCode chat share this one workspace —
 * one VFS, one container — so files written in one surface appear in all others.
 */
let workspace: WorkspaceController | null = null;

export function getWorkspace(): WorkspaceController {
  if (typeof window === "undefined") {
    throw new Error("AlmostOS runtime is browser-only");
  }
  if (!workspace) {
    // Disable online Napster commands before the shared shell can run them.
    const host = window as unknown as { almostOS?: Record<string, unknown> };
    host.almostOS = { ...host.almostOS, soundcloud: { onlineEnabled: false } };
    // Snapshot the "was it established?" flag before createWorkspace hydrates
    // the session — the live subscription below rewrites it for the next boot.
    bootEstablished = readEstablished();
    workspace = createWorkspace({
      basePath: import.meta.env.BASE_URL.replace(/\/$/, ""),
      installMode: "auto",
      autoStartPreview: false,
      browserEnv: { themeMode: "dark" },
      // Default: Tailscale OFF — browser transport routed through the CORS proxy.
      // Turning Tailscale on (Tailscale app) switches the provider.
      network: { corsProxy: CORS_PROXY_URL },
      networkIntegration,
    });
    // Persist whether the tunnel is genuinely up so only a real connection
    // (not an abandoned login) auto-resumes next boot.
    workspace.container.network.subscribe((status) => {
      markEstablished(status.provider === "tailscale" && status.state === "running");
    });
    // Register the almostnode service worker so it injects COOP/COEP headers
    // on every response (the coi-serviceworker pattern) — Vite's own
    // `server.headers` config doesn't reach the root document under
    // TanStack Start's SPA middleware, so without this, `crossOriginIsolated`
    // stays false and SharedArrayBuffer-dependent tools (vim.wasm) can't run.
    // `initServiceWorker()` reloads the page once automatically the first time
    // the worker takes control (`reloadOnFirstControl` defaults to `true`), so
    // this is fire-and-forget rather than blocking `getWorkspace()`.
    void workspace.container.serverBridge
      .initServiceWorker()
      .catch((error: unknown) => {
        console.error("[almostos] service worker init failed", error);
      });
  }
  return workspace;
}

export function hasWorkspace(): boolean {
  return workspace !== null;
}
