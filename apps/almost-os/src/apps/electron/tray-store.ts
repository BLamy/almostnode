// Electron Tray instances, surfaced as macOS menu-bar extras. The shim
// publishes each Tray (title/icon/tooltip/context-menu) here via the host seam;
// the MenuBar renders them and routes clicks back (context menu + 'click').
import { useSyncExternalStore } from "react";
import type { ElectronTray } from "@agent-wasm/core";

let trays: ElectronTray[] = [];
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

export function setTray(trayId: number, tray: ElectronTray | null): void {
  const rest = trays.filter((t) => t.trayId !== trayId);
  trays = tray ? [...rest, tray] : rest;
  emit();
}

export function useTrays(): ElectronTray[] {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => trays,
    () => trays,
  );
}
