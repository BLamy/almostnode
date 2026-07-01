/**
 * `electron` main-process module shim.
 *
 * Returned by `require('electron')` inside the almostnode runtime, one instance
 * per runtime (wired into `Runtime.builtinModules`). It emulates the Electron
 * *main* process: `app` lifecycle, `BrowserWindow` (backed by a host-provided
 * iframe window), `webContents`, and `ipcMain`. IPC to the renderer travels
 * over the host window handle's postMessage transport using the wire protocol
 * defined in `../frameworks/electron-host`.
 *
 * Scope (MVP): modern secure apps — contextIsolation + preload + contextBridge,
 * ipcMain.handle/ipcRenderer.invoke + send/on. The renderer-side `electron`
 * (`ipcRenderer`, `contextBridge`) is provided by the injected preload bridge,
 * NOT by this module — matching real Electron, where `require('electron')` in
 * the main process does not expose `ipcRenderer`.
 */

import type { VirtualFS } from '../virtual-fs';
import { EventEmitter } from './events';
import {
  ELECTRON_IPC_KIND,
  ELECTRON_IPC_TAG,
  getElectronHost,
  isElectronIpcEnvelope,
  type ElectronHost,
  type ElectronIpcEnvelope,
  type ElectronIpcError,
  type ElectronWindowHandle,
  type ElectronWindowOptions,
} from '../frameworks/electron-host';

/** Minimal view of the runtime process this shim relies on. */
export interface ElectronProcessLike {
  cwd(): string;
  env: Record<string, string | undefined>;
  platform?: string;
}

export interface ElectronShimContext {
  vfs: VirtualFS;
  process: ElectronProcessLike;
  /** Override the host lookup (defaults to the global registration seam). */
  getHost?: () => ElectronHost;
  /** Electron version reported via app.getVersion() fallback. */
  electronVersion?: string;
}

interface WebPreferences {
  preload?: string;
  contextIsolation?: boolean;
  nodeIntegration?: boolean;
  [key: string]: unknown;
}

interface BrowserWindowConstructorOptions {
  width?: number;
  height?: number;
  x?: number;
  y?: number;
  minWidth?: number;
  minHeight?: number;
  title?: string;
  show?: boolean;
  resizable?: boolean;
  backgroundColor?: string;
  webPreferences?: WebPreferences;
  [key: string]: unknown;
}

type AnyFn = (...args: unknown[]) => unknown;

function toIpcError(err: unknown): ElectronIpcError {
  if (err instanceof Error) {
    return { message: err.message, name: err.name, stack: err.stack };
  }
  return { message: String(err) };
}

const DEFAULT_ELECTRON_VERSION = '31.0.0';

