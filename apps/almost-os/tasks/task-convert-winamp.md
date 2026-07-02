# Task: Convert Winamp to an Electron app (native surface)

**Priority:** P3 · **Area:** almost-os · **Deps:** webamp-custom-media, electron-window-options, native-surface-windows, electron-app-packaging, dock-electron-integration

## Goal

Winamp becomes a real Electron app (main process owns identity/menus/lifecycle) while Webamp keeps rendering in host DOM so per-pixel click-through keeps working (see task-native-surface-windows for why an iframe can't do this).

## Structure

- `src/electron-apps/winamp/package.json` + `main.js`:
  - `new BrowserWindow({ frame:false, transparent:true, show:true })` + `loadURL('almost-native://webamp')`.
  - `app.on('window-all-closed', () => app.quit())`.
  - Application menu (the visible payoff of the conversion):
    - File: Add URL… → `webContents.send('winamp:add-url')`; Quit (role).
    - Playback: Play/Pause/Stop/Next/Previous → write `/home/user/.winamp/command.json` actions (existing CLI protocol; shared VFS).
    - Options: Skins submenu from `fs.readdirSync('/home/user/Desktop/Winamp Skins')` → `webContents.send('winamp:set-skin', path)`.
- Host: `registerNativeSurface('webamp', WebampSurface, { overlay: true })` where `WebampSurface` = `WinampApp` adapted to take the `NativeSurfaceChannel` prop. It keeps using host modules directly (player-store, soundcloud-api, winamp-store — they MUST stay host-side: the SoundCloud widget iframe/audio live in `PlayerHost` at desktop root) and additionally listens for `winamp:add-url` / `winamp:set-skin`. Webamp's close button → channel close → `'closed'` host event → main quits.
- Transport truth stays in `player-store.ts`; the CLI bridge (`command.json`/`state.json`) is unchanged.

## Host cleanup

Remove `winamp` from `AppId`/`APPS`; add `ELECTRON_APPS.winamp`. `Desktop.tsx` openFile flows (virtual mp3 / .wsz) switch from `wm.openApp(APPS.winamp)` to: write play command / set skin via winampStore, then `manager.launchOrFocus(winampEntry)`.

## Honest scope note

This is a hybrid: the main process is thin and the surface component keeps host coupling. That's deliberate — the alternative (pure iframe) regresses click-through and the free-floating desktop UX.

## Verification

Dock launch → Webamp appears full-work-area with click-through intact (re-run task-winamp-css-clickthrough checks); menus work (Add URL prompt, Playback controls move the actual audio, skin switching); quit via menu frees the dock dot and ends the session; Finder vmp3/wsz double-click still routes correctly; StrictMode double-mount doesn't wedge the channel.
