export const WORKBENCH_NETWORK_SESSION_STORAGE_KEY =
  "__almostnodeWorkbenchNetwork";
export const TAILSCALE_SESSION_STORAGE_KEY = "__almostnodeTailscaleState";

export interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export type TailscaleSessionSnapshot = Record<string, string>;

export interface StoredWorkbenchNetworkConfig {
  provider: "tailscale";
  useExitNode: boolean;
  exitNodeId: string | null;
}

function getBrowserSessionStorage(): SessionStorageLike | null {
  try {
    if (typeof sessionStorage === "undefined") {
      return null;
    }
    return sessionStorage;
  } catch {
    return null;
  }
}

function normalizeTailscaleSessionSnapshot(
  value: unknown,
): TailscaleSessionSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const snapshot: TailscaleSessionSnapshot = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      return null;
    }
    snapshot[key] = entry;
  }

  return snapshot;
}

export function parseStoredWorkbenchNetworkConfig(
  raw: string | null | undefined,
): StoredWorkbenchNetworkConfig | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      !parsed
      || typeof parsed !== "object"
      || parsed.provider !== "tailscale"
      || typeof parsed.useExitNode !== "boolean"
    ) {
      return null;
    }

    return {
      provider: "tailscale",
      useExitNode: parsed.useExitNode,
      exitNodeId:
        typeof parsed.exitNodeId === "string" && parsed.exitNodeId.trim()
          ? parsed.exitNodeId.trim()
          : null,
    };
  } catch {
    return null;
  }
}

export function readStoredWorkbenchNetworkConfig(
  storage: SessionStorageLike | null | undefined = getBrowserSessionStorage(),
): StoredWorkbenchNetworkConfig | null {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(WORKBENCH_NETWORK_SESSION_STORAGE_KEY);
    const parsed = parseStoredWorkbenchNetworkConfig(raw);
    if (raw && !parsed) {
      storage.removeItem(WORKBENCH_NETWORK_SESSION_STORAGE_KEY);
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredWorkbenchNetworkConfig(
  config: StoredWorkbenchNetworkConfig,
  storage: SessionStorageLike | null | undefined = getBrowserSessionStorage(),
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      WORKBENCH_NETWORK_SESSION_STORAGE_KEY,
      JSON.stringify(config),
    );
  } catch {
    // Ignore sessionStorage failures.
  }
}

export function clearStoredWorkbenchNetworkConfig(
  storage: SessionStorageLike | null | undefined = getBrowserSessionStorage(),
): void {
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(WORKBENCH_NETWORK_SESSION_STORAGE_KEY);
  } catch {
    // Ignore sessionStorage failures.
  }
}

export function parseStoredTailscaleSessionSnapshot(
  raw: string | null | undefined,
): TailscaleSessionSnapshot | null {
  if (!raw) {
    return null;
  }

  try {
    return normalizeTailscaleSessionSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function serializeTailscaleSessionSnapshot(
  snapshot: TailscaleSessionSnapshot,
): string {
  return JSON.stringify(snapshot);
}

export function readStoredTailscaleSessionSnapshot(
  storage: SessionStorageLike | null | undefined = getBrowserSessionStorage(),
): TailscaleSessionSnapshot | null {
  if (!storage) {
    return null;
  }

  try {
    const raw = storage.getItem(TAILSCALE_SESSION_STORAGE_KEY);
    const parsed = parseStoredTailscaleSessionSnapshot(raw);
    if (raw && !parsed) {
      storage.removeItem(TAILSCALE_SESSION_STORAGE_KEY);
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredTailscaleSessionSnapshot(
  snapshot: TailscaleSessionSnapshot,
  storage: SessionStorageLike | null | undefined = getBrowserSessionStorage(),
): void {
  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      TAILSCALE_SESSION_STORAGE_KEY,
      serializeTailscaleSessionSnapshot(snapshot),
    );
  } catch {
    // Ignore sessionStorage failures.
  }
}

export function clearStoredTailscaleSessionSnapshot(
  storage: SessionStorageLike | null | undefined = getBrowserSessionStorage(),
): void {
  if (!storage) {
    return;
  }

  try {
    storage.removeItem(TAILSCALE_SESSION_STORAGE_KEY);
  } catch {
    // Ignore sessionStorage failures.
  }
}
