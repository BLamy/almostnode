/**
 * Database Manager
 * localStorage-based registry of named PGlite databases
 */

const REGISTRY_KEY = 'almostnode-db-registry';
const ACTIVE_KEY = 'almostnode-active-db';
const DEFAULT_NAMESPACE = 'global';

let currentNamespace = DEFAULT_NAMESPACE;

export interface DatabaseEntry {
  name: string;
  createdAt: string;
}

function normalizeNamespace(namespace: string | null | undefined): string {
  const trimmed = namespace?.trim();
  if (!trimmed) {
    return DEFAULT_NAMESPACE;
  }

  const normalized = trimmed.replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 80);
  return normalized || DEFAULT_NAMESPACE;
}

function getRegistryKey(namespace = currentNamespace): string {
  const normalized = normalizeNamespace(namespace);
  return normalized === DEFAULT_NAMESPACE ? REGISTRY_KEY : `${REGISTRY_KEY}:${normalized}`;
}

function getActiveKey(namespace = currentNamespace): string {
  const normalized = normalizeNamespace(namespace);
  return normalized === DEFAULT_NAMESPACE ? ACTIVE_KEY : `${ACTIVE_KEY}:${normalized}`;
}

function getIndexedDbName(name: string, namespace = currentNamespace): string {
  const normalizedNamespace = normalizeNamespace(namespace);
  return normalizedNamespace === DEFAULT_NAMESPACE
    ? `almostnode-db-${name}`
    : `almostnode-db-${normalizedNamespace}-${name}`;
}

function loadRegistry(namespace = currentNamespace): DatabaseEntry[] {
  try {
    const raw = localStorage.getItem(getRegistryKey(namespace));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveRegistry(entries: DatabaseEntry[], namespace = currentNamespace): void {
  localStorage.setItem(getRegistryKey(namespace), JSON.stringify(entries));
}

export function getDatabaseNamespace(): string {
  return currentNamespace;
}

export function setDatabaseNamespace(namespace: string | null | undefined): string {
  currentNamespace = normalizeNamespace(namespace);
  return currentNamespace;
}

export function listDatabases(namespace = currentNamespace): DatabaseEntry[] {
  return loadRegistry(namespace);
}

export function createDatabase(name: string, namespace = currentNamespace): DatabaseEntry {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Database name cannot be empty');
  if (trimmed.length > 50) throw new Error('Database name must be 50 characters or less');
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error('Database name can only contain letters, numbers, hyphens, and underscores');
  }

  const entries = loadRegistry(namespace);
  if (entries.some((e) => e.name === trimmed)) {
    throw new Error(`Database "${trimmed}" already exists`);
  }

  const entry: DatabaseEntry = { name: trimmed, createdAt: new Date().toISOString() };
  entries.push(entry);
  saveRegistry(entries, namespace);
  return entry;
}

export function deleteDatabase(name: string, namespace = currentNamespace): void {
  const entries = loadRegistry(namespace);
  const filtered = entries.filter((e) => e.name !== name);
  if (filtered.length === entries.length) {
    throw new Error(`Database "${name}" not found`);
  }
  saveRegistry(filtered, namespace);

  // Clear active if we just deleted it
  if (getActiveDatabase(namespace) === name) {
    localStorage.removeItem(getActiveKey(namespace));
  }

  // Delete the IndexedDB database. PGlite prepends /pglite/ internally.
  indexedDB.deleteDatabase(`/pglite/${getIndexedDbName(name, namespace)}`);
}

export function getActiveDatabase(namespace = currentNamespace): string | null {
  return localStorage.getItem(getActiveKey(namespace));
}

export function setActiveDatabase(name: string, namespace = currentNamespace): void {
  localStorage.setItem(getActiveKey(namespace), name);
}

/**
 * Ensure a default database exists. Called on first launch.
 * Returns the name of the active database.
 */
export function ensureDefaultDatabase(namespace = currentNamespace): string {
  const entries = loadRegistry(namespace);
  if (entries.length === 0) {
    createDatabase('default', namespace);
  }

  const active = getActiveDatabase(namespace);
  if (active && loadRegistry(namespace).some((e) => e.name === active)) {
    return active;
  }

  // Fall back to first entry
  const first = loadRegistry(namespace)[0].name;
  setActiveDatabase(first, namespace);
  return first;
}

/** Returns the idb:// path for PGlite to use for IndexedDB persistence */
export function getIdbPath(name: string, namespace = currentNamespace): string {
  return `idb://${getIndexedDbName(name, namespace)}`;
}
