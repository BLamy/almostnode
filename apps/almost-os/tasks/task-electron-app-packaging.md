# Task: Electron app packaging + app manager

**Priority:** P2 · **Area:** almost-os · **Deps:** none (can land first in the Electron track)

## Problem

Bundled Electron apps are TS modules exporting `files: Record<string,string>` string literals (`src/apps/appstore/apps/*.ts`) — unmaintainable for real apps. Launch logic lives in `appstore-store.ts` and isn't reusable for dock-launched first-party apps.

## Changes

1. **New `src/electron-apps/` directory**: real per-app source dirs (`<id>/package.json`, `main.js`, `preload.js`, `src/renderer/**` — text files only; the in-VFS ViteDevServer transpiles renderer TS). Exclude from the host tsconfig `include` (these compile in the VFS, not the host build). Add a README documenting the layout.
2. **New `src/apps/electron/app-sources.ts`**:
   ```ts
   const sources = import.meta.glob('../../electron-apps/*/**', { query: '?raw', import: 'default' });
   export async function loadAppFiles(id: string): Promise<Record<string, string>>; // strips prefix
   ```
   Lazy + code-split per app (same as catalog `load()`).
3. **New `src/apps/electron/electron-app-manager.ts`** (generalizes `appstore-store.ts`):
   ```ts
   interface ManagedElectronApp { id; name; appDir; loadFiles(); version; }
   ensureInstalled(app)   // (re)writes files when VFS package.json version != bundled
   launch(app)            // terminals.createSession({ env: { ALMOST_ELECTRON_APP_ID: app.id } }); run(`electron ${app.appDir}`)
   launchOrFocus(app, wm); stop(id); isRunning(id); useRunning(): Set<string>
   ```
4. **Refactor `src/apps/appstore/appstore-store.ts`** into a thin wrapper over the manager (store apps also get the env tag).

Note: `electron <dir>` never runs `npm install`, so renderers must be vanilla TS + DOM (no npm React). The runtime shares the workspace VFS; main processes run same-context and can call `globalThis.almostOS.*`.

## Verification

- App Store install/open/stop still works for pomodoro/markdownify/sysinfo.
- A scaffold app in `src/electron-apps/` loads via `loadAppFiles` and launches via the manager (unit test the prefix-stripping; manual launch test).
