/**
 * Project lifecycle manager — coordinates ProjectDB with WebIDEHost.
 *
 * Handles CRUD, project switching, auto-save, resumable thread persistence,
 * and first-run bootstrapping.
 */

import {
  ProjectDB,
  type ProjectAgentStateRecord,
  type ProjectAgentStateSnapshot,
  type ProjectGitRemoteRecord,
  type ProjectRecord,
  type ResumableThreadRecord,
} from './project-db';
import {
  collectProjectFilesBase64,
  type SerializedFile,
} from '../desktop/project-snapshot';
import { mergeDiscoveredThreads } from './resumable-threads';
import { resolveProjectName } from './project-names';
import { isTemplateId, type TemplateId } from './workspace-seed';
import type { GitHubRepositorySummary } from './github-repositories';

export interface ProjectManagerHost {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getVfs(): any;
  getTemplateId(): TemplateId;
  hasGitHubCredentials(): boolean;
  createGitHubRemote(projectName: string): Promise<ProjectGitRemoteRecord>;
  syncProjectGit(project: ProjectRecord): Promise<void>;
  attachProjectContext(
    templateId: TemplateId,
    dbPrefix?: string,
    defaultDatabaseName?: string,
  ): Promise<void>;
  switchProjectWorkspace(
    templateId: TemplateId,
    files: Awaited<ReturnType<ProjectDB['getProjectFiles']>>,
    dbPrefix?: string,
    defaultDatabaseName?: string,
  ): Promise<void>;
  collectAgentStateSnapshot(): Promise<ProjectAgentStateSnapshot>;
  restoreAgentStateSnapshot(
    snapshot: ProjectAgentStateSnapshot | null | undefined,
  ): Promise<void>;
  teardownActiveProject?(): Promise<void>;
  discoverActiveProjectThreads(projectId: string): Promise<{
    claude: ResumableThreadRecord[];
    opencode: ResumableThreadRecord[];
  }>;
  resumeResumableThread(thread: ResumableThreadRecord): Promise<void>;
  requestGitHubLogin?(): Promise<void>;
  listGitHubRepositories?(): Promise<GitHubRepositorySummary[]>;
  importGitHubRepository?(
    repository: GitHubRepositorySummary,
    dbPrefix?: string,
    defaultDatabaseName?: string,
  ): Promise<TemplateId>;
}

export interface ProjectManagerCallbacks {
  onProjectsChanged: (projects: ProjectRecord[]) => void;
  onActiveProjectChanged: (projectId: string | null) => void;
  onResumableThreadsChanged: (threads: ResumableThreadRecord[]) => void;
  onSwitchingStateChanged: (isSwitching: boolean) => void;
}

export interface ProjectEnvironmentController {
  getActiveProject(): Promise<ProjectRecord | null>;
  updateActiveProject(
    updater: (project: ProjectRecord) => ProjectRecord,
  ): Promise<ProjectRecord>;
  saveCurrentProject(): Promise<void>;
}

export interface CreateProjectOptions {
  createGitHubRepo?: boolean;
}

const ACTIVE_PROJECT_KEY = 'almostnode-active-project-id';
const URL_PROJECT_PARAM = 'project';
const URL_TEMPLATE_PARAM = 'template';
const URL_NAME_PARAM = 'name';
const AUTO_SAVE_DEBOUNCE_MS = 3000;
const AI_SIDEBAR_TAB_CLOSED_EVENT = 'almostnode:ai-sidebar-tab-closed';

export class ProjectManager {
  readonly db = new ProjectDB();
  private host: ProjectManagerHost | null = null;
  private callbacks: ProjectManagerCallbacks | null = null;
  private activeProjectId: string | null = null;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  private readonly handleAiSidebarTabClosed = () => {
    void this.saveCurrentProject();
  };

  setHost(host: ProjectManagerHost): void {
    this.host = host;
  }

  setCallbacks(callbacks: ProjectManagerCallbacks): void {
    this.callbacks = callbacks;

    if (this.initialized) {
      void this.emitCurrentStateToCallbacks();
    }
  }

