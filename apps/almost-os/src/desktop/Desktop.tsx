import { useEffect, useMemo, useRef, useState } from "react";
import { ChatPopover } from "../chat/ChatPopover";
import { KeychainProvider } from "../keychain/keychain-store";
import { chromeStore } from "../apps/chrome/chrome-store";
import { terminalBus } from "../apps/terminal/terminal-bus";
import { ElectronHostBridge } from "../apps/electron/ElectronHostBridge";
import { applyAppearance } from "../os/appearance";
import { APPS } from "../os/apps";
import type { AppId } from "../os/types";
import { SystemProvider, type SystemActions } from "../os/system";
import { OsRuntimeProvider, useOsRuntime } from "../runtime/OsRuntimeProvider";
import { PlayerHost } from "../media/PlayerHost";
import { Window } from "../windows/Window";
import { WindowManagerProvider, useWindowManager } from "../windows/WindowManager";
import { DesktopIcons } from "./DesktopIcons";
import { Dock } from "./Dock";
import { MenuBar } from "./MenuBar";
import { Wallpaper } from "./Wallpaper";

export function Desktop() {
  return (
    <OsRuntimeProvider>
      <WindowManagerProvider>
        <KeychainProvider>
          <DesktopShell />
        </KeychainProvider>
      </WindowManagerProvider>
    </OsRuntimeProvider>
  );
}

function DesktopShell() {
  const wm = useWindowManager();
  const { workspace } = useOsRuntime();
  const [chatOpen, setChatOpen] = useState(false);
  const didAutoOpen = useRef(false);

  // Push the stored accent + light/dark onto the document root on boot.
  useEffect(() => {
    applyAppearance();
  }, []);

  // Open a Terminal once on first boot so the desktop isn't empty.
  useEffect(() => {
    if (didAutoOpen.current) return;
    didAutoOpen.current = true;
    wm.openApp(APPS.terminal);
  }, [wm]);

  const system = useMemo<SystemActions>(
    () => ({
      openApp: (id) => wm.openApp(APPS[id]),
      openFile: (path) => {
        workspace.setCurrentFile(path);
        wm.openApp(APPS.code);
      },
      runInTerminal: (command) => {
        terminalBus.run(command);
        wm.openApp(APPS.terminal);
      },
      openUrl: (url) => {
        chromeStore.createTab({ url, activate: true });
        wm.openApp(APPS.chrome);
      },
    }),
    [wm, workspace],
  );

  const focused =
    wm.state.windows.find((w) => w.id === wm.state.focusedId && !w.minimized) ?? null;
  const activeApp = focused
    ? focused.frame
      ? focused.title
      : APPS[focused.appId as AppId].name
    : "Finder";

  return (
    <SystemProvider value={system}>
      <ElectronHostBridge />
      <div className="os-desktop">
        <Wallpaper />
        <MenuBar
          activeApp={activeApp}
          chatOpen={chatOpen}
          onToggleChat={() => setChatOpen((o) => !o)}
        />
        <DesktopIcons />
        <div className="os-window-layer">
          {wm.state.windows.map((win) => (
            <Window key={win.id} win={win} focused={win.id === wm.state.focusedId} />
          ))}
        </div>
        <ChatPopover open={chatOpen} onClose={() => setChatOpen(false)} />
        <PlayerHost />
        <Dock />
      </div>
    </SystemProvider>
  );
}
