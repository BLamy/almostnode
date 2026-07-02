/**
 * Vite Stopwatch — an **electron-vite**-shaped app, in TypeScript.
 *
 * Mirrors a real electron-vite project to exercise `electron <dir>`'s
 * from-source pipeline end to end:
 *   - `package.json` "main" points at the *unbuilt* `./out/main/index.js`, so
 *     the runtime falls back to the TypeScript source entry (`resolveMainEntry`);
 *   - the main, preload, and renderer are all **TypeScript**, transpiled on the
 *     fly (main + preload through the module loader, renderer via the dev
 *     server), laid out under `src/main`, `src/preload`, `src/renderer`.
 */
export const files: Record<string, string> = {
  'package.json': JSON.stringify(
    {
      name: 'vite-stopwatch',
      version: '1.0.0',
      description: 'An electron-vite stopwatch',
      main: './out/main/index.js',
    },
    null,
    2,
  ),

  'src/main/index.ts': `import { app, BrowserWindow, ipcMain } from 'electron'

function createWindow(): void {
  const win: BrowserWindow = new BrowserWindow({
    width: 380,
    height: 470,
    webPreferences: { preload: '/src/preload/index.ts', contextIsolation: true },
  })
  const url: string | undefined = process.env['ELECTRON_RENDERER_URL']
  if (url) win.loadURL(url)
}

interface AppInfo {
  name: string
  version: string
  platform: string
}

ipcMain.handle('app:info', (): AppInfo => ({
  name: app.getName(),
  version: app.getVersion(),
  platform: process.platform,
}))

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
`,

  'src/preload/index.ts': `import { contextBridge, ipcRenderer } from 'electron'

const api = {
  info: (): Promise<{ name: string; version: string; platform: string }> =>
    ipcRenderer.invoke('app:info'),
}

contextBridge.exposeInMainWorld('vite', api)
`,

  'src/renderer/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Vite Stopwatch</title>
    <style>
      :root { color-scheme: dark; }
      body { margin: 0; }
      #app {
        height: 100vh; display: grid; place-items: center;
        font-family: ui-sans-serif, system-ui, sans-serif; user-select: none;
        background: radial-gradient(120% 120% at 50% 0%, #1e3a8a, #0b1120 65%);
        color: #e2e8f0;
      }
      .card { text-align: center; }
      .badge {
        font-size: 11px; letter-spacing: .25em; text-transform: uppercase;
        color: #93c5fd; margin-bottom: 12px;
      }
      .time { font-size: 66px; font-weight: 700; font-variant-numeric: tabular-nums; }
      .ms { font-size: 26px; opacity: .55; }
      .row { display: flex; gap: 10px; justify-content: center; margin-top: 24px; }
      button {
        border: 0; border-radius: 999px; padding: 11px 22px; font-size: 14px; font-weight: 600;
        cursor: pointer; background: rgba(255,255,255,.1); color: #e2e8f0;
      }
      button.primary { background: #3b82f6; color: #fff; }
      button:active { transform: translateY(1px); }
      .info { margin-top: 22px; font-size: 12px; opacity: .5; }
    </style>
    <script type="module" src="/src/main.ts"></script>
  </head>
  <body>
    <div id="app">
      <div class="card">
        <div class="badge">electron-vite · typescript</div>
        <div class="time"><span id="t">00:00</span><span class="ms" id="ms">.00</span></div>
        <div class="row">
          <button class="primary" id="toggle">Start</button>
          <button id="reset">Reset</button>
        </div>
        <div class="info" id="info">…</div>
      </div>
    </div>
  </body>
</html>
`,

  'src/renderer/src/main.ts': `interface ViteApi {
  info: () => Promise<{ name: string; version: string; platform: string }>
}
declare global {
  interface Window { vite?: ViteApi }
}

const tEl = document.getElementById('t') as HTMLElement
const msEl = document.getElementById('ms') as HTMLElement
const toggleEl = document.getElementById('toggle') as HTMLElement
const resetEl = document.getElementById('reset') as HTMLElement
const infoEl = document.getElementById('info') as HTMLElement

let elapsed = 0
let running = false
let last = 0
let raf = 0

function render(): void {
  const total = Math.floor(elapsed)
  const m = Math.floor(total / 60).toString().padStart(2, '0')
  const s = (total % 60).toString().padStart(2, '0')
  tEl.textContent = m + ':' + s
  msEl.textContent = '.' + Math.floor((elapsed % 1) * 100).toString().padStart(2, '0')
}

function loop(now: number): void {
  if (!running) return
  elapsed += (now - last) / 1000
  last = now
  render()
  raf = requestAnimationFrame(loop)
}

toggleEl.addEventListener('click', () => {
  running = !running
  toggleEl.textContent = running ? 'Pause' : 'Start'
  toggleEl.classList.toggle('primary', !running)
  if (running) {
    last = performance.now()
    raf = requestAnimationFrame(loop)
  } else {
    cancelAnimationFrame(raf)
  }
})

resetEl.addEventListener('click', () => {
  running = false
  elapsed = 0
  cancelAnimationFrame(raf)
  toggleEl.textContent = 'Start'
  toggleEl.classList.add('primary')
  render()
})

render()
if (window.vite) {
  window.vite
    .info()
    .then((i) => {
      infoEl.textContent = i.name + ' v' + i.version + ' · ' + i.platform
    })
    .catch(() => {
      infoEl.textContent = 'electron-vite demo'
    })
}

export {}
`,
};
