import type { TailscaleConnectStateStorage } from '@tailscale/connect';

export const TAILSCALE_SESSION_STORAGE_KEY = '__almostnodeTailscaleState';

export type TailscaleStateSnapshot = Record<string, string>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface TailscaleSessionStateStore extends TailscaleConnectStateStorage {
  clear(): void;
  replace(snapshot: TailscaleStateSnapshot | null): void;
  snapshot(): TailscaleStateSnapshot | null;
}

function normalizeSnapshot(
  value: unknown,
): TailscaleStateSnapshot | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const snapshot: TailscaleStateSnapshot = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'string') {
      return null;
    }
    snapshot[key] = entry;
  }

  return snapshot;
}

export function parseTailscaleStateSnapshot(
  raw: string | null | undefined,
): TailscaleStateSnapshot | null {
  if (!raw) {
    return null;
  }

  try {
    return normalizeSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function serializeTailscaleStateSnapshot(
  snapshot: TailscaleStateSnapshot,
): string {
  return JSON.stringify(snapshot);
}

export function createTailscaleSessionPersistence(
  storage: StorageLike | null | undefined,
  key = TAILSCALE_SESSION_STORAGE_KEY,
): {
  clear(): void;
  load(): TailscaleStateSnapshot | null;
  save(snapshot: TailscaleStateSnapshot): void;
} {
  return {
    load(): TailscaleStateSnapshot | null {
      if (!storage) {
        return null;
      }

      try {
        const raw = storage.getItem(key);
        const snapshot = parseTailscaleStateSnapshot(raw);
        if (raw && !snapshot) {
          storage.removeItem(key);
        }
        return snapshot;
      } catch {
        return null;
      }
    },
    save(snapshot: TailscaleStateSnapshot): void {
      if (!storage) {
        return;
      }

      try {
        storage.setItem(key, serializeTailscaleStateSnapshot(snapshot));
      } catch {
        // Ignore sessionStorage failures.
      }
    },
    clear(): void {
      if (!storage) {
        return;
      }

      try {
        storage.removeItem(key);
      } catch {
        // Ignore sessionStorage failures.
      }
    },
  };
}

export function createTailscaleSessionStateStore(
  initialSnapshot: TailscaleStateSnapshot | null,
  onSnapshotChange?: (snapshot: TailscaleStateSnapshot | null) => void,
): TailscaleSessionStateStore {
  const entries = new Map<string, string>(
    Object.entries(initialSnapshot ?? {}),
  );

  const snapshot = (): TailscaleStateSnapshot | null => {
    if (entries.size === 0) {
      return null;
    }
    return Object.fromEntries(entries);
  };

  const emit = (): void => {
    onSnapshotChange?.(snapshot());
  };

  return {
    getState(id: string): string {
      return entries.get(id) ?? '';
    },
    setState(id: string, value: string): void {
      entries.set(id, value);
      emit();
    },
    clear(): void {
      if (entries.size === 0) {
        onSnapshotChange?.(null);
        return;
      }
      entries.clear();
      emit();
    },
    replace(nextSnapshot: TailscaleStateSnapshot | null): void {
      entries.clear();
      for (const [key, value] of Object.entries(nextSnapshot ?? {})) {
        entries.set(key, value);
      }
    },
    snapshot,
  };
}
