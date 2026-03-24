import { app, BrowserWindow, dialog, ipcMain, type OpenDialogOptions } from 'electron';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ensureAlmostnodeClaudeBridgeFiles } from './claude-project-hooks';
import { PROJECT_ROOT, resolveProjectOutputPath, shouldSkipDiskPath } from './project-paths';
import { seedProjectDirectoryFromTemplate } from './project-template-seed';
import {
  inferTemplateIdFromProjectFiles,
  inferTitleFromProjectFiles,
} from './project-template-inference';
import type { LoadedProjectPayload, RecentProjectItem, SerializedFile, TemplateId } from './project-types';

interface AppSettings {
  projectRootDirectory: string | null;
}

interface ProjectFileApplyOpWrite {
  type: 'write';
  path: string;
  contentBase64: string;
}

interface ProjectFileApplyOpDelete {
  type: 'delete';
  path: string;
}

type ProjectFileApplyOp = ProjectFileApplyOpWrite | ProjectFileApplyOpDelete;

const SETTINGS_FILE_NAME = 'desktop-ide-settings.json';
const activeProjectIdsBySenderId = new Map<number, string>();

function getSettingsFilePath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILE_NAME);
}

function normalizeDirectory(candidate: string): string | null {
  const trimmed = candidate.trim();
  if (!trimmed) return null;

  const resolved = path.resolve(trimmed);
  try {
    const stats = fs.statSync(resolved);
    return stats.isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function readSettings(): AppSettings {
  const defaults: AppSettings = { projectRootDirectory: null };

  try {
    const settingsPath = getSettingsFilePath();
    if (!fs.existsSync(settingsPath)) return defaults;

    const raw = fs.readFileSync(settingsPath, 'utf8');
    const parsed = JSON.parse(raw) as Partial<AppSettings>;

    return {
      projectRootDirectory:
        typeof parsed.projectRootDirectory === 'string' ? parsed.projectRootDirectory : null,
    };
  } catch {
    return defaults;
  }
}

function writeSettings(settings: AppSettings): void {
  const settingsPath = getSettingsFilePath();
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf8');
}

function pathIsDirectChildDirectory(rootDirectory: string, childName: string): boolean {
  if (!childName || childName === '.' || childName === '..') return false;
  if (childName.includes('/') || childName.includes('\\')) return false;

  const root = path.resolve(rootDirectory);
  const childPath = path.resolve(root, childName);
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  return childPath.startsWith(rootWithSeparator);
}

function projectIdIsValid(projectId: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(projectId);
}

function readTextFromSerializedFiles(
  filesByPath: Map<string, SerializedFile>,
  targetPath: string,
): string | null {
  const target = filesByPath.get(targetPath);
  if (!target) return null;
  try {
    return Buffer.from(target.contentBase64, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

function resolveWorkspaceDirectory(projectId: string): string {
  if (!projectIdIsValid(projectId)) {
    throw new Error('Invalid project id.');
  }

  const rootDirectory = getProjectRootDirectory();
  if (!rootDirectory) {
    throw new Error('Project root directory is not configured.');
  }

  if (!pathIsDirectChildDirectory(rootDirectory, projectId)) {
    throw new Error('Invalid project id path.');
  }

  const projectDirectory = path.resolve(rootDirectory, projectId);
  if (!fs.existsSync(projectDirectory)) {
    throw new Error(`Workspace project does not exist: ${projectId}`);
  }
  if (!fs.statSync(projectDirectory).isDirectory()) {
    throw new Error(`Workspace project is not a directory: ${projectId}`);
  }
  return projectDirectory;
}

function collectWorkspaceFiles(directoryPath: string, basePath: string, out: SerializedFile[]): void {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const absoluteEntryPath = path.resolve(directoryPath, entry.name);
    const relativeEntryPath = path.relative(basePath, absoluteEntryPath).replace(/\\/g, '/');
    if (!relativeEntryPath || relativeEntryPath.startsWith('../') || shouldSkipDiskPath(relativeEntryPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      collectWorkspaceFiles(absoluteEntryPath, basePath, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const content = fs.readFileSync(absoluteEntryPath);
    out.push({
      path: `${PROJECT_ROOT}/${relativeEntryPath}`,
      contentBase64: content.toString('base64'),
    });
  }
}

function collectWorkspaceProjectPaths(directoryPath: string, basePath: string, out: string[]): void {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    const absoluteEntryPath = path.resolve(directoryPath, entry.name);
    const relativeEntryPath = path.relative(basePath, absoluteEntryPath).replace(/\\/g, '/');
    if (!relativeEntryPath || relativeEntryPath.startsWith('../') || shouldSkipDiskPath(relativeEntryPath)) {
      continue;
    }

    if (entry.isDirectory()) {
      collectWorkspaceProjectPaths(absoluteEntryPath, basePath, out);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    out.push(`${PROJECT_ROOT}/${relativeEntryPath}`);
  }
}

function directoryHasUserProjectFiles(directoryPath: string): boolean {
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (entry.name === '.claude' || entry.name === '.almostnode') {
      continue;
    }
    return true;
  }

  return false;
}

function buildLoadedWorkspacePayload(projectId: string, projectDirectory: string): LoadedProjectPayload {
  const projectPaths: string[] = [];
  collectWorkspaceProjectPaths(projectDirectory, projectDirectory, projectPaths);

  const readTextFile = (targetPath: string): string | null => {
    const normalized = targetPath.replace(/\\/g, '/');
    if (
      normalized === PROJECT_ROOT
      || normalized === `${PROJECT_ROOT}/`
      || !normalized.startsWith(`${PROJECT_ROOT}/`)
    ) {
      return null;
    }

    const relativePath = normalized.slice(PROJECT_ROOT.length + 1);
    if (shouldSkipDiskPath(relativePath)) {
      return null;
    }

    const absolutePath = path.resolve(projectDirectory, relativePath);
    const projectRoot = projectDirectory.endsWith(path.sep) ? projectDirectory : `${projectDirectory}${path.sep}`;
    if (absolutePath !== projectDirectory && !absolutePath.startsWith(projectRoot)) {
      return null;
    }
    if (!fs.existsSync(absolutePath)) {
      return null;
    }

    try {
      return fs.readFileSync(absolutePath, 'utf8');
    } catch {
      return null;
    }
  };

  const templateId = inferTemplateIdFromProjectFiles(projectPaths, readTextFile);
  const title = inferTitleFromProjectFiles(`Project ${projectId.slice(0, 6)}`, readTextFile);

  return {
    projectId,
    projectDirectory,
    templateId,
    title,
  };
}

function normalizeIsoDate(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const normalized = new Date(value);
  if (Number.isNaN(normalized.getTime())) return new Date().toISOString();
  return normalized.toISOString();
}

function getWorkspaceRecentItems(): RecentProjectItem[] {
  const rootDirectory = getProjectRootDirectory();
  if (!rootDirectory || !fs.existsSync(rootDirectory)) {
    return [];
  }

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(rootDirectory, { withFileTypes: true });
  } catch {
    return [];
  }

  const workspaceItems: RecentProjectItem[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (!pathIsDirectChildDirectory(rootDirectory, entry.name)) continue;

    const projectId = entry.name;
    const projectDirectory = path.resolve(rootDirectory, projectId);
    let directoryStats: fs.Stats | null = null;
    try {
      directoryStats = fs.statSync(projectDirectory);
    } catch {
      directoryStats = null;
    }
    if (!directoryStats || !directoryStats.isDirectory()) {
      continue;
    }

    const projectPaths: string[] = [];
    try {
      collectWorkspaceProjectPaths(projectDirectory, projectDirectory, projectPaths);
    } catch {
      continue;
    }
    if (projectPaths.length === 0) continue;

    const templateId = inferTemplateIdFromProjectFiles(
      projectPaths,
      (targetPath) => {
        const normalized = targetPath.replace(/\\/g, '/');
        if (
          normalized === PROJECT_ROOT
          || normalized === `${PROJECT_ROOT}/`
          || !normalized.startsWith(`${PROJECT_ROOT}/`)
        ) {
          return null;
        }
        const relative = normalized.slice(PROJECT_ROOT.length + 1);
        if (shouldSkipDiskPath(relative)) return null;
        const diskPath = path.resolve(projectDirectory, relative);
        if (!diskPath.startsWith(projectDirectory)) return null;
        if (!fs.existsSync(diskPath)) return null;
        try {
          return fs.readFileSync(diskPath, 'utf8');
        } catch {
          return null;
        }
      },
    );

    const title = inferTitleFromProjectFiles(
      `Project ${projectId.slice(0, 6)}`,
      (targetPath) => {
        const normalized = targetPath.replace(/\\/g, '/');
        if (
          normalized === PROJECT_ROOT
          || normalized === `${PROJECT_ROOT}/`
          || !normalized.startsWith(`${PROJECT_ROOT}/`)
        ) {
          return null;
        }
        const relative = normalized.slice(PROJECT_ROOT.length + 1);
        if (shouldSkipDiskPath(relative)) return null;
        const diskPath = path.resolve(projectDirectory, relative);
        if (!diskPath.startsWith(projectDirectory)) return null;
        if (!fs.existsSync(diskPath)) return null;
        try {
          return fs.readFileSync(diskPath, 'utf8');
        } catch {
          return null;
        }
      },
    );

    workspaceItems.push({
      id: `workspace:${projectId}`,
      title,
      templateId,
      lastOpenedAt: normalizeIsoDate(directoryStats.mtime),
      projectId,
      projectDirectory,
    });
  }

  return workspaceItems.sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt));
}

export function getProjectRootDirectory(): string | null {
  const settings = readSettings();
  if (!settings.projectRootDirectory) return null;

  const normalized = normalizeDirectory(settings.projectRootDirectory);
  if (!normalized) return null;

  if (normalized !== settings.projectRootDirectory) {
    writeSettings({ ...settings, projectRootDirectory: normalized });
  }

  return normalized;
}

function setProjectRootDirectory(directory: string): string {
  const resolved = path.resolve(directory);
  fs.mkdirSync(resolved, { recursive: true });
  writeSettings({ ...readSettings(), projectRootDirectory: resolved });
  return resolved;
}

export async function promptForProjectRootDirectory(
  window?: BrowserWindow,
): Promise<string | null> {
  const dialogOptions: OpenDialogOptions = {
    title: 'Choose a folder for almostnode desktop projects',
    buttonLabel: 'Use Folder',
    properties: ['openDirectory', 'createDirectory'],
  };

  const focusedWindow = window ?? BrowserWindow.getFocusedWindow();
  const result = focusedWindow
    ? await dialog.showOpenDialog(focusedWindow, dialogOptions)
    : await dialog.showOpenDialog(dialogOptions);

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return setProjectRootDirectory(result.filePaths[0]);
}

export async function ensureProjectRootDirectory(window?: BrowserWindow): Promise<string | null> {
  const existing = getProjectRootDirectory();
  if (existing) return existing;
  return promptForProjectRootDirectory(window);
}

function generateProjectId(): string {
  const seed = `${Date.now()}:${randomUUID()}`;
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function normalizeTemplateIdOrDefault(value: unknown): TemplateId {
  return (value === 'vite' || value === 'nextjs' || value === 'tanstack') ? value : 'vite';
}

export function listRecentProjects(): RecentProjectItem[] {
  return getWorkspaceRecentItems();
}

export function getActiveProjectIdForSender(senderId: number): string | null {
  const value = activeProjectIdsBySenderId.get(senderId);
  return typeof value === 'string' ? value : null;
}

export function setActiveProjectIdForSender(senderId: number, projectId: string | null): string | null {
  if (!projectId) {
    activeProjectIdsBySenderId.delete(senderId);
    return null;
  }
  activeProjectIdsBySenderId.set(senderId, projectId);
  return projectId;
}

export function getActiveProjectDirectoryForSender(senderId: number): string | null {
  const rootDirectory = getProjectRootDirectory();
  const activeProjectId = getActiveProjectIdForSender(senderId);
  if (!rootDirectory || !activeProjectId) return null;
  return path.resolve(rootDirectory, activeProjectId);
}

export function clearProjectSessionForSender(senderId: number): void {
  activeProjectIdsBySenderId.delete(senderId);
}

async function applyProjectOps(senderId: number, ops: ProjectFileApplyOp[]): Promise<{ appliedCount: number }> {
  const rootDirectory = getProjectRootDirectory();
  const activeProjectId = getActiveProjectIdForSender(senderId);
  if (!rootDirectory || !activeProjectId) {
    return { appliedCount: 0 };
  }

  let appliedCount = 0;
  for (const op of ops) {
    if (!op || typeof op.path !== 'string') {
      continue;
    }

    const outputPath = resolveProjectOutputPath(rootDirectory, activeProjectId, op.path);
    if (op.type === 'delete') {
      await fs.promises.rm(outputPath, { recursive: true, force: true });
      appliedCount += 1;
      continue;
    }

    if (op.type === 'write' && typeof op.contentBase64 === 'string') {
      await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.promises.writeFile(outputPath, Buffer.from(op.contentBase64, 'base64'));
      appliedCount += 1;
    }
  }

  return { appliedCount };
}

function seedActiveProjectDirectoryIfEmpty(senderId: number, templateId: TemplateId): { seeded: boolean; projectDirectory: string | null } {
  const projectDirectory = getActiveProjectDirectoryForSender(senderId);
  if (!projectDirectory) {
    return { seeded: false, projectDirectory: null };
  }

  if (directoryHasUserProjectFiles(projectDirectory)) {
    return { seeded: false, projectDirectory };
  }

  seedProjectDirectoryFromTemplate(projectDirectory, templateId);
  return { seeded: true, projectDirectory };
}

function streamWorkspaceFilesToSender(sender: Electron.WebContents, projectDirectory: string): { streamedCount: number } {
  const files: SerializedFile[] = [];
  collectWorkspaceFiles(projectDirectory, projectDirectory, files);

  for (const file of files) {
    const relativePath = file.path.startsWith(`${PROJECT_ROOT}/`)
      ? file.path.slice(PROJECT_ROOT.length + 1)
      : file.path;
    sender.send('project-directory:file-changed', {
      kind: 'changed',
      relativePath,
      contentBase64: file.contentBase64,
      eventType: 'hydrate',
    });
  }

  sender.send('project-directory:hydration-complete', {
    projectDirectory,
    streamedCount: files.length,
  });

  return { streamedCount: files.length };
}

export function openWorkspaceProject(projectId: string): LoadedProjectPayload {
  const workspaceDirectory = resolveWorkspaceDirectory(projectId);
  const payload = buildLoadedWorkspacePayload(projectId, workspaceDirectory);

  try {
    const now = new Date();
    fs.utimesSync(workspaceDirectory, now, now);
  } catch {
    // Ignore timestamp update failures.
  }

  return payload;
}

export async function createWorkspaceProject(
  templateId: TemplateId,
  window?: BrowserWindow,
  senderId?: number,
): Promise<{ projectId: string; projectDirectory: string }> {
  console.log(`[desktop-projects] createWorkspaceProject template=${templateId}`);
  const rootDirectory = await ensureProjectRootDirectory(window);
  if (!rootDirectory) {
    throw new Error('Project root directory is not configured.');
  }

  const projectId = generateProjectId();
  const projectDirectory = path.resolve(rootDirectory, projectId);
  await fs.promises.mkdir(projectDirectory, { recursive: true });
  seedProjectDirectoryFromTemplate(projectDirectory, templateId);
  await ensureAlmostnodeClaudeBridgeFiles(projectDirectory);
  console.log(`[desktop-projects] created ${projectId} at ${projectDirectory}`);
  if (typeof senderId === 'number') {
    setActiveProjectIdForSender(senderId, projectId);
  }
  return { projectId, projectDirectory };
}

export function setupProjectStorageHandlers(): void {
  ipcMain.handle('project-root:get', () => {
    return getProjectRootDirectory();
  });

  ipcMain.handle('project-root:choose', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const selected = await promptForProjectRootDirectory(win);
    if (selected) {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send('project-root:updated', selected);
      }
    }
    return selected;
  });

  ipcMain.handle('project-library:list', () => {
    return listRecentProjects();
  });

  ipcMain.handle('project-library:create', async (event, payload: { templateId?: unknown } = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    try {
      return await createWorkspaceProject(normalizeTemplateIdOrDefault(payload?.templateId), win, event.sender.id);
    } catch (error) {
      if (error instanceof Error && error.message === 'Project root directory is not configured.') {
        return null;
      }
      throw error;
    }
  });

  ipcMain.handle('project-session:start', async (event, payload: { templateId?: unknown } = {}) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    return createWorkspaceProject(normalizeTemplateIdOrDefault(payload?.templateId), win, event.sender.id);
  });

  ipcMain.handle('project-session:get-active', (event) => {
    const projectId = getActiveProjectIdForSender(event.sender.id);
    const projectDirectory = getActiveProjectDirectoryForSender(event.sender.id);
    return { projectId, projectDirectory };
  });

  ipcMain.handle('project-files:load', async (event, payload: { projectId?: unknown }) => {
    if (!payload || typeof payload.projectId !== 'string') {
      throw new Error('Invalid project-files:load payload');
    }
    console.log(`[desktop-projects] loading ${payload.projectId} for sender=${event.sender.id}`);
    const loaded = openWorkspaceProject(payload.projectId);
    await ensureAlmostnodeClaudeBridgeFiles(loaded.projectDirectory);
    setActiveProjectIdForSender(event.sender.id, payload.projectId);
    console.log(`[desktop-projects] loaded metadata for ${payload.projectId}`);
    return loaded;
  });

  ipcMain.handle('project-files:hydrate-active', (event) => {
    const projectDirectory = getActiveProjectDirectoryForSender(event.sender.id);
    if (!projectDirectory) {
      return { streamedCount: 0, projectDirectory: null };
    }

    console.log(`[desktop-projects] hydrating ${projectDirectory} for sender=${event.sender.id}`);
    const result = streamWorkspaceFilesToSender(event.sender, projectDirectory);
    console.log(`[desktop-projects] hydration complete for ${projectDirectory} (${result.streamedCount} files)`);
    return { ...result, projectDirectory };
  });

  ipcMain.handle('project-files:apply-ops', async (event, payload: { ops?: unknown }) => {
    const ops = Array.isArray(payload?.ops) ? payload.ops.filter((entry): entry is ProjectFileApplyOp => {
      if (!entry || typeof entry !== 'object') return false;
      const record = entry as Record<string, unknown>;
      if ((record.type === 'delete' || record.type === 'write') && typeof record.path === 'string') {
        return record.type === 'delete' || typeof record.contentBase64 === 'string';
      }
      return false;
    }) : [];

    return applyProjectOps(event.sender.id, ops);
  });

  ipcMain.handle('project-directory:seed-active-if-empty', (event, payload: { templateId?: unknown } = {}) => {
    const templateId: TemplateId = (payload?.templateId === 'vite' || payload?.templateId === 'nextjs' || payload?.templateId === 'tanstack')
      ? payload.templateId
      : 'vite';
    return seedActiveProjectDirectoryIfEmpty(event.sender.id, templateId);
  });
}
