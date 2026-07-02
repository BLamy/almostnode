// Application menus published by emulated Electron apps (via the runtime's
// `ElectronHost.setApplicationMenu` seam) — one menu per app instance. The
// MenuBar resolves the focused window's app instance to one of these; menu
// clicks dispatch same-context through `onCommand`. Follows the module-store +
// useSyncExternalStore pattern used by media/player-store.

import { useSyncExternalStore } from "react";
import type { ElectronApplicationMenu, SerializedMenuItem } from "@agent-wasm/core";

/** The shape the MenuBar consumes — produced by Electron apps and native apps alike. */
export interface ResolvedMenu {
  appName: string;
  items: SerializedMenuItem[];
  onCommand: (commandId: string) => void;
}

const menus = new Map<number, ElectronApplicationMenu>();
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version += 1;
  for (const listener of listeners) listener();
}

export function setElectronAppMenu(
  appInstanceId: number,
  menu: ElectronApplicationMenu | null,
): void {
  if (menu) menus.set(appInstanceId, menu);
  else menus.delete(appInstanceId);
  emit();
}

export function getMenuForAppInstance(
  appInstanceId: number | undefined,
): ElectronApplicationMenu | null {
  if (appInstanceId === undefined) return null;
  return menus.get(appInstanceId) ?? null;
}

/** Subscribe to menu changes; the returned version bumps on every publish. */
export function useMenuStoreVersion(): number {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => version,
    () => version,
  );
}
