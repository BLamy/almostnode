import { describe, expect, it } from 'vitest';
import {
  createTailscaleSessionPersistence,
  createTailscaleSessionStateStore,
  parseTailscaleStateSnapshot,
  TAILSCALE_SESSION_STORAGE_KEY,
} from '../src/network/tailscale-session-storage';

class MemoryStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe('tailscale session storage', () => {
  it('hydrates worker state from a persisted snapshot', () => {
    const storage = new MemoryStorage();
    const persistence = createTailscaleSessionPersistence(storage);
    persistence.save({ profile: 'alpha', node: 'sfo' });

    const store = createTailscaleSessionStateStore(persistence.load(), () => {});
    expect(store.getState('profile')).toBe('alpha');
    expect(store.getState('node')).toBe('sfo');
    expect(store.snapshot()).toEqual({ profile: 'alpha', node: 'sfo' });
  });

  it('clears persisted state on explicit logout', () => {
    const storage = new MemoryStorage();
    const persistence = createTailscaleSessionPersistence(storage);
    persistence.save({ profile: 'alpha' });

    const updates: Array<Record<string, string> | null> = [];
    const store = createTailscaleSessionStateStore(
      persistence.load(),
      (snapshot) => {
        updates.push(snapshot);
        if (snapshot) {
          persistence.save(snapshot);
        } else {
          persistence.clear();
        }
      },
    );

    store.clear();

    expect(updates).toEqual([null]);
    expect(storage.getItem(TAILSCALE_SESSION_STORAGE_KEY)).toBeNull();
  });

  it('drops malformed persisted snapshots and falls back to empty state', () => {
    const storage = new MemoryStorage();
    storage.setItem(TAILSCALE_SESSION_STORAGE_KEY, '{"profile":1}');

    const persistence = createTailscaleSessionPersistence(storage);
    expect(parseTailscaleStateSnapshot(storage.getItem(TAILSCALE_SESSION_STORAGE_KEY))).toBeNull();
    expect(persistence.load()).toBeNull();
    expect(storage.getItem(TAILSCALE_SESSION_STORAGE_KEY)).toBeNull();
  });
});
