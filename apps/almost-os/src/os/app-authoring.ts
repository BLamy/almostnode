/**
 * AI-authored apps (Phase 8): let the agent scaffold a real Electron app that
 * lands in the dock immediately.
 *
 * A spec becomes a minimal but complete Electron app (package.json / main /
 * preload / renderer) written under `/Applications/<id>` via the existing
 * `electron-app-manager` lifecycle, then launched — so it appears in the dock
 * with a running dot (Dock already merges `useRunning()` apps) and can be
 * uninstalled cleanly (Phase 1's reset convention).
 */

import {
  ensureInstalled,
  launch,
  type ManagedElectronApp,
} from "../apps/electron/electron-app-manager";

/** Slugify a name into a dock-safe kebab id, falling back to `app`. */
function toAppId(raw: string): string {
  const kebab = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return kebab || "app";
}

export interface CreateAppSpec {
  /** Kebab id; derived from the name when omitted. */
  id?: string;
  name: string;
  /** Main-window HTML body (renderer). Plain HTML/JS; no build step. */
  html?: string;
  /** Extra files to write, path relative to the app dir → content. */
  files?: Record<string, string>;
  width?: number;
  height?: number;
}

const DEFAULT_HTML = `<!doctype html>
<html>
  <head><meta charset="utf-8" /><title>App</title>
    <style>
      body { font-family: -apple-system, system-ui, sans-serif; margin: 0;
        display: grid; place-items: center; height: 100vh;
        background: #0b0c10; color: #e5e7eb; }
    </style>
  </head>
  <body><h1>Hello from your new app</h1></body>
</html>`;

function mainJs(width: number, height: number): string {
  return `const { app, BrowserWindow } = require("electron");
const path = require("path");
function createWindow() {
  const win = new BrowserWindow({
    width: ${width}, height: ${height},
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  win.loadFile("index.html");
}
app.whenReady().then(createWindow);
app.on("window-all-closed", () => { if (process.platform !== "darwin") app.quit(); });
`;
}

const PRELOAD_JS = `// Bridge surface for the renderer (kept minimal).
window.addEventListener("DOMContentLoaded", () => {});
`;

/** Build the ManagedElectronApp descriptor for a spec (no I/O). */
export function buildManagedApp(spec: CreateAppSpec): ManagedElectronApp {
  const id = toAppId(spec.id ?? spec.name);
  const width = spec.width ?? 640;
  const height = spec.height ?? 480;
  const name = spec.name.trim() || id;
  return {
    id,
    name,
    version: "1.0.0",
    loadFiles: async () => ({
      "package.json": `${JSON.stringify(
        { name: id, version: "1.0.0", main: "main.js", productName: name },
        null,
        2,
      )}\n`,
      "main.js": mainJs(width, height),
      "preload.js": PRELOAD_JS,
      "index.html": spec.html ?? DEFAULT_HTML,
      ...(spec.files ?? {}),
    }),
  };
}

export interface CreateAppResult {
  id: string;
  name: string;
  dir: string;
  launched: boolean;
}

/** Scaffold the app into the VFS and launch it (appears in the dock). */
export async function createApp(spec: CreateAppSpec): Promise<CreateAppResult> {
  const managed = buildManagedApp(spec);
  await ensureInstalled(managed);
  launch(managed);
  return {
    id: managed.id,
    name: managed.name,
    dir: `/Applications/${managed.id}`,
    launched: true,
  };
}
