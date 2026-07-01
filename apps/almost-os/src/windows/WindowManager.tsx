import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";
import type { AppDefinition, Rect } from "../os/types";
import {
  initialWMState,
  wmReducer,
  type FrameWindow,
  type WMState,
} from "./window-store";

interface Viewport {
  width: number;
  height: number;
}

interface WindowManagerValue {
  state: WMState;
  viewport: Viewport;
  openApp: (app: AppDefinition) => void;
  /** Open a generic iframe-backed frame window (e.g. an Electron BrowserWindow). */
  openWindow: (payload: {
    id: string;
    title: string;
    size: { width: number; height: number };
    frame: FrameWindow;
  }) => void;
  setWindowUrl: (id: string, url: string) => void;
  setWindowTitle: (id: string, title: string) => void;
  close: (id: string) => void;
  focus: (id: string) => void;
  minimize: (id: string) => void;
  toggleMaximize: (id: string) => void;
  move: (id: string, x: number, y: number) => void;
  resize: (id: string, rect: Rect) => void;
}

const WindowManagerContext = createContext<WindowManagerValue | null>(null);

function useViewport(): Viewport {
  const [viewport, setViewport] = useState<Viewport>(() => ({
    width: typeof window === "undefined" ? 1440 : window.innerWidth,
    height: typeof window === "undefined" ? 900 : window.innerHeight,
  }));
  useEffect(() => {
    const onResize = () =>
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return viewport;
}

export function WindowManagerProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(wmReducer, initialWMState);
  const viewport = useViewport();

  const value = useMemo<WindowManagerValue>(
    () => ({
      state,
      viewport,
      openApp: (app) =>
        dispatch({
          type: "open",
          appId: app.id,
          title: app.name,
          size: app.defaultSize,
          viewport,
        }),
      openWindow: (payload) =>
        dispatch({
          type: "openWindow",
          id: payload.id,
          title: payload.title,
          size: payload.size,
          frame: payload.frame,
          viewport,
        }),
      setWindowUrl: (id, url) => dispatch({ type: "setWindowUrl", id, url }),
      setWindowTitle: (id, title) => dispatch({ type: "setWindowTitle", id, title }),
      close: (id) => dispatch({ type: "close", id }),
      focus: (id) => dispatch({ type: "focus", id }),
      minimize: (id) => dispatch({ type: "minimize", id }),
      toggleMaximize: (id) => dispatch({ type: "toggleMaximize", id, viewport }),
      move: (id, x, y) => dispatch({ type: "move", id, x, y }),
      resize: (id, rect) => dispatch({ type: "resize", id, rect }),
    }),
    [state, viewport],
  );

  return (
    <WindowManagerContext.Provider value={value}>
      {children}
    </WindowManagerContext.Provider>
  );
}

export function useWindowManager(): WindowManagerValue {
  const value = useContext(WindowManagerContext);
  if (!value) {
    throw new Error("useWindowManager must be used within <WindowManagerProvider>");
  }
  return value;
}

/** Convenience: which app ids currently have a window open. */
export function useOpenAppIds(): Set<string> {
  const { state } = useWindowManager();
  return useMemo(() => new Set(state.windows.map((w) => w.appId)), [state.windows]);
}
