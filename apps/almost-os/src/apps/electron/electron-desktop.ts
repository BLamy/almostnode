/**
 * Bridge between the imperative Electron host (called from the almostnode
 * runtime via `setElectronHost`) and the React WindowManager.
 *
 * The `electron` shim asks this host to create windows; each becomes a real
 * frame window in the WindowManager. Per-window IPC messages are relayed here:
 * main -> renderer via `attachRenderer` (drained into the iframe by
 * `ElectronWindow`), renderer -> main via `emitFromRenderer`.
 */
import type {
  ElectronHost,
  ElectronWindowBounds,
  ElectronWindowEvent,
  ElectronWindowHandle,
  ElectronWindowOptions,
} from "@agent-wasm/core";
import { setElectronAppMenu } from "../../desktop/menu-store";
import {
  DOCK_RESERVE,
  MENUBAR_HEIGHT,
  type FrameWindow,
} from "../../windows/window-store";
import { closeContextMenu, showContextMenu } from "./context-menu-store";
import { requestDialog } from "./dialog-store";
import { setTray } from "./tray-store";

/** How the React WindowManager exposes itself to this imperative host. */
export interface ElectronWindowController {
  openWindow(payload: {
    id: string;
    title: string;
    size: { width: number; height: number };
    frame: FrameWindow;
    frameless?: boolean;
    transparent?: boolean;
    resizable?: boolean;
    minSize?: { width: number; height: number };
    position?: { x: number; y: number };
  }): void;
  setWindowUrl(id: string, url: string): void;
  setWindowTitle(id: string, title: string): void;
  setWindowBounds(id: string, bounds: Partial<ElectronWindowBounds>): void;
  focus(id: string): void;
  minimize(id: string): void;
  unminimize(id: string): void;
  setMaximized(id: string, maximized: boolean): void;
  close(id: string): void;
  getViewport(): { width: number; height: number };
}

interface WindowRecord {
  electronId: number;
  domId: string;
  url: string;
  title: string;
  bounds: ElectronWindowBounds;
  destroyed: boolean;
  closedFired: boolean;
  focused: boolean;
  deliverToRenderer: ((message: unknown) => void) | null;
  pending: unknown[];
  fromRenderer: Array<(message: unknown) => void>;
  hostEvents: Map<ElectronWindowEvent, Array<(...args: unknown[]) => void>>;
}

const records = new Map<number, WindowRecord>();
let controller: ElectronWindowController | null = null;
let pendingOps: Array<(c: ElectronWindowController) => void> = [];
let idCounter = 0;

function withController(fn: (c: ElectronWindowController) => void): void {
  if (controller) fn(controller);
  else pendingOps.push(fn);
}

export function setElectronWindowController(c: ElectronWindowController | null): void {
  controller = c;
  if (c) {
    const ops = pendingOps;
    pendingOps = [];
    for (const op of ops) op(c);
  }
}

function fireHostEvent(rec: WindowRecord, event: ElectronWindowEvent, ...args: unknown[]): void {
  for (const listener of rec.hostEvents.get(event) ?? []) listener(...args);
}

function createWindow(options: ElectronWindowOptions): ElectronWindowHandle {
  const electronId = ++idCounter;
  const domId = `electron-${electronId}`;
  const rec: WindowRecord = {
    electronId,
    domId,
    url: "about:blank",
    title: options.title ?? "Electron",
    bounds: {
      x: options.x ?? 0,
      y: options.y ?? 0,
      width: options.width ?? 900,
      height: options.height ?? 640,
    },
    destroyed: false,
    closedFired: false,
    focused: false,
    deliverToRenderer: null,
    pending: [],
    fromRenderer: [],
    hostEvents: new Map(),
  };
  records.set(electronId, rec);

  const minSize =
    options.minWidth || options.minHeight
      ? { width: options.minWidth ?? 0, height: options.minHeight ?? 0 }
      : undefined;
  withController((c) =>
    c.openWindow({
      id: domId,
      title: rec.title,
      size: { width: rec.bounds.width, height: rec.bounds.height },
      frame: {
        electronWindowId: electronId,
        url: rec.url,
        appInstanceId: options.appInstanceId,
        appId: options.appId,
      },
      frameless: options.frame === false,
      transparent: options.transparent,
      resizable: options.resizable,
      minSize,
      position:
        options.x !== undefined && options.y !== undefined
          ? { x: options.x, y: options.y }
          : undefined,
    }),
  );

  const handle: ElectronWindowHandle = {
    id: electronId,
    loadURL: async (url) => {
      // The main-process shim already resolved this to a renderable URL.
      rec.url = url;
      withController((c) => c.setWindowUrl(domId, rec.url));
    },
    loadFile: async (path) => {
      rec.url = path;
      withController((c) => c.setWindowUrl(domId, rec.url));
    },
    postMessage: (message) => {
      if (rec.deliverToRenderer) rec.deliverToRenderer(message);
      else rec.pending.push(message);
    },
    onMessage: (listener) => {
      rec.fromRenderer.push(listener);
    },
    setTitle: (title) => {
      rec.title = title;
      withController((c) => c.setWindowTitle(domId, title));
    },
    setBounds: (bounds) => {
      Object.assign(rec.bounds, bounds);
      withController((c) => c.setWindowBounds(domId, bounds));
    },
    getBounds: () => ({ ...rec.bounds }),
    show: () => {
      withController((c) => c.unminimize(domId));
    },
    hide: () => {
      withController((c) => c.minimize(domId));
    },
    focus: () => {
      withController((c) => c.focus(domId));
    },
    blur: () => {},
    minimize: () => {
      withController((c) => c.minimize(domId));
    },
    maximize: () => {
      withController((c) => c.setMaximized(domId, true));
    },
    unmaximize: () => {
      withController((c) => c.setMaximized(domId, false));
    },
    close: () => {
      if (rec.destroyed) return;
      // The WindowManager removes the window; ElectronWindow's unmount then
      // calls notifyClosed(), which fires the single 'closed' host event.
      withController((c) => c.close(domId));
    },
    isDestroyed: () => rec.destroyed,
    on: (event, listener) => {
      const list = rec.hostEvents.get(event) ?? [];
      list.push(listener);
      rec.hostEvents.set(event, list);
    },
  };
  return handle;
}

