import { describe, it, expect } from 'vitest';

// Flush pending microtasks + timers so IPC promise chains settle.
const flush = () => new Promise<void>((res) => setTimeout(res, 0));
import { VirtualFS } from '../src/virtual-fs';
import { Runtime } from '../src/runtime';
import { createElectronShim } from '../src/shims/electron';
import {
  ELECTRON_IPC_KIND,
  ELECTRON_IPC_TAG,
  type ElectronApplicationMenu,
  type ElectronHost,
  type ElectronWindowHandle,
  type ElectronWindowOptions,
  type SerializedMenuItem,
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
  const windowOptions: ElectronWindowOptions[] = [];
  const publishedMenus: Array<ElectronApplicationMenu | null> = [];
  const host: ElectronHost = {
    createWindow: (options) => {
      const win = createFakeWindow(options);
      windows.push(win);
      windowOptions.push(options);
      return win;
    },
    setApplicationMenu: (_appInstanceId, menu) => {
      publishedMenus.push(menu);
    },
  };
  const process = { cwd: () => '/', env: {} as Record<string, string | undefined> };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const electron = createElectronShim({ vfs, process, getHost: () => host }) as any;
  return {
    vfs,
    windows,
    windowOptions,
    publishedMenus,
    electron,
    app: electron.app,
    lastMenu: () => publishedMenus[publishedMenus.length - 1],
  };
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

  it('emits browser-window-created with the new window when one is created', () => {
    const { app, electron } = setup();
    const created: unknown[] = [];
    app.on('browser-window-created', (_event: unknown, window: unknown) => {
      created.push(window);
    });
    const win = new electron.BrowserWindow({ width: 400, height: 300 });
    expect(created).toHaveLength(1);
    expect(created[0]).toBe(win);
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

describe('electron shim — Menu', () => {
  it('setApplicationMenu publishes a serialized tree through the host', () => {
    const { electron, lastMenu } = setup();
    const menu = electron.Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          { label: 'Open', accelerator: 'CmdOrCtrl+O' },
          { type: 'separator' },
          { label: 'Ticker', type: 'checkbox', checked: true },
        ],
      },
    ]);
    electron.Menu.setApplicationMenu(menu);

    const published = lastMenu();
    expect(published).not.toBeNull();
    expect(published!.appName).toBe('electron-app');
    const file = published!.items[0];
    expect(file.label).toBe('File');
    expect(file.type).toBe('submenu');
    const [open, sep, ticker] = file.submenu!;
    expect(open).toMatchObject({
      label: 'Open',
      type: 'normal',
      enabled: true,
      visible: true,
      accelerator: 'CmdOrCtrl+O',
    });
    expect(open.commandId).toBeTruthy();
    expect(sep.type).toBe('separator');
    expect(ticker).toMatchObject({ type: 'checkbox', checked: true });
  });

  it('dispatches onCommand to the item click handler with the focused window', () => {
    const { electron, lastMenu } = setup();
    const win = new electron.BrowserWindow();
    let clicked: unknown[] = [];
    const menu = electron.Menu.buildFromTemplate([
      {
        label: 'File',
        submenu: [
          {
            label: 'Do Thing',
            click: (...args: unknown[]) => {
              clicked = args;
            },
          },
        ],
      },
    ]);
    electron.Menu.setApplicationMenu(menu);
    const item = lastMenu()!.items[0].submenu![0];
    lastMenu()!.onCommand(item.commandId);
    expect(clicked[0]).toMatchObject({ label: 'Do Thing' });
    expect(clicked[1]).toBe(win);
    expect(clicked[2]).toEqual({ triggeredByAccelerator: false });
  });

  it('does not dispatch clicks on disabled items', () => {
    const { electron, lastMenu } = setup();
    let clicks = 0;
    electron.Menu.setApplicationMenu(
      electron.Menu.buildFromTemplate([
        {
          label: 'File',
          submenu: [{ label: 'Nope', enabled: false, click: () => clicks++ }],
        },
      ]),
    );
    lastMenu()!.onCommand(lastMenu()!.items[0].submenu![0].commandId);
    expect(clicks).toBe(0);
  });

  it('toggles checkboxes and republishes the menu', async () => {
    const { electron, publishedMenus, lastMenu } = setup();
    electron.Menu.setApplicationMenu(
      electron.Menu.buildFromTemplate([
        {
          label: 'View',
          submenu: [{ label: 'Show Ticker', type: 'checkbox', checked: false }],
        },
      ]),
    );
    const before = publishedMenus.length;
    lastMenu()!.onCommand(lastMenu()!.items[0].submenu![0].commandId);
    await flush();
    expect(publishedMenus.length).toBeGreaterThan(before);
    expect(lastMenu()!.items[0].submenu![0].checked).toBe(true);
  });

  it('selects radio items within a contiguous group', async () => {
    const { electron, lastMenu } = setup();
    electron.Menu.setApplicationMenu(
      electron.Menu.buildFromTemplate([
        {
          label: 'Speed',
          submenu: [
            { label: 'Slow', type: 'radio', checked: true },
            { label: 'Fast', type: 'radio', checked: false },
          ],
        },
      ]),
    );
    lastMenu()!.onCommand(lastMenu()!.items[0].submenu![1].commandId);
    await flush();
    const [slow, fast] = lastMenu()!.items[0].submenu!;
    expect(slow.checked).toBe(false);
    expect(fast.checked).toBe(true);
  });

  it('expands composite roles like editMenu and windowMenu', () => {
    const { electron, lastMenu } = setup();
    electron.Menu.setApplicationMenu(
      electron.Menu.buildFromTemplate([{ role: 'editMenu' }, { role: 'windowMenu' }]),
    );
    const [edit, window] = lastMenu()!.items;
    expect(edit.label).toBe('Edit');
    const editLabels = edit.submenu!.map((i: SerializedMenuItem) => i.label);
    expect(editLabels).toContain('Undo');
    expect(editLabels).toContain('Paste');
    expect(window.label).toBe('Window');
    const minimize = window.submenu!.find((i: SerializedMenuItem) => i.role === 'minimize');
    expect(minimize?.accelerator).toBe('CmdOrCtrl+M');
  });

  it('role quit closes all windows and clears the menu', async () => {
    const { electron, app, lastMenu } = setup();
    const win = new electron.BrowserWindow();
    let quitFired = false;
    app.on('quit', () => {
      quitFired = true;
    });
    electron.Menu.setApplicationMenu(
      electron.Menu.buildFromTemplate([{ role: 'appMenu' }]),
    );
    const appMenu = lastMenu()!.items[0];
    const quit = appMenu.submenu!.find((i: SerializedMenuItem) => i.role === 'quit')!;
    lastMenu()!.onCommand(quit.commandId);
    expect(quitFired).toBe(true);
    expect(win.isDestroyed()).toBe(true);
    await flush();
    expect(lastMenu()).toBeNull();
  });

  it('updating item.enabled republishes the serialized menu', async () => {
    const { electron, lastMenu } = setup();
    const menu = electron.Menu.buildFromTemplate([
      { label: 'File', submenu: [{ id: 'save', label: 'Save', enabled: false }] },
    ]);
    electron.Menu.setApplicationMenu(menu);
    expect(lastMenu()!.items[0].submenu![0].enabled).toBe(false);
    menu.getMenuItemById('save')!.enabled = true;
    await flush();
    expect(lastMenu()!.items[0].submenu![0].enabled).toBe(true);
  });

  it('Menu.popup shows a context menu through the host and dispatches clicks', () => {
    const contextMenus: Array<{ items: unknown[]; onCommand: (id: string) => void; pos: unknown }> = [];
    const vfs = new VirtualFS();
    const host: ElectronHost = {
      createWindow: (o) => createFakeWindow(o),
      showContextMenu: (menu, position) =>
        contextMenus.push({ items: menu.items, onCommand: menu.onCommand, pos: position }),
    };
    const process = { cwd: () => '/', env: {} as Record<string, string | undefined> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electron = createElectronShim({ vfs, process, getHost: () => host }) as any;

    let clicked = false;
    const menu = electron.Menu.buildFromTemplate([
      { label: 'Copy Link', click: () => (clicked = true) },
      { type: 'separator' },
      { label: 'Delete', enabled: false, click: () => (clicked = true) },
    ]);
    menu.popup({ x: 120, y: 40 });

    expect(contextMenus).toHaveLength(1);
    const shown = contextMenus[0];
    expect(shown.pos).toEqual({ x: 120, y: 40 });
    expect((shown.items[0] as { label: string }).label).toBe('Copy Link');
    // Clicking the enabled item fires its handler…
    shown.onCommand((shown.items[0] as { commandId: string }).commandId);
    expect(clicked).toBe(true);
    // …and a disabled item does not.
    clicked = false;
    shown.onCommand((shown.items[2] as { commandId: string }).commandId);
    expect(clicked).toBe(false);
  });

  it('sends window identity (appInstanceId/appId/appName) to the host', () => {
    const { electron, windowOptions } = setup();
    new electron.BrowserWindow();
    expect(windowOptions[0].appInstanceId).toBeGreaterThan(0);
    expect(windowOptions[0].appId).toBe('electron-app');
    expect(windowOptions[0].appName).toBe('electron-app');
  });
});

