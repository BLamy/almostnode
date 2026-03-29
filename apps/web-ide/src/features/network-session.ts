import {
  createNetworkSessionPersistence,
} from "../../../../packages/almostnode/src/network/session";
import {
  createTailscaleSessionPersistence,
  parseTailscaleStateSnapshot,
  serializeTailscaleStateSnapshot,
  TAILSCALE_SESSION_STORAGE_KEY,
} from "../../../../packages/almostnode/src/network/tailscale-session-storage";
import type { PersistedNetworkSession } from "../../../../packages/almostnode/src/network/types";

export const WORKBENCH_NETWORK_SESSION_STORAGE_KEY =
  "__almostnodeWorkbenchNetwork";
export { TAILSCALE_SESSION_STORAGE_KEY };

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type TailscaleSessionSnapshot = Record<string, string>;

export type StoredWorkbenchNetworkConfig = Omit<
  PersistedNetworkSession,
  "acceptDns" | "stateSnapshot"
> & {
  acceptDns?: boolean;
};

export function parseStoredWorkbenchNetworkConfig(
  raw: string | null | undefined,
): StoredWorkbenchNetworkConfig | null {
  const persistence = createNetworkSessionPersistence({
    getItem: () => raw ?? null,
    setItem: () => {},
    removeItem: () => {},
  });
  const session = persistence.load();
  if (!session) {
    return null;
  }

  return {
    provider: session.provider,
    useExitNode: session.useExitNode,
    exitNodeId: session.exitNodeId,
    acceptDns: session.acceptDns,
  };
}

export function readStoredWorkbenchNetworkConfig(
  storage: SessionStorageLike | null | undefined = getBrowserDurableStorage(),
): StoredWorkbenchNetworkConfig | null {
  const session = createNetworkSessionPersistence(
    storage,
    WORKBENCH_NETWORK_SESSION_STORAGE_KEY,
  ).load();
  if (!session) {
    return null;
  }

  return {
    provider: session.provider,
    useExitNode: session.useExitNode,
    exitNodeId: session.exitNodeId,
    acceptDns: session.acceptDns,
  };
}

export function writeStoredWorkbenchNetworkConfig(
  config: StoredWorkbenchNetworkConfig,
  storage: SessionStorageLike | null | undefined = getBrowserDurableStorage(),
): void {
  createNetworkSessionPersistence(
    storage,
    WORKBENCH_NETWORK_SESSION_STORAGE_KEY,
  ).save({
    ...config,
    acceptDns: config.acceptDns !== false,
    stateSnapshot: readStoredTailscaleSessionSnapshot(storage),
  });
}

export function clearStoredWorkbenchNetworkConfig(
  storage: SessionStorageLike | null | undefined = getBrowserDurableStorage(),
): void {
  createNetworkSessionPersistence(
    storage,
    WORKBENCH_NETWORK_SESSION_STORAGE_KEY,
  ).clear();
}

export function parseStoredTailscaleSessionSnapshot(
  raw: string | null | undefined,
): TailscaleSessionSnapshot | null {
  return parseTailscaleStateSnapshot(raw);
}

export function serializeTailscaleSessionSnapshot(
  snapshot: TailscaleSessionSnapshot,
): string {
  return serializeTailscaleStateSnapshot(snapshot);
}

export function readStoredTailscaleSessionSnapshot(
  storage: SessionStorageLike | null | undefined = getBrowserDurableStorage(),
): TailscaleSessionSnapshot | null {
  return createTailscaleSessionPersistence(storage).load();
}

export function writeStoredTailscaleSessionSnapshot(
  snapshot: TailscaleSessionSnapshot,
  storage: SessionStorageLike | null | undefined = getBrowserDurableStorage(),
): void {
  createTailscaleSessionPersistence(storage).save(snapshot);
}

export function clearStoredTailscaleSessionSnapshot(
  storage: SessionStorageLike | null | undefined = getBrowserDurableStorage(),
): void {
  createTailscaleSessionPersistence(storage).clear();
}

function getBrowserStorage(
  storageKey: "localStorage" | "sessionStorage",
): SessionStorageLike | null {
  try {
    const storage = globalThis[storageKey];
    if (typeof storage === "undefined") {
      return null;
    }
    return storage;
  } catch {
    return null;
  }
}

function getBrowserDurableStorage(): SessionStorageLike | null {
  return getBrowserStorage("localStorage") ?? getBrowserStorage("sessionStorage");
}
