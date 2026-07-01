// Real host-filesystem access via the File System Access API. Used by the
// desktop "Winamp Skins" folder: the user grants almost-os access to a real
// folder (e.g. ~/Desktop) once, we persist the directory handle in IndexedDB,
// and Finder lists the actual .wsz files off disk. Clicking one reads the real
// bytes and applies it as a Webamp skin. Chromium-only (needs a secure context
// + a user gesture to pick, and a gesture to re-grant permission on reload).

// showDirectoryPicker / handle permission methods aren't in the default TS DOM
// lib, so we describe just what we use.
type PermissionState = "granted" | "denied" | "prompt";
interface PermissionCapableHandle {
  queryPermission?(desc: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(desc: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}
interface DirPicker {
  showDirectoryPicker?: (opts?: {
    id?: string;
    mode?: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
}

const DB_NAME = "almostos-fs";
const STORE = "handles";
const SKINS_KEY = "winamp-skins-dir";

export function isFileSystemAccessSupported(): boolean {
  return typeof window !== "undefined" && typeof (window as DirPicker).showDirectoryPicker === "function";
}

// ── tiny IndexedDB handle store ──────────────────────────────────────────────

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// ── permission helpers ───────────────────────────────────────────────────────

async function hasReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as unknown as PermissionCapableHandle;
  if (!h.queryPermission) return true;
  return (await h.queryPermission({ mode: "read" })) === "granted";
}

async function ensureReadPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as unknown as PermissionCapableHandle;
  if (await hasReadPermission(handle)) return true;
  if (!h.requestPermission) return false;
  return (await h.requestPermission({ mode: "read" })) === "granted";
}

// ── public API ────────────────────────────────────────────────────────────────

/** Prompt the user to choose a real folder for skins; persists the handle. */
export async function pickSkinsDir(): Promise<FileSystemDirectoryHandle | null> {
  const picker = window as DirPicker;
  if (!picker.showDirectoryPicker) return null;
  try {
    const handle = await picker.showDirectoryPicker({ id: "winamp-skins", mode: "read" });
    await idbSet(SKINS_KEY, handle);
    return handle;
  } catch {
    // User dismissed the picker.
    return null;
  }
}

/** Saved handle if we still have (or can re-obtain) read permission, else null. */
export async function getSkinsDir(): Promise<FileSystemDirectoryHandle | null> {
  const handle = await idbGet<FileSystemDirectoryHandle>(SKINS_KEY).catch(() => undefined);
  if (!handle) return null;
  return (await ensureReadPermission(handle)) ? handle : null;
}

/** Saved handle or, failing that, prompt for a new one. */
export async function ensureSkinsDir(): Promise<FileSystemDirectoryHandle | null> {
  return (await getSkinsDir()) ?? (await pickSkinsDir());
}

export interface RealFile {
  name: string;
  handle: FileSystemFileHandle;
}

/** List `.wsz` skin files in the granted folder. */
export async function listWsz(dir: FileSystemDirectoryHandle): Promise<RealFile[]> {
  const out: RealFile[] = [];
  // values() is an async iterator on the directory handle.
  const entries = dir as unknown as AsyncIterable<FileSystemHandle>;
  for await (const entry of entries) {
    if (entry.kind === "file" && entry.name.toLowerCase().endsWith(".wsz")) {
      out.push({ name: entry.name, handle: entry as FileSystemFileHandle });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readWszBytes(file: FileSystemFileHandle): Promise<ArrayBuffer> {
  const blob = await file.getFile();
  return blob.arrayBuffer();
}
