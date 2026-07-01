import { describe, it, expect } from 'vitest';

// Flush pending microtasks + timers so IPC promise chains settle.
const flush = () => new Promise<void>((res) => setTimeout(res, 0));
import { VirtualFS } from '../src/virtual-fs';
import { Runtime } from '../src/runtime';
import { createElectronShim } from '../src/shims/electron';
import {
  ELECTRON_IPC_KIND,
  ELECTRON_IPC_TAG,
  type ElectronHost,
  type ElectronWindowHandle,
  type ElectronWindowOptions,
} from '../src/frameworks/electron-host';

// A controllable in-memory host: windows record what main posts to the
// renderer (`outbound`) and let tests inject renderer->main messages
// (`emitFromRenderer`).
interface FakeWindow extends ElectronWindowHandle {
  outbound: Record<string, unknown>[];
  loadedURL: string | null;
  emitFromRenderer: (message: unknown) => void;
  fireHostEvent: (event: string, ...args: unknown[]) => void;
}

let windowIdCounter = 0;

function createFakeWindow(_options: ElectronWindowOptions): FakeWindow {
  const id = ++windowIdCounter;
  const messageListeners: Array<(message: unknown) => void> = [];
  const hostEvents = new Map<string, Array<(...args: unknown[]) => void>>();
  const outbound: Record<string, unknown>[] = [];
  let destroyed = false;
  const fireHostEvent = (event: string, ...args: unknown[]): void => {
    for (const listener of hostEvents.get(event) ?? []) listener(...args);
  };
  return {
    id,
    outbound,
    loadedURL: null,
    loadURL: async function (this: FakeWindow, url: string) {
      this.loadedURL = url;
    },
    loadFile: async () => {},
    postMessage: (message) => {
      outbound.push(message as Record<string, unknown>);
    },
    onMessage: (listener) => {
      messageListeners.push(listener);
    },
    emitFromRenderer: (message) => {
      for (const listener of messageListeners) listener(message);
    },
    fireHostEvent,
    setTitle: () => {},
    setBounds: () => {},
    getBounds: () => ({ x: 0, y: 0, width: 800, height: 600 }),
    show: () => {},
    hide: () => {},
    focus: () => {},
    blur: () => {},
    minimize: () => {},
    maximize: () => {},
    unmaximize: () => {},
    close: () => {
      if (destroyed) return;
      destroyed = true;
      fireHostEvent('closed');
    },
    isDestroyed: () => destroyed,
    on: (event, listener) => {
      const list = hostEvents.get(event) ?? [];
      list.push(listener);
      hostEvents.set(event, list);
    },
  };
}

