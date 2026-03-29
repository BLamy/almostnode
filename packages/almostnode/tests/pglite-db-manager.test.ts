import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createDatabase,
  ensureDefaultDatabase,
  getActiveDatabase,
  getIdbPath,
  listDatabases,
  setActiveDatabase,
  setDatabaseNamespace,
} from '../src/pglite/db-manager';

class MemoryStorage implements Storage {
  private readonly store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

beforeEach(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  });
  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      deleteDatabase: vi.fn(),
    },
  });
  setDatabaseNamespace('global');
});

describe('pglite db manager namespaces', () => {
  it('isolates database registries and active selections per namespace', () => {
    setDatabaseNamespace('project-a');
    ensureDefaultDatabase();
    createDatabase('analytics');
    setActiveDatabase('analytics');

    expect(listDatabases().map((entry) => entry.name)).toEqual(['default', 'analytics']);
    expect(getActiveDatabase()).toBe('analytics');
    expect(getIdbPath('analytics')).toBe('idb://almostnode-db-project-a-analytics');

    setDatabaseNamespace('project-b');

    expect(listDatabases()).toEqual([]);
    expect(getActiveDatabase()).toBeNull();
    expect(ensureDefaultDatabase()).toBe('default');
    expect(listDatabases().map((entry) => entry.name)).toEqual(['default']);
    expect(getActiveDatabase()).toBe('default');
    expect(getIdbPath('default')).toBe('idb://almostnode-db-project-b-default');

    setDatabaseNamespace('project-a');
    expect(listDatabases().map((entry) => entry.name)).toEqual(['default', 'analytics']);
    expect(getActiveDatabase()).toBe('analytics');
  });
});
