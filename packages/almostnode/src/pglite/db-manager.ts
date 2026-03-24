/**
 * Database Manager
 * localStorage-based registry of named PGlite databases
 */

const REGISTRY_KEY = 'almostnode-db-registry';
const ACTIVE_KEY = 'almostnode-active-db';

export interface DatabaseEntry {
  name: string;
  createdAt: string;
}

function loadRegistry(): DatabaseEntry[] {
  try {
    const raw = localStorage.getItem(REGISTRY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRegistry(entries: DatabaseEntry[]): void {
  localStorage.setItem(REGISTRY_KEY, JSON.stringify(entries));
}

export function listDatabases(): DatabaseEntry[] {
  return loadRegistry();
}

export function createDatabase(name: string): DatabaseEntry {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Database name cannot be empty');
  if (trimmed.length > 50) throw new Error('Database name must be 50 characters or less');
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error('Database name can only contain letters, numbers, hyphens, and underscores');
  }

  const entries = loadRegistry();
  if (entries.some((e) => e.name === trimmed)) {
    throw new Error(`Database "${trimmed}" already exists`);
  }

  const entry: DatabaseEntry = { name: trimmed, createdAt: new Date().toISOString() };
  entries.push(entry);
  saveRegistry(entries);
  return entry;
}

export function deleteDatabase(name: string): void {
  const entries = loadRegistry();
  const filtered = entries.filter((e) => e.name !== name);
  if (filtered.length === entries.length) {
    throw new Error(`Database "${name}" not found`);
  }
  saveRegistry(filtered);

  // Clear active if we just deleted it
  if (getActiveDatabase() === name) {
    localStorage.removeItem(ACTIVE_KEY);
  }

  // Delete the IndexedDB database. PGlite prepends /pglite/ internally.
  indexedDB.deleteDatabase(`/pglite/almostnode-db-${name}`);
}

export function getActiveDatabase(): string | null {
  return localStorage.getItem(ACTIVE_KEY);
}

export function setActiveDatabase(name: string): void {
  localStorage.setItem(ACTIVE_KEY, name);
}

/**
 * Ensure a default database exists. Called on first launch.
 * Returns the name of the active database.
 */
export function ensureDefaultDatabase(): string {
  const entries = loadRegistry();
  if (entries.length === 0) {
    createDatabase('default');
  }

  const active = getActiveDatabase();
  if (active && loadRegistry().some((e) => e.name === active)) {
    return active;
  }

  // Fall back to first entry
  const first = loadRegistry()[0].name;
  setActiveDatabase(first);
  return first;
}

/** Returns the idb:// path for PGlite to use for IndexedDB persistence */
export function getIdbPath(name: string): string {
  return `idb://almostnode-db-${name}`;
}