  getActiveProjectId(): string | null {
    return this.activeProjectId;
  }

  async getActiveProject(): Promise<ProjectRecord | null> {
    if (!this.activeProjectId) {
      return null;
    }

    return (await this.db.getProject(this.activeProjectId)) ?? null;
  }

  hasGitHubCredentials(): boolean {
    return this.host?.hasGitHubCredentials() ?? false;
  }

  async requestGitHubLogin(): Promise<void> {
    const requestGitHubLogin = this.host?.requestGitHubLogin;
    if (!requestGitHubLogin) {
      throw new Error('GitHub login is unavailable in this session.');
    }
    await requestGitHubLogin();
  }

  async listGitHubRepositories(): Promise<GitHubRepositorySummary[]> {
    const host = this.host;
    const listGitHubRepositories = host?.listGitHubRepositories;
    if (!host || !listGitHubRepositories) {
      throw new Error('GitHub repository listing is unavailable in this session.');
    }
    if (!host.hasGitHubCredentials()) {
      throw new Error('GitHub credentials are not available. Run `gh auth login` first.');
    }
    return listGitHubRepositories();
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    let projects = await this.db.listProjects();
    const urlProjectId = readUrlProjectId();
    let createdProject: ProjectRecord | null = null;

    if (!urlProjectId) {
      const creationIntent = readUrlProjectCreationIntent();
      if (creationIntent) {
        createdProject = await this.createProjectFromUrlIntent(creationIntent);
        projects = await this.db.listProjects();
      }
    }

    const storedActiveId = urlProjectId ?? createdProject?.id ?? readActiveProjectId();
    const matchingProject = storedActiveId
      ? projects.find((project) => project.id === storedActiveId)
      : null;

    const activeProject = matchingProject ?? projects[0] ?? null;
    this.activeProjectId = activeProject?.id ?? null;
    writeActiveProjectId(this.activeProjectId);
    writeUrlProjectId(this.activeProjectId);

    this.callbacks?.onProjectsChanged(projects);
    this.callbacks?.onActiveProjectChanged(this.activeProjectId);

    if (!activeProject) {
      if (this.host?.teardownActiveProject) {
        await this.host.teardownActiveProject();
      }
      await this.syncActiveProjectThreads();
      this.startAutoSave();
      window.addEventListener(
        AI_SIDEBAR_TAB_CLOSED_EVENT,
        this.handleAiSidebarTabClosed,
      );

      window.addEventListener('beforeunload', () => {
        void this.saveCurrentProject();
      });
      return;
    }

    if (this.host) {
      const activeFiles = await this.db.getProjectFiles(activeProject.id);
      const currentFiles = collectProjectFilesBase64(this.host.getVfs(), { includeGit: true });
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
          getProjectDefaultDatabaseName(activeProject),
        );
      } else {
        await this.host.attachProjectContext(
          activeProject.templateId,
          activeProject.dbPrefix,
          getProjectDefaultDatabaseName(activeProject),
        );
      }

      await this.host.syncProjectGit(activeProject);

