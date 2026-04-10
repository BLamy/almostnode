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
    ensureDefaultDatabase(undefined, 'project-a');
    createDatabase('analytics');
    setActiveDatabase('analytics');

    expect(listDatabases().map((entry) => entry.name)).toEqual(['project-a', 'analytics']);
    expect(getActiveDatabase()).toBe('analytics');
    expect(getIdbPath('analytics')).toBe('idb://almostnode-db-project-a-analytics');
    expect(getIdbPath('project-a')).toBe('idb://almostnode-db-project-a-project-a');

    setDatabaseNamespace('project-b');

    expect(listDatabases()).toEqual([]);
    expect(getActiveDatabase()).toBeNull();
    expect(ensureDefaultDatabase(undefined, 'project-b')).toBe('project-b');
    expect(listDatabases().map((entry) => entry.name)).toEqual(['project-b']);
    expect(getActiveDatabase()).toBe('project-b');
    expect(getIdbPath('project-b')).toBe('idb://almostnode-db-project-b-project-b');

    setDatabaseNamespace('project-a');
    expect(listDatabases().map((entry) => entry.name)).toEqual(['project-a', 'analytics']);
    expect(getActiveDatabase()).toBe('analytics');
  });

  it('renames a legacy default database without changing its storage path', () => {
    setDatabaseNamespace('project-a');
    ensureDefaultDatabase();

    expect(listDatabases().map((entry) => entry.name)).toEqual(['default']);
    expect(getIdbPath('default')).toBe('idb://almostnode-db-project-a-default');

    expect(ensureDefaultDatabase(undefined, 'project-a')).toBe('project-a');
    expect(listDatabases()).toEqual([
      {
        name: 'project-a',
        createdAt: expect.any(String),
        storageKey: 'default',
      },
    ]);
    expect(getActiveDatabase()).toBe('project-a');
    expect(getIdbPath('project-a')).toBe('idb://almostnode-db-project-a-default');
  });
});
