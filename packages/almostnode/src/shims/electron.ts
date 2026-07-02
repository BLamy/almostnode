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
  allocateElectronAppInstanceId,
  getElectronHost,
  isElectronIpcEnvelope,
  type ElectronHost,
  type ElectronIpcEnvelope,
  type ElectronIpcError,
  type ElectronWindowHandle,
  type ElectronWindowOptions,
  type SerializedMenuItem,
  type SerializedMenuItemType,
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
  frame?: boolean;
  transparent?: boolean;
  parent?: unknown;
  modal?: boolean;
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

  // One instance id per shim (i.e. per running app); the host uses it to
  // associate windows and the application menu with this app.
  const appInstanceId = allocateElectronAppInstanceId();
  const electronAppId = (): string =>
    process.env.ALMOST_ELECTRON_APP_ID ?? appName();

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

  // Map a packaged `loadFile(path)` onto the served renderer origin when the
  // file lives under the root the renderer server is serving (so assets
  // resolve). Files outside that root pass through unchanged.
  const translateFileUrl = (filePath: string): string => {
    const root = process.env.__ALMOST_ELECTRON_RENDERER_ROOT;
    const devUrl = process.env.__ALMOST_ELECTRON_DEV_URL;
    if (!root || !devUrl) return filePath;
    const abs = filePath.startsWith('/')
      ? filePath
      : `${process.cwd()}/${filePath}`.replace(/\/+/g, '/');
    const normRoot = root.replace(/\/+$/, '');
    if (abs === normRoot || abs.startsWith(`${normRoot}/`)) {
      const rel = abs.slice(normRoot.length).replace(/^\//, '');
      return `${devUrl.replace(/\/$/, '')}/${rel}`;
    }
    return filePath;
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
    private parentWindow: BrowserWindow | null = null;
    private readonly childWindows = new Set<BrowserWindow>();
    private readonly modal: boolean;

    constructor(options: BrowserWindowConstructorOptions = {}) {
      super();
      this.preload = options.webPreferences?.preload;
      this.title = options.title ?? '';
      this.modal = options.modal === true;
      if (options.parent instanceof BrowserWindow) {
        this.parentWindow = options.parent;
        options.parent.childWindows.add(this);
      }
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
        frame: options.frame,
        transparent: options.transparent,
        preload: this.preload,
        appInstanceId,
        appId: electronAppId(),
        appName: appName(),
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

      // Standard electron lifecycle event: apps register `browser-window-created`
      // to wire per-window behavior (e.g. @electron-toolkit's
      // optimizer.watchWindowShortcuts). Fired once the window + webContents exist.
      app.emit('browser-window-created', { preventDefault() {} }, this);
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
      this.parentWindow?.childWindows.delete(this);
      // Closing a parent closes its (modal) children, matching Electron.
      for (const child of [...this.childWindows]) child.close();
      if (focusedWindowId === this.id) focusedWindowId = null;
      this.emit('closed');
      if (allWindows.size === 0) app.emit('window-all-closed');
    }

    getParentWindow(): BrowserWindow | null {
      return this.parentWindow;
    }
    setParentWindow(parent: BrowserWindow | null): void {
      this.parentWindow?.childWindows.delete(this);
      this.parentWindow = parent;
      parent?.childWindows.add(this);
    }
    getChildWindows(): BrowserWindow[] {
      return [...this.childWindows];
    }
    isModal(): boolean {
      return this.modal;
    }

    loadURL(url: string): Promise<void> {
      const target = translateRendererUrl(url);
      this._currentUrl = target;
      return this.handle.loadURL(target);
    }
    loadFile(path: string): Promise<void> {
      const target = translateFileUrl(path);
      this._currentUrl = target;
      return this.handle.loadFile(target);
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

  // -- Menu / MenuItem --------------------------------------------------------
  // Real template handling: composite roles expand like Electron's, items get
  // commandIds, and `Menu.setApplicationMenu` publishes a serialized tree
  // through the host seam. Click dispatch comes back same-context via
  // `onCommand` (no postMessage — main processes share the host's JS context).

  type MenuItemClick = (
    item: MenuItem,
    window: BrowserWindow | null,
    event: { triggeredByAccelerator: boolean },
  ) => void;

  interface MenuItemConstructorOptions {
    id?: string;
    label?: string;
    sublabel?: string;
    type?: SerializedMenuItemType;
    role?: string;
    accelerator?: string;
    enabled?: boolean;
    visible?: boolean;
    checked?: boolean;
    click?: MenuItemClick;
    submenu?: Menu | MenuItemConstructorOptions[];
    [key: string]: unknown;
  }

  const ROLE_LABELS: Record<string, string> = {
    about: 'About',
    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    pasteAndMatchStyle: 'Paste and Match Style',
    delete: 'Delete',
    selectAll: 'Select All',
    reload: 'Reload',
    forceReload: 'Force Reload',
    toggleDevTools: 'Toggle Developer Tools',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    togglefullscreen: 'Toggle Full Screen',
    minimize: 'Minimize',
    zoom: 'Zoom',
    front: 'Bring All to Front',
    close: 'Close Window',
    quit: 'Quit',
    hide: 'Hide',
    hideOthers: 'Hide Others',
    unhide: 'Show All',
    services: 'Services',
  };

  const ROLE_ACCELERATORS: Record<string, string> = {
    undo: 'CmdOrCtrl+Z',
    redo: 'Shift+CmdOrCtrl+Z',
    cut: 'CmdOrCtrl+X',
    copy: 'CmdOrCtrl+C',
    paste: 'CmdOrCtrl+V',
    pasteAndMatchStyle: 'Shift+CmdOrCtrl+V',
    selectAll: 'CmdOrCtrl+A',
    reload: 'CmdOrCtrl+R',
    forceReload: 'Shift+CmdOrCtrl+R',
    toggleDevTools: 'Alt+CmdOrCtrl+I',
    resetZoom: 'CmdOrCtrl+0',
    zoomIn: 'CmdOrCtrl+Plus',
    zoomOut: 'CmdOrCtrl+-',
    togglefullscreen: 'Ctrl+Cmd+F',
    minimize: 'CmdOrCtrl+M',
    close: 'CmdOrCtrl+W',
    quit: 'CmdOrCtrl+Q',
    hide: 'CmdOrCtrl+H',
    hideOthers: 'Alt+CmdOrCtrl+H',
  };

  // Roles the shim cannot act on (no devtools/fullscreen/zoom in an iframe
  // renderer). Rendered disabled so menus look native without dead buttons.
  const UNSUPPORTED_ROLES = new Set([
    'about',
    'toggleDevTools',
    'togglefullscreen',
    'resetZoom',
    'zoomIn',
    'zoomOut',
    'hide',
    'hideOthers',
    'unhide',
    'services',
    'front',
  ]);

  const COMPOSITE_ROLES = new Set([
    'appMenu',
    'fileMenu',
    'editMenu',
    'viewMenu',
    'windowMenu',
    'help',
  ]);

  const expandCompositeRole = (
    role: string,
  ): { label: string; submenu: MenuItemConstructorOptions[] } => {
    switch (role) {
      case 'appMenu':
        return {
          label: appName(),
          submenu: [
            { role: 'about', label: `About ${appName()}` },
            { type: 'separator' },
            { role: 'hide', label: `Hide ${appName()}` },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit', label: `Quit ${appName()}` },
          ],
        };
      case 'fileMenu':
        return { label: 'File', submenu: [{ role: 'close' }] };
      case 'editMenu':
        return {
          label: 'Edit',
          submenu: [
            { role: 'undo' },
            { role: 'redo' },
            { type: 'separator' },
            { role: 'cut' },
            { role: 'copy' },
            { role: 'paste' },
            { role: 'pasteAndMatchStyle' },
            { role: 'delete' },
            { role: 'selectAll' },
          ],
        };
      case 'viewMenu':
        return {
          label: 'View',
          submenu: [
            { role: 'reload' },
            { role: 'forceReload' },
            { type: 'separator' },
            { role: 'resetZoom' },
            { role: 'zoomIn' },
            { role: 'zoomOut' },
            { type: 'separator' },
            { role: 'togglefullscreen' },
          ],
        };
      case 'windowMenu':
        return {
          label: 'Window',
          submenu: [
            { role: 'minimize' },
            { role: 'zoom' },
            { type: 'separator' },
            { role: 'close' },
          ],
        };
      case 'help':
      default:
        return { label: 'Help', submenu: [] };
    }
  };

  const normalizeMenuOptions = (
    options: MenuItemConstructorOptions,
  ): MenuItemConstructorOptions => {
    const role = options.role;
    if (!role) return options;
    if (COMPOSITE_ROLES.has(role)) {
      const expanded = expandCompositeRole(role);
      return {
        ...options,
        label: options.label ?? expanded.label,
        submenu: options.submenu ?? expanded.submenu,
      };
    }
    return {
      ...options,
      label: options.label ?? ROLE_LABELS[role] ?? role,
      accelerator: options.accelerator ?? ROLE_ACCELERATORS[role],
      enabled: options.enabled ?? !UNSUPPORTED_ROLES.has(role),
    };
  };

  class MenuItem {
    readonly id?: string;
    readonly sublabel?: string;
    readonly role?: string;
    readonly accelerator?: string;
    readonly click?: MenuItemClick;
    readonly type: SerializedMenuItemType;
    submenu?: Menu;
    commandId = '';
    /** Set while part of the published application menu (schedules republish). */
    _onChange: (() => void) | null = null;
    /** Menu containing this item; used for radio-group selection. */
    _parentMenu: Menu | null = null;
    private _label: string;
    private _enabled: boolean;
    private _visible: boolean;
    private _checked: boolean;

    constructor(rawOptions: MenuItemConstructorOptions = {}) {
      const options = normalizeMenuOptions(rawOptions);
      this.id = options.id;
      this.sublabel = options.sublabel;
      this.role = options.role;
      this.accelerator = options.accelerator;
      this.click = options.click;
      if (options.submenu) {
        this.submenu =
          options.submenu instanceof Menu
            ? options.submenu
            : Menu.buildFromTemplate(options.submenu);
      }
      this.type = options.type ?? (this.submenu ? 'submenu' : 'normal');
      this._label = options.label ?? '';
      this._enabled = options.enabled ?? true;
      this._visible = options.visible ?? true;
      this._checked = options.checked ?? false;
    }

    get label(): string {
      return this._label;
    }
    set label(value: string) {
      this._label = value;
      this._onChange?.();
    }
    get enabled(): boolean {
      return this._enabled;
    }
    set enabled(value: boolean) {
      this._enabled = value;
      this._onChange?.();
    }
    get visible(): boolean {
      return this._visible;
    }
    set visible(value: boolean) {
      this._visible = value;
      this._onChange?.();
    }
    get checked(): boolean {
      return this._checked;
    }
    set checked(value: boolean) {
      this._checked = value;
      this._onChange?.();
    }
  }

  let applicationMenu: Menu | null = null;
  let menuPublishScheduled = false;
  let menuCommandSeq = 0;
  let menuCommandMap = new Map<string, MenuItem>();

  const scheduleMenuPublish = (): void => {
    if (menuPublishScheduled) return;
    menuPublishScheduled = true;
    queueMicrotask(() => {
      menuPublishScheduled = false;
      publishApplicationMenu();
    });
  };

  class Menu {
    items: MenuItem[] = [];
    /** Set while part of the published application menu. */
    _published = false;

    append(item: MenuItem): void {
      this.items.push(item);
      item._parentMenu = this;
      if (this._published) scheduleMenuPublish();
    }
    insert(pos: number, item: MenuItem): void {
      this.items.splice(pos, 0, item);
      item._parentMenu = this;
      if (this._published) scheduleMenuPublish();
    }
    popup(options: { x?: number; y?: number } = {}): void {
      const host = resolveHost();
      if (!host.showContextMenu) return;
      // Serialize into a popup-local command map; a no-op onChange keeps popup
      // checkbox/radio toggles from republishing the application menu.
      const map = new Map<string, MenuItem>();
      const items = serializeMenu(this, map, () => {});
      host.showContextMenu(
        { items, onCommand: (commandId: string) => dispatchFromMap(map, commandId) },
        { x: options.x ?? 0, y: options.y ?? 0 },
      );
    }
    closePopup(): void {
      resolveHost().closeContextMenu?.();
    }
    getMenuItemById(id: string): MenuItem | null {
      for (const item of this.items) {
        if (item.id === id) return item;
        const nested = item.submenu?.getMenuItemById(id);
        if (nested) return nested;
      }
      return null;
    }
    static buildFromTemplate(
      template: Array<MenuItemConstructorOptions | MenuItem>,
    ): Menu {
      const menu = new Menu();
      for (const entry of template) {
        menu.append(entry instanceof MenuItem ? entry : new MenuItem(entry));
      }
      return menu;
    }
    static setApplicationMenu(menu: Menu | null): void {
      applicationMenu = menu;
      publishApplicationMenu();
    }
    static getApplicationMenu(): Menu | null {
      return applicationMenu;
    }
  }

  const serializeMenu = (
    menu: Menu,
    map: Map<string, MenuItem>,
    onChange: () => void = scheduleMenuPublish,
  ): SerializedMenuItem[] => {
    menu._published = true;
    const out: SerializedMenuItem[] = [];
    for (const item of menu.items) {
      item._onChange = onChange;
      item._parentMenu = menu;
      const commandId = `cmd-${++menuCommandSeq}`;
      item.commandId = commandId;
      map.set(commandId, item);
      const serialized: SerializedMenuItem = {
        commandId,
        type: item.type,
        label: item.label,
        enabled: item.enabled,
        visible: item.visible,
        accelerator: item.accelerator,
        role: item.role,
      };
      if (item.type === 'checkbox' || item.type === 'radio') {
        serialized.checked = item.checked;
      }
      if (item.submenu) serialized.submenu = serializeMenu(item.submenu, map, onChange);
      out.push(serialized);
    }
    return out;
  };

  const selectRadioItem = (item: MenuItem): void => {
    const parent = item._parentMenu;
    if (!parent) {
      item.checked = true;
      return;
    }
    // A radio group is a contiguous run of radio items within one menu.
    const idx = parent.items.indexOf(item);
    let start = idx;
    while (start > 0 && parent.items[start - 1].type === 'radio') start--;
    let end = idx;
    while (end < parent.items.length - 1 && parent.items[end + 1].type === 'radio') end++;
    for (let i = start; i <= end; i++) {
      parent.items[i].checked = i === idx;
    }
  };

  const EDIT_ROLES = new Set([
    'undo',
    'redo',
    'cut',
    'copy',
    'paste',
    'pasteAndMatchStyle',
    'delete',
    'selectAll',
  ]);

  const applyMenuRole = (role: string): void => {
    const focused = BrowserWindow.getFocusedWindow();
    switch (role) {
      case 'quit':
        (app.quit as () => void)();
        break;
      case 'close':
        focused?.close();
        break;
      case 'minimize':
        focused?.minimize();
        break;
      case 'zoom':
        focused?.maximize();
        break;
      case 'reload':
      case 'forceReload':
        focused?.webContents.reload();
        break;
      default:
        if (EDIT_ROLES.has(role)) {
          // Best-effort: the renderer applies these via document.execCommand.
          focused?._postToRenderer({
            [ELECTRON_IPC_TAG]: true,
            kind: ELECTRON_IPC_KIND.menuRole,
            args: [role],
          });
        }
        break;
    }
  };

  const dispatchFromMap = (map: Map<string, MenuItem>, commandId: string): void => {
    const item = map.get(commandId);
    if (!item || !item.enabled) return;
    if (item.type === 'checkbox') {
      item.checked = !item.checked;
    } else if (item.type === 'radio') {
      selectRadioItem(item);
    }
    if (item.role) applyMenuRole(item.role);
    item.click?.(item, BrowserWindow.getFocusedWindow(), {
      triggeredByAccelerator: false,
    });
  };
  const dispatchMenuCommand = (commandId: string): void =>
    dispatchFromMap(menuCommandMap, commandId);

  const publishApplicationMenu = (): void => {
    const host = resolveHost();
    if (!host.setApplicationMenu) return;
    // Detach the previous tree so stale items no longer trigger republish.
    for (const item of menuCommandMap.values()) {
      item._onChange = null;
      if (item.submenu) item.submenu._published = false;
      if (item._parentMenu) item._parentMenu._published = false;
    }
    if (!applicationMenu) {
      menuCommandMap = new Map();
      host.setApplicationMenu(appInstanceId, null);
      return;
    }
    const map = new Map<string, MenuItem>();
    const items = serializeMenu(applicationMenu, map);
    menuCommandMap = map;
    host.setApplicationMenu(appInstanceId, {
      appInstanceId,
      appId: electronAppId(),
      appName: appName(),
      items,
      onCommand: dispatchMenuCommand,
    });
  };

  // A quitting app must not leave its menu in the host menu bar.
  app.on('quit', () => {
    applicationMenu = null;
    publishApplicationMenu();
  });

  // -- dialog (host-backed; sync variants unavailable in the browser) --------
  // Electron allows an optional leading BrowserWindow (modal parent) arg.
  const dialogOptions = (args: unknown[]): Record<string, unknown> => {
    const options = args[0] instanceof BrowserWindow ? args[1] : args[0];
    return (options ?? {}) as Record<string, unknown>;
  };
  const showHostDialog = async (
    request: Record<string, unknown>,
  ): Promise<Record<string, unknown> | null> => {
    const host = resolveHost();
    if (!host.showDialog) return null;
    return (await host.showDialog(
      request as never,
    )) as unknown as Record<string, unknown>;
  };
  const dialog = {
    showOpenDialog: async (...args: unknown[]) => {
      const o = dialogOptions(args);
      const result = await showHostDialog({
        kind: 'open',
        title: o.title,
        defaultPath: o.defaultPath,
        buttonLabel: o.buttonLabel,
        filters: o.filters,
        properties: o.properties,
        message: o.message,
      });
      if (!result) return { canceled: true, filePaths: [] as string[] };
      return {
        canceled: !!result.canceled,
        filePaths: (result.filePaths as string[]) ?? [],
      };
    },
    showOpenDialogSync: () => undefined,
    showSaveDialog: async (...args: unknown[]) => {
      const o = dialogOptions(args);
      const result = await showHostDialog({
        kind: 'save',
        title: o.title,
        defaultPath: o.defaultPath,
        buttonLabel: o.buttonLabel,
        filters: o.filters,
        message: o.message,
      });
      if (!result) return { canceled: true, filePath: undefined };
      return {
        canceled: !!result.canceled,
        filePath: result.filePath as string | undefined,
      };
    },
    showSaveDialogSync: () => undefined,
    showMessageBox: async (...args: unknown[]) => {
      const o = dialogOptions(args);
      const result = await showHostDialog({
        kind: 'message',
        title: o.title,
        type: o.type,
        message: o.message,
        detail: o.detail,
        buttons: o.buttons,
        defaultId: o.defaultId,
        cancelId: o.cancelId,
        checkboxLabel: o.checkboxLabel,
        checkboxChecked: o.checkboxChecked,
      });
      if (!result) return { response: 0, checkboxChecked: false };
      return {
        response: (result.response as number) ?? 0,
        checkboxChecked: !!result.checkboxChecked,
      };
    },
    showMessageBoxSync: () => 0,
    showErrorBox: (title: string, content: string) => {
      void showHostDialog({
        kind: 'message',
        type: 'error',
        message: title,
        detail: content,
        buttons: ['OK'],
      });
    },
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
  // Backed by the host's real viewport when it exposes one; the static size is
  // only the headless/test fallback.
  const primaryDisplay = () => {
    const info = resolveHost().getScreenInfo?.() ?? null;
    const width = info?.width ?? 1280;
    const height = info?.height ?? 800;
    const workArea = info?.workArea ?? { x: 0, y: 0, width, height: height - 40 };
    return {
      id: 0,
      bounds: { x: 0, y: 0, width, height },
      workArea,
      workAreaSize: { width: workArea.width, height: workArea.height },
      size: { width, height },
      scaleFactor: 1,
      rotation: 0,
      internal: true,
      touchSupport: 'unknown',
    };
  };
  const screen = Object.assign(new EventEmitter(), {
    getPrimaryDisplay: () => primaryDisplay(),
    getAllDisplays: () => [primaryDisplay()],
    getDisplayNearestPoint: () => primaryDisplay(),
    getDisplayMatching: () => primaryDisplay(),
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

  // -- globalShortcut (page-focused keydown) --------------------------------
  // The main-process shim runs in the host page's JS context, so an accelerator
  // maps to a document keydown listener. Not truly global (only fires while the
  // page/desktop is focused), but functional for app-defined shortcuts.
  const shortcutDoc = (globalThis as { document?: Document }).document;
  const acceleratorMatches = (accelerator: string, e: KeyboardEvent): boolean => {
    const parts = accelerator.split('+').map((p) => p.trim().toLowerCase());
    const wantCtrlOrCmd = parts.some((p) =>
      ['cmdorctrl', 'commandorcontrol', 'cmd', 'command', 'super', 'meta', 'ctrl', 'control'].includes(p),
    );
    const wantShift = parts.includes('shift');
    const wantAlt = parts.includes('alt') || parts.includes('option');
    const key = parts[parts.length - 1];
    if (wantCtrlOrCmd && !(e.metaKey || e.ctrlKey)) return false;
    if (!wantCtrlOrCmd && (e.metaKey || e.ctrlKey)) return false;
    if (wantShift !== e.shiftKey) return false;
    if (wantAlt !== e.altKey) return false;
    const pressed = e.key.toLowerCase();
    return pressed === key || (key === 'plus' && pressed === '+');
  };
  const shortcuts = new Map<string, { handler: () => void; listener: (e: KeyboardEvent) => void }>();
  const globalShortcut = {
    register: (accelerator: string, callback: () => void): boolean => {
      if (!shortcutDoc) return false;
      const listener = (e: KeyboardEvent) => {
        if (acceleratorMatches(accelerator, e)) {
          e.preventDefault();
          callback();
        }
      };
      shortcutDoc.addEventListener('keydown', listener);
      shortcuts.set(accelerator, { handler: callback, listener });
      return true;
    },
    registerAll: (accelerators: string[], callback: () => void): void => {
      for (const a of accelerators) globalShortcut.register(a, callback);
    },
    isRegistered: (accelerator: string): boolean => shortcuts.has(accelerator),
    unregister: (accelerator: string): void => {
      const entry = shortcuts.get(accelerator);
      if (entry && shortcutDoc) shortcutDoc.removeEventListener('keydown', entry.listener);
      shortcuts.delete(accelerator);
    },
    unregisterAll: (): void => {
      for (const [, entry] of shortcuts) shortcutDoc?.removeEventListener('keydown', entry.listener);
      shortcuts.clear();
    },
  };

  // -- Notification (Web Notification API) / Tray ---------------------------
  const WebNotification = (globalThis as { Notification?: typeof globalThis.Notification }).Notification;
  class Notification extends EventEmitter {
    private native: globalThis.Notification | null = null;
    constructor(public options: Record<string, unknown> = {}) {
      super();
    }
    show(): void {
      if (!WebNotification) return;
      const opts = this.options;
      const fire = () => {
        try {
          this.native = new WebNotification(String(opts.title ?? ''), {
            body: opts.body ? String(opts.body) : undefined,
            silent: opts.silent === true,
          });
          this.native.onclick = () => this.emit('click');
          this.native.onclose = () => this.emit('close');
          this.emit('show');
        } catch {
          /* notification construction can throw if unsupported */
        }
      };
      if (WebNotification.permission === 'granted') fire();
      else if (WebNotification.permission !== 'denied') {
        void WebNotification.requestPermission().then((p) => {
          if (p === 'granted') fire();
        });
      }
    }
    close(): void {
      this.native?.close();
    }
    static isSupported(): boolean {
      return !!WebNotification;
    }
  }
  let trayIdSeq = 0;
  const trayIconDataUrl = (image: unknown): string | null => {
    const img =
      typeof image === 'string'
        ? (nativeImage.createFromPath(image) as { toDataURL?: () => string })
        : (image as { toDataURL?: () => string } | undefined);
    const url = img?.toDataURL?.();
    return url || null;
  };
  class Tray extends EventEmitter {
    private readonly trayId = ++trayIdSeq;
    private trayTitle = '';
    private tooltip = '';
    private icon: string | null;
    private menu: Menu | null = null;
    private destroyed = false;
    constructor(image?: unknown) {
      super();
      this.icon = trayIconDataUrl(image);
      this.publish();
    }
    setToolTip(tooltip: string): void {
      this.tooltip = tooltip;
      this.publish();
    }
    setContextMenu(menu: Menu | null): void {
      this.menu = menu;
      this.publish();
    }
    setImage(image: unknown): void {
      this.icon = trayIconDataUrl(image);
      this.publish();
    }
    setTitle(title: string): void {
      this.trayTitle = title;
      this.publish();
    }
    getTitle(): string {
      return this.trayTitle;
    }
    popUpContextMenu(menu?: Menu): void {
      (menu ?? this.menu)?.popup();
    }
    destroy(): void {
      if (this.destroyed) return;
      this.destroyed = true;
      resolveHost().setTray?.(this.trayId, null);
    }
    isDestroyed(): boolean {
      return this.destroyed;
    }
    private publish(): void {
      if (this.destroyed) return;
      const host = resolveHost();
      if (!host.setTray) return;
      let menu = null as null | { items: SerializedMenuItem[]; onCommand: (id: string) => void };
      if (this.menu) {
        const map = new Map<string, MenuItem>();
        const items = serializeMenu(this.menu, map, () => this.publish());
        menu = { items, onCommand: (commandId: string) => dispatchFromMap(map, commandId) };
      }
      host.setTray(this.trayId, {
        trayId: this.trayId,
        title: this.trayTitle,
        tooltip: this.tooltip,
        icon: this.icon,
        menu,
        onClick: () => this.emit('click'),
      });
    }
  }

  // -- session / protocol ---------------------------------------------------
  // Track registered/handled schemes so predicates are truthful. Custom-scheme
  // request *serving* still isn't wired into the service worker (a later phase),
  // but registration is now real state rather than a no-op.
  const registeredSchemes = new Set<string>();
  const schemeHandlers = new Map<string, AnyFn>();
  const protocol = {
    registerSchemesAsPrivileged: (schemes: Array<{ scheme?: string }> = []) => {
      for (const s of schemes) if (s.scheme) registeredSchemes.add(s.scheme);
    },
    registerFileProtocol: (scheme: string) => (registeredSchemes.add(scheme), true),
    registerStringProtocol: (scheme: string) => (registeredSchemes.add(scheme), true),
    registerBufferProtocol: (scheme: string) => (registeredSchemes.add(scheme), true),
    registerHttpProtocol: (scheme: string) => (registeredSchemes.add(scheme), true),
    registerStreamProtocol: (scheme: string) => (registeredSchemes.add(scheme), true),
    handle: (scheme: string, handler: AnyFn) => {
      schemeHandlers.set(scheme, handler);
      registeredSchemes.add(scheme);
    },
    unhandle: (scheme: string) => {
      schemeHandlers.delete(scheme);
    },
    isProtocolRegistered: (scheme: string) => registeredSchemes.has(scheme),
    isProtocolHandled: async (scheme: string) => schemeHandlers.has(scheme),
    unregisterProtocol: (scheme: string) => (registeredSchemes.delete(scheme), true),
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
