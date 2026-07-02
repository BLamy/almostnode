/**
 * Runtime lifecycle for Electron apps installed into the workspace VFS under
 * /Applications/<id>. Generalizes the App Store's install/launch/stop logic so
 * both the App Store and first-party dock apps (and, later, AI-authored apps)
 * share one path.
 *
 * Install writes an app's seed files into the VFS (persisted in the workspace
 * snapshot). Launch runs `electron <dir>` in a dedicated terminal session,
 * tagged with ALMOST_ELECTRON_APP_ID so the electron shim can associate the
 * app's BrowserWindows with this id (dock presence, menus). The running set is
 * a reactive store (useRunning) so the dock/App Store track live instances.
 */
import { useSyncExternalStore } from "react";
import type { TerminalSessionHandle } from "@agent-wasm/sdk";
import { getWorkspace } from "../../runtime/runtime";

export const APPS_ROOT = "/Applications";

/** A launchable Electron app whose sources live in (or install into) the VFS. */
export interface ManagedElectronApp {
  id: string;
  name: string;
  /** VFS directory the app installs to (defaults to /Applications/<id>). */
  appDir?: string;
  /** Bundled version; when set, a version mismatch on disk forces a rewrite. */
  version?: string;
  /** Lazily produce the seed files (path relative to appDir -> content). */
  loadFiles: () => Promise<Record<string, string>>;
}

export function appDir(id: string): string {
  return `${APPS_ROOT}/${id}`;
}

function resolveDir(app: ManagedElectronApp): string {
  return app.appDir ?? appDir(app.id);
}

export function isInstalled(id: string): boolean {
  return getWorkspace().vfs.existsSync(`${appDir(id)}/package.json`);
}

function installedVersion(dir: string): string | null {
  const vfs = getWorkspace().vfs;
  try {
    const pkg = JSON.parse(vfs.readFileSync(`${dir}/package.json`, "utf8") as string);
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

function writeFiles(dir: string, files: Record<string, string>): void {
  const vfs = getWorkspace().vfs;
  for (const [rel, content] of Object.entries(files)) {
    const full = `${dir}/${rel}`;
    const parent = full.slice(0, full.lastIndexOf("/"));
    if (parent && !vfs.existsSync(parent)) {
      vfs.mkdirSync(parent, { recursive: true });
    }
    vfs.writeFileSync(full, content);
  }
}

/**
 * Ensure the app's files are on disk. Re-writes when absent, or (when the app
 * declares a `version`) when the installed version differs from the bundled one.
 */
export async function ensureInstalled(app: ManagedElectronApp): Promise<void> {
  const dir = resolveDir(app);
  const vfs = getWorkspace().vfs;
  const present = vfs.existsSync(`${dir}/package.json`);
  if (present && (app.version === undefined || installedVersion(dir) === app.version)) {
    return;
  }
  writeFiles(dir, await app.loadFiles());
}

// -- app-data ownership convention ----------------------------------------
// An app "owns" its VFS subtree (/Applications/<id>) plus any localStorage keys
// namespaced `app:<id>:*` and any module-singleton state registered via a reset
// callback. Clearing all three is what makes uninstall wipe settings + AI edits.
const resets = new Map<string, () => void>();

/** Register a callback that resets an app's in-memory (singleton) state. */
export function registerAppReset(id: string, reset: () => void): () => void {
  resets.set(id, reset);
  return () => {
    if (resets.get(id) === reset) resets.delete(id);
  };
}

/** localStorage prefix an app should namespace its keys under. */
export function appStoragePrefix(id: string): string {
  return `app:${id}:`;
}

function clearAppData(id: string): void {
  resets.get(id)?.();
  try {
    const prefix = appStoragePrefix(id);
    const ls = globalThis.localStorage;
    if (ls) {
      for (const key of Object.keys(ls)) {
        if (key.startsWith(prefix)) ls.removeItem(key);
      }
    }
  } catch {
    /* localStorage may be unavailable */
  }
}

/** Remove an app's installed files + owned data (stops it first). */
export function uninstall(id: string): void {
  stop(id);
  const dir = appDir(id);
  const workspace = getWorkspace();
  if (workspace.vfs.existsSync(dir)) workspace.remove(dir);
  clearAppData(id);
}

/**
 * Wipe an app back to a pristine install: remove its files + settings + AI
 * modifications, then re-write its bundled seed files. Does not relaunch.
 */
export async function reinstall(app: ManagedElectronApp): Promise<void> {
  uninstall(app.id);
  await ensureInstalled(app);
}

// -- running instances (reactive) -----------------------------------------
const running = new Map<string, TerminalSessionHandle>();
const listeners = new Set<() => void>();
let runningSnapshot: ReadonlySet<string> = new Set();

function emitRunning(): void {
  runningSnapshot = new Set(running.keys());
  for (const listener of listeners) listener();
}

export function isRunning(id: string): boolean {
  return running.has(id);
}

/** Launch the app (no-op if already running). Assumes files are installed. */
export function launch(app: ManagedElectronApp): void {
  const id = app.id;
  if (running.has(id)) return;
  const workspace = getWorkspace();
  // Tag the session so the electron shim reports this id on createWindow options
  // (ALMOST_ELECTRON_APP_ID → FrameWindow.appId), giving the app dock identity.
  const handle = workspace.terminals.createSession({
    env: { ALMOST_ELECTRON_APP_ID: id },
  });
  running.set(id, handle);
  emitRunning();
  // Fire-and-forget: the session keeps the main process alive until disposed or
  // the app quits itself (the electron command returns on app.quit()).
  void handle.session
    .run(`electron ${resolveDir(app)}`)
    .catch(() => {})
    .finally(() => {
      if (running.get(id) === handle) {
        running.delete(id);
        emitRunning();
      }
    });
}

/** Install if needed, then launch. */
export async function ensureLaunched(app: ManagedElectronApp): Promise<void> {
  await ensureInstalled(app);
  launch(app);
}

export function stop(id: string): void {
  const handle = running.get(id);
  if (handle) {
    handle.dispose();
    running.delete(id);
    emitRunning();
  }
}

/** Reactive set of currently-running app ids (for dock/App Store dots). */
export function useRunning(): ReadonlySet<string> {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => runningSnapshot,
    () => runningSnapshot,
  );
}
