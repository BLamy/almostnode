# Task: Electron window options (frame/transparent/bounds) + quit lifecycle

**Priority:** P2 · **Area:** packages/almostnode + almost-os · **Deps:** none

## Problem

`ElectronWindowOptions` has no `frame`/`transparent`; almost-os forwards only title+size (drops x/y/min/resizable); handle methods (`show/hide/focus/minimize/maximize/setBounds`) are dead stubs; host→shim focus/move/resize events never fire; `app.quit()` leaves the `electron` command's session alive.

## Changes

1. **`packages/almostnode/src/frameworks/electron-host.ts`**: `ElectronWindowOptions += frame?: boolean; transparent?: boolean`.
2. **`packages/almostnode/src/shims/electron.ts`**: `BrowserWindowConstructorOptions` += same; pass through (:346-358).
3. **Quit lifecycle**: `ElectronAppInstance` gains `whenQuit: Promise<number>`; `launchElectronApp` (frameworks/electron-app.ts) obtains the runtime's electron shim (add a small `Runtime.getBuiltin(name)` accessor in runtime.ts) and resolves on app `'quit'`. `electron` command (child_process.ts:2900) → `await Promise.race([waitForAbort(signal), app.whenQuit])` then cleanup.
4. **`apps/almost-os/src/apps/electron/electron-desktop.ts`**: forward `frameless` (options.frame === false), `transparent`, `minSize`, `position` (x/y when both given), `resizable` in the openWindow payload. Wire dead handle methods: `setBounds`→new `controller.setWindowBounds`→wm resize/move; `minimize`→wm.minimize; `focus`→wm.focus; `maximize/unmaximize`→wm.toggleMaximize; `show/hide`→minimized toggle. Back-propagate: on wm move/resize of a frame window update `rec.bounds` + fire `'move'/'resize'` host events so `getBounds()` is truthful.
5. **`apps/almost-os/src/windows/window-store.ts` + `WindowManager.tsx` + `Window.tsx`**: `WindowState += transparent?/resizable?/minSize?`; honor explicit position instead of cascade; `minSize = win.minSize ?? app?.minSize ?? DEFAULT_MIN`; skip resize handles when `resizable === false`; `.is-transparent` class.
6. **CSS split (`os.css:727-748`)**: `.is-frameless` = no chrome, keeps its rect (what generic `frame:false` windows get); NEW `.is-overlay` = full work-area + pointer-events:none (opt-in, host-side only). Migrate native Winamp to `frameless: true, overlay: true` (`src/os/apps.tsx`, `src/os/types.ts`) and update the winamp-css-clickthrough selectors if they referenced `.is-frameless` for overlay behavior.

## Verification

- Existing App Store apps (pomodoro/markdownify/sysinfo) still open at their sizes; a test app with `frame:false` renders without OS chrome and keeps its rect; min sizes respected.
- In-app `app.quit()` (menu role or code) ends the `electron` session (terminal command returns).
- Winamp still full-screen click-through via `.is-overlay`. `pnpm nx test almostnode && pnpm --filter almost-os type-check`.
