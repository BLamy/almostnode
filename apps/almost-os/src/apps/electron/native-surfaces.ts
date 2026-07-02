// Native-surface windows: an Electron BrowserWindow whose renderer is a
// registered React component drawn directly in the host DOM instead of an
// iframe. A main process opts in with `win.loadURL('almost-native://<name>')`
// — the shim's translateRendererUrl leaves the custom scheme untouched, so no
// runtime change is needed. This exists because a transparent full-work-area
// iframe can't be per-pixel click-through (needed for Webamp-style surfaces),
// whereas a host-DOM component can.
//
// The component receives a NativeSurfaceChannel — an in-page ipcRenderer
// equivalent that speaks the same envelope protocol as electron-preload.ts, but
// via direct function calls (attachRenderer/emitFromRenderer) rather than
// postMessage.
import type { ComponentType } from "react";

export interface NativeSurfaceChannel {
  /** renderer → main invoke, resolves with the ipcMain.handle result. */
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  /** renderer → main fire-and-forget. */
  send(channel: string, ...args: unknown[]): void;
  /** subscribe to main → renderer webContents.send(channel, …); returns an unsubscribe. */
  on(channel: string, listener: (...args: unknown[]) => void): () => void;
}

export interface NativeSurfaceOptions {
  /** Render click-through over the work area (pairs with frame:false, transparent:true). */
  overlay?: boolean;
}

export interface NativeSurfaceComponentProps {
  channel: NativeSurfaceChannel;
}

interface NativeSurfaceEntry {
  component: ComponentType<NativeSurfaceComponentProps>;
  options: NativeSurfaceOptions;
}

const surfaces = new Map<string, NativeSurfaceEntry>();

export function registerNativeSurface(
  name: string,
  component: ComponentType<NativeSurfaceComponentProps>,
  options: NativeSurfaceOptions = {},
): void {
  surfaces.set(name, { component, options });
}

export function getNativeSurface(name: string): NativeSurfaceEntry | null {
  return surfaces.get(name) ?? null;
}

/** `almost-native://webamp` or `almost-native://webamp/path` → "webamp". */
export function parseNativeSurfaceName(url: string): string | null {
  const match = /^almost-native:\/\/([^/?#]+)/.exec(url);
  return match ? match[1] : null;
}

export function isNativeSurfaceUrl(url: string | undefined): boolean {
  return !!url && url.startsWith("almost-native:");
}