export function createElectronShim(ctx: ElectronShimContext): Record<string, unknown> {
  const { vfs, process } = ctx;
  const resolveHost = ctx.getHost ?? getElectronHost;
  const electronVersion = ctx.electronVersion ?? DEFAULT_ELECTRON_VERSION;

  // -- package.json / app identity -----------------------------------------
  let nameOverride: string | null = null;
  const pathOverrides: Record<string, string> = {};

  const readPackageJson = (): Record<string, unknown> => {
    try {
      const pkgPath = `${process.cwd()}/package.json`;
      if (vfs.existsSync(pkgPath)) {
        return JSON.parse(vfs.readFileSync(pkgPath, 'utf8') as string) as Record<string, unknown>;
      }
    } catch {
      /* ignore */
    }
    return {};
  };

  const appName = (): string =>
    nameOverride ?? (readPackageJson().name as string) ?? 'electron-app';
  const appVersion = (): string =>
    (readPackageJson().version as string) ?? electronVersion;

  const home = (): string => process.env.HOME || process.env.USERPROFILE || '/root';

  // The app orchestrator serves the renderer through a virtual server and
  // exposes its URL here. loadURL('http://localhost:5173/...') from a dev-mode
  // app is rewritten onto that virtual origin (path/query/hash preserved).
  const translateRendererUrl = (url: string): string => {
    const devUrl = process.env.__ALMOST_ELECTRON_DEV_URL;
    if (!devUrl) return url;
    // Already pointing at the virtual renderer (e.g. the app loaded
    // ELECTRON_RENDERER_URL directly) — leave it alone, or we'd double the prefix.
    if (url === devUrl || url.startsWith(devUrl) || url.includes('/__virtual__/')) {
      return url;
    }
    // Only rewrite a hardcoded dev-server localhost URL (e.g. http://localhost:5173).
    if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url)) return url;
    try {
      const parsed = new URL(url);
      return devUrl.replace(/\/$/, '') + parsed.pathname + parsed.search + parsed.hash;
    } catch {
      return devUrl;
    }
  };

  const ensureDir = (p: string): void => {
    try {
      if (!vfs.existsSync(p)) vfs.mkdirSync(p, { recursive: true });
    } catch {
      /* best effort */
    }
  };

  const getPath = (name: string): string => {
    if (pathOverrides[name]) return pathOverrides[name];
    const h = home();
    const map: Record<string, string> = {
      home: h,
      appData: `${h}/.config`,
      userData: `${h}/.config/${appName()}`,
      sessionData: `${h}/.config/${appName()}`,
      temp: '/tmp',
      exe: '/usr/local/bin/electron',
      module: '/usr/local/bin/electron',
      desktop: `${h}/Desktop`,
      documents: `${h}/Documents`,
      downloads: `${h}/Downloads`,
      music: `${h}/Music`,
      pictures: `${h}/Pictures`,
      videos: `${h}/Videos`,
      recent: `${h}/Recent`,
      logs: `${h}/.config/${appName()}/logs`,
      cache: `${h}/.cache`,
      crashDumps: `${h}/.config/${appName()}/crashDumps`,
    };
    const resolved = map[name];
    if (!resolved) {
      throw new Error(`Failed to get '${name}' path`);
    }
    ensureDir(resolved);
    return resolved;
  };

  // -- window registry ------------------------------------------------------
  const allWindows = new Map<number, BrowserWindow>();
  let focusedWindowId: number | null = null;

  // -- app ------------------------------------------------------------------
  const app = new EventEmitter() as EventEmitter & Record<string, unknown>;
  let appReady = false;
  let quitRequested = false;
  let resolveReady!: () => void;
  const readyPromise = new Promise<void>((res) => {
    resolveReady = res;
  });
  const fireReady = (): void => {
    if (appReady) return;
    appReady = true;
    app.emit('will-finish-launching');
    app.emit('ready', {}, {});
    resolveReady();
  };
  // Fire on the next tick so a synchronously-loaded main module can register
  // its `whenReady()` / `on('ready')` handlers first.
  setTimeout(fireReady, 0);

  const makeQuitEvent = () => ({ preventDefault: () => {} });

  Object.assign(app, {
    whenReady: () => readyPromise.then(() => app),
    isReady: () => appReady,
    quit: () => {
      if (quitRequested) return;
      quitRequested = true;
      app.emit('before-quit', makeQuitEvent());
      for (const win of [...allWindows.values()]) win.close();
      app.emit('will-quit', makeQuitEvent());
      app.emit('quit', makeQuitEvent(), 0);
    },
    exit: (code = 0) => {
      for (const win of [...allWindows.values()]) win.destroy();
      app.emit('quit', makeQuitEvent(), code);
    },
    relaunch: () => {},
    focus: () => {},
    hide: () => {},
    show: () => {},
    getName: () => appName(),
    setName: (name: string) => {
      nameOverride = name;
    },
    getVersion: () => appVersion(),
    getAppPath: () => process.cwd(),
    getPath,
    setPath: (name: string, p: string) => {
      pathOverrides[name] = p;
    },
    getLocale: () => 'en-US',
    getLocaleCountryCode: () => 'US',
    getSystemLocale: () => 'en-US',
    requestSingleInstanceLock: () => true,
    hasSingleInstanceLock: () => true,
    releaseSingleInstanceLock: () => {},
    setAppUserModelId: () => {},
    setLoginItemSettings: () => {},
    getLoginItemSettings: () => ({ openAtLogin: false }),
    addRecentDocument: () => {},
    clearRecentDocuments: () => {},
    isPackaged: false,
    commandLine: {
      appendSwitch: () => {},
      appendArgument: () => {},
      hasSwitch: () => false,
      getSwitchValue: () => '',
      removeSwitch: () => {},
    },
    dock: {
      hide: () => {},
      show: () => Promise.resolve(),
      setBadge: () => {},
      getBadge: () => '',
      setIcon: () => {},
      bounce: () => 0,
      cancelBounce: () => {},
      setMenu: () => {},
    },
    /** Internal: force the ready event (used by the app orchestrator). */
    __fireReady: fireReady,
  });

  // -- webContents (per window) --------------------------------------------
  class WebContents extends EventEmitter {
    readonly id: number;
    constructor(
      private readonly win: BrowserWindow,
      id: number,
    ) {
      super();
      this.id = id;
    }
    send(channel: string, ...args: unknown[]): void {
      this.win._postToRenderer({
        [ELECTRON_IPC_TAG]: true,
        kind: ELECTRON_IPC_KIND.event,
        channel,
        args,
      });
    }
    sendToFrame(_frame: unknown, channel: string, ...args: unknown[]): void {
      this.send(channel, ...args);
    }
    getURL(): string {
      return this.win._currentUrl;
    }
    getTitle(): string {
      return this.win.getTitle();
    }
    isDestroyed(): boolean {
      return this.win.isDestroyed();
    }
    isLoading(): boolean {
      return false;
    }
    focus(): void {
      this.win.focus();
    }
    reload(): void {
      if (this.win._currentUrl) void this.win.loadURL(this.win._currentUrl);
    }
    executeJavaScript(): Promise<unknown> {
      // MVP: not supported (would require injecting into the renderer world).
      return Promise.resolve(undefined);
    }
    insertCSS(): Promise<string> {
      return Promise.resolve('');
    }
    setWindowOpenHandler(): void {}
    openDevTools(): void {}
    closeDevTools(): void {}
    isDevToolsOpened(): boolean {
      return false;
    }
    toggleDevTools(): void {}
    send_(): void {}
  }

  // -- ipcMain --------------------------------------------------------------
  class IpcMain extends EventEmitter {
    private readonly handlers = new Map<string, AnyFn>();
    handle(channel: string, listener: AnyFn): void {
      this.handlers.set(channel, listener);
    }
    handleOnce(channel: string, listener: AnyFn): void {
      this.handlers.set(channel, (...args: unknown[]) => {
        this.handlers.delete(channel);
        return listener(...args);
      });
    }
    removeHandler(channel: string): void {
      this.handlers.delete(channel);
    }
    getHandler(channel: string): AnyFn | undefined {
      return this.handlers.get(channel);
    }
  }
  const ipcMain = new IpcMain();

  // -- BrowserWindow --------------------------------------------------------
  class BrowserWindow extends EventEmitter {
    readonly id: number;
    readonly webContents: WebContents;
    _currentUrl = '';
    private readonly handle: ElectronWindowHandle;
    private readonly preload?: string;
    private title: string;
    private destroyed = false;

    constructor(options: BrowserWindowConstructorOptions = {}) {
      super();
      this.preload = options.webPreferences?.preload;
      this.title = options.title ?? '';
      const hostOptions: ElectronWindowOptions = {
        width: options.width,
        height: options.height,
        x: options.x,
        y: options.y,
        minWidth: options.minWidth,
        minHeight: options.minHeight,
        title: options.title,
        show: options.show,
        resizable: options.resizable,
        backgroundColor: options.backgroundColor,
        preload: this.preload,
      };
      this.handle = resolveHost().createWindow(hostOptions);
      this.id = this.handle.id;
      this.webContents = new WebContents(this, this.id);

      allWindows.set(this.id, this);
      focusedWindowId = this.id;

      this.handle.onMessage((message) => this._onRendererMessage(message));
      this.handle.on('closed', () => this._handleClosed());
      this.handle.on('focus', () => {
        focusedWindowId = this.id;
        this.emit('focus');
      });
      this.handle.on('blur', () => this.emit('blur'));
      this.handle.on('resize', () => this.emit('resize'));
      this.handle.on('move', () => this.emit('move'));
    }

    // Internal: post an IPC envelope into this window's renderer.
    _postToRenderer(envelope: ElectronIpcEnvelope): void {
      if (this.destroyed) return;
      this.handle.postMessage(envelope);
    }

    private _makeIpcMainEvent() {
      return {
        sender: this.webContents,
        senderFrame: null,
        processId: 0,
        frameId: 0,
        returnValue: undefined as unknown,
        reply: (channel: string, ...args: unknown[]) =>
          this.webContents.send(channel, ...args),
      };
    }

    private _onRendererMessage(message: unknown): void {
      if (!isElectronIpcEnvelope(message)) return;
      const env = message;
      switch (env.kind) {
        case ELECTRON_IPC_KIND.rendererReady: {
          this.webContents.emit('dom-ready');
          this.webContents.emit('did-finish-load');
          this.emit('ready-to-show');
          break;
        }
        case ELECTRON_IPC_KIND.invoke: {
          const handler = ipcMain.getHandler(env.channel ?? '');
          const event = this._makeIpcMainEvent();
          Promise.resolve()
            .then(() => {
              if (!handler) {
                throw new Error(
                  `No handler registered for '${env.channel}'`,
                );
              }
              return handler(event, ...(env.args ?? []));
            })
            .then((result) =>
              this._postToRenderer({
                [ELECTRON_IPC_TAG]: true,
                kind: ELECTRON_IPC_KIND.invokeReply,
                id: env.id,
                ok: true,
                args: [result],
              }),
            )
            .catch((err) =>
              this._postToRenderer({
                [ELECTRON_IPC_TAG]: true,
                kind: ELECTRON_IPC_KIND.invokeReply,
                id: env.id,
                ok: false,
                error: toIpcError(err),
              }),
            );
          break;
        }
        case ELECTRON_IPC_KIND.send: {
          const event = this._makeIpcMainEvent();
          ipcMain.emit(env.channel ?? '', event, ...(env.args ?? []));
          break;
        }
        default:
          break;
      }
    }

    private _handleClosed(): void {
      if (this.destroyed) return;
      this.destroyed = true;
      allWindows.delete(this.id);
      if (focusedWindowId === this.id) focusedWindowId = null;
      this.emit('closed');
      if (allWindows.size === 0) app.emit('window-all-closed');
    }

    loadURL(url: string): Promise<void> {
      const target = translateRendererUrl(url);
      this._currentUrl = target;
      return this.handle.loadURL(target);
    }
    loadFile(path: string): Promise<void> {
      this._currentUrl = path;
      return this.handle.loadFile(path);
    }
    getTitle(): string {
      return this.title;
    }
    setTitle(title: string): void {
      this.title = title;
      this.handle.setTitle(title);
    }
    show(): void {
      this.handle.show();
      this.emit('show');
    }
    showInactive(): void {
      this.handle.show();
    }
    hide(): void {
      this.handle.hide();
      this.emit('hide');
    }
    focus(): void {
      this.handle.focus();
    }
    blur(): void {
      this.handle.blur();
    }
    minimize(): void {
      this.handle.minimize();
      this.emit('minimize');
    }
    maximize(): void {
      this.handle.maximize();
      this.emit('maximize');
    }
    unmaximize(): void {
      this.handle.unmaximize();
      this.emit('unmaximize');
    }
    restore(): void {}
    close(): void {
      this.handle.close();
    }
    destroy(): void {
      this._handleClosed();
      this.handle.close();
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    isVisible(): boolean {
      return true;
    }
    isMinimized(): boolean {
      return false;
    }
    isMaximized(): boolean {
      return false;
    }
    isFocused(): boolean {
      return focusedWindowId === this.id;
    }
    getBounds() {
      return this.handle.getBounds();
    }
    setBounds(bounds: Partial<{ x: number; y: number; width: number; height: number }>): void {
      this.handle.setBounds(bounds);
    }
    getSize(): [number, number] {
      const b = this.handle.getBounds();
      return [b.width, b.height];
    }
    setSize(width: number, height: number): void {
      this.handle.setBounds({ width, height });
    }
    getPosition(): [number, number] {
      const b = this.handle.getBounds();
      return [b.x, b.y];
    }
    setPosition(x: number, y: number): void {
      this.handle.setBounds({ x, y });
    }
    center(): void {}
    setMenu(): void {}
    removeMenu(): void {}
    setMenuBarVisibility(): void {}
    setResizable(): void {}
    setAlwaysOnTop(): void {}
    setTitleBarOverlay(): void {}

    static getAllWindows(): BrowserWindow[] {
      return [...allWindows.values()];
    }
    static getFocusedWindow(): BrowserWindow | null {
      return focusedWindowId !== null
        ? allWindows.get(focusedWindowId) ?? null
        : null;
    }
    static fromWebContents(wc: WebContents): BrowserWindow | null {
      return [...allWindows.values()].find((w) => w.webContents === wc) ?? null;
    }
    static fromId(id: number): BrowserWindow | null {
      return allWindows.get(id) ?? null;
    }
  }

  const webContentsModule = {
    getAllWebContents: () => [...allWindows.values()].map((w) => w.webContents),
    getFocusedWebContents: () =>
      BrowserWindow.getFocusedWindow()?.webContents ?? null,
    fromId: (id: number) =>
      [...allWindows.values()]
        .map((w) => w.webContents)
        .find((wc) => wc.id === id) ?? null,
  };

  // -- Menu / MenuItem (partial) -------------------------------------------
  class MenuItem {
    constructor(options: Record<string, unknown> = {}) {
      Object.assign(this, options);
    }
  }
  let applicationMenu: Menu | null = null;
  class Menu {
    items: MenuItem[] = [];
    append(item: MenuItem): void {
      this.items.push(item);
    }
    insert(pos: number, item: MenuItem): void {
      this.items.splice(pos, 0, item);
    }
    popup(): void {}
    closePopup(): void {}
    static buildFromTemplate(template: Array<Record<string, unknown> | MenuItem>): Menu {
      const menu = new Menu();
      for (const entry of template) {
        menu.append(entry instanceof MenuItem ? entry : new MenuItem(entry));
      }
      return menu;
    }
    static setApplicationMenu(menu: Menu | null): void {
      applicationMenu = menu;
    }
    static getApplicationMenu(): Menu | null {
      return applicationMenu;
    }
  }

  // -- dialog (stub; real impl backed by host in a later phase) -------------
  const dialog = {
    showOpenDialog: async () => ({ canceled: true, filePaths: [] as string[] }),
    showOpenDialogSync: () => undefined,
    showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
    showSaveDialogSync: () => undefined,
    showMessageBox: async () => ({ response: 0, checkboxChecked: false }),
    showMessageBoxSync: () => 0,
    showErrorBox: () => {},
    showCertificateTrustDialog: async () => {},
  };

  // -- shell ----------------------------------------------------------------
  const openExternalWindow = (url: string): void => {
    const opener = (globalThis as { open?: (u: string, t?: string, f?: string) => unknown }).open;
    opener?.(url, '_blank', 'noopener,noreferrer');
  };
  const shell = {
    openExternal: async (url: string) => {
      openExternalWindow(url);
    },
    openPath: async () => '',
    showItemInFolder: () => {},
    trashItem: async () => {},
    beep: () => {},
    writeShortcutLink: () => false,
    readShortcutLink: () => ({}),
  };

  // -- clipboard (browser-backed; sync reads unavailable) -------------------
  const nav = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } })
    .navigator;
  const clipboard = {
    readText: () => '',
    writeText: (text: string) => {
      nav?.clipboard?.writeText?.(text)?.catch(() => {});
    },
    readHTML: () => '',
    writeHTML: () => {},
    clear: () => {},
    availableFormats: () => [] as string[],
  };

  // -- nativeImage (minimal) ------------------------------------------------
  const makeImage = (dataUrl: string) => ({
    toDataURL: () => dataUrl,
    toPNG: () => new Uint8Array(),
    toJPEG: () => new Uint8Array(),
    toBitmap: () => new Uint8Array(),
    isEmpty: () => !dataUrl,
    getSize: () => ({ width: 0, height: 0 }),
    resize: () => makeImage(dataUrl),
    getScaleFactors: () => [1],
  });
  const nativeImage = {
    createEmpty: () => makeImage(''),
    createFromPath: (p: string) => {
      try {
        const data = vfs.readFileSync(p) as unknown as Uint8Array;
        const b64 =
          typeof btoa === 'function'
            ? btoa(String.fromCharCode(...data))
            : '';
        return makeImage(b64 ? `data:image/png;base64,${b64}` : '');
      } catch {
        return makeImage('');
      }
    },
    createFromDataURL: (dataUrl: string) => makeImage(dataUrl),
    createFromBuffer: () => makeImage(''),
    createFromNamedImage: () => makeImage(''),
  };

  // -- screen / nativeTheme / powerMonitor ----------------------------------
  const primaryDisplay = {
    id: 0,
    bounds: { x: 0, y: 0, width: 1280, height: 800 },
    workArea: { x: 0, y: 0, width: 1280, height: 760 },
    workAreaSize: { width: 1280, height: 760 },
    size: { width: 1280, height: 800 },
    scaleFactor: 1,
    rotation: 0,
    internal: true,
    touchSupport: 'unknown',
  };
  const screen = Object.assign(new EventEmitter(), {
    getPrimaryDisplay: () => primaryDisplay,
    getAllDisplays: () => [primaryDisplay],
    getDisplayNearestPoint: () => primaryDisplay,
    getDisplayMatching: () => primaryDisplay,
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
  });
  const nativeTheme = Object.assign(new EventEmitter(), {
    shouldUseDarkColors: true,
    shouldUseHighContrastColors: false,
    shouldUseInvertedColorScheme: false,
    themeSource: 'system' as 'system' | 'light' | 'dark',
    inForcedColorsMode: false,
  });
  const powerMonitor = Object.assign(new EventEmitter(), {
    getSystemIdleTime: () => 0,
    getSystemIdleState: () => 'active',
    isOnBatteryPower: () => false,
  });

  // -- globalShortcut / Notification / Tray ---------------------------------
  const globalShortcut = {
    register: () => true,
    registerAll: () => {},
    isRegistered: () => false,
    unregister: () => {},
    unregisterAll: () => {},
  };
  class Notification extends EventEmitter {
    constructor(public options: Record<string, unknown> = {}) {
      super();
    }
    show(): void {}
    close(): void {}
    static isSupported(): boolean {
      return false;
    }
  }
  class Tray extends EventEmitter {
    constructor(_image?: unknown) {
      super();
    }
    setToolTip(): void {}
    setContextMenu(): void {}
    setImage(): void {}
    setTitle(): void {}
    getTitle(): string {
      return '';
    }
    popUpContextMenu(): void {}
    destroy(): void {}
    isDestroyed(): boolean {
      return false;
    }
  }

  // -- session / protocol (stubs) ------------------------------------------
  const protocol = {
    registerSchemesAsPrivileged: () => {},
    registerFileProtocol: () => true,
    registerStringProtocol: () => true,
    registerBufferProtocol: () => true,
    registerHttpProtocol: () => true,
    registerStreamProtocol: () => true,
    handle: () => {},
    unhandle: () => {},
    isProtocolRegistered: () => false,
    isProtocolHandled: async () => false,
    unregisterProtocol: () => true,
  };
  const makeSession = () => ({
    webRequest: {
      onBeforeRequest: () => {},
      onBeforeSendHeaders: () => {},
      onHeadersReceived: () => {},
      onSendHeaders: () => {},
      onResponseStarted: () => {},
      onCompleted: () => {},
      onErrorOccurred: () => {},
    },
    cookies: Object.assign(new EventEmitter(), {
      get: async () => [],
      set: async () => {},
      remove: async () => {},
      flushStore: async () => {},
    }),
    setPermissionRequestHandler: () => {},
    setPermissionCheckHandler: () => {},
    setProxy: async () => {},
    clearCache: async () => {},
    clearStorageData: async () => {},
    loadExtension: async () => ({}),
    protocol,
  });
  const session = {
    defaultSession: makeSession(),
    fromPartition: () => makeSession(),
  };

  // -- autoUpdater / crashReporter (stubs) ----------------------------------
  const autoUpdater = Object.assign(new EventEmitter(), {
    setFeedURL: () => {},
    getFeedURL: () => '',
    checkForUpdates: () => {},
    quitAndInstall: () => {},
  });
  const crashReporter = {
    start: () => {},
    getLastCrashReport: () => null,
    getUploadedReports: () => [],
    addExtraParameter: () => {},
    removeExtraParameter: () => {},
    getParameters: () => ({}),
  };
  const systemPreferences = Object.assign(new EventEmitter(), {
    getUserDefault: () => undefined,
    setUserDefault: () => {},
    getAccentColor: () => '0078d4ff',
    getColor: () => '#000000',
    isDarkMode: () => true,
    askForMediaAccess: async () => true,
    getMediaAccessStatus: () => 'granted',
  });

  const electron: Record<string, unknown> = {
    app,
    BrowserWindow,
    webContents: webContentsModule,
    ipcMain,
    Menu,
    MenuItem,
    dialog,
    shell,
    clipboard,
    nativeImage,
    screen,
    nativeTheme,
    powerMonitor,
    globalShortcut,
    Notification,
    Tray,
    session,
    protocol,
    autoUpdater,
    crashReporter,
    systemPreferences,
  };
  // ESM default-import interop (`import electron from 'electron'`).
  electron.default = electron;
  return electron;
}

export default createElectronShim;