      const agentState = await this.db.getProjectAgentState(activeProject.id);
      await this.host.restoreAgentStateSnapshot(agentState ?? null);
    }

    await this.syncActiveProjectThreads();
    this.startAutoSave();
    window.addEventListener(
      AI_SIDEBAR_TAB_CLOSED_EVENT,
      this.handleAiSidebarTabClosed,
    );

    window.addEventListener('beforeunload', () => {
      void this.saveCurrentProject();
    });
  }

  async createProject(
    name: string,
    templateId: TemplateId,
    options: CreateProjectOptions = {},
  ): Promise<ProjectRecord> {
    const project = createProjectRecord(name, templateId);
    if (options.createGitHubRepo) {
      if (!this.host?.hasGitHubCredentials()) {
        throw new Error('GitHub credentials are not available. Run `gh auth login` first.');
      }
      project.gitRemote = await this.host.createGitHubRemote(name);
      project.repoRef = toRepoRef(project.gitRemote, 'main');
    }
    await this.db.putProject(project);
    await this.notifyProjectsChanged();
    return project;
  }

  async importGitHubRepository(
    repository: GitHubRepositorySummary,
  ): Promise<ProjectRecord> {
    const host = this.host;
    const importGitHubRepository = host?.importGitHubRepository;
    if (!host || !importGitHubRepository) {
      throw new Error('GitHub import is unavailable in this session.');
    }
    if (!host.hasGitHubCredentials()) {
      throw new Error('GitHub credentials are not available. Run `gh auth login` first.');
    }

    const previousProject = this.activeProjectId
      ? await this.db.getProject(this.activeProjectId)
      : undefined;
    const previousAgentState = previousProject
      ? await this.db.getProjectAgentState(previousProject.id)
      : undefined;

    await this.saveCurrentProject();

    const project = createProjectRecord(repository.fullName, 'vite');
    project.gitRemote = {
      name: 'origin',
      url: repository.cloneUrl,
      provider: 'github',
      repositoryFullName: repository.fullName,
      repositoryUrl: repository.htmlUrl,
    };
    project.repoRef = toRepoRef(project.gitRemote, repository.defaultBranch);

    this.callbacks?.onSwitchingStateChanged(true);

    try {
      project.templateId = await importGitHubRepository(
        repository,
        project.dbPrefix,
        getProjectDefaultDatabaseName(project),
      );

      await this.db.putProject(project);

      const files = collectProjectFilesBase64(host.getVfs(), { includeGit: true });
      await this.db.saveProjectFiles(project.id, files);

      const agentState = await host.collectAgentStateSnapshot();
      await this.db.putProjectAgentState({
        projectId: project.id,
        ...agentState,
        savedAt: Date.now(),
      });

      this.activeProjectId = project.id;
      writeActiveProjectId(project.id);
      writeUrlProjectId(project.id);

      this.callbacks?.onActiveProjectChanged(project.id);
      await this.notifyProjectsChanged();
      await this.syncActiveProjectThreads();

      return project;
    } catch (error) {
      await this.restoreWorkspaceAfterFailedImport(previousProject, previousAgentState);
      throw error;
    } finally {
      this.callbacks?.onSwitchingStateChanged(false);
    }
  }

  async renameProject(id: string, name: string): Promise<void> {
    const project = await this.db.getProject(id);
    if (!project) return;
    project.name = name;
    project.defaultDatabaseName = toProjectDefaultDatabaseName(name);
    project.lastModified = Date.now();
    await this.db.putProject(project);
    if (id === this.activeProjectId && this.host) {
      await this.host.attachProjectContext(
        project.templateId,
        project.dbPrefix,
        getProjectDefaultDatabaseName(project),
      );
    }
    await this.notifyProjectsChanged();
  }

  async deleteProject(id: string): Promise<void> {
    if (id === this.activeProjectId) {
      const projects = await this.db.listProjects();
      const otherProject = projects.find((project) => project.id !== id);
      if (!otherProject) {
        await this.db.deleteProject(id);
        this.activeProjectId = null;
        writeActiveProjectId(null);
        writeUrlProjectId(null);
        this.callbacks?.onActiveProjectChanged(null);
        if (this.host?.teardownActiveProject) {
          await this.host.teardownActiveProject();
        }
        await this.notifyProjectsChanged();
        await this.refreshResumableThreads();
        return;
      }
      await this.switchProject(otherProject.id);
    }

    await this.db.deleteProject(id);
    await this.notifyProjectsChanged();
    await this.refreshResumableThreads();
  }

  async switchProject(targetId: string): Promise<void> {
    if (targetId === this.activeProjectId || !this.host) {
      return;
    }

    const targetProject = await this.db.getProject(targetId);
    if (!targetProject) {
      return;
    }

    this.callbacks?.onSwitchingStateChanged(true);

    try {
      await this.saveCurrentProject();

      const files = await this.db.getProjectFiles(targetId);
      const agentState = await this.db.getProjectAgentState(targetId);

      await this.host.switchProjectWorkspace(
        targetProject.templateId,
        files,
        targetProject.dbPrefix,
        getProjectDefaultDatabaseName(targetProject),
      );
      await this.host.syncProjectGit(targetProject);
      await this.host.restoreAgentStateSnapshot(agentState ?? null);

      this.activeProjectId = targetId;
      writeActiveProjectId(targetId);
      writeUrlProjectId(targetId);

      this.callbacks?.onActiveProjectChanged(targetId);
      await this.syncActiveProjectThreads();

      targetProject.lastModified = Date.now();
      await this.db.putProject(targetProject);
      await this.notifyProjectsChanged();
    } finally {
      this.callbacks?.onSwitchingStateChanged(false);
    }
  }

  async saveCurrentProject(): Promise<void> {
    if (!this.activeProjectId || !this.host) {
      return;
    }

    const files = collectProjectFilesBase64(this.host.getVfs(), { includeGit: true });
    await this.db.saveProjectFiles(this.activeProjectId, files);

    const agentState = await this.host.collectAgentStateSnapshot();
    await this.db.putProjectAgentState({
      projectId: this.activeProjectId,
      ...agentState,
      savedAt: Date.now(),
    });

    await this.syncActiveProjectThreads();

    const project = await this.db.getProject(this.activeProjectId);
    if (project) {
      project.lastModified = Date.now();
      await this.db.putProject(project);
    }
  }

  async updateActiveProject(
    updater: (project: ProjectRecord) => ProjectRecord,
  ): Promise<ProjectRecord> {
    if (!this.activeProjectId) {
      throw new Error('There is no active project.');
    }

    const project = await this.db.getProject(this.activeProjectId);
    if (!project) {
      throw new Error(`Active project "${this.activeProjectId}" was not found.`);
    }

    const nextProject = updater({
      ...project,
    });
    nextProject.lastModified = Date.now();
    await this.db.putProject(nextProject);
    await this.notifyProjectsChanged();
    return nextProject;
  }

  async resumeThread(threadId: string): Promise<void> {
    if (!this.host) {
      return;
    }

    const thread = await this.db.getResumableThread(threadId);
    if (!thread) {
      return;
    }

    if (thread.projectId !== this.activeProjectId) {
      await this.switchProject(thread.projectId);
    }

    await this.host.resumeResumableThread(thread);
    await this.syncActiveProjectThreads();
  }

  async syncActiveProjectThreads(): Promise<ResumableThreadRecord[]> {
    if (!this.activeProjectId) {
      this.callbacks?.onResumableThreadsChanged([]);
      return [];
    }

    const existing = await this.db.listResumableThreads(this.activeProjectId);

    if (!this.host) {
      await this.notifyResumableThreadsChanged();
      return existing;
    }

    try {
      const discovered = await this.host.discoverActiveProjectThreads(
        this.activeProjectId,
      );
      const threads = mergeDiscoveredThreads(existing, discovered);
      await this.db.replaceProjectResumableThreads(this.activeProjectId, threads);
      await this.notifyResumableThreadsChanged();
      return threads;
    } catch {
      await this.notifyResumableThreadsChanged();
      return existing;
    }
  }

  dispose(): void {
    if (this.autoSaveTimer) {
      clearTimeout(this.autoSaveTimer);
      this.autoSaveTimer = null;
    }

    window.removeEventListener(
      AI_SIDEBAR_TAB_CLOSED_EVENT,
      this.handleAiSidebarTabClosed,
    );
  }

  private startAutoSave(): void {
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

  private async notifyProjectsChanged(): Promise<void> {
    const projects = await this.db.listProjects();
    this.callbacks?.onProjectsChanged(projects);
  }

  private async createProjectFromUrlIntent(
    intent: UrlProjectCreationIntent,
  ): Promise<ProjectRecord> {
    const project = createProjectRecord(
      resolveProjectName(intent.name),
      intent.templateId,
    );
    await this.db.putProject(project);

    if (!this.host) {
      return project;
    }

    const files = collectProjectFilesBase64(this.host.getVfs(), { includeGit: true });
    await this.db.saveProjectFiles(project.id, files);

    const agentState = await this.host.collectAgentStateSnapshot();
    await this.db.putProjectAgentState({
      projectId: project.id,
      ...agentState,
      savedAt: Date.now(),
    });

    return project;
  }

  private async emitCurrentStateToCallbacks(): Promise<void> {
    if (!this.callbacks) {
      return;
    }

    await this.notifyProjectsChanged();
    this.callbacks.onActiveProjectChanged(this.activeProjectId);
    await this.notifyResumableThreadsChanged();
    this.callbacks.onSwitchingStateChanged(false);
  }

  private async refreshResumableThreads(): Promise<void> {
    await this.notifyResumableThreadsChanged();
  }

  private async notifyResumableThreadsChanged(): Promise<void> {
    const threads = await this.db.listAllResumableThreads();
    this.callbacks?.onResumableThreadsChanged(threads);
  }

  private async restoreWorkspaceAfterFailedImport(
    previousProject: ProjectRecord | undefined,
    previousAgentState: ProjectAgentStateRecord | undefined,
  ): Promise<void> {
    if (!previousProject || !this.host) {
      return;
    }

    const files = await this.db.getProjectFiles(previousProject.id);
    await this.host.switchProjectWorkspace(
      previousProject.templateId,
      files,
      previousProject.dbPrefix,
      getProjectDefaultDatabaseName(previousProject),
    );
    await this.host.syncProjectGit(previousProject);
    await this.host.restoreAgentStateSnapshot(previousAgentState ?? null);
  }
}

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
    defaultDatabaseName: toProjectDefaultDatabaseName(name),
    activeEnvironment: 'local',
    repoRef: null,
    codespace: null,
  };
}

