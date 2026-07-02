import { useEffect, useRef } from "react";
import type { WindowState } from "../../windows/window-store";
import {
  attachRenderer,
  emitFromRenderer,
  notifyBoundsChanged,
  notifyClosed,
  notifyFocusChanged,
} from "./electron-desktop";
import { NativeSurfaceHost } from "./NativeSurfaceHost";
import { isNativeSurfaceUrl } from "./native-surfaces";

/**
 * Body of an Electron BrowserWindow: an iframe pointed at the renderer's
 * (virtual) URL, bridged to the main process via postMessage. Geometry, title
 * bar and traffic lights are provided by the surrounding WindowManager
 * `Window` shell.
 */
export function ElectronWindow({ win, focused }: { win: WindowState; focused: boolean }) {
  const frame = win.frame;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const electronWindowId = frame?.electronWindowId;
  // `almost-native://<name>` renders a registered host component instead of an
  // iframe (NativeSurfaceHost owns its own attach/close lifecycle).
  const nativeSurface = isNativeSurfaceUrl(frame?.url);
  // Pending "closed" signal — deferred so React StrictMode's dev-only
  // mount→cleanup→mount doesn't tear down the window (and delete its IPC
  // record). A real unmount lets the timeout fire; a remount cancels it.
  const pendingClose = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Mirror WindowManager focus onto the main process ('focus'/'blur' events;
  // keeps BrowserWindow.getFocusedWindow() truthful for menu dispatch).
  useEffect(() => {
    if (electronWindowId === undefined) return;
    notifyFocusChanged(electronWindowId, focused);
  }, [electronWindowId, focused]);

  // Back-propagate WM geometry (drag/resize/maximize/setBounds) so the main
  // process's getBounds() is truthful and 'move'/'resize' events fire.
  useEffect(() => {
    if (electronWindowId === undefined) return;
    notifyBoundsChanged(electronWindowId, {
      x: win.x,
      y: win.y,
      width: win.width,
      height: win.height,
    });
  }, [electronWindowId, win.x, win.y, win.width, win.height]);

  useEffect(() => {
    if (electronWindowId === undefined || nativeSurface) return;
    const iframe = iframeRef.current;
    if (!iframe) return;

    if (pendingClose.current !== null) {
      clearTimeout(pendingClose.current);
      pendingClose.current = null;
    }

    // main -> renderer: post into the iframe's window.
    const deliver = (message: unknown) => {
      iframe.contentWindow?.postMessage(message, "*");
    };
    const detach = attachRenderer(electronWindowId, deliver);

    // renderer -> main: forward messages originating from this iframe.
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      emitFromRenderer(electronWindowId, event.data);
    };
    window.addEventListener("message", onMessage);

    return () => {
      window.removeEventListener("message", onMessage);
      detach();
      // Defer: a StrictMode remount clears this before it fires; a genuine
      // window close (traffic-light or host-driven) lets it run.
      pendingClose.current = setTimeout(() => notifyClosed(electronWindowId), 0);
    };
  }, [electronWindowId, nativeSurface]);

  if (!frame) return null;

  if (nativeSurface && electronWindowId !== undefined) {
    return <NativeSurfaceHost electronId={electronWindowId} url={frame.url} />;
  }

  return (
    <iframe
      ref={iframeRef}
      src={frame.url}
      title={win.title}
      allow="clipboard-read; clipboard-write"
      style={{
        width: "100%",
        height: "100%",
        border: "none",
        display: "block",
        background: "#fff",
      }}
    />
  );
}
