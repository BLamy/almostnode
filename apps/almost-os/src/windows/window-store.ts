import type { AppId, Rect } from "../os/types";

export const MENUBAR_HEIGHT = 28;
export const DOCK_RESERVE = 96;

/** Frame windows (e.g. an Electron BrowserWindow) are not dock apps. */
export type WindowAppId = AppId | "electron";

/** Payload for a generic iframe-backed ("frame") window. */
export interface FrameWindow {
  /** Electron BrowserWindow id this frame renders. */
  electronWindowId: number;
  /** URL the iframe is pointed at (updated by loadURL). */
  url: string;
  /** Owning Electron app instance (menu association). */
  appInstanceId?: number;
  /** Owning app id (dock association, e.g. "napster"). */
  appId?: string;
}

export interface WindowState extends Rect {
  id: string;
  appId: WindowAppId;
  title: string;
  z: number;
  minimized: boolean;
  maximized: boolean;
  /** Saved rect to restore to when un-maximizing. */
  restoreRect?: Rect;
  /** Present when this is an iframe-backed frame window (not a dock app). */
  frame?: FrameWindow;
  /** Render with no OS chrome — the app draws its own header (e.g. Winamp). */
  frameless?: boolean;
  /** Fill the work area with a click-through container (Webamp-style). */
  overlay?: boolean;
  /** Transparent window body (no background). */
  transparent?: boolean;
  /** Resize handles disabled when false. */
  resizable?: boolean;
  /** Per-window minimum size (falls back to the app's minSize). */
  minSize?: { width: number; height: number };
}

export interface WMState {
  windows: WindowState[];
  focusedId: string | null;
  nextZ: number;
  counter: number;
}

export const initialWMState: WMState = {
  windows: [],
  focusedId: null,
  nextZ: 1,
  counter: 0,
};

export type WMAction =
  | {
      type: "open";
      appId: AppId;
      title: string;
      size: { width: number; height: number };
      viewport: { width: number; height: number };
      frameless?: boolean;
      overlay?: boolean;
    }
  | {
      type: "openWindow";
      id: string;
      title: string;
      size: { width: number; height: number };
      viewport: { width: number; height: number };
      frame: FrameWindow;
      frameless?: boolean;
      transparent?: boolean;
      resizable?: boolean;
      minSize?: { width: number; height: number };
      /** Explicit top-left position (skips the cascade placement). */
      position?: { x: number; y: number };
    }
  | { type: "setWindowUrl"; id: string; url: string }
  | { type: "setWindowTitle"; id: string; title: string }
  | { type: "close"; id: string }
  | { type: "focus"; id: string }
  | { type: "move"; id: string; x: number; y: number }
  | { type: "resize"; id: string; rect: Rect }
  | {
      type: "setBounds";
      id: string;
      bounds: Partial<Rect>;
      viewport: { width: number; height: number };
    }
  | { type: "minimize"; id: string }
  | { type: "toggleMaximize"; id: string; viewport: { width: number; height: number } }
  | {
      type: "setMaximized";
      id: string;
      maximized: boolean;
      viewport: { width: number; height: number };
    };

function raise(state: WMState, id: string): WMState {
  const z = state.nextZ + 1;
  return {
    ...state,
    nextZ: z,
    focusedId: id,
    windows: state.windows.map((w) => (w.id === id ? { ...w, z, minimized: false } : w)),
  };
}

function clampPosition(
  rect: { width: number; height: number },
  viewport: { width: number; height: number },
  x: number,
  y: number,
): { x: number; y: number } {
  const maxX = Math.max(0, viewport.width - 120);
  // Keep the whole window above the dock strip; a window taller than the
  // work area pins to the menu bar instead.
  const maxY = Math.max(MENUBAR_HEIGHT + 4, viewport.height - DOCK_RESERVE - rect.height);
  return {
    x: Math.min(Math.max(x, -(rect.width - 160)), maxX),
    y: Math.min(Math.max(y, MENUBAR_HEIGHT + 4), maxY),
  };
}

