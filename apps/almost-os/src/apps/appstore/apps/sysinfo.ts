/**
 * System Info — a tiny "about this app" utility.
 *
 * Inspired by the official Electron contextBridge example (exposing getVersion
 * / ping / dialog through a preload). Exercises app/process APIs, an IPC
 * round-trip, and shell.openExternal.
 */
export const files: Record<string, string> = {
  'package.json': JSON.stringify(
    { name: 'sysinfo', version: '1.2.0', main: 'main.js' },
    null,
    2,
  ),

  'main.js': `const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');

const REPO = 'https://github.com/electron/electron';

ipcMain.handle('sys:info', () => ({
  app: app.getName(),
  version: app.getVersion(),
  platform: process.platform,
  electron: (process.versions && process.versions.electron) || 'emulated',
  node: (process.versions && process.versions.node) || 'n/a',
  userData: app.getPath('userData'),
  now: new Date().toISOString(),
}));
ipcMain.handle('sys:ping', (_event, msg) => 'pong:' + msg);
ipcMain.handle('sys:openRepo', () => shell.openExternal(REPO));

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 460,
    height: 460,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadURL(process.env.ELECTRON_RENDERER_URL);
});

app.on('window-all-closed', () => app.quit());
`,

  'preload.js': `const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sys', {
  getInfo: () => ipcRenderer.invoke('sys:info'),
  ping: (msg) => ipcRenderer.invoke('sys:ping', msg),
  openRepo: () => ipcRenderer.invoke('sys:openRepo'),
});
`,

  'src/renderer/index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>System Info</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; min-height: 100vh; font-family: system-ui, sans-serif; color: #e2e8f0; background: #0b1220; padding: 24px; }
      h1 { font-size: 18px; margin: 0 0 16px; }
      dl { display: grid; grid-template-columns: 120px 1fr; gap: 8px 14px; font-size: 13px; }
      dt { color: #7dd3fc; } dd { margin: 0; font-family: ui-monospace, Menlo, monospace; overflow-wrap: anywhere; }
      .row { margin-top: 20px; display: flex; gap: 10px; align-items: center; }
      button { border: none; border-radius: 8px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; background: #2563eb; color: #fff; }
      button.ghost { background: #1e293b; color: #cbd5e1; }
      #pong { font-family: ui-monospace, Menlo, monospace; color: #34d399; }
    </style>
  </head>
  <body>
    <h1>ℹ️ System Info</h1>
    <dl id="info"></dl>
    <div class="row">
      <button id="ping">Ping main</button>
      <span id="pong"></span>
    </div>
    <div class="row">
      <button class="ghost" id="repo">View Electron on GitHub ↗</button>
    </div>
    <script type="module" src="./main.js"></script>
  </body>
</html>
`,

  'src/renderer/main.js': `const infoEl = document.getElementById('info');
const pongEl = document.getElementById('pong');

window.sys.getInfo().then((info) => {
  infoEl.innerHTML = Object.entries(info)
    .map(([k, v]) => '<dt>' + k + '</dt><dd>' + v + '</dd>')
    .join('');
});

let n = 0;
document.getElementById('ping').addEventListener('click', async () => {
  pongEl.textContent = await window.sys.ping('hello-' + ++n);
});
document.getElementById('repo').addEventListener('click', () => window.sys.openRepo());
`,
};
