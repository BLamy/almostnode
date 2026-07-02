// Active Electron context menu (from Menu.popup) + desktop cursor tracking.
// The shim's popup coordinates are relative to the app's own renderer and don't
// translate across the iframe boundary, so when the app doesn't pass explicit
// coords we pop the menu at the last known desktop cursor position (which is
// what real Electron does for a no-arg popup()).
import { useSyncExternalStore } from "react";
import type { ElectronContextMenu } from "@agent-wasm/core";

export interface ActiveContextMenu {
  menu: ElectronContextMenu;
  x: number;
  y: number;
}

let active: ActiveContextMenu | null = null;
let lastPointer = { x: 200, y: 200 };
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};

export function trackPointer(x: number, y: number): void {
  lastPointer = { x, y };
}

export function showContextMenu(
  menu: ElectronContextMenu,
  position: { x: number; y: number },
): void {
  const at = position.x === 0 && position.y === 0 ? lastPointer : position;
  active = { menu, x: at.x, y: at.y };
  emit();
}

export function closeContextMenu(): void {
  if (active) {
    active = null;
    emit();
  }
}

export function useContextMenu(): ActiveContextMenu | null {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => active,
    () => null,
  );
}