describe('electron shim — dialog', () => {
  function setupWithDialog(result: Record<string, unknown>) {
    const requests: Record<string, unknown>[] = [];
    const vfs = new VirtualFS();
    const host: ElectronHost = {
      createWindow: (options) => createFakeWindow(options),
      showDialog: async (request) => {
        requests.push(request as unknown as Record<string, unknown>);
        return result as never;
      },
    };
    const process = { cwd: () => '/', env: {} as Record<string, string | undefined> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electron = createElectronShim({ vfs, process, getHost: () => host }) as any;
    return { electron, requests };
  }

  it('showOpenDialog forwards options to the host and maps the result', async () => {
    const { electron, requests } = setupWithDialog({
      canceled: false,
      filePaths: ['/home/user/a.txt'],
    });
    const result = await electron.dialog.showOpenDialog({
      title: 'Open',
      defaultPath: '/home/user',
      properties: ['openFile'],
      filters: [{ name: 'Text', extensions: ['txt'] }],
    });
    expect(requests[0]).toMatchObject({
      kind: 'open',
      title: 'Open',
      defaultPath: '/home/user',
      properties: ['openFile'],
    });
    expect(result).toEqual({ canceled: false, filePaths: ['/home/user/a.txt'] });
  });

  it('accepts a leading BrowserWindow argument', async () => {
    const { electron, requests } = setupWithDialog({ canceled: false, filePath: '/x.md' });
    const win = new electron.BrowserWindow();
    const result = await electron.dialog.showSaveDialog(win, { defaultPath: '/x.md' });
    expect(requests[0]).toMatchObject({ kind: 'save', defaultPath: '/x.md' });
    expect(result).toEqual({ canceled: false, filePath: '/x.md' });
  });

  it('showMessageBox maps buttons/response', async () => {
    const { electron, requests } = setupWithDialog({ canceled: false, response: 2 });
    const result = await electron.dialog.showMessageBox({
      message: 'Save changes?',
      buttons: ['Save', "Don't Save", 'Cancel'],
    });
    expect(requests[0]).toMatchObject({ kind: 'message', message: 'Save changes?' });
    expect(result).toEqual({ response: 2, checkboxChecked: false });
  });

  it('falls back to canceled when the host has no dialog support', async () => {
    const { electron } = setup(); // setup()'s host has no showDialog
    await expect(electron.dialog.showOpenDialog({})).resolves.toEqual({
      canceled: true,
      filePaths: [],
    });
    await expect(electron.dialog.showSaveDialog({})).resolves.toEqual({
      canceled: true,
      filePath: undefined,
    });
  });
});

describe('electron shim — packaged loadFile', () => {
  it('maps a loadFile under the served root onto the renderer origin', async () => {
    const vfs = new VirtualFS();
    const host: ElectronHost = { createWindow: (o) => createFakeWindow(o) };
    const process = {
      cwd: () => '/app',
      env: {
        __ALMOST_ELECTRON_RENDERER_ROOT: '/app/dist',
        __ALMOST_ELECTRON_DEV_URL: 'https://virt.example/xyz/',
      } as Record<string, string | undefined>,
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electron = createElectronShim({ vfs, process, getHost: () => host }) as any;
    const win = new electron.BrowserWindow();
    await win.loadFile('dist/index.html');
    expect(win.webContents.getURL()).toBe('https://virt.example/xyz/index.html');
    // A file outside the served root passes through unchanged.
    await win.loadFile('/somewhere/else.html');
    expect(win.webContents.getURL()).toBe('/somewhere/else.html');
  });
});

describe('electron shim — protocol registry', () => {
  it('tracks registered + handled schemes', async () => {
    const { electron } = setup();
    expect(electron.protocol.isProtocolRegistered('app')).toBe(false);
    electron.protocol.registerFileProtocol('app', () => {});
    expect(electron.protocol.isProtocolRegistered('app')).toBe(true);

    electron.protocol.handle('media', () => {});
    expect(await electron.protocol.isProtocolHandled('media')).toBe(true);
    electron.protocol.unhandle('media');
    expect(await electron.protocol.isProtocolHandled('media')).toBe(false);

    electron.protocol.registerSchemesAsPrivileged([{ scheme: 'secure' }]);
    expect(electron.protocol.isProtocolRegistered('secure')).toBe(true);
    electron.protocol.unregisterProtocol('app');
    expect(electron.protocol.isProtocolRegistered('app')).toBe(false);
  });
});

describe('electron shim — Tray', () => {
  function setupWithTray() {
    const trays = new Map<number, unknown>();
    const vfs = new VirtualFS();
    const host: ElectronHost = {
      createWindow: (o) => createFakeWindow(o),
      setTray: (trayId, tray) => {
        if (tray) trays.set(trayId, tray);
        else trays.delete(trayId);
      },
    };
    const process = { cwd: () => '/', env: {} as Record<string, string | undefined> };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const electron = createElectronShim({ vfs, process, getHost: () => host }) as any;
    return { electron, trays };
  }

  it('publishes a tray, updates it, and clicking its menu dispatches', () => {
    const { electron, trays } = setupWithTray();
    const tray = new electron.Tray();
    expect(trays.size).toBe(1);
    tray.setToolTip('Status');
    tray.setTitle('42');
    let clicked = false;
    tray.setContextMenu(
      electron.Menu.buildFromTemplate([{ label: 'Open', click: () => (clicked = true) }]),
    );
    const published = [...trays.values()][0] as {
      title: string;
      tooltip: string;
      menu: { items: Array<{ commandId: string }>; onCommand: (id: string) => void };
      onClick: () => void;
    };
    expect(published.title).toBe('42');
    expect(published.tooltip).toBe('Status');
    published.menu.onCommand(published.menu.items[0].commandId);
    expect(clicked).toBe(true);

    let clickEvent = false;
    tray.on('click', () => (clickEvent = true));
    published.onClick();
    expect(clickEvent).toBe(true);
  });

  it('destroy removes the tray from the host', () => {
    const { electron, trays } = setupWithTray();
    const tray = new electron.Tray();
    expect(trays.size).toBe(1);
    tray.destroy();
    expect(trays.size).toBe(0);
    expect(tray.isDestroyed()).toBe(true);
  });
});

describe('electron shim — child / modal windows', () => {
  it('tracks parent/child relationships and modality', () => {
    const { electron } = setup();
    const parent = new electron.BrowserWindow();
    const child = new electron.BrowserWindow({ parent, modal: true });
    expect(child.getParentWindow()).toBe(parent);
    expect(child.isModal()).toBe(true);
    expect(parent.getChildWindows()).toContain(child);
    const plain = new electron.BrowserWindow();
    expect(plain.getParentWindow()).toBeNull();
    expect(plain.isModal()).toBe(false);
  });

  it('closing a parent closes its children', () => {
    const { electron } = setup();
    const parent = new electron.BrowserWindow();
    const child = new electron.BrowserWindow({ parent });
    parent.close();
    expect(parent.isDestroyed()).toBe(true);
    expect(child.isDestroyed()).toBe(true);
  });

  it('Notification.isSupported() returns a boolean', () => {
    const { electron } = setup();
    expect(typeof electron.Notification.isSupported()).toBe('boolean');
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
