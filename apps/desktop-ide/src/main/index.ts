import { app, BrowserWindow, ipcMain, Menu } from 'electron';
import fs from 'node:fs';
import { createServer as createHttpServer, type Server as HttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, extname, join, resolve as resolvePath, sep as pathSeparator } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawn as spawnPty, type IPty } from 'node-pty';
import { invokeRendererForWindowId, setupAlmostNodeBridge } from './almostnode-bridge';
import {
  getAlmostnodeBridgeShellPath,
  getAlmostnodeBridgeShimDirectoryPath,
  setupAlmostnodeCommandBridgeServer,
  stopAlmostnodeCommandBridgeServer,
} from './almostnode-command-bridge';
import { ensureAlmostnodeToolingCliWrappers } from './oxc-tooling-cli';
import {
  clearProjectSessionForSender,
  createWorkspaceProject,
  ensureProjectRootDirectory,
  getActiveProjectDirectoryForSender,
  getProjectRootDirectory,
  setupProjectStorageHandlers,
} from './project-storage';
import { normalizeTemplateId } from './project-template-inference';
import type { TemplateId } from './project-types';

type WindowRole = 'splash' | 'project';

type ProjectBootstrapIntent =
  | { kind: 'workspace'; projectId: string }
  | { kind: 'template'; templateId: TemplateId };

interface ManagedWindowState {
  role: WindowRole;
  bootstrapIntent: ProjectBootstrapIntent | null;
  projectKey: string | null;
}

interface TerminalSession {
  pty: IPty;
  senderId: number;
}

interface ProjectDirectoryWatcherSession {
  watcher: fs.FSWatcher;
  rootDirectory: string;
}

interface TerminalCommand {
  file: string;
  args: string[];
}

interface RendererHttpServerState {
  origin: string;
  server: HttpServer;
}

interface TerminalCreatePayload {
  cols?: number;
  rows?: number;
  cwd?: string;
  shell?: string;
  env?: Record<string, string>;
  routeCommandsToBridge?: boolean;
}

interface TerminalWritePayload {
  terminalId: string;
  data: string;
}

interface TerminalResizePayload {
  terminalId: string;
  cols: number;
  rows: number;
}

interface TerminalKillPayload {
  terminalId: string;
}

const terminalSessions = new Map<string, TerminalSession>();
const projectDirectoryWatchers = new Map<number, ProjectDirectoryWatcherSession>();
const managedWindows = new Map<number, ManagedWindowState>();
const projectKeyToWindowId = new Map<string, number>();
let splashWindowId: number | null = null;
let nodePtyHelperPermissionsEnsured = false;
let appIsQuitting = false;
let rendererHttpServerState: RendererHttpServerState | null = null;
let rendererHttpServerPromise: Promise<RendererHttpServerState> | null = null;
const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

function toProjectKey(intent: ProjectBootstrapIntent): string | null {
  if (intent.kind === 'workspace') {
    return `workspace:${intent.projectId}`;
  }
  return null;
}

function getManagedWindowState(windowId: number): ManagedWindowState | null {
  return managedWindows.get(windowId) ?? null;
}

function focusWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) {
    win.restore();
  }
  win.show();
  win.focus();
}

function getProjectWindows(): BrowserWindow[] {
  return BrowserWindow.getAllWindows().filter((win) => {
    const state = getManagedWindowState(win.webContents.id);
    return state?.role === 'project';
  });
}

function focusProjectWindowByKey(projectKey: string): BrowserWindow | null {
  const existingId = projectKeyToWindowId.get(projectKey);
  if (!existingId) return null;

  const existing = BrowserWindow.fromId(existingId);
  if (!existing || existing.isDestroyed()) {
    projectKeyToWindowId.delete(projectKey);
    return null;
  }

  focusWindow(existing);
  return existing;
}

function getSplashWindow(): BrowserWindow | null {
  if (typeof splashWindowId === 'number') {
    const splash = BrowserWindow.fromId(splashWindowId);
    if (splash && !splash.isDestroyed()) {
      return splash;
    }
    splashWindowId = null;
  }

  for (const win of BrowserWindow.getAllWindows()) {
    const state = getManagedWindowState(win.webContents.id);
    if (state?.role === 'splash') {
      splashWindowId = win.id;
      return win;
    }
  }

  return null;
}

