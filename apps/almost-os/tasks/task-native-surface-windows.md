# Task: Native surface windows (almost-native:// URLs)

**Priority:** P2 · **Area:** almost-os · **Deps:** electron-window-options

## Problem

A transparent full-work-area Electron window is an iframe — clicks on transparent iframe regions can NEVER pass through to underlying DOM (per-pixel pass-through doesn't exist for iframes). Winamp needs host-DOM rendering to keep click-through, while still being a real Electron app (main process, menus, lifecycle).

Rejected alternatives: iframe hit-test forwarding (fails touch/pen + stationary-cursor, fragile); one BrowserWindow per Webamp sub-window (single React tree/store, weeks of fork surgery).

## Design

`win.loadURL('almost-native://webamp')` — the shim's `translateRendererUrl` only rewrites localhost URLs, so the custom scheme passes through untouched (zero almostnode changes). The host renders a registered React component instead of an iframe; the IPC channel uses the same envelope protocol as `electron-preload.ts`, minus postMessage (plain function calls).

## Changes

1. **New `src/apps/electron/native-surfaces.ts`**:
   ```ts
   interface NativeSurfaceOptions { overlay?: boolean }
   function registerNativeSurface(name, component: ComponentType<{ channel: NativeSurfaceChannel }>, options?): void;
   interface NativeSurfaceChannel {  // ipcRenderer-equivalent, in-page
     invoke(channel, ...args): Promise<unknown>;
     send(channel, ...args): void;
     on(channel, listener): () => void;
   }
   ```
2. **`src/apps/electron/ElectronWindow.tsx`**: if `frame.url` starts with `almost-native:` → render the registered component; back the channel with `attachRenderer`/`emitFromRenderer` directly. Emit `renderer-ready` on mount (so `ready-to-show`/`did-finish-load` fire). Replicate the StrictMode `pendingClose` deferral for the channel attach/detach.
3. When the registration has `overlay: true` and the window was created `frame:false, transparent:true`, render with `.is-frameless.is-overlay` (full work-area click-through).

## Verification

- A trivial test surface (registered component + main.js doing invoke round-trips) works: `ipcMain.handle` responds, `webContents.send` reaches the component, close propagates both ways, StrictMode double-mount doesn't wedge the channel.
- `pnpm --filter almost-os type-check`.
