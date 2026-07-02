# Task: Electron menu seam (framework level)

**Priority:** P2 · **Area:** packages/almostnode · **Deps:** none

## Problem

The electron shim's `Menu.setApplicationMenu(menu)` stores to a module var that nothing reads (`packages/almostnode/src/shims/electron.ts:602-604`); `MenuItem` is inert; there is no seam for a host to render an application menu. This blocks a working macOS menu bar for emulated Electron apps.

## Design

Main processes run in the same browser JS context as the desktop, so menu click callbacks can be plain same-context function calls (no postMessage). Serialize the menu template through a new **optional** `ElectronHost.setApplicationMenu?()`.

## Changes

1. **`src/frameworks/electron-host.ts`**:
   ```ts
   export type SerializedMenuItemType = 'normal' | 'separator' | 'submenu' | 'checkbox' | 'radio';
   export interface SerializedMenuItem {
     commandId: string; type: SerializedMenuItemType; label: string;
     enabled: boolean; visible: boolean; checked?: boolean;
     accelerator?: string; role?: string; submenu?: SerializedMenuItem[];
   }
   export interface ElectronApplicationMenu {
     appInstanceId: number; appId: string; appName: string;
     items: SerializedMenuItem[];
     onCommand: (commandId: string) => void;   // same-context callback into the shim
   }
   export interface ElectronHost {
     createWindow(options: ElectronWindowOptions): ElectronWindowHandle;
     setApplicationMenu?(appInstanceId: number, menu: ElectronApplicationMenu | null): void;
   }
   export function allocateElectronAppInstanceId(): number;  // module counter
   // ElectronWindowOptions += appInstanceId?: number; appId?: string; appName?: string;
   ```
   Headless host: no change needed (method optional).
2. **`src/shims/electron.ts`** — replace inert Menu/MenuItem (:578-608):
   - Real `MenuItem` fields `{id?, label, sublabel, type (inferred), role, accelerator, enabled=true, visible=true, checked=false, click?, submenu?: Menu}` with property setters (enabled/checked/label/visible) that queueMicrotask-debounce a republish when part of the current app menu.
   - `Menu.buildFromTemplate`: recursive; wraps nested arrays; **expands composite roles** (`appMenu`, `fileMenu`, `editMenu`, `viewMenu`, `windowMenu`, `help`) into standard templates like real Electron.
   - `Menu.setApplicationMenu`: walk tree assigning commandIds + `Map<commandId, MenuItem>`; publish `resolveHost().setApplicationMenu?.(appInstanceId, {...})`. `appInstanceId = allocateElectronAppInstanceId()` once per shim; `appId = process.env.ALMOST_ELECTRON_APP_ID ?? app.getName()`.
   - `onCommand(commandId)`: checkbox toggle / radio group select (auto-republish) → role behaviors (`quit`→app.quit(), `close`/`minimize`/`zoom`→focused window, `reload`→webContents.reload(), edit roles → forward to focused renderer via new envelope kind `menu-role`, handled in `electron-preload.ts` with `document.execCommand` best-effort — ship disabled if flaky) → invoke `item.click?.(item, BrowserWindow.getFocusedWindow(), {triggeredByAccelerator:false})`.
   - `BrowserWindow` constructor: add `appInstanceId/appId/appName` to hostOptions (:346-358).
   - `app.quit()`: also resolve an internal `whenQuit` promise (consumed by task electron-window-options) — do NOT `process.exit()` (throws through the host's MenuBar click stack).
3. **Tests** (`tests/electron-shim.test.ts`): fake host capturing `setApplicationMenu`; assert template→serialization shape, commandId click dispatch, checkbox toggle republish, role `quit` closes windows, composite-role expansion.

## Verification

`pnpm nx test almostnode` (new tests), `pnpm nx type-check almostnode`. No host required — the method is optional, existing App Store apps unaffected.
