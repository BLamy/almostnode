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
  storageKey?: string;
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

function isValidDatabaseName(name: string | null | undefined): name is string {
  return Boolean(name)
    && name.length <= 50
    && /^[a-zA-Z0-9_-]+$/.test(name);
}

function getValidatedDatabaseName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Database name cannot be empty');
  if (trimmed.length > 50) throw new Error('Database name must be 50 characters or less');
  if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) {
    throw new Error('Database name can only contain letters, numbers, hyphens, and underscores');
  }
  return trimmed;
}

function resolveStorageKey(name: string, namespace = currentNamespace): string {
  const entry = loadRegistry(namespace).find((candidate) => candidate.name === name);
  return entry?.storageKey || name;
}

function loadRegistry(namespace = currentNamespace): DatabaseEntry[] {
  try {
    const raw = localStorage.getItem(getRegistryKey(namespace));
    const entries = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(entries)) {
      return [];
    }
    return entries
      .filter((entry): entry is DatabaseEntry => (
        Boolean(entry)
        && typeof entry === 'object'
        && typeof entry.name === 'string'
        && typeof entry.createdAt === 'string'
      ))
      .map((entry) => ({
        name: entry.name,
        createdAt: entry.createdAt,
        storageKey: typeof entry.storageKey === 'string' && entry.storageKey
          ? entry.storageKey
          : undefined,
      }));
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
  const trimmed = getValidatedDatabaseName(name);

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
  const entry = entries.find((candidate) => candidate.name === name);
  const storageKey = entry?.storageKey || name;
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
  indexedDB.deleteDatabase(`/pglite/${getIndexedDbName(storageKey, namespace)}`);
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
export function ensureDefaultDatabase(
  namespace = currentNamespace,
  preferredName?: string,
): string {
  const preferred = isValidDatabaseName(preferredName?.trim())
    ? preferredName!.trim()
    : null;
  let entries = loadRegistry(namespace);

  if (preferred && preferred !== 'default') {
    const legacyDefault = entries.find((entry) => entry.name === 'default');
    const preferredEntry = entries.find((entry) => entry.name === preferred);
    if (legacyDefault && !preferredEntry) {
      legacyDefault.name = preferred;
      legacyDefault.storageKey = legacyDefault.storageKey || 'default';
      saveRegistry(entries, namespace);
      entries = loadRegistry(namespace);
    }
  }

  if (entries.length === 0) {
    createDatabase(preferred || 'default', namespace);
    entries = loadRegistry(namespace);
  }

  const active = getActiveDatabase(namespace);
  if (active && entries.some((e) => e.name === active)) {
    return active;
  }

  const nextActive = (
    preferred && entries.some((entry) => entry.name === preferred)
      ? preferred
      : entries[0]!.name
  );
  setActiveDatabase(nextActive, namespace);
  return nextActive;
}

/** Returns the idb:// path for PGlite to use for IndexedDB persistence */
export function getIdbPath(name: string, namespace = currentNamespace): string {
  return `idb://${getIndexedDbName(resolveStorageKey(name, namespace), namespace)}`;
}
