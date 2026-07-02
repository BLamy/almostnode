/**
 * Electron host seam.
 *
 * The `electron` main-process shim (`shims/electron.ts`) runs inside the
 * almostnode runtime and cannot touch the UI directly. Instead it asks a
 * registered *host* to create the windows that back `BrowserWindow`. Each host
 * window is an iframe rendered somewhere in the embedder (in almost-os, a real
 * window in the WindowManager); the returned handle exposes a postMessage
 * transport the shim uses for IPC.
 *
 * This mirrors the `setServerCloseCallback` / `NetworkIntegration` injection
 * pattern used elsewhere: a module-level registration seam with a safe default
 * (here, a headless host) so the shim and its unit tests work with no DOM.
 */

/** Bounds shared between the shim, the host, and the WindowManager. */
export interface ElectronWindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Subset of Electron's `BrowserWindowConstructorOptions` the host understands. */
export interface ElectronWindowOptions {
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
  /** `frame: false` renders without OS chrome (no titlebar/traffic lights). */
  frame?: boolean;
  /** Transparent window background. */
  transparent?: boolean;
  /** Preload script path (absolute VFS path), used by the renderer injector. */
  preload?: string;
  /** Identity of the app instance that owns this window (menu/dock association). */
  appInstanceId?: number;
  appId?: string;
  appName?: string;
}

/** Host display metrics backing the shim's `screen` module. */
export interface ElectronScreenInfo {
  width: number;
  height: number;
  workArea: { x: number; y: number; width: number; height: number };
}

// ---------------------------------------------------------------------------
// Dialogs — the shim's `dialog` module forwards to the host, which renders a
// real (VFS-backed) picker or message box and resolves with the outcome.
// ---------------------------------------------------------------------------

export interface ElectronFileFilter {
  name: string;
  extensions: string[];
}

export interface ElectronDialogRequest {
  kind: 'open' | 'save' | 'message';
  /** Dialog window title (open/save) or message-box title. */
  title?: string;
  /** open/save: initial directory or suggested file path. */
  defaultPath?: string;
  buttonLabel?: string;
  filters?: ElectronFileFilter[];
  /** open: Electron properties ('openFile' | 'openDirectory' | 'multiSelections' | ...). */
  properties?: string[];
  /** message: body text + secondary detail. */
  message?: string;
  detail?: string;
  /** message: button labels (default ['OK']). */
  buttons?: string[];
  /** message: 'none' | 'info' | 'error' | 'question' | 'warning'. */
  type?: string;
  defaultId?: number;
  cancelId?: number;
  checkboxLabel?: string;
  checkboxChecked?: boolean;
}

export interface ElectronDialogResult {
  canceled: boolean;
  /** open */
  filePaths?: string[];
  /** save */
  filePath?: string;
  /** message: index of the clicked button */
  response?: number;
  checkboxChecked?: boolean;
}

export type ElectronWindowEvent =
  | 'closed'
  | 'focus'
  | 'blur'
  | 'ready-to-show'
  | 'resize'
  | 'move';

/**
 * A single host-backed window. The shim's `BrowserWindow`/`webContents` wrap
 * one of these. All UI concerns (rendering the iframe, dragging, z-order) live
 * behind this interface.
 */
export interface ElectronWindowHandle {
  readonly id: number;
  /** Point the window's iframe at a URL (renderer entry). */
  loadURL(url: string): Promise<void>;
  /** Point the window's iframe at a served file path. */
  loadFile(path: string): Promise<void>;
  /** Send a message into the renderer (main -> renderer). */
  postMessage(message: unknown): void;
  /** Subscribe to messages coming out of the renderer (renderer -> main). */
  onMessage(listener: (message: unknown) => void): void;
  setTitle(title: string): void;
  setBounds(bounds: Partial<ElectronWindowBounds>): void;
  getBounds(): ElectronWindowBounds;
  show(): void;
  hide(): void;
  focus(): void;
  blur(): void;
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  close(): void;
  isDestroyed(): boolean;
  on(event: ElectronWindowEvent, listener: (...args: unknown[]) => void): void;
}

// ---------------------------------------------------------------------------
// Application menus — serialized template published by the shim's
// `Menu.setApplicationMenu`. Main processes run in the same JS context as the
// host, so menu click dispatch is a plain function call (`onCommand`), not a
// postMessage round-trip.
// ---------------------------------------------------------------------------

export type SerializedMenuItemType =
  | 'normal'
  | 'separator'
  | 'submenu'
  | 'checkbox'
  | 'radio';

export interface SerializedMenuItem {
  commandId: string;
  type: SerializedMenuItemType;
  label: string;
  enabled: boolean;
  visible: boolean;
  checked?: boolean;
  accelerator?: string;
  role?: string;
  submenu?: SerializedMenuItem[];
}

export interface ElectronApplicationMenu {
  appInstanceId: number;
  appId: string;
  appName: string;
  items: SerializedMenuItem[];
  /** Same-context callback into the shim; dispatches the item's behavior. */
  onCommand: (commandId: string) => void;
}

/** A context menu popped up via `Menu.popup(...)`, rendered at a screen point. */
export interface ElectronContextMenu {
  items: SerializedMenuItem[];
  onCommand: (commandId: string) => void;
}

/** A `Tray` instance, surfaced as a menu-bar extra. */
export interface ElectronTray {
  trayId: number;
  title: string;
  tooltip: string;
  /** Icon as a data URL, or null. */
  icon: string | null;
  /** Context menu (from setContextMenu), shown on click; null if none. */
  menu: ElectronContextMenu | null;
  /** Fired when the extra is clicked. */
  onClick: () => void;
}