/** Initial rect for a new window: cascade from centre, fitted to the work area. */
function placeNewWindow(
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  counter: number,
): Rect {
  const offset = (counter % 6) * 28;
  const workHeight = Math.max(160, viewport.height - MENUBAR_HEIGHT - DOCK_RESERVE);
  const workWidth = Math.max(320, viewport.width - 48);
  // Fit the default within the work area so large defaults never overflow on
  // smaller viewports (windows stay draggable/resizable from there).
  const width = Math.min(size.width, workWidth);
  const height = Math.min(size.height, workHeight);
  const x = Math.round(Math.max(24, (viewport.width - width) / 2) + offset - 60);
  const y = Math.round(
    Math.max(MENUBAR_HEIGHT + 24, (viewport.height - height) / 2) + offset - 50,
  );
  return { ...clampPosition({ width, height }, viewport, x, y), width, height };
}

export function wmReducer(state: WMState, action: WMAction): WMState {
  switch (action.type) {
    case "open": {
      const existing = state.windows.find((w) => w.appId === action.appId);
      if (existing) {
        return raise(state, existing.id);
      }
      const counter = state.counter + 1;
      const z = state.nextZ + 1;
      const id = `${action.appId}-${counter}`;
      const rect = placeNewWindow(action.size, action.viewport, counter);
      const win: WindowState = {
        id,
        appId: action.appId,
        title: action.title,
        ...rect,
        z,
        minimized: false,
        maximized: false,
        frameless: action.frameless,
        overlay: action.overlay,
      };
      return {
        ...state,
        counter,
        nextZ: z,
        focusedId: id,
        windows: [...state.windows, win],
      };
    }
    case "openWindow": {
      // Frame windows are never deduped — a main process may open several.
      const counter = state.counter + 1;
      const z = state.nextZ + 1;
      const rect = action.position
        ? {
            ...clampPosition(action.size, action.viewport, action.position.x, action.position.y),
            width: action.size.width,
            height: action.size.height,
          }
        : placeNewWindow(action.size, action.viewport, counter);
      const win: WindowState = {
        id: action.id,
        appId: "electron",
        title: action.title,
        ...rect,
        z,
        minimized: false,
        maximized: false,
        frame: action.frame,
        frameless: action.frameless,
        transparent: action.transparent,
        resizable: action.resizable,
        minSize: action.minSize,
      };
      return {
        ...state,
        counter,
        nextZ: z,
        focusedId: action.id,
        windows: [...state.windows, win],
      };
    }
    case "setWindowUrl":
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id && w.frame
            ? { ...w, frame: { ...w.frame, url: action.url } }
            : w,
        ),
      };
    case "setWindowTitle":
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, title: action.title } : w,
        ),
      };
    case "close": {
      const windows = state.windows.filter((w) => w.id !== action.id);
      const focusedId =
        state.focusedId === action.id
          ? windows.reduce<WindowState | null>((top, w) => (!top || w.z > top.z ? w : top), null)?.id ?? null
          : state.focusedId;
      return { ...state, windows, focusedId };
    }
    case "focus":
      return raise(state, action.id);
    case "move":
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, x: action.x, y: action.y } : w,
        ),
      };
    case "resize":
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, ...action.rect } : w,
        ),
      };
    case "setBounds":
      return {
        ...state,
        windows: state.windows.map((w) => {
          if (w.id !== action.id) return w;
          const next = { ...w, ...action.bounds };
          return { ...next, ...clampPosition(next, action.viewport, next.x, next.y) };
        }),
      };
    case "minimize":
      return {
        ...state,
        focusedId: state.focusedId === action.id ? null : state.focusedId,
        windows: state.windows.map((w) =>
          w.id === action.id ? { ...w, minimized: true } : w,
        ),
      };
    case "toggleMaximize": {
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? applyMaximize(w, !w.maximized, action.viewport) : w,
        ),
      };
    }
    case "setMaximized":
      return {
        ...state,
        windows: state.windows.map((w) =>
          w.id === action.id ? applyMaximize(w, action.maximized, action.viewport) : w,
        ),
      };
    default:
      return state;
  }
}

function applyMaximize(
  w: WindowState,
  maximized: boolean,
  viewport: { width: number; height: number },
): WindowState {
  if (maximized === w.maximized) return w;
  if (!maximized) {
    if (!w.restoreRect) return { ...w, maximized: false };
    const { restoreRect, ...rest } = w;
    return { ...rest, ...restoreRect, maximized: false };
  }
  return {
    ...w,
    maximized: true,
    restoreRect: { x: w.x, y: w.y, width: w.width, height: w.height },
    x: 0,
    y: MENUBAR_HEIGHT,
    width: viewport.width,
    height: viewport.height - MENUBAR_HEIGHT - DOCK_RESERVE,
  };
}

export { clampPosition };
