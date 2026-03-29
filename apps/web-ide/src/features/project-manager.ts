/**
 * Project lifecycle manager — coordinates ProjectDB with WebIDEHost.
 *
 * Handles CRUD, project switching, auto-save, and first-run bootstrapping.
 */

import {
  ProjectDB,
  type ProjectRecord,
  type ChatThread,
} from './project-db';
import {
  collectProjectFilesBase64,
  type SerializedFile,
} from '../desktop/project-snapshot';
import type { TemplateId } from './workspace-seed';

// ── Types ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ProjectManagerHost {
  getVfs(): any;
  getTemplateId(): TemplateId;
  attachProjectContext(templateId: TemplateId, dbPrefix?: string): Promise<void>;
  switchProjectWorkspace(
    templateId: TemplateId,
    files: Awaited<ReturnType<ProjectDB['getProjectFiles']>>,
    dbPrefix?: string,
  ): Promise<void>;
}

export interface ProjectManagerCallbacks {
  onProjectsChanged: (projects: ProjectRecord[]) => void;
  onActiveProjectChanged: (projectId: string | null) => void;
  onChatThreadsChanged: (threads: ChatThread[]) => void;
  onSwitchingStateChanged: (isSwitching: boolean) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const ACTIVE_PROJECT_KEY = 'almostnode-active-project-id';
const URL_PROJECT_PARAM = 'project';
const URL_TEMPLATE_PARAM = 'template';
const AUTO_SAVE_DEBOUNCE_MS = 3000;

// ── ProjectManager ────────────────────────────────────────────────────────────

export class ProjectManager {
  readonly db = new ProjectDB();
  private host: ProjectManagerHost | null = null;
  private callbacks: ProjectManagerCallbacks | null = null;
  private activeProjectId: string | null = null;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private vfsChangeHandler: ((...args: unknown[]) => void) | null = null;
  private initialized = false;

  setHost(host: ProjectManagerHost): void {
    this.host = host;
  }

  setCallbacks(callbacks: ProjectManagerCallbacks): void {
    this.callbacks = callbacks;
  }

  getActiveProjectId(): string | null {
    return this.activeProjectId;
  }

  /**
   * Initialize the project manager. Call once after the host is bootstrapped.
   *
   * If no projects exist, creates "My Project" from the current template
   * and saves the current VFS files into it.
   */
  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    let projects = await this.db.listProjects();

    if (projects.length === 0) {
      const templateId = this.host?.getTemplateId() ?? 'vite';
      const project = createProjectRecord('My Project', templateId);
      await this.db.putProject(project);

      // Save current VFS into this project
      if (this.host) {
        const files = collectProjectFilesBase64(this.host.getVfs());
        await this.db.saveProjectFiles(project.id, files);
      }

      projects = [project];
    }

    // Restore active project: URL param > localStorage > first project
    const urlProjectId = readUrlProjectId();
    const storedActiveId = urlProjectId ?? readActiveProjectId();
    const matchingProject = storedActiveId
      ? projects.find((p) => p.id === storedActiveId)
      : null;

    this.activeProjectId = matchingProject?.id ?? projects[0]!.id;
    writeActiveProjectId(this.activeProjectId);
    writeUrlProjectId(this.activeProjectId);

    this.callbacks?.onProjectsChanged(projects);
    this.callbacks?.onActiveProjectChanged(this.activeProjectId);

    if (this.host) {
      const activeProject = matchingProject ?? projects[0]!;
      const activeFiles = await this.db.getProjectFiles(activeProject.id);
      const currentFiles = collectProjectFilesBase64(this.host.getVfs());
      const shouldRestoreWorkspace = (
        activeFiles.length === 0
        || this.host.getTemplateId() !== activeProject.templateId
        || !serializedFilesEqual(currentFiles, activeFiles)
      );

      if (shouldRestoreWorkspace) {
        await this.host.switchProjectWorkspace(
          activeProject.templateId,
          activeFiles,
          activeProject.dbPrefix,
        );
      } else {
        await this.host.attachProjectContext(
          activeProject.templateId,
          activeProject.dbPrefix,
        );
      }
    }

    // Load chat threads for active project
    await this.refreshChatThreads();

    // Start auto-save
    this.startAutoSave();

    // Listen for beforeunload to save on exit
    window.addEventListener('beforeunload', () => {
      void this.saveCurrentProject();
    });
  }

  // ── Project CRUD ──

  async createProject(name: string, templateId: TemplateId): Promise<ProjectRecord> {
    const project = createProjectRecord(name, templateId);
    await this.db.putProject(project);
    await this.notifyProjectsChanged();
    return project;
  }

  async renameProject(id: string, name: string): Promise<void> {
    const project = await this.db.getProject(id);
    if (!project) return;
    project.name = name;
    project.lastModified = Date.now();
    await this.db.putProject(project);
    await this.notifyProjectsChanged();
  }

