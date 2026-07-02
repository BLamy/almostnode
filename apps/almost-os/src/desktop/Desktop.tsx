import { useEffect, useMemo, useRef, useState } from "react";
import { ChatPopover } from "../chat/ChatPopover";
import { KeychainProvider } from "../keychain/keychain-store";
import { chromeStore } from "../apps/chrome/chrome-store";
import { terminalBus } from "../apps/terminal/terminal-bus";
import { ElectronContextMenuHost } from "../apps/electron/ElectronContextMenuHost";
import { ElectronDialogHost } from "../apps/electron/ElectronDialogHost";
import { ElectronHostBridge } from "../apps/electron/ElectronHostBridge";
import { applyAppearance } from "../os/appearance";
import { APPS } from "../os/apps";
import type { AppId } from "../os/types";
import { SystemProvider, type SystemActions } from "../os/system";
import { OsRuntimeProvider, useOsRuntime } from "../runtime/OsRuntimeProvider";
import { PlayerHost } from "../media/PlayerHost";
import { playVirtualMp3 } from "../media/player-store";
import { isVirtualMp3Path, readVirtualMp3 } from "../media/virtual-mp3";
import { resolveVirtualMediaTarget, targetToVirtualMp3 } from "../media/virtual-url-map";
import { Window } from "../windows/Window";
import { WindowManagerProvider, useWindowManager } from "../windows/WindowManager";
import { buildDefaultMenu } from "./default-menu";
import { DesktopIcons } from "./DesktopIcons";
import { Dock } from "./Dock";
import { getMenuForAppInstance, useMenuStoreVersion, type ResolvedMenu } from "./menu-store";
import { LiquidGlassBackdrop } from "./LiquidGlassBackdrop";
import { LiquidGlassFilters } from "./LiquidGlassFilters";
import { MenuBar } from "./MenuBar";

// Real edge-refraction liquid glass on the AI drawer's backdrop (module-const so
// the effect isn't torn down each render).
const CHAT_GLASS_FROST = "blur(7px) saturate(190%) brightness(1.03)";
const CHAT_GLASS_OPTIONS = {
  radius: 30,
  strength: 0.12,
  chromaticAberration: 0.22,
  depth: 18,
  curvature: 0.7,
  glow: 0.08,
  edgeHighlight: 0.35,
  edgeWidth: 6,
  specular: 1,
  blur: 0,
} as const;
import { resolveNativeMenu } from "./native-menu";
import { Wallpaper } from "./Wallpaper";
import { winampStore } from "../apps/winamp/winamp-store";

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
        const virtualMedia = resolveVirtualMediaTarget(path, workspace.vfs);
        if (virtualMedia?.kind === "webamp-skin") {
          winampStore.setSkin(virtualMedia.url, virtualMedia.name);
          wm.openApp(APPS.winamp);
          return;
        }
        const virtualTrack = virtualMedia ? targetToVirtualMp3(virtualMedia) : null;
        if (virtualTrack) {
          playVirtualMp3(virtualTrack);
          wm.openApp(APPS.winamp);
          return;
        }
        if (isVirtualMp3Path(path)) {
          const payload = readVirtualMp3(path);
          if (payload) {
            playVirtualMp3(payload);
            wm.openApp(APPS.winamp);
            return;
          }
        }
        if (path.toLowerCase().endsWith(".wsz")) {
          try {
            const bytes = workspace.vfs.readFileSync(path);
            winampStore.setSkinFromBytes(
              typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes,
              path.split("/").pop(),
            );
            wm.openApp(APPS.winamp);
            return;
          } catch {
            /* fall through to Code */
          }
        }
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

  // Resolve the focused window's menu: Electron seam menu → native
  // AppDefinition.menu → default fallback.
  const menuVersion = useMenuStoreVersion();
  const menu = useMemo(() => {
    if (!focused) return buildDefaultMenu("Finder");
    const windowActions = {
      close: () => wm.close(focused.id),
      minimize: () => wm.minimize(focused.id),
      zoom: () => wm.toggleMaximize(focused.id),
    };
    if (focused.frame) {
      const electronMenu = getMenuForAppInstance(focused.frame.appInstanceId);
      if (electronMenu) return electronMenu;
      return buildDefaultMenu(focused.title || "Electron", windowActions);
    }
    const app = APPS[focused.appId as AppId];
    const fallback = buildDefaultMenu(app.name, windowActions);
    if (!app.menu) return fallback;
    const native = resolveNativeMenu(app.name, app.menu({ system }));
    // Append standard Window/Help menus unless the app defines its own.
    const nativeLabels = new Set(native.items.map((item) => item.label));
    const extras = fallback.items.filter(
      (item) => !nativeLabels.has(item.label) && ["Window", "Help"].includes(item.label),
    );
    const merged: ResolvedMenu = {
      appName: app.name,
      items: [...native.items, ...extras],
      onCommand: (commandId) => {
        native.onCommand(commandId);
        fallback.onCommand(commandId);
      },
    };
    return merged;
    // menuVersion re-resolves after every Electron menu (re)publish.
  }, [focused, wm, system, menuVersion]);

  return (
    <SystemProvider value={system}>
      <ElectronHostBridge />
      <LiquidGlassFilters />
      <LiquidGlassBackdrop
        selector=".os-chat"
        frost={CHAT_GLASS_FROST}
        options={CHAT_GLASS_OPTIONS}
      />
      <div className="os-desktop">
        <Wallpaper />
        <MenuBar
          menu={menu}
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
        <ElectronDialogHost />
        <ElectronContextMenuHost />
        <Dock />
      </div>
    </SystemProvider>
  );
}
