/**
 * App Store install/launch surface — a thin adapter over the shared
 * electron-app-manager. Catalog entries (AppStoreEntry) are mapped to the
 * manager's ManagedElectronApp shape; all install/launch/stop/uninstall and the
 * reactive running set live in the manager so the dock and App Store agree on
 * app state.
 */
import {
  APPS_ROOT,
  appDir,
  ensureInstalled,
  isInstalled,
  isRunning,
  launch,
  reinstall,
  stop,
  uninstall,
  useRunning,
  type ManagedElectronApp,
} from "../electron/electron-app-manager";
import type { AppStoreEntry } from "./catalog";

export { APPS_ROOT, appDir, isInstalled, isRunning, useRunning };

function toManaged(entry: AppStoreEntry): ManagedElectronApp {
  return {
    id: entry.id,
    name: entry.name,
    version: entry.version,
    loadFiles: () => entry.load().then((m) => m.files),
  };
}

export async function installApp(entry: AppStoreEntry): Promise<void> {
  await ensureInstalled(toManaged(entry));
}

/** Wipe the app's settings + AI edits and restore its pristine seed files. */
export async function reinstallApp(entry: AppStoreEntry): Promise<void> {
  await reinstall(toManaged(entry));
}

export function launchApp(id: string): void {
  // Installed before this is called (the UI only enables Open once installed).
  launch({ id, name: id, loadFiles: async () => ({}) });
}

export function stopApp(id: string): void {
  stop(id);
}

export function uninstallApp(id: string): void {
  uninstall(id);
}