  async deleteProject(id: string): Promise<void> {
    if (id === this.activeProjectId) {
      // Switch to another project first
      const projects = await this.db.listProjects();
      const other = projects.find((p) => p.id !== id);
      if (other) {
        await this.switchProject(other.id);
      } else {
        // Last project — can't delete
        return;
      }
    }
    await this.db.deleteProject(id);
    await this.notifyProjectsChanged();
  }

  // ── Project Switching ──

  async switchProject(targetId: string): Promise<void> {
    if (targetId === this.activeProjectId) return;
    if (!this.host) return;

    const targetProject = await this.db.getProject(targetId);
    if (!targetProject) return;

    this.callbacks?.onSwitchingStateChanged(true);

    try {
      // 1. Save current project files
      await this.saveCurrentProject();

      // 2. Load target project files from IndexedDB
      const files = await this.db.getProjectFiles(targetId);

      // 3. Swap the mounted workspace in place and switch the project DB namespace.
      await this.host.switchProjectWorkspace(
        targetProject.templateId,
        files,
        targetProject.dbPrefix,
      );

      // 4. Update active project
      this.activeProjectId = targetId;
      writeActiveProjectId(targetId);
      writeUrlProjectId(targetId);

      // 5. Update UI
      this.callbacks?.onActiveProjectChanged(targetId);
      await this.refreshChatThreads();

      // Touch lastModified
      targetProject.lastModified = Date.now();
      await this.db.putProject(targetProject);
      await this.notifyProjectsChanged();
    } finally {
      this.callbacks?.onSwitchingStateChanged(false);
    }
  }

  // ── Save ──

  async saveCurrentProject(): Promise<void> {
    if (!this.activeProjectId || !this.host) return;

    const files = collectProjectFilesBase64(this.host.getVfs());
    await this.db.saveProjectFiles(this.activeProjectId, files);

    // Update lastModified
    const project = await this.db.getProject(this.activeProjectId);
    if (project) {
      project.lastModified = Date.now();
      await this.db.putProject(project);
    }
  }

  // ── Chat Thread CRUD ──

  async createChatThread(title: string): Promise<ChatThread> {
    if (!this.activeProjectId) throw new Error('No active project');

    const thread: ChatThread = {
      id: crypto.randomUUID(),
      projectId: this.activeProjectId,
      title,
      createdAt: Date.now(),
      lastMessageAt: Date.now(),
    };
    await this.db.putChatThread(thread);
    await this.refreshChatThreads();
    return thread;
  }

  async renameChatThread(id: string, title: string): Promise<void> {
    const thread = await this.db.getChatThread(id);
    if (!thread) return;
    thread.title = title;
    await this.db.putChatThread(thread);
    await this.refreshChatThreads();
  }

  async deleteChatThread(id: string): Promise<void> {
    await this.db.deleteChatThread(id);
    await this.refreshChatThreads();
  }

  // ── Auto-save ──

  private startAutoSave(): void {
    // Watch VFS changes via polling debounce (VFS doesn't expose events we can reliably use externally)
    // Instead, we schedule saves based on activity
    this.scheduleAutoSave();
  }

  private scheduleAutoSave(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
    }
    this.autoSaveTimer = setTimeout(() => {
      void this.saveCurrentProject().finally(() => {
        this.scheduleAutoSave();
      });
    }, AUTO_SAVE_DEBOUNCE_MS);
  }

  dispose(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }
  }

  // ── Private helpers ──

  private async notifyProjectsChanged(): Promise<void> {
    const projects = await this.db.listProjects();
    this.callbacks?.onProjectsChanged(projects);
  }

  private async refreshChatThreads(): Promise<void> {
    if (!this.activeProjectId) return;
    const threads = await this.db.listChatThreads(this.activeProjectId);
    this.callbacks?.onChatThreadsChanged(threads);
  }
}

// ── Utility functions ─────────────────────────────────────────────────────────

function createProjectRecord(name: string, templateId: TemplateId): ProjectRecord {
  const id = crypto.randomUUID();
  const now = Date.now();
  return {
    id,
    name,
    templateId,
    createdAt: now,
    lastModified: now,
    dbPrefix: id.slice(0, 8),
  };
}

function readActiveProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

function writeActiveProjectId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_PROJECT_KEY, id);
  } catch {
    // Ignore storage failures.
  }
}

function readUrlProjectId(): string | null {
  try {
    const params = new URLSearchParams(window.location.search);
    return params.get(URL_PROJECT_PARAM);
  } catch {
    return null;
  }
}

function writeUrlProjectId(id: string): void {
  try {
    const url = new URL(window.location.href);
    url.searchParams.set(URL_PROJECT_PARAM, id);
    url.searchParams.delete(URL_TEMPLATE_PARAM);
    window.history.replaceState(null, '', url.toString());
  } catch {
    // Ignore URL update failures.
  }
}

function serializedFilesEqual(left: SerializedFile[], right: SerializedFile[]): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (
      left[index]!.path !== right[index]!.path
      || left[index]!.contentBase64 !== right[index]!.contentBase64
    ) {
      return false;
    }
  }

  return true;
}
