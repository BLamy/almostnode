# Task: Dock integration for Electron apps

**Priority:** P2 · **Area:** almost-os · **Deps:** menubar-menus, electron-app-packaging

## Problem

Frame (Electron) windows carry `appId: "electron"` and never dedupe; they have no dock presence. Converted first-party apps (Winamp/Napster/Tailscale) must appear in the dock with icons, running dots, and click-to-focus semantics identical to native apps.

## Changes

1. **New `src/os/electron-apps.ts`**:
   ```ts
   type ElectronAppId = 'napster' | 'tailscale' | 'winamp';
   interface ElectronAppEntry { id; name; icon: ComponentType; appDir: `/Applications/${id}`; loadFiles(); version; }
   export const ELECTRON_APPS: Record<ElectronAppId, ElectronAppEntry>;  // reuse existing icons
   ```
2. **Window→app association**: shim sends `appId` (from `ALMOST_ELECTRON_APP_ID`, set by the manager's `createSession({env})`) through createWindow options → `FrameWindow.appId` (threaded in menubar-menus task).
3. **`src/desktop/Dock.tsx`**: `DOCK_ITEMS: Array<{kind:'native',id:AppId}|{kind:'electron',id:ElectronAppId}>` replaces `DOCK_APP_ORDER`. Running dot: native → `useOpenAppIds()`; electron → manager `useRunning()` OR any window with `frame.appId === id`. Click: native → `wm.openApp`; electron → window with that appId exists → focus/unminimize topmost; else `ensureInstalled` + `launch` (manager running-map prevents double-launch).
4. **`SystemActions.openApp`** widens to `AppId | ElectronAppId`; `Desktop.tsx` routes electron ids to the manager. Update call sites: `Desktop.tsx` openFile ("winamp"), `MenuBar.tsx`/TailscaleMenu ("tailscale").
5. **Active-app label** (`Desktop.tsx`): frame windows → `ELECTRON_APPS[frame.appId]?.name ?? menu appName ?? win.title`.

## Verification

- Dock shows converted apps with icons; click launches (first) / focuses (subsequent); running dot tracks the session; quit from menu frees the dot.
- Clicking dock icon twice never double-launches. Type-check passes.
