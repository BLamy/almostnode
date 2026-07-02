# Task: Real MenuBar dropdowns driven by the menu seam

**Priority:** P2 · **Area:** almost-os · **Deps:** electron-menu-seam

## Problem

`MenuBar.tsx` renders `APP_MENUS = ["File","Edit","View","Window","Help"]` as dead buttons (:75-79). Menus published by emulated Electron apps must render as real dropdowns, switch with window focus, and dispatch clicks back to the app.

## Changes

1. **New `src/desktop/menu-store.ts`** (useSyncExternalStore pattern, precedent: player-store):
   `setElectronAppMenu(appInstanceId, menu|null)`, `getMenuForAppInstance(id)`, `useMenuStoreVersion()`.
2. **`src/apps/electron/electron-desktop.ts`**:
   - `electronDesktopHost.setApplicationMenu = (id, menu) => setElectronAppMenu(id, menu)`.
   - `WindowRecord` + openWindow payload gain `appInstanceId?/appId?` from options; forward into the frame payload.
   - New `notifyFocusChanged(electronId, focused)` → fires the (currently never-fired) `'focus'`/`'blur'` host events so `BrowserWindow.getFocusedWindow()` is correct for menu clicks.
3. **`src/windows/window-store.ts` + `WindowManager.tsx`**: `FrameWindow` gains `appInstanceId?: number; appId?: string` (threaded through openWindow action).
4. **`src/windows/Window.tsx` + `src/apps/electron/ElectronWindow.tsx`**: pass `focused` prop; effect calls `notifyFocusChanged`.
5. **`src/desktop/MenuBar.tsx` + `os.css`**: replace dead buttons with `<AppMenus>` consuming a `ResolvedMenu { appName, items: SerializedMenuItem[], onCommand }`. macOS semantics (reuse the Apple-menu/TailscaleMenu dropdown patterns already in the file): click title opens; hover switches open menus; submenus fly out; separators, checkmarks, right-aligned accelerator glyphs (`CmdOrCtrl+S` → `⌘S` formatter), disabled styling; item click → `onCommand(id)` + close; Esc/outside-click closes. New classes `.os-menubar__dropdown`, `.os-menubar__menu-item`, `.os-menubar__submenu`.
6. **`src/desktop/Desktop.tsx`**: replace the `activeApp` computation (:106-112) with menu resolution: focused frame window → `getMenuForAppInstance(frame.appInstanceId)` else `DEFAULT_APP_MENU(appName)`; native window → `APPS[appId].menu` (next task) else default; none → Finder default. Ship `DEFAULT_APP_MENU` in new `src/desktop/default-menu.ts` (File/Edit/View/Window/Help, mostly disabled; Close/Quit wired to wm).

Keyboard accelerator *dispatch* (global keydown) is out of scope — display only.

## Verification

- Launch App Store pomodoro (or any app calling `Menu.setApplicationMenu`) → its menus render; clicking an item triggers the app's click handler; File→Quit (role) closes the app.
- Focus switching between an Electron window and Finder swaps the menus; no focused window → Finder default menu.
- `pnpm --filter almost-os type-check`.
