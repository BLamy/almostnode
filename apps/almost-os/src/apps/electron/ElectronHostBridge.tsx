import { useEffect, useRef } from "react";
import { setElectronHost } from "@agent-wasm/core";
import { useWindowManager } from "../../windows/WindowManager";
import {
  electronDesktopHost,
  setElectronWindowController,
  type ElectronWindowController,
} from "./electron-desktop";

/**
 * Registers the almost-os Electron host + window controller while the desktop
 * is mounted. Renders nothing. Must live inside <WindowManagerProvider>.
 */
export function ElectronHostBridge() {
  const wm = useWindowManager();
  // Keep the latest WM methods without re-registering the controller.
  const wmRef = useRef(wm);
  wmRef.current = wm;

  useEffect(() => {
    const controller: ElectronWindowController = {
      openWindow: (payload) => wmRef.current.openWindow(payload),
      setWindowUrl: (id, url) => wmRef.current.setWindowUrl(id, url),
      setWindowTitle: (id, title) => wmRef.current.setWindowTitle(id, title),
      close: (id) => wmRef.current.close(id),
      getViewport: () => wmRef.current.viewport,
    };
    setElectronWindowController(controller);
    setElectronHost(electronDesktopHost);
    return () => {
      setElectronWindowController(null);
      setElectronHost(null);
    };
  }, []);

  return null;
}
