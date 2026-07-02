# Task: Convert Tailscale to an Electron app (+ almostnode:network builtin)

**Priority:** P3 · **Area:** packages/almostnode + almost-os · **Deps:** electron-menu-seam, menubar-menus, electron-window-options, electron-app-packaging, dock-electron-integration

## Goal

The Tailscale app runs as an emulated Electron app; the network controller becomes reachable from inside any app runtime via a first-class builtin (lowest-level change per project policy).

## Framework change (packages/almostnode)

New builtin virtual module **`require('almostnode:network')`**:
- `src/shims/almostos-network.ts` — `createNetworkModule()` returning `{ getStatus, subscribe, configure, login, logout }`, a thin wrapper over `getDefaultNetworkController()` (the workspace controller IS the default: `container.ts:188` calls `setDefaultNetworkController`).
- Register in the per-runtime builtins map in `runtime.ts` (~:1831, precedent: `electron`, `chokidar`). Unit test.
- (Rejected alternative: shelling to the `tailscale` CLI — loses `subscribe`, forces polling.)

## App structure (`src/electron-apps/tailscale/`)

- `main.js`: window 460×560 min 380×420. ipcMain: `net:status/net:connect/net:disconnect/net:exit-node/config:get/config:set`; push `net:status` events via `webContents.send` from `subscribe`. Connect mirrors `use-network.ts`: `configure({provider:'tailscale', authMode:'interactive', controlUrl})` then `login()`; disconnect: `logout()` then `configure({provider:'browser', corsProxy:'/__api/cors-proxy?url='})`. Config persisted to `app.getPath('userData')/config.json` (replaces localStorage). Application menu: Tailscale (Connect/Disconnect, Exit Node radio submenu rebuilt on status change via fresh `Menu.setApplicationMenu`).
- `preload.js` + `src/renderer/`: vanilla-TS port of `TailscaleApp.tsx` + `ts-app` CSS.

## Host cleanup

Remove `tailscale` from `AppId`/`APPS`; add `ELECTRON_APPS.tailscale`. **`TailscaleMenu` in MenuBar and `use-network.ts` stay native and untouched** — they drive the same controller singleton, so state stays consistent between menu-bar status item and app.

## Verification

Dock launch; connect/disconnect works and the menu-bar Tailscale status item reflects it live (same singleton); exit-node radio menu updates; config survives relaunch; `pnpm nx test almostnode` for the builtin.