let appInstanceCounter = 0;

/** One id per shim instance (i.e. per running Electron app). */
export function allocateElectronAppInstanceId(): number {
  return ++appInstanceCounter;
}

/** The embedder-provided window factory. */
export interface ElectronHost {
  createWindow(options: ElectronWindowOptions): ElectronWindowHandle;
  /**
   * Render (or clear, with null) the application menu for an app instance.
   * Optional: headless hosts and tests may omit it.
   */
  setApplicationMenu?(
    appInstanceId: number,
    menu: ElectronApplicationMenu | null,
  ): void;
  /** Real display metrics for the shim's `screen` module (null = not ready). */
  getScreenInfo?(): ElectronScreenInfo | null;
  /** Show a file picker / message box. Optional: absent → dialogs cancel. */
  showDialog?(request: ElectronDialogRequest): Promise<ElectronDialogResult>;
  /** Pop up a context menu at a point (Menu.popup). Optional: absent → no-op. */
  showContextMenu?(menu: ElectronContextMenu, position: { x: number; y: number }): void;
  /** Dismiss the active context menu (Menu.closePopup). */
  closeContextMenu?(): void;
  /** Create/update (tray) or remove (null) a menu-bar-extra tray icon. */
  setTray?(trayId: number, tray: ElectronTray | null): void;
}

// ---------------------------------------------------------------------------
// IPC wire protocol — shared contract between the main shim (electron.ts) and
// the injected renderer bridge (electron-preload.ts). Kept here so both sides
// import the same string constants and cannot drift.
// ---------------------------------------------------------------------------

/** Tag distinguishing our IPC envelopes from unrelated postMessages. */
export const ELECTRON_IPC_TAG = '__almostElectronIpc' as const;

export const ELECTRON_IPC_KIND = {
  /** renderer -> main: ipcRenderer.invoke(channel, ...args) */
  invoke: 'invoke',
  /** main -> renderer: reply to an invoke, correlated by id */
  invokeReply: 'invoke-reply',
  /** renderer -> main: ipcRenderer.send(channel, ...args) */
  send: 'send',
  /** main -> renderer: webContents.send(channel, ...args) */
  event: 'event',
  /** renderer -> main: preload bridge is installed and listening */
  rendererReady: 'renderer-ready',
  /** main -> renderer: apply an edit-role menu command (best-effort execCommand) */
  menuRole: 'menu-role',
} as const;

export type ElectronIpcKind =
  (typeof ELECTRON_IPC_KIND)[keyof typeof ELECTRON_IPC_KIND];

export interface ElectronIpcError {
  message: string;
  name?: string;
  stack?: string;
}

export interface ElectronIpcEnvelope {
  [ELECTRON_IPC_TAG]: true;
  kind: ElectronIpcKind;
  /** Correlation id for invoke/invoke-reply. */
  id?: number;
  channel?: string;
  args?: unknown[];
  /** invoke-reply success flag. */
  ok?: boolean;
  error?: ElectronIpcError;
}

/** Narrowing helper for messages arriving over a window handle. */
export function isElectronIpcEnvelope(value: unknown): value is ElectronIpcEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>)[ELECTRON_IPC_TAG] === true &&
    typeof (value as Record<string, unknown>).kind === 'string'
  );
}

// ---------------------------------------------------------------------------
// Registration seam + headless default
// ---------------------------------------------------------------------------

let currentHost: ElectronHost | null = null;

/** Register the host that backs `BrowserWindow`. Pass null to clear. */
export function setElectronHost(host: ElectronHost | null): void {
  currentHost = host;
}

/** Whether a real (non-headless) host is registered. */
export function hasElectronHost(): boolean {
  return currentHost !== null;
}

/** The active host, falling back to a headless no-op host. */
export function getElectronHost(): ElectronHost {
  return currentHost ?? headlessHost;
}

let headlessWindowId = 0;

/**
 * A host that renders nothing. Windows still model their own lifecycle and a
 * loopback-free message channel so main-process code (and unit tests that do
 * not inject a fake host) run without a DOM.
 */
export function createHeadlessElectronWindow(
  options: ElectronWindowOptions,
): ElectronWindowHandle {
  const id = ++headlessWindowId;
  const bounds: ElectronWindowBounds = {
    x: options.x ?? 0,
    y: options.y ?? 0,
    width: options.width ?? 800,
    height: options.height ?? 600,
  };
  const events = new Map<ElectronWindowEvent, Array<(...args: unknown[]) => void>>();
  let destroyed = false;
  const emit = (event: ElectronWindowEvent, ...args: unknown[]): void => {
    for (const listener of events.get(event) ?? []) listener(...args);
  };
  return {
    id,
    loadURL: async () => {},
    loadFile: async () => {},
    postMessage: () => {},
    onMessage: () => {},
    setTitle: () => {},
    setBounds: (next) => {
      Object.assign(bounds, next);
    },
    getBounds: () => ({ ...bounds }),
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
      emit('closed');
    },
    isDestroyed: () => destroyed,
    on: (event, listener) => {
      const list = events.get(event) ?? [];
      list.push(listener);
      events.set(event, list);
    },
  };
}

const headlessHost: ElectronHost = {
  createWindow: (options) => createHeadlessElectronWindow(options),
};
