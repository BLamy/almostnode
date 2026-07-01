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
  | { type: "open"; appId: AppId; title: string; size: { width: number; height: number }; viewport: { width: number; height: number } }
  | {
      type: "openWindow";
      id: string;
      title: string;
      size: { width: number; height: number };
      viewport: { width: number; height: number };
      frame: FrameWindow;
    }
  | { type: "setWindowUrl"; id: string; url: string }
  | { type: "setWindowTitle"; id: string; title: string }
  | { type: "close"; id: string }
  | { type: "focus"; id: string }
  | { type: "move"; id: string; x: number; y: number }
  | { type: "resize"; id: string; rect: Rect }
  | { type: "minimize"; id: string }
  | { type: "toggleMaximize"; id: string; viewport: { width: number; height: number } };

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
  const maxY = Math.max(MENUBAR_HEIGHT, viewport.height - DOCK_RESERVE);
  return {
    x: Math.min(Math.max(x, -(rect.width - 160)), maxX),
    y: Math.min(Math.max(y, MENUBAR_HEIGHT + 4), maxY),
  };
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
      // Cascade new windows from a sensible centred-ish origin.
      const offset = (counter % 6) * 28;
      const x = Math.round(
        Math.max(24, (action.viewport.width - action.size.width) / 2) + offset - 60,
      );
      const y = Math.round(
        Math.max(MENUBAR_HEIGHT + 24, (action.viewport.height - action.size.height) / 2) +
          offset -
          50,
      );
      const win: WindowState = {
        id,
        appId: action.appId,
        title: action.title,
        x,
        y,
        width: action.size.width,
        height: action.size.height,
        z,
        minimized: false,
        maximized: false,
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
      const offset = (counter % 6) * 28;
      const x = Math.round(
        Math.max(24, (action.viewport.width - action.size.width) / 2) + offset - 60,
      );
      const y = Math.round(
        Math.max(MENUBAR_HEIGHT + 24, (action.viewport.height - action.size.height) / 2) +
          offset -
          50,
      );
      const win: WindowState = {
        id: action.id,
        appId: "electron",
        title: action.title,
        x,
        y,
        width: action.size.width,
        height: action.size.height,
        z,
        minimized: false,
        maximized: false,
        frame: action.frame,
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
        windows: state.windows.map((w) => {
          if (w.id !== action.id) return w;
          if (w.maximized && w.restoreRect) {
            const { restoreRect, ...rest } = w;
            return { ...rest, ...restoreRect, maximized: false };
          }
          return {
            ...w,
            maximized: true,
            restoreRect: { x: w.x, y: w.y, width: w.width, height: w.height },
            x: 0,
            y: MENUBAR_HEIGHT,
            width: action.viewport.width,
            height: action.viewport.height - MENUBAR_HEIGHT - DOCK_RESERVE + 28,
          };
        }),
      };
    }
    default:
      return state;
  }
}

export { clampPosition };
