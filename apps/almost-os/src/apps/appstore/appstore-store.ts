/**
 * App Store install/launch logic against the shared almost-os workspace.
 *
 * Install lazily imports an app's source and writes it into the VFS under
 * /Applications/<id> (persisted with the workspace snapshot). Launch runs
 * `electron <dir>` in a dedicated terminal session so each app gets its own
 * isolated runtime (separate app/ipcMain/window state).
 */
import type { TerminalSessionHandle } from '@agent-wasm/sdk';
import { getWorkspace } from '../../runtime/runtime';
import type { AppStoreEntry } from './catalog';

export const APPS_ROOT = '/Applications';

export function appDir(id: string): string {
  return `${APPS_ROOT}/${id}`;
}

export function isInstalled(id: string): boolean {
  return getWorkspace().vfs.existsSync(`${appDir(id)}/package.json`);
}

export async function installApp(entry: AppStoreEntry): Promise<void> {
  const vfs = getWorkspace().vfs;
  const mod = await entry.load();
  const dir = appDir(entry.id);
  for (const [rel, content] of Object.entries(mod.files)) {
    const full = `${dir}/${rel}`;
    const parent = full.slice(0, full.lastIndexOf('/'));
    if (parent && !vfs.existsSync(parent)) {
      vfs.mkdirSync(parent, { recursive: true });
    }
    vfs.writeFileSync(full, content);
  }
}

export function uninstallApp(id: string): void {
  stopApp(id);
  const dir = appDir(id);
  if (getWorkspace().vfs.existsSync(dir)) {
    getWorkspace().remove(dir);
  }
}

// Live app instances, keyed by app id — prevents double-launch and lets us stop.
const running = new Map<string, TerminalSessionHandle>();

export function isRunning(id: string): boolean {
  return running.has(id);
}

export function launchApp(id: string): void {
  if (running.has(id)) return;
  const workspace = getWorkspace();
  const handle = workspace.terminals.createSession();
  running.set(id, handle);
  // Fire-and-forget: the session keeps the Electron main process alive until
  // we dispose it (or the command errors, in which case we free the slot).
  void handle.session
    .run(`electron ${appDir(id)}`)
    .catch(() => {})
    .finally(() => {
      if (running.get(id) === handle) running.delete(id);
    });
}

export function stopApp(id: string): void {
  const handle = running.get(id);
  if (handle) {
    handle.dispose();
    running.delete(id);
  }
}
