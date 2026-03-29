import type { PersistedNetworkSession } from './types';

export const PERSISTED_NETWORK_SESSION_STORAGE_KEY = '__almostnodeNetworkSession';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function normalizePersistedSession(
  value: unknown,
): PersistedNetworkSession | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const parsed = value as Record<string, unknown>;
  if (
    parsed.provider !== 'tailscale'
    || typeof parsed.useExitNode !== 'boolean'
  ) {
    return null;
  }

  const stateSnapshot = parsed.stateSnapshot;
  if (
    stateSnapshot !== null
    && stateSnapshot !== undefined
    && (
      typeof stateSnapshot !== 'object'
      || Array.isArray(stateSnapshot)
      || Object.values(stateSnapshot as Record<string, unknown>).some(
        (entry) => typeof entry !== 'string',
      )
    )
  ) {
    return null;
  }

  return {
    provider: 'tailscale',
    useExitNode: parsed.useExitNode,
    exitNodeId:
      typeof parsed.exitNodeId === 'string' && parsed.exitNodeId.trim()
        ? parsed.exitNodeId.trim()
        : null,
    acceptDns: parsed.acceptDns !== false,
    stateSnapshot:
      stateSnapshot && typeof stateSnapshot === 'object'
        ? { ...(stateSnapshot as Record<string, string>) }
        : null,
  };
}

export function parsePersistedNetworkSession(
  raw: string | null | undefined,
): PersistedNetworkSession | null {
  if (!raw) {
    return null;
  }

  try {
    return normalizePersistedSession(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function serializePersistedNetworkSession(
  session: PersistedNetworkSession,
): string {
  return JSON.stringify(session);
}

function getBrowserSessionStorage(): StorageLike | null {
  try {
    if (typeof sessionStorage === 'undefined') {
      return null;
    }
    return sessionStorage;
  } catch {
    return null;
  }
}

export function createNetworkSessionPersistence(
  storage: StorageLike | null | undefined = getBrowserSessionStorage(),
  key = PERSISTED_NETWORK_SESSION_STORAGE_KEY,
): {
  clear(): void;
  load(): PersistedNetworkSession | null;
  save(session: PersistedNetworkSession): void;
} {
  return {
    load(): PersistedNetworkSession | null {
      if (!storage) {
        return null;
      }

      try {
        const raw = storage.getItem(key);
        const session = parsePersistedNetworkSession(raw);
        if (raw && !session) {
          storage.removeItem(key);
        }
        return session;
      } catch {
        return null;
      }
    },
    save(session: PersistedNetworkSession): void {
      if (!storage) {
        return;
      }

      try {
        storage.setItem(key, serializePersistedNetworkSession(session));
      } catch {
        // Ignore storage failures.
      }
    },
    clear(): void {
      if (!storage) {
        return;
      }

      try {
        storage.removeItem(key);
      } catch {
        // Ignore storage failures.
      }
    },
  };
}
