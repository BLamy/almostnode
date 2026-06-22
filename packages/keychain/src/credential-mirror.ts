import type { VirtualFS, FSWatcher } from '@agent-wasm/core';

export const CREDENTIAL_MIRROR_STORAGE_KEY = 'almostnode.webide.live-credentials.v1';

interface MirrorEntry {
  path: string;
  contentBase64: string;
}

interface MirrorPayload {
  version: 1;
  entries: MirrorEntry[];
  updatedAt: string;
}

const WATCH_DEBOUNCE_MS = 150;

function encodeContent(raw: string | Uint8Array): string {
  const bytes = typeof raw === 'string' ? new TextEncoder().encode(raw) : raw;
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function decodeContent(encoded: string): Uint8Array {
  const binary = atob(encoded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function readPayload(): MirrorPayload | null {
  try {
    const raw = localStorage.getItem(CREDENTIAL_MIRROR_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MirrorPayload;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePayload(entries: MirrorEntry[]): void {
  const payload: MirrorPayload = {
    version: 1,
    entries,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(CREDENTIAL_MIRROR_STORAGE_KEY, JSON.stringify(payload));
}

export interface CredentialMirrorOptions {
  vfs: VirtualFS;
  paths: string[];
}

/**
 * Persists a fixed set of credential paths to localStorage and restores them into a fresh VFS
 * on boot. Lets routes that bootstrap their own WebIDEHost (e.g. /app-builder) pick up live
 * credentials that were produced by sign-in flows in another tab or an earlier navigation,
 * without requiring the passkey-protected keychain to be unlocked.
 */
export class CredentialMirror {
  private readonly vfs: VirtualFS;
  private readonly paths: string[];
  private readonly watchers: FSWatcher[] = [];
  private pendingHandle = 0;
  private suppressSync = false;

  constructor(options: CredentialMirrorOptions) {
    this.vfs = options.vfs;
    this.paths = [...options.paths];
  }

  hydrateFromStorage(): void {
    const payload = readPayload();
    if (!payload) return;

    const allowed = new Set(this.paths);
    this.suppressSync = true;
    try {
      for (const entry of payload.entries) {
        if (!allowed.has(entry.path)) continue;
        if (this.vfs.existsSync(entry.path)) continue;
        const parentDir = entry.path.slice(0, entry.path.lastIndexOf('/')) || '/';
        if (parentDir !== '/') {
          this.vfs.mkdirSync(parentDir, { recursive: true });
        }
        try {
          this.vfs.writeFileSync(entry.path, decodeContent(entry.contentBase64));
        } catch {
          // Skip any entry that fails to write.
        }
      }
    } finally {
      queueMicrotask(() => {
        this.suppressSync = false;
      });
    }
  }

  startWatching(): void {
    const watchedDirs = new Set<string>();
    for (const path of this.paths) {
      const parentDir = path.slice(0, path.lastIndexOf('/')) || '/';
      if (watchedDirs.has(parentDir)) continue;
      watchedDirs.add(parentDir);

      if (parentDir === '/') {
        this.watchers.push(this.vfs.watch(path, () => this.scheduleSync()));
      } else {
        this.watchers.push(this.vfs.watch(parentDir, { recursive: true }, (_event, filename) => {
          if (!filename) {
            this.scheduleSync();
            return;
          }
          const resolved = filename.startsWith('/') ? filename : `${parentDir}/${filename}`;
          if (this.paths.includes(resolved)) {
            this.scheduleSync();
          }
        }));
      }
    }

    // Run once to capture current state.
    this.scheduleSync();
  }

  dispose(): void {
    window.clearTimeout(this.pendingHandle);
    for (const watcher of this.watchers) {
      try {
        watcher.close();
      } catch {
        // Ignore close errors.
      }
    }
    this.watchers.length = 0;
  }

  private scheduleSync(): void {
    if (this.suppressSync) return;
    window.clearTimeout(this.pendingHandle);
    this.pendingHandle = window.setTimeout(() => {
      try {
        this.syncToStorage();
      } catch {
        // Storage writes shouldn't break the app.
      }
    }, WATCH_DEBOUNCE_MS);
  }

  private syncToStorage(): void {
    const entries: MirrorEntry[] = [];
    for (const path of this.paths) {
      if (!this.vfs.existsSync(path)) continue;
      try {
        if (!this.vfs.statSync(path).isFile()) continue;
        const raw = this.vfs.readFileSync(path) as string | Uint8Array;
        entries.push({
          path,
          contentBase64: encodeContent(raw),
        });
      } catch {
        // Skip unreadable files.
      }
    }

    if (entries.length === 0) {
      localStorage.removeItem(CREDENTIAL_MIRROR_STORAGE_KEY);
      return;
    }

    writePayload(entries);
  }
}