function setup() {
  const vfs = new VirtualFS();
  const windows: FakeWindow[] = [];
  const host: ElectronHost = {
    createWindow: (options) => {
      const win = createFakeWindow(options);
      windows.push(win);
      return win;
    },
  };
  const process = { cwd: () => '/', env: {} as Record<string, string | undefined> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const electron = createElectronShim({ vfs, process, getHost: () => host }) as any;
  return { vfs, windows, electron, app: electron.app };
}

describe('electron shim — app lifecycle', () => {
  it('fires ready and resolves whenReady()', async () => {
    const { app } = setup();
    let readyFired = false;
    app.on('ready', () => {
      readyFired = true;
    });
    expect(app.isReady()).toBe(false);
    await app.whenReady();
    expect(readyFired).toBe(true);
    expect(app.isReady()).toBe(true);
  });

  it('maps app.getPath() names onto virtual paths', () => {
    const { app } = setup();
    expect(app.getPath('temp')).toBe('/tmp');
    expect(app.getPath('userData')).toContain('.config');
    expect(() => app.getPath('nonsense')).toThrow();
  });

  it('quit() closes all windows and emits the quit sequence', () => {
    const { app, electron } = setup();
    const order: string[] = [];
    app.on('before-quit', () => order.push('before-quit'));
    app.on('will-quit', () => order.push('will-quit'));
    app.on('quit', () => order.push('quit'));
    const win = new electron.BrowserWindow();
    app.quit();
    expect(win.isDestroyed()).toBe(true);
    expect(order).toEqual(['before-quit', 'will-quit', 'quit']);
  });
});

describe('electron shim — BrowserWindow', () => {
  it('creates a host window and loadURL points it at the URL', async () => {
    const { electron, windows } = setup();
    const win = new electron.BrowserWindow({
      width: 400,
      height: 300,
      webPreferences: { preload: '/preload.js' },
    });
    expect(windows).toHaveLength(1);
    await win.loadURL('http://localhost/app');
    expect(windows[0].loadedURL).toBe('http://localhost/app');
    expect(electron.BrowserWindow.getAllWindows()).toContain(win);
    expect(electron.BrowserWindow.getFocusedWindow()).toBe(win);
  });

  it('closing the last window emits window-all-closed', () => {
    const { app, electron } = setup();
    let allClosed = false;
    app.on('window-all-closed', () => {
      allClosed = true;
    });
    const w1 = new electron.BrowserWindow();
    const w2 = new electron.BrowserWindow();
    w1.close();
    expect(allClosed).toBe(false);
    expect(electron.BrowserWindow.getAllWindows()).toHaveLength(1);
    w2.close();
    expect(allClosed).toBe(true);
    expect(electron.BrowserWindow.getAllWindows()).toHaveLength(0);
  });
});

describe('electron shim — ipcMain', () => {
  it('routes ipcRenderer.invoke to a handler and replies', async () => {
    const { electron, windows } = setup();
    new electron.BrowserWindow();
    electron.ipcMain.handle('ping', (_event: unknown, msg: string) => `pong:${msg}`);

    windows[0].emitFromRenderer({
      [ELECTRON_IPC_TAG]: true,
      kind: ELECTRON_IPC_KIND.invoke,
      id: 7,
      channel: 'ping',
      args: ['hi'],
    });
    // Let the handler's promise chain settle.
    await flush();

    const reply = windows[0].outbound.find(
      (m) => m.kind === ELECTRON_IPC_KIND.invokeReply && m.id === 7,
    );
    expect(reply).toBeDefined();
    expect(reply?.ok).toBe(true);
    expect((reply?.args as unknown[])[0]).toBe('pong:hi');
  });

  it('replies with an error when no handler is registered', async () => {
    const { electron, windows } = setup();
    new electron.BrowserWindow();
    windows[0].emitFromRenderer({
      [ELECTRON_IPC_TAG]: true,
      kind: ELECTRON_IPC_KIND.invoke,
      id: 1,
      channel: 'missing',
      args: [],
    });
    await flush();
    const reply = windows[0].outbound.find(
      (m) => m.kind === ELECTRON_IPC_KIND.invokeReply && m.id === 1,
    );
    expect(reply?.ok).toBe(false);
    expect((reply?.error as { message: string }).message).toContain('missing');
  });

  it('delivers ipcRenderer.send to ipcMain.on listeners', () => {
    const { electron, windows } = setup();
    new electron.BrowserWindow();
    let received: unknown = null;
    electron.ipcMain.on('log', (_event: unknown, payload: unknown) => {
      received = payload;
    });
    windows[0].emitFromRenderer({
      [ELECTRON_IPC_TAG]: true,
      kind: ELECTRON_IPC_KIND.send,
      channel: 'log',
      args: ['hello'],
    });
    expect(received).toBe('hello');
  });

  it('webContents.send posts an event envelope to the renderer', () => {
    const { electron, windows } = setup();
    const win = new electron.BrowserWindow();
    win.webContents.send('update', { n: 1 });
    const evt = windows[0].outbound.find(
      (m) => m.kind === ELECTRON_IPC_KIND.event && m.channel === 'update',
    );
    expect(evt).toBeDefined();
    expect((evt?.args as unknown[])[0]).toEqual({ n: 1 });
  });
});

describe('electron shim — runtime integration', () => {
  it("require('electron') exposes the main-process API", async () => {
    const vfs = new VirtualFS();
    vfs.writeFileSync(
      '/main.js',
      `const e = require('electron');
       module.exports = {
         hasApp: !!e.app,
         browserWindowIsFn: typeof e.BrowserWindow === 'function',
         hasIpcMain: !!e.ipcMain,
       };`,
    );
    const runtime = new Runtime(vfs);
    const { exports } = await runtime.runFile('/main.js');
    expect(exports).toEqual({
      hasApp: true,
      browserWindowIsFn: true,
      hasIpcMain: true,
    });
  });

  it('returns one shared electron module across files (shared ipcMain)', async () => {
    const vfs = new VirtualFS();
    vfs.writeFileSync('/other.js', `module.exports = require('electron').ipcMain;`);
    vfs.writeFileSync(
      '/main.js',
      `const ipc = require('electron').ipcMain;
       const other = require('./other');
       module.exports = ipc === other;`,
    );
    const runtime = new Runtime(vfs);
    const { exports } = await runtime.runFile('/main.js');
    expect(exports).toBe(true);
  });
});