export const electronDesktopHost: ElectronHost = {
  createWindow,
  setApplicationMenu: (appInstanceId, menu) => setElectronAppMenu(appInstanceId, menu),
  showDialog: (request) => requestDialog(request),
  showContextMenu: (menu, position) => showContextMenu(menu, position),
  closeContextMenu: () => closeContextMenu(),
  setTray: (trayId, tray) => setTray(trayId, tray),
  getScreenInfo: () => {
    if (!controller) return null;
    const viewport = controller.getViewport();
    return {
      width: viewport.width,
      height: viewport.height,
      workArea: {
        x: 0,
        y: MENUBAR_HEIGHT,
        width: viewport.width,
        height: viewport.height - MENUBAR_HEIGHT - DOCK_RESERVE,
      },
    };
  },
};

// -- React-facing glue (used by ElectronWindow) ---------------------------

/** Wire an iframe as the renderer for a window; returns a detach fn. */
export function attachRenderer(
  electronId: number,
  deliver: (message: unknown) => void,
): () => void {
  const rec = records.get(electronId);
  if (!rec) return () => {};
  rec.deliverToRenderer = deliver;
  const queued = rec.pending;
  rec.pending = [];
  for (const message of queued) deliver(message);
  return () => {
    if (rec.deliverToRenderer === deliver) rec.deliverToRenderer = null;
  };
}

/** Deliver a renderer -> main message to the window's host listeners. */
export function emitFromRenderer(electronId: number, message: unknown): void {
  const rec = records.get(electronId);
  if (!rec) return;
  for (const listener of rec.fromRenderer) listener(message);
}

/** The window's frame unmounted (closed by user or host): fire 'closed' once. */
export function notifyClosed(electronId: number): void {
  const rec = records.get(electronId);
  if (!rec || rec.closedFired) return;
  rec.closedFired = true;
  rec.destroyed = true;
  fireHostEvent(rec, "closed");
  records.delete(electronId);
}

/**
 * WindowManager focus moved on/off this window: fire the shim's 'focus'/'blur'
 * host events so `BrowserWindow.getFocusedWindow()` stays truthful (menu
 * command dispatch depends on it).
 */
export function notifyFocusChanged(electronId: number, focused: boolean): void {
  const rec = records.get(electronId);
  if (!rec || rec.destroyed || rec.focused === focused) return;
  rec.focused = focused;
  fireHostEvent(rec, focused ? "focus" : "blur");
}

/**
 * WindowManager geometry changed (drag, resize handles, maximize, setBounds):
 * keep the shim's `getBounds()` truthful and fire 'move'/'resize' host events.
 */
export function notifyBoundsChanged(
  electronId: number,
  bounds: ElectronWindowBounds,
): void {
  const rec = records.get(electronId);
  if (!rec || rec.destroyed) return;
  const moved = bounds.x !== rec.bounds.x || bounds.y !== rec.bounds.y;
  const resized =
    bounds.width !== rec.bounds.width || bounds.height !== rec.bounds.height;
  if (!moved && !resized) return;
  rec.bounds = { ...bounds };
  if (moved) fireHostEvent(rec, "move");
  if (resized) fireHostEvent(rec, "resize");
}
