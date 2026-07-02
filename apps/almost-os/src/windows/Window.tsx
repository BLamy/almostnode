import { useMemo, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { ElectronWindow } from "../apps/electron/ElectronWindow";
import { getApp } from "../os/apps";
import type { AppId } from "../os/types";
import { AppErrorBoundary } from "./AppErrorBoundary";
import { TrafficLights } from "./TrafficLights";
import { WindowProvider, type WindowHandle } from "./WindowContext";
import { useWindowManager } from "./WindowManager";
import { DOCK_RESERVE, MENUBAR_HEIGHT, type WindowState } from "./window-store";

const DEFAULT_MIN = { width: 320, height: 200 };

type ResizeDir = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

interface WindowProps {
  win: WindowState;
  focused: boolean;
}

export function Window({ win, focused }: WindowProps) {
  const wm = useWindowManager();
  const ref = useRef<HTMLDivElement>(null);
  // Frame windows (Electron BrowserWindows) render an iframe, not a dock app.
  const app = win.frame ? null : getApp(win.appId as AppId);
  const minSize = win.minSize ?? app?.minSize ?? DEFAULT_MIN;

  function startDrag(e: ReactPointerEvent<HTMLElement>) {
    if (win.maximized) return;
    if ((e.target as HTMLElement).closest(".os-traffic")) return;
    e.preventDefault();
    wm.focus(win.id);
    const el = ref.current;
    if (!el) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = win.x;
    const origY = win.y;
    el.classList.add("is-dragging");
    // Keep the window's bottom edge above the dock strip; windows taller than
    // the work area pin to the menu bar.
    const maxY = Math.max(MENUBAR_HEIGHT, window.innerHeight - DOCK_RESERVE - win.height);

    const clampY = (y: number) => Math.min(Math.max(MENUBAR_HEIGHT, y), maxY);
    const onMove = (ev: PointerEvent) => {
      const nextX = origX + (ev.clientX - startX);
      const nextY = clampY(origY + (ev.clientY - startY));
      el.style.left = `${nextX}px`;
      el.style.top = `${nextY}px`;
    };
    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      el.classList.remove("is-dragging");
      const nextX = origX + (ev.clientX - startX);
      const nextY = clampY(origY + (ev.clientY - startY));
      wm.move(win.id, nextX, nextY);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  function startResize(dir: ResizeDir) {
    return (e: ReactPointerEvent<HTMLElement>) => {
      if (win.maximized) return;
      e.preventDefault();
      e.stopPropagation();
      wm.focus(win.id);
      const el = ref.current;
      if (!el) return;
      const startX = e.clientX;
      const startY = e.clientY;
      const orig = { x: win.x, y: win.y, width: win.width, height: win.height };
      el.classList.add("is-resizing");

      const compute = (ev: PointerEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let { x, y, width, height } = orig;
        if (dir.includes("e")) width = Math.max(minSize.width, orig.width + dx);
        if (dir.includes("s")) {
          // The bottom edge stops above the dock strip.
          const maxHeight = Math.max(
            minSize.height,
            window.innerHeight - DOCK_RESERVE - orig.y,
          );
          height = Math.min(Math.max(minSize.height, orig.height + dy), maxHeight);
        }
        if (dir.includes("w")) {
          width = Math.max(minSize.width, orig.width - dx);
          x = orig.x + (orig.width - width);
        }
        if (dir.includes("n")) {
          height = Math.max(minSize.height, orig.height - dy);
          y = Math.max(MENUBAR_HEIGHT, orig.y + (orig.height - height));
        }
        return { x, y, width, height };
      };
      const onMove = (ev: PointerEvent) => {
        const r = compute(ev);
        el.style.left = `${r.x}px`;
        el.style.top = `${r.y}px`;
        el.style.width = `${r.width}px`;
        el.style.height = `${r.height}px`;
      };
      const onUp = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        el.classList.remove("is-resizing");
        wm.resize(win.id, compute(ev));
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    };
  }

  const dirs: ResizeDir[] = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

  const handle = useMemo<WindowHandle>(
    () => ({
      id: win.id,
      frameless: !!win.frameless,
      close: () => wm.close(win.id),
      minimize: () => wm.minimize(win.id),
      focus: () => wm.focus(win.id),
    }),
    [wm, win.id, win.frameless],
  );

  return (
    <div
      ref={ref}
      className={[
        "os-window",
        focused ? "is-focused" : "",
        win.minimized ? "is-minimized" : "",
        win.maximized ? "is-maximized" : "",
        win.frameless ? "is-frameless" : "",
        win.overlay ? "is-overlay" : "",
        win.transparent ? "is-transparent" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        left: win.x,
        top: win.y,
        width: win.width,
        height: win.height,
        zIndex: win.z,
      }}
      onPointerDown={() => wm.focus(win.id)}
      role="dialog"
      aria-label={win.title}
      data-window-id={win.id}
      data-app-id={win.frame?.appId ?? win.appId}
    >
      {!win.frameless && (
        <header className="os-window__titlebar" onPointerDown={startDrag} onDoubleClick={() => wm.toggleMaximize(win.id)}>
          <TrafficLights
            onClose={() => wm.close(win.id)}
            onMinimize={() => wm.minimize(win.id)}
            onZoom={() => wm.toggleMaximize(win.id)}
          />
          <div className="os-window__title">{win.title}</div>
          <div className="os-window__titlebar-spacer" />
        </header>
      )}
      <div className="os-window__body">
        <WindowProvider value={handle}>
          <AppErrorBoundary appName={win.title || app?.name || "App"} onClose={() => wm.close(win.id)}>
            {win.frame ? <ElectronWindow win={win} focused={focused} /> : app ? <app.component /> : null}
          </AppErrorBoundary>
        </WindowProvider>
      </div>
      {!win.maximized &&
        !win.overlay &&
        win.resizable !== false &&
        dirs.map((dir) => (
          <div
            key={dir}
            className={`os-resize os-resize--${dir}`}
            onPointerDown={startResize(dir)}
          />
        ))}
    </div>
  );
}
