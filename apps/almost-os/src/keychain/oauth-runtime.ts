/**
 * OS-wide OAuth service runtime: ONE `OAuthServiceRegistry` (non-secret
 * configs in localStorage) + ONE `OAuthServiceOrchestrator` (token refresh
 * loop, per-id refresh locks) over the shared workspace VFS and keychain.
 *
 * The engine lives in `@agent-wasm/keychain/oauth`; web-ide wires the same
 * pieces in `workbench-host.ts`. Here it backs executor.sh connections, and
 * any future app can reuse it.
 */

import {
  OAuthServiceOrchestrator,
  OAuthServiceRegistry,
  type OAuthServiceStatus,
} from "@agent-wasm/keychain/oauth";
import { getWorkspace } from "../runtime/runtime";
import { getKeychain } from "./keychain-store";

let registry: OAuthServiceRegistry | null = null;
let orchestrator: OAuthServiceOrchestrator | null = null;

let statuses: OAuthServiceStatus[] = [];
const statusListeners = new Set<() => void>();

/** Safe before the workspace exists — pure localStorage mirror. */
export function getOAuthRegistry(): OAuthServiceRegistry {
  if (!registry) {
    registry = new OAuthServiceRegistry();
  }
  return registry;
}

export function getOAuthOrchestrator(): OAuthServiceOrchestrator {
  if (typeof window === "undefined") {
    throw new Error("OAuth orchestrator is browser-only");
  }
  if (!orchestrator) {
    const workspace = getWorkspace();
    const keychain = getKeychain();
    orchestrator = new OAuthServiceOrchestrator({
      vfs: workspace.vfs,
      registry: getOAuthRegistry(),
      keychain: {
        registerSlot: (name, paths) => keychain.registerSlot(name, paths),
        hasSlotData: (name) => keychain.hasSlotData(name),
        notifyExternalStateChanged: () => keychain.notifyExternalStateChanged(),
      },
      baseHref: import.meta.env.BASE_URL ?? "/",
      onStatusChange: (next) => {
        statuses = next;
        for (const listener of statusListeners) listener();
      },
    });
    statuses = orchestrator.getStatuses();
    // The refresh loop is a no-op for services whose token files aren't in
    // the VFS yet (still vault-locked) — safe to run from boot.
    orchestrator.start();
  }
  return orchestrator;
}

export function getOAuthStatuses(): OAuthServiceStatus[] {
  return statuses;
}

/** Re-read statuses after an operation outside the orchestrator's flows. */
export function refreshOAuthStatuses(): void {
  if (!orchestrator) return;
  statuses = orchestrator.getStatuses();
  for (const listener of statusListeners) listener();
}

export function subscribeOAuthStatuses(listener: () => void): () => void {
  statusListeners.add(listener);
  return () => {
    statusListeners.delete(listener);
  };
}