function hideSplashWindow(): void {
  const splash = getSplashWindow();
  if (!splash || splash.isDestroyed()) return;
  splash.hide();
}

function normalizeOptionalDirectory(candidate: string | null | undefined): string | null {
  if (typeof candidate !== 'string') return null;
  const trimmed = candidate.trim();
  if (!trimmed) return null;
  return resolvePath(trimmed);
}

function pathContainsDirectory(rootDirectory: string, candidateDirectory: string): boolean {
  if (candidateDirectory === rootDirectory) {
    return true;
  }
  const rootWithSeparator = rootDirectory.endsWith(pathSeparator) ? rootDirectory : `${rootDirectory}${pathSeparator}`;
  return candidateDirectory.startsWith(rootWithSeparator);
}

function resolveProjectWindowIdForDirectory(
  cwd: string | null,
  projectDirectory: string | null,
): number | null {
  const targetDirectory = normalizeOptionalDirectory(cwd) ?? normalizeOptionalDirectory(projectDirectory);
  const projectWindows = getProjectWindows();

  let bestWindowId: number | null = null;
  let bestRootLength = -1;

  for (const win of projectWindows) {
    if (win.isDestroyed()) continue;
    const activeProjectDirectory = getActiveProjectDirectoryForSender(win.webContents.id);
    const normalizedActiveProjectDirectory = normalizeOptionalDirectory(activeProjectDirectory);
    if (!normalizedActiveProjectDirectory) continue;

    if (!targetDirectory) {
      if (bestWindowId === null) {
        bestWindowId = win.id;
      }
      continue;
    }

    if (!pathContainsDirectory(normalizedActiveProjectDirectory, targetDirectory)) {
      continue;
    }

    if (normalizedActiveProjectDirectory.length > bestRootLength) {
      bestWindowId = win.id;
      bestRootLength = normalizedActiveProjectDirectory.length;
    }
  }

  if (bestWindowId !== null) {
    return bestWindowId;
  }

  if (projectWindows.length === 1) {
    return projectWindows[0]?.id ?? null;
  }

  return null;
}

function sanitizeTerminalCols(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 120;
  return Math.min(400, Math.max(20, Math.floor(value)));
}

function sanitizeTerminalRows(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 30;
  return Math.min(200, Math.max(5, Math.floor(value)));
}

function resolveTerminalCwd(candidate: string | undefined, senderId: number): string {
  if (typeof candidate === 'string' && candidate.trim().length > 0) {
    const resolved = resolvePath(candidate.trim());
    try {
      fs.mkdirSync(resolved, { recursive: true });
      if (fs.statSync(resolved).isDirectory()) {
        return resolved;
      }
    } catch {
      // Fall through to default cwd.
    }
  }

  const activeProjectDirectory = getActiveProjectDirectoryForSender(senderId);
  if (activeProjectDirectory) {
    try {
      fs.mkdirSync(activeProjectDirectory, { recursive: true });
      return activeProjectDirectory;
    } catch {
      // Fall through to projects root.
    }
  }

  const projectsRootDirectory = getProjectRootDirectory();
  if (projectsRootDirectory) {
    try {
      fs.mkdirSync(projectsRootDirectory, { recursive: true });
      return projectsRootDirectory;
    } catch {
      // Fall through to home.
    }
  }

  const home = app.getPath('home');
  if (home && fs.existsSync(home)) {
    return home;
  }
  return process.cwd();
}

function normalizeWatchedRelativePath(candidate: string): string | null {
  const normalized = candidate.replace(/\\/g, '/');
  const parts = normalized.split('/').filter((part) => part.length > 0);
  if (parts.length === 0) return null;

  for (const part of parts) {
    if (part === '.' || part === '..') {
      return null;
    }
  }

  return parts.join('/');
}

function shouldSkipWatchedFileSync(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return normalized === 'node_modules'
    || normalized.startsWith('node_modules/')
    || normalized === '.git'
    || normalized.startsWith('.git/');
}

