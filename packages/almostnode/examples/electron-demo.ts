/**
 * Electron Demo — run a modern (contextIsolation + preload) Electron app from
 * source in the browser.
 *
 * Seeds a minimal electron-vite-style app into the VFS, registers a tiny
 * iframe-backed ElectronHost (the almost-os desktop uses a richer one), and
 * launches it with `launchElectronApp`. The renderer talks to the main process
 * over IPC: `window.api.ping()` -> `ipcMain.handle('ping')`, and a
 * `webContents.send('tick')` event streams back into the page.
 */
import { VirtualFS } from '../src/virtual-fs';
import { Runtime } from '../src/runtime';
import { launchElectronApp } from '../src/frameworks/electron-app';
import {
  setElectronHost,
  type ElectronHost,
  type ElectronWindowHandle,
} from '../src/frameworks/electron-host';

const APP_DIR = '/app';

/** Seed a minimal main + preload + renderer into the VFS. */
export function seedElectronApp(vfs: VirtualFS): void {
  vfs.mkdirSync(`${APP_DIR}/src/renderer`, { recursive: true });

  vfs.writeFileSync(
    `${APP_DIR}/package.json`,
    JSON.stringify({ name: 'electron-demo', version: '1.0.0', main: 'main.js' }, null, 2),
  );

  vfs.writeFileSync(
    `${APP_DIR}/main.js`,
    `const { app, BrowserWindow, ipcMain } = require('electron');

ipcMain.handle('ping', (_event, msg) => 'pong:' + msg);

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 640,
    height: 420,
    webPreferences: { preload: '/app/preload.js', contextIsolation: true },
  });
  win.loadURL(process.env.ELECTRON_RENDERER_URL);
  win.webContents.on('did-finish-load', () => {
    let n = 0;
    setInterval(() => win.webContents.send('tick', ++n), 1000);
  });
});

app.on('window-all-closed', () => app.quit());
`,
  );

  vfs.writeFileSync(
    `${APP_DIR}/preload.js`,
    `const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  ping: (msg) => ipcRenderer.invoke('ping', msg),
  onTick: (cb) => ipcRenderer.on('tick', (_event, n) => cb(n)),
});
`,
  );

  vfs.writeFileSync(
    `${APP_DIR}/src/renderer/index.html`,
    `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Electron Renderer</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 24px; color: #111; }
      h1 { font-size: 20px; }
      #ipc { font-size: 18px; font-weight: 600; }
      .tick { color: #2563eb; }
    </style>
  </head>
  <body>
    <h1>⚛️ Electron renderer (in the browser)</h1>
    <p>IPC round-trip: <span id="ipc" data-ready="0">…</span></p>
    <div id="ticks"></div>
    <script type="module" src="./main.js"></script>
  </body>
</html>
`,
  );

  vfs.writeFileSync(
    `${APP_DIR}/src/renderer/main.js`,
    `const ipc = document.getElementById('ipc');
const ticks = document.getElementById('ticks');

window.api.ping('hello').then((res) => {
  ipc.textContent = res;
  ipc.dataset.ready = '1';
});

window.api.onTick((n) => {
  const line = document.createElement('div');
  line.className = 'tick';
  line.textContent = 'tick ' + n;
  ticks.appendChild(line);
});
`,
  );
}

/**
 * A minimal ElectronHost that renders each BrowserWindow as an iframe appended
 * to `container`, bridging IPC over postMessage.
 */
export function createDemoElectronHost(container: HTMLElement): ElectronHost {
  let idCounter = 0;
  return {
    createWindow(options): ElectronWindowHandle {
      const id = ++idCounter;
      const iframe = document.createElement('iframe');
      iframe.dataset.electronWindow = String(id);
      iframe.style.cssText =
        'width:100%;height:440px;border:1px solid #334155;border-radius:8px;background:#fff';
      container.appendChild(iframe);

      const messageListeners: Array<(message: unknown) => void> = [];
      const closedListeners: Array<() => void> = [];
      const bounds = {
        x: options.x ?? 0,
        y: options.y ?? 0,
        width: options.width ?? 800,
        height: options.height ?? 600,
      };
      const onMessage = (event: MessageEvent) => {
        if (event.source !== iframe.contentWindow) return;
        for (const listener of messageListeners) listener(event.data);
      };
      window.addEventListener('message', onMessage);

      return {
        id,
        loadURL: async (url) => {
          iframe.src = url;
        },
        loadFile: async (path) => {
          iframe.src = path;
        },
        postMessage: (message) => {
          iframe.contentWindow?.postMessage(message, '*');
        },
        onMessage: (listener) => messageListeners.push(listener),
        setTitle: () => {},
        setBounds: (next) => Object.assign(bounds, next),
        getBounds: () => ({ ...bounds }),
        show: () => {},
        hide: () => {},
        focus: () => {},
        blur: () => {},
        minimize: () => {},
        maximize: () => {},
        unmaximize: () => {},
        close: () => {
          window.removeEventListener('message', onMessage);
          iframe.remove();
          for (const listener of closedListeners) listener();
        },
        isDestroyed: () => !iframe.isConnected,
        on: (event, listener) => {
          if (event === 'closed') closedListeners.push(listener as () => void);
        },
      };
    },
  };
}

export interface ElectronDemoHandles {
  vfs: VirtualFS;
  runtime: Runtime;
  rendererUrl: string;
}

/** Boot the demo: seed the app, register the host, launch it. */
export async function initElectronDemo(
  container: HTMLElement,
  log: (message: string) => void = () => {},
): Promise<ElectronDemoHandles> {
  const vfs = new VirtualFS();
  seedElectronApp(vfs);
  log('Seeded electron app into /app');

  const runtime = new Runtime(vfs, {
    cwd: APP_DIR,
    env: { NODE_ENV: 'development' },
    onConsole: (method, args) => log(`[${method}] ${args.map((a) => String(a)).join(' ')}`),
  });

  setElectronHost(createDemoElectronHost(container));
  log('Registered demo Electron host');

  const appInstance = await launchElectronApp(APP_DIR, {
    vfs,
    runtime,
    onLog: (line) => log(line.trim()),
  });
  log(`Renderer dev server: ${appInstance.rendererUrl}`);

  return { vfs, runtime, rendererUrl: appInstance.rendererUrl };
}