function getProjectDefaultDatabaseName(
  project: Pick<ProjectRecord, 'name'> & Partial<Pick<ProjectRecord, 'defaultDatabaseName'>>,
): string {
  const stored = project.defaultDatabaseName?.trim();
  if (
    stored
    && stored.length <= 50
    && /^[a-zA-Z0-9_-]+$/.test(stored)
  ) {
    return stored;
  }
  return toProjectDefaultDatabaseName(project.name);
}

function toProjectDefaultDatabaseName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 50)
    .replace(/^-+|-+$/g, '');

  return slug || 'project';
}

function toRepoRef(
  gitRemote: ProjectGitRemoteRecord | undefined,
  branch: string,
): ProjectRecord['repoRef'] {
  if (!gitRemote?.repositoryFullName) {
    return null;
  }

  const [owner, repo] = gitRemote.repositoryFullName.split('/');
  if (!owner || !repo) {
    return null;
  }

  return {
    owner,
    repo,
    branch: branch.trim() || 'main',
    remoteUrl: gitRemote.url,
  };
}

interface UrlProjectCreationIntent {
  templateId: TemplateId;
  name: string | null;
}

function readActiveProjectId(): string | null {
  try {
    return localStorage.getItem(ACTIVE_PROJECT_KEY);
  } catch {
    return null;
  }
}

function writeActiveProjectId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(ACTIVE_PROJECT_KEY, id);
    } else {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
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

function readUrlProjectCreationIntent(): UrlProjectCreationIntent | null {
  try {
    const params = new URLSearchParams(window.location.search);
    const templateId = params.get(URL_TEMPLATE_PARAM);
    if (!templateId || !isTemplateId(templateId)) {
      return null;
    }

    return {
      templateId,
      name: params.get(URL_NAME_PARAM),
    };
  } catch {
    return null;
  }
}

function writeUrlProjectId(id: string | null): void {
  try {
    const url = new URL(window.location.href);
    if (id) {
      url.searchParams.set(URL_PROJECT_PARAM, id);
    } else {
      url.searchParams.delete(URL_PROJECT_PARAM);
    }
    url.searchParams.delete(URL_TEMPLATE_PARAM);
    url.searchParams.delete(URL_NAME_PARAM);
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