function stopProjectDirectoryWatcherForSender(senderId: number): void {
  const watcherSession = projectDirectoryWatchers.get(senderId);
  if (!watcherSession) return;
  projectDirectoryWatchers.delete(senderId);

  try {
    watcherSession.watcher.close();
  } catch {
    // Ignore close errors.
  }
}

function startProjectDirectoryWatcherForSender(sender: Electron.WebContents, directory: string): void {
  stopProjectDirectoryWatcherForSender(sender.id);

  fs.mkdirSync(directory, { recursive: true });
  const rootDirectory = resolvePath(directory);
  const rootWithSeparator = rootDirectory.endsWith(pathSeparator)
    ? rootDirectory
    : `${rootDirectory}${pathSeparator}`;

  const watcher = fs.watch(
    rootDirectory,
    { recursive: process.platform === 'darwin' || process.platform === 'win32' },
    (eventType, filename) => {
      if (sender.isDestroyed()) return;

      const rawFilename = typeof filename === 'string'
        ? filename
        : filename
          ? String(filename)
          : '';
      if (!rawFilename) return;

      const relativeFilePath = normalizeWatchedRelativePath(rawFilename);
      if (!relativeFilePath || shouldSkipWatchedFileSync(relativeFilePath)) {
        return;
      }

      const absolutePath = resolvePath(rootDirectory, relativeFilePath);
      if (absolutePath !== rootDirectory && !absolutePath.startsWith(rootWithSeparator)) {
        return;
      }

      try {
        const stat = fs.statSync(absolutePath);
        if (stat.isDirectory()) {
          return;
        }

        const content = fs.readFileSync(absolutePath);
        sender.send('project-directory:file-changed', {
          kind: 'changed',
          relativePath: relativeFilePath,
          contentBase64: content.toString('base64'),
          eventType,
        });
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          sender.send('project-directory:file-changed', {
            kind: 'deleted',
            relativePath: relativeFilePath,
            eventType,
          });
        }
      }
    },
  );

  watcher.on('error', (error) => {
    if (sender.isDestroyed()) return;
    sender.send('project-directory:watch-error', {
      directory: rootDirectory,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  projectDirectoryWatchers.set(sender.id, { watcher, rootDirectory });
}

function ensureNodePtySpawnHelperPermissions(): void {
  if (nodePtyHelperPermissionsEnsured || process.platform !== 'darwin') {
    return;
  }

  nodePtyHelperPermissionsEnsured = true;
  try {
    const nodePtyEntry = require.resolve('node-pty');
    const nodePtyRoot = resolvePath(nodePtyEntry, '..', '..');
    const prebuildsDir = join(nodePtyRoot, 'prebuilds');
    if (!fs.existsSync(prebuildsDir)) return;

    for (const entry of fs.readdirSync(prebuildsDir)) {
      if (!entry.startsWith('darwin-')) continue;
      const helperPath = join(prebuildsDir, entry, 'spawn-helper');
      if (!fs.existsSync(helperPath)) continue;
      try {
        fs.accessSync(helperPath, fs.constants.X_OK);
      } catch {
        fs.chmodSync(helperPath, 0o755);
      }
    }
  } catch {
    // Ignore helper permission fixes when resolution fails.
  }
}

function sanitizeTerminalEnv(extraEnv?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') {
      env[key] = value;
    }
  }

  if (extraEnv) {
    for (const [key, value] of Object.entries(extraEnv)) {
      if (typeof value === 'string') {
        env[key] = value;
      }
    }
  }

  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  return env;
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function resolveTerminalCommandCandidates(payloadShell?: string): TerminalCommand[] {
  if (process.platform === 'win32') {
    const candidates = [
      typeof payloadShell === 'string' ? payloadShell.trim() : '',
      process.env.COMSPEC || '',
      'powershell.exe',
      'cmd.exe',
    ].filter((candidate, index, all) => candidate.length > 0 && all.indexOf(candidate) === index);

    return candidates.map((candidate) => ({ file: candidate, args: [] }));
  }

  const candidates = [
    typeof payloadShell === 'string' ? payloadShell.trim() : '',
    process.env.SHELL || '',
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
  ].filter((candidate, index, all) => candidate.length > 0 && all.indexOf(candidate) === index);

  const commands: TerminalCommand[] = [];
  for (const candidate of candidates) {
    if (candidate.includes('/')) {
      if (isExecutableFile(candidate)) {
        commands.push({ file: candidate, args: ['-l'] });
      }
    } else {
      commands.push({ file: candidate, args: ['-l'] });
    }
  }

  if (commands.length === 0) {
    commands.push({ file: '/bin/sh', args: ['-l'] });
  }

  return commands;
}

function destroyTerminalSession(terminalId: string): void {
  const terminalSession = terminalSessions.get(terminalId);
  if (!terminalSession) return;
  terminalSessions.delete(terminalId);
  try {
    terminalSession.pty.kill();
  } catch {
    // Ignore shutdown errors.
  }
}

function destroyTerminalSessionsForSender(senderId: number): void {
  for (const [terminalId, terminalSession] of terminalSessions.entries()) {
    if (terminalSession.senderId === senderId) {
      destroyTerminalSession(terminalId);
    }
  }
}

function getRendererContentType(filePath: string): string {
  switch (extname(filePath).toLowerCase()) {
    case '.css': return 'text/css; charset=utf-8';
    case '.html': return 'text/html; charset=utf-8';
    case '.js':
    case '.mjs': return 'application/javascript; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.png': return 'image/png';
    case '.svg': return 'image/svg+xml';
    case '.ttf': return 'font/ttf';
    case '.wasm': return 'application/wasm';
    default: return 'application/octet-stream';
  }
}

function setRendererResponseHeaders(res: ServerResponse, filePath: string): void {
  res.setHeader('Content-Type', getRendererContentType(filePath));
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cache-Control', filePath.endsWith('__sw__.js') ? 'no-cache' : 'public, max-age=0');
  if (filePath.endsWith('__sw__.js')) {
    res.setHeader('Service-Worker-Allowed', '/');
  }
}

function writeRendererResponse(
  res: ServerResponse,
  filePath: string,
  statusCode = 200,
): void {
  setRendererResponseHeaders(res, filePath);
  res.statusCode = statusCode;
  res.end(fs.readFileSync(filePath));
}

function writeRendererError(res: ServerResponse, statusCode: number, message: string): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.setHeader('Cross-Origin-Embedder-Policy', 'credentialless');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.end(message);
}

function normalizeRendererRequestPath(request: IncomingMessage): string | null {
  try {
    const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname;
    const decoded = decodeURIComponent(pathname);
    return decoded.startsWith('/') ? decoded : `/${decoded}`;
  } catch {
    return null;
  }
}

function resolveRendererAssetPath(rendererRoot: string, requestPath: string): string | null {
  const normalized = requestPath === '/' ? '/index.html' : requestPath;
  const rootWithSeparator = rendererRoot.endsWith(pathSeparator)
    ? rendererRoot
    : `${rendererRoot}${pathSeparator}`;
  const candidate = resolvePath(rendererRoot, `.${normalized}`);
  if (candidate !== rendererRoot && !candidate.startsWith(rootWithSeparator)) {
    return null;
  }
  try {
    if (fs.statSync(candidate).isFile()) {
      return candidate;
    }
  } catch {
    return null;
  }
  return null;
}

function shouldFallbackToRendererIndex(requestPath: string): boolean {
  const normalized = requestPath.replace(/\/+$/, '') || '/';
  if (normalized === '/' || normalized === '/index.html') {
    return true;
  }
  if (normalized.startsWith('/__virtual__/') || normalized.startsWith('/__api/')) {
    return false;
  }
  const basename = normalized.split('/').pop() ?? '';
  return !basename.includes('.');
}

function stopRendererHttpServer(): void {
  if (rendererHttpServerState) {
    try {
      rendererHttpServerState.server.close();
    } catch {
      // Ignore shutdown errors.
    }
  }
  rendererHttpServerState = null;
  rendererHttpServerPromise = null;
}

function ensureRendererHttpServer(): Promise<RendererHttpServerState> {
  if (rendererHttpServerState) {
    return Promise.resolve(rendererHttpServerState);
  }
  if (rendererHttpServerPromise) {
    return rendererHttpServerPromise;
  }

  rendererHttpServerPromise = new Promise<RendererHttpServerState>((resolve, reject) => {
    const rendererRoot = resolvePath(CURRENT_DIR, '../renderer');
    const server = createHttpServer((req, res) => {
      const requestPath = normalizeRendererRequestPath(req);
      if (!requestPath) {
        writeRendererError(res, 400, 'Invalid renderer request path');
        return;
      }

      const assetPath = resolveRendererAssetPath(rendererRoot, requestPath);
      if (assetPath) {
        writeRendererResponse(res, assetPath);
        return;
      }

      if (shouldFallbackToRendererIndex(requestPath)) {
        const indexPath = resolveRendererAssetPath(rendererRoot, '/index.html');
        if (!indexPath) {
          writeRendererError(res, 500, 'Renderer index.html is missing');
          return;
        }
        writeRendererResponse(res, indexPath);
        return;
      }

      writeRendererError(res, 404, 'Not found');
    });

    server.once('error', (error) => {
      rendererHttpServerPromise = null;
      reject(error);
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as AddressInfo | null;
      if (!address) {
        rendererHttpServerPromise = null;
        reject(new Error('Renderer HTTP server did not expose a listening address.'));
        return;
      }

      const state = {
        origin: `http://127.0.0.1:${address.port}`,
        server,
      };
      rendererHttpServerState = state;
      resolve(state);
    });
  }).catch((error) => {
    stopRendererHttpServer();
    throw error;
  });

  return rendererHttpServerPromise;
}

async function buildRendererLoadUrl(role: WindowRole): Promise<string> {
  if (process.env['ELECTRON_RENDERER_URL']) {
    const target = new URL(process.env['ELECTRON_RENDERER_URL']);
    target.searchParams.set('__desktop_role', role);
    return target.toString();
  }

  const { origin } = await ensureRendererHttpServer();
  const target = new URL(origin);
  target.searchParams.set('__desktop_role', role);
  return target.toString();
}

function registerWindowState(win: BrowserWindow, state: ManagedWindowState): void {
  managedWindows.set(win.webContents.id, state);

  if (state.role === 'project' && state.projectKey) {
    projectKeyToWindowId.set(state.projectKey, win.id);
  }
  if (state.role === 'splash') {
    splashWindowId = win.id;
  }
}

function unregisterWindowState(win: BrowserWindow, preCapturedWebContentsId?: number): void {
  const webContentsId = preCapturedWebContentsId ?? win.webContents.id;
  const state = getManagedWindowState(webContentsId);

  if (state?.projectKey) {
    const mappedWindowId = projectKeyToWindowId.get(state.projectKey);
    if (mappedWindowId === win.id) {
      projectKeyToWindowId.delete(state.projectKey);
    }
  }

  if (state?.role === 'splash' && splashWindowId === win.id) {
    splashWindowId = null;
  }

  managedWindows.delete(webContentsId);

  if (!appIsQuitting && state?.role === 'project' && getProjectWindows().length === 0) {
    const splash = ensureSplashWindow();
    focusWindow(splash);
  }
}

function createManagedWindow(
  role: WindowRole,
  bootstrapIntent: ProjectBootstrapIntent | null,
  projectKey: string | null,
): BrowserWindow {
  const win = new BrowserWindow({
    width: role === 'splash' ? 1120 : 1440,
    height: role === 'splash' ? 760 : 920,
    minWidth: role === 'splash' ? 920 : 1100,
    minHeight: role === 'splash' ? 680 : 760,
    show: false,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    backgroundColor: '#111111',
    webPreferences: {
      preload: join(CURRENT_DIR, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  registerWindowState(win, {
    role,
    bootstrapIntent,
    projectKey,
  });

  win.on('ready-to-show', () => {
    win.show();

    if (role === 'splash') {
      void ensureProjectRootDirectory(win)
        .then((selected) => {
          if (selected) {
            win.webContents.send('project-root:updated', selected);
          }
        })
        .catch(() => {
          // Ignore auto-choose failures.
        });
    }
  });

  void buildRendererLoadUrl(role)
    .then((targetUrl) => win.loadURL(targetUrl))
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      const fallbackHtml = `<!doctype html><html><body><pre>Failed to load almostnode desktop renderer.\n\n${message}</pre></body></html>`;
      return win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(fallbackHtml)}`);
    });

  const webContentsIdForCleanup = win.webContents.id;
  win.on('closed', () => {
    unregisterWindowState(win, webContentsIdForCleanup);
  });

  return win;
}

function ensureSplashWindow(): BrowserWindow {
  const existingSplash = getSplashWindow();
  if (existingSplash && !existingSplash.isDestroyed()) {
    existingSplash.show();
    return existingSplash;
  }

  return createManagedWindow('splash', null, null);
}

function openOrFocusProjectWindow(intent: ProjectBootstrapIntent): { action: 'opened' | 'focused'; window: BrowserWindow } {
  const projectKey = toProjectKey(intent);
  if (projectKey) {
    const focused = focusProjectWindowByKey(projectKey);
    if (focused) {
      hideSplashWindow();
      return { action: 'focused', window: focused };
    }
  }

  const win = createManagedWindow('project', intent, projectKey);
  hideSplashWindow();
  return { action: 'opened', window: win };
}

function setupApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Project Window',
          accelerator: 'CmdOrCtrl+N',
          click: () => {
            const splash = ensureSplashWindow();
            focusWindow(splash);
          },
        },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  setupApplicationMenu();
  setupProjectStorageHandlers();
  setupAlmostNodeBridge();
  await ensureAlmostnodeToolingCliWrappers();
  await setupAlmostnodeCommandBridgeServer({
    invokeRenderer: invokeRendererForWindowId,
    resolveProjectWindowId: resolveProjectWindowIdForDirectory,
  });

  ipcMain.handle('project-window:get-role', (event) => {
    const state = getManagedWindowState(event.sender.id);
    return { role: state?.role ?? 'splash' };
  });

  ipcMain.handle('project-window:get-bootstrap', (event) => {
    const state = getManagedWindowState(event.sender.id);
    if (!state || state.role !== 'project') return null;
    return state.bootstrapIntent;
  });

  ipcMain.handle('project-window:show-splash', () => {
    const splash = ensureSplashWindow();
    focusWindow(splash);
    return { shown: true };
  });

  ipcMain.handle('project-window:open-workspace', (_event, payload: { projectId?: unknown }) => {
    if (!payload || typeof payload.projectId !== 'string' || payload.projectId.trim().length === 0) {
      throw new Error('Invalid project-window:open-workspace payload.');
    }

    const result = openOrFocusProjectWindow({ kind: 'workspace', projectId: payload.projectId.trim() });
    return { action: result.action };
  });

  ipcMain.handle('project-window:create-from-template', async (event, payload: { templateId?: unknown }) => {
    const templateId = normalizeTemplateId(payload?.templateId);
    if (!templateId) {
      throw new Error('Invalid project-window:create-from-template payload.');
    }

    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const created = await createWorkspaceProject(templateId, win, undefined);
    openOrFocusProjectWindow({ kind: 'workspace', projectId: created.projectId });
    return { action: 'opened' as const, projectId: created.projectId };
  });

  ipcMain.handle('project-directory:watch-active', (event) => {
    const directory = getActiveProjectDirectoryForSender(event.sender.id);
    if (!directory) {
      stopProjectDirectoryWatcherForSender(event.sender.id);
      return { watching: false, directory: null };
    }

    startProjectDirectoryWatcherForSender(event.sender, directory);
    return { watching: true, directory };
  });

  ipcMain.handle('project-directory:unwatch', (event) => {
    stopProjectDirectoryWatcherForSender(event.sender.id);
    return { success: true };
  });

  ipcMain.handle('terminal:create', (event, payload: TerminalCreatePayload = {}) => {
    ensureNodePtySpawnHelperPermissions();

    const cols = sanitizeTerminalCols(payload.cols);
    const rows = sanitizeTerminalRows(payload.rows);
    const cwd = resolveTerminalCwd(payload.cwd, event.sender.id);
    const commandCandidates = resolveTerminalCommandCandidates(payload.shell);
    const env = sanitizeTerminalEnv(payload.env);
    if (payload.routeCommandsToBridge === true) {
      const preferredShell = commandCandidates[0]?.file;
      const activeProjectDirectory = getActiveProjectDirectoryForSender(event.sender.id);
      env.SHELL = getAlmostnodeBridgeShellPath();
      if (preferredShell) {
        env.ALMOSTNODE_REAL_SHELL = preferredShell;
      }
      if (activeProjectDirectory || cwd) {
        env.ALMOSTNODE_BRIDGE_PROJECT_DIR = activeProjectDirectory ?? cwd;
      }
      const shimDirectory = getAlmostnodeBridgeShimDirectoryPath();
      env.PATH = env.PATH ? `${shimDirectory}:${env.PATH}` : shimDirectory;
    }

    let selectedCommand: TerminalCommand | null = null;
    let pty: IPty | null = null;
    let lastError: unknown = null;

    for (const command of commandCandidates) {
      try {
        pty = spawnPty(command.file, command.args, {
          name: 'xterm-256color',
          cols,
          rows,
          cwd,
          env,
        });
        selectedCommand = command;
        break;
      } catch (error) {
        lastError = error;
      }
    }

    if (!pty || !selectedCommand) {
      const tried = commandCandidates
        .map((command) => `${command.file} ${command.args.join(' ')}`.trim())
        .join(', ');
      const reason = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`Unable to start terminal shell. Tried: ${tried}. Last error: ${reason}`);
    }

    const terminalId = randomUUID();
    const sender = event.sender;
    terminalSessions.set(terminalId, { pty, senderId: sender.id });

    pty.onData((data) => {
      if (!sender.isDestroyed()) {
        sender.send('terminal:data', { terminalId, data });
      }
    });

    pty.onExit(({ exitCode, signal }) => {
      terminalSessions.delete(terminalId);
      if (!sender.isDestroyed()) {
        sender.send('terminal:exit', { terminalId, exitCode, signal });
      }
    });

    return { terminalId, shell: selectedCommand.file, cwd };
  });

  ipcMain.on('terminal:write', (event, payload: TerminalWritePayload) => {
    if (!payload || typeof payload.terminalId !== 'string' || typeof payload.data !== 'string') {
      return;
    }
    const terminalSession = terminalSessions.get(payload.terminalId);
    if (!terminalSession || terminalSession.senderId !== event.sender.id) return;
    terminalSession.pty.write(payload.data);
  });

  ipcMain.on('terminal:resize', (event, payload: TerminalResizePayload) => {
    if (!payload || typeof payload.terminalId !== 'string') return;
    const terminalSession = terminalSessions.get(payload.terminalId);
    if (!terminalSession || terminalSession.senderId !== event.sender.id) return;

    const cols = sanitizeTerminalCols(payload.cols);
    const rows = sanitizeTerminalRows(payload.rows);
    terminalSession.pty.resize(cols, rows);
  });

  ipcMain.on('terminal:kill', (event, payload: TerminalKillPayload) => {
    if (!payload || typeof payload.terminalId !== 'string') return;
    const terminalSession = terminalSessions.get(payload.terminalId);
    if (!terminalSession || terminalSession.senderId !== event.sender.id) return;
    destroyTerminalSession(payload.terminalId);
  });

  ensureSplashWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      ensureSplashWindow();
      return;
    }

    const splash = getSplashWindow();
    if (splash) {
      focusWindow(splash);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  appIsQuitting = true;

  for (const terminalId of terminalSessions.keys()) {
    destroyTerminalSession(terminalId);
  }
  for (const senderId of projectDirectoryWatchers.keys()) {
    stopProjectDirectoryWatcherForSender(senderId);
  }

  void stopAlmostnodeCommandBridgeServer();
  stopRendererHttpServer();
});

app.on('web-contents-created', (_event, contents) => {
  contents.once('destroyed', () => {
    destroyTerminalSessionsForSender(contents.id);
    stopProjectDirectoryWatcherForSender(contents.id);
    clearProjectSessionForSender(contents.id);
  });
});

app.on('second-instance', () => {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused) {
    focusWindow(focused);
    return;
  }

  const splash = ensureSplashWindow();
  focusWindow(splash);
});
