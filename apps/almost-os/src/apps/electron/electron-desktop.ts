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

/** How the React WindowManager exposes itself to this imperative host. */
export interface ElectronWindowController {
  openWindow(payload: {
    id: string;
    title: string;
    size: { width: number; height: number };
    frame: { electronWindowId: number; url: string };
  }): void;
  setWindowUrl(id: string, url: string): void;
  setWindowTitle(id: string, title: string): void;
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
    deliverToRenderer: null,
    pending: [],
    fromRenderer: [],
    hostEvents: new Map(),
  };
  records.set(electronId, rec);

  withController((c) =>
    c.openWindow({
      id: domId,
      title: rec.title,
      size: { width: rec.bounds.width, height: rec.bounds.height },
      frame: { electronWindowId: electronId, url: rec.url },
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
    },
    getBounds: () => ({ ...rec.bounds }),
    show: () => {},
    hide: () => {},
    focus: () => {},
    blur: () => {},
    minimize: () => {},
    maximize: () => {},
    unmaximize: () => {},
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
