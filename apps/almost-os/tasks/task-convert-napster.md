# Task: Convert Napster to an Electron app

**Priority:** P3 · **Area:** almost-os · **Deps:** electron-menu-seam, menubar-menus, electron-window-options, electron-app-packaging, dock-electron-integration

## Goal

Napster runs as an emulated Electron app (`electron /Applications/napster`) with a real application menu, instead of a bundled native React component.

## Key facts

- The `electron <dir>` runtime **shares the workspace VFS** — the app can read/write `/home/user/Desktop/Napster Downloads` directly via `fs`.
- Main processes run same-context — `globalThis.almostOS.soundcloud.getIdToken()` is directly callable (precedent: the napster CLI, `packages/almostnode/src/shims/soundcloud-command.ts:35`).
- Renderer iframes are same-origin; renderer fetches the SoundCloud gateway (`https://napster.brett-lamy.workers.dev`) directly (CORS already proven from the desktop origin).
- No npm install step → renderer is vanilla TS + DOM. Port `NapsterApp.tsx` UI (~460 lines JSX) + its CSS verbatim.

## Structure (`src/electron-apps/napster/`)

- `package.json` `{ name: "napster", main: "main.js", version: "1.0.0" }`
- `main.js`: `BrowserWindow({width:1000, height:680, minWidth:720, minHeight:460, webPreferences:{preload}})`; `loadURL(process.env.ELECTRON_RENDERER_URL)`; `Menu.setApplicationMenu` (File: New Search ⌘F → `webContents.send('menu:view','search')`, Close role; View: Home/My Library; Help). IPC handlers:
  - `auth:token` → `globalThis.almostOS.soundcloud.getIdToken()`
  - `library:list` → `fs.readdirSync('/home/user/Desktop/Napster Downloads')` + parse `NAPSTER-VMP3/1` payloads
  - `library:download(track)` → `fs.writeFileSync` VMP3 (duplicate ~20 lines encode/filename from `src/media/virtual-mp3.ts`)
  - `player:play(payload)` → write `/home/user/.winamp/command.json` `{id: crypto.randomUUID(), action:'play', url, title, artist}` (existing CLI protocol consumed by host player-store)
  - `fs.watch` downloads dir → `webContents.send('library:changed')`
- `preload.js`: `contextBridge.exposeInMainWorld('napster', {...})`
- `src/renderer/`: vanilla-TS port of the Napster UI (search/home/top-10/library views, download→play button behavior from task-napster-play-button).

## Host cleanup

Remove `napster` from `AppId`/`APPS`/`DOCK_APP_ORDER` (`src/os/types.ts`, `src/os/apps.tsx`); add `ELECTRON_APPS.napster`; delete `src/apps/napster/NapsterApp.tsx` after the port; keep `src/media/soundcloud-api.ts` (WinampApp Add-URL still uses `resolveTrack`). TypeScript will surface all `openApp("napster")` call sites.

## Verification

Dock click installs+launches; search/download/play flows work end-to-end (download appears in Finder's Napster Downloads, Play routes to Winamp via command.json); menus render and dispatch; File→Close/Quit behave; `napster` CLI download still interops (same VMP3 format).
