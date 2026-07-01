import { useEffect, useRef } from "react";
import type { WindowState } from "../../windows/window-store";
import { attachRenderer, emitFromRenderer, notifyClosed } from "./electron-desktop";

/**
 * Body of an Electron BrowserWindow: an iframe pointed at the renderer's
 * (virtual) URL, bridged to the main process via postMessage. Geometry, title
 * bar and traffic lights are provided by the surrounding WindowManager
 * `Window` shell.
 */
export function ElectronWindow({ win }: { win: WindowState }) {
  const frame = win.frame;
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const electronWindowId = frame?.electronWindowId;
  // Pending "closed" signal — deferred so React StrictMode's dev-only
  // mount→cleanup→mount doesn't tear down the window (and delete its IPC
  // record). A real unmount lets the timeout fire; a remount cancels it.
  const pendingClose = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (electronWindowId === undefined) return;
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
  }, [electronWindowId]);

  if (!frame) return null;

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
