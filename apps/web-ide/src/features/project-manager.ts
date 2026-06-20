/**
 * Project lifecycle manager — coordinates ProjectDB with WebIDEHost.
 *
 * Handles CRUD, project switching, auto-save, resumable thread persistence,
 * and first-run bootstrapping.
 */

import {
  ProjectDB,
  REPO_DEFAULT_BRANCH,
  type ProjectAgentStateRecord,
  type ProjectAgentStateSnapshot,
  type ProjectGitRemoteRecord,
  type ProjectRecord,
  type ResumableThreadRecord,
  type SandboxAgentStateRecord,
  type SandboxPrRecord,
  type SandboxRecord,
} from './project-db';
import {
  collectProjectFilesBase64,
  collectScopedFilesBase64,
  type SerializedFile,
} from '../desktop/project-snapshot';
import {
  CLAUDE_PROJECTS_ROOT,
  discoverClaudeThreads,
  mergeDiscoveredThreads,
} from './resumable-threads';
import { resolveProjectName } from './project-names';
import { isTemplateId, type TemplateId } from './workspace-seed';
import type { GitHubRepositorySummary } from './github-repositories';

export interface ProjectManagerHost {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getVfs(): any;
  /** VFS of the (possibly background) session bound to a project, if live. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getVfsForProject?(projectId: string): any;
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
  /**
   * Attach/detach project switch: background sessions keep their terminals,
   * agents, and dev servers running. Resolves with whether the project's
   * workspace was loaded from `files` (false when its live session was
   * simply re-attached).
   */
  switchProjectWorkspaceToSession?(
    projectId: string,
    templateId: TemplateId,
    files: Awaited<ReturnType<ProjectDB['getProjectFiles']>>,
    dbPrefix?: string,
    defaultDatabaseName?: string,
  ): Promise<{ workspaceReplaced: boolean }>;
  /**
   * Open a sandbox session (live re-attach, snapshot restore, or fresh fork
   * from `baseFiles` + `git checkout -b`). `workspaceReplaced` mirrors
   * `switchProjectWorkspaceToSession`.
   */
  openSandboxSession?(
    repo: ProjectRecord,
    sandbox: SandboxRecord,
    savedFiles: SerializedFile[],
    baseFiles: SerializedFile[],
    dbPrefix?: string,
    defaultDatabaseName?: string,
  ): Promise<{ workspaceReplaced: boolean }>;
  /** VFS of any live session by id (active or background), if live. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getVfsForSession?(sessionId: string): any;
  getLiveSessionIds?(): string[];
  getActiveSessionId?(): string | null;
  getProjectIdForSession?(sessionId: string): string | null;
  collectAgentStateSnapshotForSession?(
    sessionId: string,
  ): Promise<ProjectAgentStateSnapshot>;
  /** Lets the host snapshot a session before the pool evicts it. */
  setSessionPersistence?(
    persist: (sessionId: string) => Promise<void>,
  ): void;
  /**
   * Run a shell command inside a live session's container (sandbox ids and
   * project ids both resolve). Rejects when the session isn't live.
   */
  runSessionCommand?(
    sessionId: string,
    command: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  /** Fully dispose a live background session (deleted sandboxes). */
  disposeSession?(sessionId: string): void;
  /**
   * Push an updated base snapshot into a live repo-base session so a merge
   * promoted to main is visible without recreating the session.
   */
  refreshRepoBaseSession?(repoId: string, files: SerializedFile[]): void;
  /**
   * Mark the active session read-only. Boot restores and import recovery
   * attach a repo base outside the session switcher — repo bases (main) are
   * always read-only.
   */
  markActiveSessionReadOnly?(): void;
  collectAgentStateSnapshot(
    projectId?: string,
  ): Promise<ProjectAgentStateSnapshot>;
  restoreAgentStateSnapshot(
    snapshot: ProjectAgentStateSnapshot | null | undefined,
  ): Promise<void>;
  teardownActiveProject?(): Promise<void>;
  discoverActiveProjectThreads(projectId: string): Promise<{
    claude: ResumableThreadRecord[];
    opencode: ResumableThreadRecord[];
  }>;
  /** OpenCode chats of a live sandbox session ([] when dormant). */
  discoverSandboxOpenCodeThreads?(
    sandboxId: string,
  ): Promise<ResumableThreadRecord[]>;
  /** Codex threads observed in a live sandbox session ([] when dormant). */
  discoverSandboxCodexThreads?(
    sandboxId: string,
  ): Promise<ResumableThreadRecord[]>;
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
  /** Fired after every sandbox CRUD/switch with the full grouped listing. */
  onSandboxesChanged?: (sandboxesByRepo: Record<string, SandboxRecord[]>) => void;
  /**
   * Fired whenever the foreground sandbox changes — including switches the
   * sidebar didn't initiate (legacy-thread resume forks, sandbox deletion).
   */
  onActiveSandboxChanged?: (sandboxId: string | null) => void;
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
const AGENT_THREAD_UPDATED_EVENT = 'almostnode:agent-thread-updated';
const THREAD_REFRESH_DEBOUNCE_MS = 400;

export class ProjectManager {
  readonly db = new ProjectDB();
  private host: ProjectManagerHost | null = null;
  private callbacks: ProjectManagerCallbacks | null = null;
  private activeProjectId: string | null = null;
  /** Sandbox shown in the workbench, or null when a repo base is active. */
  private activeSandboxId: string | null = null;
  private autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
  private initialized = false;
  /** Serializes workspace switches; see {@link enqueueSwitch}. */
  private switchChain: Promise<void> = Promise.resolve();
  /**
   * Legacy per-project/per-sandbox OpenCode DB blobs, read once per record.
   * Hosts no longer collect `openCodeDb` (OpenCode history lives in one
   * host-level browser DB; see opencode-browser-session.ts) but stored
   * blobs are carried forward untouched for one release as the migration
   * seed / recovery fallback.
   */
  private readonly legacyOpenCodeDbCache = new Map<string, Uint8Array | null>();
  private readonly handleAiSidebarTabClosed = () => {
    // A TUI may exit in a background sandbox — snapshot every live session.
    void this.saveAllSessions();
  };
  private threadRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * An agent session started or titled its thread: refresh the sidebar's
   * chat list right away (debounced — title updates arrive in bursts)
   * instead of waiting for the next project/sandbox switch.
   */
  private readonly handleAgentThreadUpdated = () => {
    if (this.threadRefreshTimer) {
      clearTimeout(this.threadRefreshTimer);
    }
    this.threadRefreshTimer = setTimeout(() => {
      this.threadRefreshTimer = null;
      void this.syncActiveProjectThreads().catch(() => {});
    }, THREAD_REFRESH_DEBOUNCE_MS);
  };

  setHost(host: ProjectManagerHost): void {
    this.host = host;
    // Pre-eviction snapshots from the host's session pool route through the
    // same persistence as auto-save.
    host.setSessionPersistence?.((sessionId) =>
      this.persistSessionById(sessionId),
    );
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

  getActiveSandboxId(): string | null {
    return this.activeSandboxId;
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
      window.addEventListener(
        AGENT_THREAD_UPDATED_EVENT,
        this.handleAgentThreadUpdated,
      );

      window.addEventListener('beforeunload', () => {
        void this.saveAllSessions();
      });
      return;
    }

    if (this.host?.openSandboxSession) {
      // Session-aware hosts boot straight into the repo's latest sandbox
      // (creating the first one when none exist). The repo base never boots
      // a workspace of its own — it stays a pristine, read-only snapshot.
      await this.openRepo(activeProject.id);
    } else if (this.host) {
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

      // Boot attaches the repo base in place (outside the session
      // switcher) — repo bases are always read-only.
      this.host.markActiveSessionReadOnly?.();
    }

    await this.syncActiveProjectThreads();
    this.startAutoSave();
    window.addEventListener(
      AI_SIDEBAR_TAB_CLOSED_EVENT,
      this.handleAiSidebarTabClosed,
    );
    window.addEventListener(
      AGENT_THREAD_UPDATED_EVENT,
      this.handleAgentThreadUpdated,
    );

    window.addEventListener('beforeunload', () => {
      // Background sandboxes must not lose work on reload either.
      void this.saveAllSessions();
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

      // Import clones into the active session in place (outside the session
      // switcher) — repo bases are always read-only.
      host.markActiveSessionReadOnly?.();

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

  /**
   * Serialize workspace switches (project and sandbox opens). Without this,
   * a slower switch started earlier (e.g. a thread resume still seeding its
   * session) lands AFTER a newer click and re-attaches the session the user
   * just navigated away from. Queued switches run in click order, so the
   * last one wins. The no-op checks run inside the queued operation, when
   * the prior switch has settled.
   */
  private enqueueSwitch<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.switchChain.then(operation);
    this.switchChain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async switchProject(targetId: string): Promise<void> {
    return this.enqueueSwitch(() => this.switchProjectQueued(targetId));
  }

  private async switchProjectQueued(targetId: string): Promise<void> {
    // Re-selecting the active project is a no-op — unless a sandbox is in
    // the foreground, in which case this switches back to the repo base.
    if ((targetId === this.activeProjectId && !this.activeSandboxId) || !this.host) {
      return;
    }

    const targetProject = await this.db.getProject(targetId);
    if (!targetProject) {
      return;
    }

    this.callbacks?.onSwitchingStateChanged(true);

    try {
      // Off the critical path — see openSandbox. The outgoing session stays
      // live; eviction and beforeunload also persist it.
      void this.saveCurrentProject().catch((error) => {
        console.warn('[projects] background save before switch failed', error);
      });

      const files = await this.db.getProjectFiles(targetId);
      const agentState = await this.db.getProjectAgentState(targetId);

      if (this.host.switchProjectWorkspaceToSession) {
        const { workspaceReplaced } =
          await this.host.switchProjectWorkspaceToSession(
            targetId,
            targetProject.templateId,
            files,
            targetProject.dbPrefix,
            getProjectDefaultDatabaseName(targetProject),
          );
        await this.host.syncProjectGit(targetProject);
        if (workspaceReplaced) {
          // Only freshly-(re)created sessions get the persisted agent state;
          // a live session's transcripts are newer than any snapshot.
          await this.host.restoreAgentStateSnapshot(agentState ?? null);
        }
      } else {
        await this.host.switchProjectWorkspace(
          targetProject.templateId,
          files,
          targetProject.dbPrefix,
          getProjectDefaultDatabaseName(targetProject),
        );
        await this.host.syncProjectGit(targetProject);
        await this.host.restoreAgentStateSnapshot(agentState ?? null);
      }

      const previousSandboxId = this.activeSandboxId;
      this.activeSandboxId = null;
      this.activeProjectId = targetId;
      writeActiveProjectId(targetId);
      writeUrlProjectId(targetId);

      if (previousSandboxId) {
        this.callbacks?.onActiveSandboxChanged?.(null);
      }
      this.callbacks?.onActiveProjectChanged(targetId);
      await this.syncActiveProjectThreads();

      targetProject.lastModified = Date.now();
      await this.db.putProject(targetProject);
      await this.notifyProjectsChanged();
    } finally {
      this.callbacks?.onSwitchingStateChanged(false);
    }
  }

  // ── Sandboxes ──
  //
  // Persistence-only at this layer. The VFS-side work (copying the repo base
  // snapshot into a fresh container, `git checkout -b <branch>`) is owned by
  // the workbench host when it opens a sandbox. Likewise the repo baseline:
  // for repos without `.git`, the host runs `git init` + `git add -A` +
  // `git commit` inside a container; the manager only records defaultBranch
  // (set on creation, backfilled to "main" by the DB migration).

  async createSandbox(repoId: string, name?: string): Promise<SandboxRecord> {
    const repo = await this.db.getRepo(repoId);
    if (!repo) {
      throw new Error(`Unknown repo: ${repoId}`);
    }

    const existing = await this.db.listSandboxes(repoId);
    const sandboxName = name?.trim() || `sandbox-${existing.length + 1}`;
    const id = crypto.randomUUID();
    const now = Date.now();
    const sandbox: SandboxRecord = {
      id,
      repoId,
      name: sandboxName,
      branch: allocateSandboxBranch(sandboxName, existing),
      createdAt: now,
      lastActive: now,
      filesKey: id,
      agentStateKey: id,
    };
    await this.db.putSandbox(sandbox);
    await this.notifySandboxesChanged();
    return sandbox;
  }

  async listSandboxes(repoId: string): Promise<SandboxRecord[]> {
    return this.db.listSandboxes(repoId);
  }

  async getSandboxesGroupedByRepo(): Promise<Record<string, SandboxRecord[]>> {
    const repos = await this.db.listRepos();
    const grouped: Record<string, SandboxRecord[]> = {};
    for (const repo of repos) {
      grouped[repo.id] = await this.db.listSandboxes(repo.id);
    }
    return grouped;
  }

  async updateSandboxPr(sandboxId: string, pr: SandboxPrRecord): Promise<void> {
    const sandbox = await this.db.getSandbox(sandboxId);
    if (!sandbox) return;
    sandbox.pr = pr;
    await this.db.putSandbox(sandbox);
    await this.notifySandboxesChanged();
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    const host = this.host;

    // A foreground sandbox switches back to its repo base first. Clearing
    // activeSandboxId up front skips the pre-switch snapshot — there is
    // nothing worth saving from a sandbox that's being deleted — so the
    // switch must not go through switchProject/saveCurrentProject (which
    // would fall back to the active sandbox VFS as the repo's files).
    if (sandboxId === this.activeSandboxId) {
      this.activeSandboxId = null;
      this.callbacks?.onActiveSandboxChanged?.(null);

      const repo = this.activeProjectId
        ? await this.db.getProject(this.activeProjectId)
        : undefined;
      if (repo && host?.switchProjectWorkspaceToSession) {
        this.callbacks?.onSwitchingStateChanged(true);
        try {
          const files = await this.db.getProjectFiles(repo.id);
          const { workspaceReplaced } =
            await host.switchProjectWorkspaceToSession(
              repo.id,
              repo.templateId,
              files,
              repo.dbPrefix,
              getProjectDefaultDatabaseName(repo),
            );
          await host.syncProjectGit(repo);
          if (workspaceReplaced) {
            const agentState = await this.db.getProjectAgentState(repo.id);
            await host.restoreAgentStateSnapshot(agentState ?? null);
          }
        } finally {
          this.callbacks?.onSwitchingStateChanged(false);
        }
      }
    }

    // The sandbox session is now in the background (if it was ever live);
    // dispose it the same way pool eviction does, minus the snapshot.
    host?.disposeSession?.(sandboxId);

    await this.db.deleteSandbox(sandboxId);
    await this.notifySandboxesChanged();
    await this.notifyResumableThreadsChanged();
  }

  async touchSandbox(sandboxId: string): Promise<void> {
    const sandbox = await this.db.getSandbox(sandboxId);
    if (!sandbox) return;
    sandbox.lastActive = Date.now();
    await this.db.putSandbox(sandbox);
    await this.notifySandboxesChanged();
  }

  // ── Sandbox PR / merge actions ──
  //
  // Both run real git/gh commands inside the sandbox session's container
  // (gh reads its auth from the session VFS — credentials are seeded per
  // session). Dormant sandboxes are opened first; that also brings them to
  // the foreground, which is the expected UX for an explicit action on the
  // sandbox row.

  /**
   * Commit (if dirty), push the branch, and open a GitHub PR for a sandbox
   * of a GitHub-backed repo. Stores the PR on the sandbox record so the
   * sidebar badge flips from branch name to "PR #N (state)".
   */
  async createPrForSandbox(sandboxId: string): Promise<SandboxPrRecord> {
    const sandbox = await this.db.getSandbox(sandboxId);
    if (!sandbox) {
      throw new Error(`Unknown sandbox: ${sandboxId}`);
    }
    const repo = await this.db.getRepo(sandbox.repoId);
    if (!repo) {
      throw new Error(`Unknown repo: ${sandbox.repoId}`);
    }
    if (!repo.gitRemote) {
      throw new Error(
        'This repo has no GitHub remote — use "Merge to main" instead.',
      );
    }

    await this.ensureSandboxSessionLive(sandboxId);
    await this.commitSandboxIfDirty(sandboxId, sandbox);

    await this.runSandboxCommandOrThrow(
      sandboxId,
      `git push -u origin ${quoteShellArg(sandbox.branch)}`,
    );

    // An existing PR tracks the branch — pushing updated it.
    if (sandbox.pr) {
      void this.refreshSandboxPrState(sandboxId).catch(() => {});
      return sandbox.pr;
    }

    const created = await this.runSandboxCommandOrThrow(
      sandboxId,
      `gh pr create --title ${quoteShellArg(sandbox.name)} --head ${quoteShellArg(sandbox.branch)}`,
    );

    const pr = parsePrCreateOutput(created.stdout);
    if (!pr) {
      throw new Error(
        `gh pr create did not return a pull request URL:\n${created.stdout.trim()}`,
      );
    }

    await this.updateSandboxPr(sandboxId, pr);
    return pr;
  }

  /**
   * Merge a local-only repo's sandbox branch into the default branch inside
   * the sandbox container, then promote the merged tree to the repo's base
   * snapshot. On conflict the merge aborts atomically and the conflict
   * output surfaces as the thrown error (no visual merge UI in v1).
   */
  async mergeSandboxToMain(sandboxId: string): Promise<void> {
    const sandbox = await this.db.getSandbox(sandboxId);
    if (!sandbox) {
      throw new Error(`Unknown sandbox: ${sandboxId}`);
    }
    const repo = await this.db.getRepo(sandbox.repoId);
    if (!repo) {
      throw new Error(`Unknown repo: ${sandbox.repoId}`);
    }
    if (repo.gitRemote) {
      throw new Error(
        'GitHub-backed repos merge through pull requests — use "Create PR" instead.',
      );
    }

    await this.ensureSandboxSessionLive(sandboxId);
    await this.commitSandboxIfDirty(sandboxId, sandbox);

    const defaultBranch = repo.defaultBranch || REPO_DEFAULT_BRANCH;
    await this.runSandboxCommandOrThrow(
      sandboxId,
      `git checkout ${quoteShellArg(defaultBranch)}`,
    );

    const merge = await this.runSandboxCommand(
      sandboxId,
      `git merge ${quoteShellArg(sandbox.branch)}`,
    );
    if (merge.exitCode !== 0) {
      // Leave the merge aborted and put the sandbox back on its branch.
      await this.runSandboxCommand(sandboxId, 'git merge --abort').catch(
        () => {},
      );
      await this.runSandboxCommand(
        sandboxId,
        `git checkout ${quoteShellArg(sandbox.branch)}`,
      ).catch(() => {});
      throw new Error(
        (merge.stderr || merge.stdout || 'git merge failed').trim(),
      );
    }

    // Promote the merged main to the repo's base snapshot before switching
    // the working tree back to the sandbox branch. A missing VFS here would
    // mean the merge commit exists but main's snapshot silently diverged —
    // fail loudly instead (ensureSandboxSessionLive makes this unreachable
    // in practice).
    const vfs = this.host?.getVfsForSession?.(sandboxId);
    if (!vfs) {
      throw new Error(
        'Merge succeeded but the sandbox session is no longer live; the repo base snapshot was not updated. Reopen the sandbox and merge again.',
      );
    }
    const files = collectProjectFilesBase64(vfs, { includeGit: true });
    await this.db.saveProjectFiles(repo.id, files);
    // A live (read-only) repo-base session keeps showing pre-merge files
    // otherwise — push the new base into it.
    this.host?.refreshRepoBaseSession?.(repo.id, files);

    await this.runSandboxCommandOrThrow(
      sandboxId,
      `git checkout ${quoteShellArg(sandbox.branch)}`,
    );

    repo.lastModified = Date.now();
    await this.db.putProject(repo);
    await this.notifyProjectsChanged();
  }

  /**
   * Lazily refresh a sandbox's stored PR state via `gh pr view` — called on
   * sidebar row expansion. Only runs against a live session (its own, or
   * the repo base's); never spins up a container just to poll.
   */
  async refreshSandboxPrState(sandboxId: string): Promise<void> {
    const host = this.host;
    const sandbox = await this.db.getSandbox(sandboxId);
    const pr = sandbox?.pr;
    if (!sandbox || !pr || !host?.runSessionCommand) {
      return;
    }

    const liveSessionId = host.getVfsForSession?.(sandboxId)
      ? sandboxId
      : host.getVfsForProject?.(sandbox.repoId)
        ? sandbox.repoId
        : null;
    if (!liveSessionId) {
      return;
    }

    const viewed = await host.runSessionCommand(
      liveSessionId,
      `gh pr view ${pr.number} --json state`,
    );
    if (viewed.exitCode !== 0) {
      return;
    }

    const state = parsePrViewState(viewed.stdout);
    if (state && state !== pr.state) {
      await this.updateSandboxPr(sandboxId, { ...pr, state });
    }
  }

  /** Bring a sandbox's session live (and to the foreground) if it isn't. */
  private async ensureSandboxSessionLive(sandboxId: string): Promise<void> {
    if (this.host?.getVfsForSession?.(sandboxId)) {
      return;
    }
    await this.openSandbox(sandboxId);
  }

  /** `git add -A` + commit with a generated message when the tree is dirty. */
  private async commitSandboxIfDirty(
    sandboxId: string,
    sandbox: SandboxRecord,
  ): Promise<void> {
    const status = await this.runSandboxCommandOrThrow(
      sandboxId,
      'git status --porcelain',
    );
    if (!status.stdout.trim()) {
      return;
    }
    await this.runSandboxCommandOrThrow(sandboxId, 'git add -A');
    await this.runSandboxCommandOrThrow(
      sandboxId,
      `git commit -m ${quoteShellArg(`Sandbox ${sandbox.name} changes`)}`,
    );
  }

  private async runSandboxCommand(
    sessionId: string,
    command: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const host = this.host;
    if (!host?.runSessionCommand) {
      throw new Error('Sandbox actions are unavailable in this session.');
    }
    return host.runSessionCommand(sessionId, command);
  }

  private async runSandboxCommandOrThrow(
    sessionId: string,
    command: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const result = await this.runSandboxCommand(sessionId, command);
    if (result.exitCode !== 0) {
      throw new Error(
        (result.stderr || result.stdout || `${command} failed`).trim(),
      );
    }
    return result;
  }

  /**
   * Discover a sandbox's Claude chats. Live sandbox sessions are read
   * straight from the session VFS (sessions are keyed by sandbox id);
   * dormant sandboxes fall back to the persisted agent-state snapshot.
   * Discovered records keep the `ownerId` transition convention from
   * resumable-threads.ts (projectId === sandboxId === the sandbox id) so
   * repo-level thread replacement can never clobber them. Records are
   * persisted and the resumable-threads callback re-fires.
   */
  async discoverSandboxThreads(sandboxId: string): Promise<ResumableThreadRecord[]> {
    const sandbox = await this.db.getSandbox(sandboxId);
    if (!sandbox) {
      return [];
    }

    let claudeFiles: SerializedFile[];
    const liveVfs = this.host?.getVfsForSession?.(sandboxId);
    if (liveVfs) {
      claudeFiles = collectScopedFilesBase64(liveVfs, [CLAUDE_PROJECTS_ROOT]);
    } else {
      const agentState = await this.db.getSandboxAgentState(sandboxId);
      claudeFiles = agentState?.claudeFiles ?? [];
    }

    const discovered = discoverClaudeThreads(sandboxId, claudeFiles);
    const openCodeThreads =
      (await this.host
        ?.discoverSandboxOpenCodeThreads?.(sandboxId)
        .catch(() => [])) ?? [];
    const codexThreads =
      (await this.host
        ?.discoverSandboxCodexThreads?.(sandboxId)
        .catch(() => [])) ?? [];
    const stored = await this.db.listSandboxResumableThreads(sandboxId);
    const byId = new Map(stored.map((thread) => [thread.id, thread] as const));
    for (const thread of [...discovered, ...openCodeThreads, ...codexThreads]) {
      byId.set(thread.id, thread);
      await this.db.putResumableThread(thread);
    }
    if (
      discovered.length > 0 ||
      openCodeThreads.length > 0 ||
      codexThreads.length > 0
    ) {
      await this.notifyResumableThreadsChanged();
    }

    return Array.from(byId.values()).sort(
      (left, right) => right.updatedAt - left.updatedAt,
    );
  }

  async saveSandboxFiles(sandboxId: string, files: SerializedFile[]): Promise<void> {
    await this.db.saveSandboxFiles(sandboxId, files);
  }

  async loadSandboxFiles(sandboxId: string): Promise<SerializedFile[]> {
    return this.db.getSandboxFiles(sandboxId);
  }

  async saveSandboxAgentState(
    sandboxId: string,
    snapshot: ProjectAgentStateSnapshot,
  ): Promise<void> {
    await this.db.putSandboxAgentState({
      sandboxId,
      ...snapshot,
      openCodeDb: await this.resolveOpenCodeDbForSave(
        'sandbox',
        sandboxId,
        snapshot,
      ),
      savedAt: Date.now(),
    });
  }

  async loadSandboxAgentState(sandboxId: string): Promise<SandboxAgentStateRecord | undefined> {
    return this.db.getSandboxAgentState(sandboxId);
  }

  /**
   * Open a sandbox in the workbench: re-attaches its live session, restores
   * its persisted snapshot, or forks a fresh session from the repo's base
   * snapshot (`git checkout -b` runs host-side). The repo stays the active
   * project (threads and sidebar selection are still repo-keyed).
   */
  async openSandbox(sandboxId: string): Promise<void> {
    return this.enqueueSwitch(() => this.openSandboxQueued(sandboxId));
  }

  private async openSandboxQueued(sandboxId: string): Promise<void> {
    const host = this.host;
    if (!host?.openSandboxSession) {
      throw new Error('Sandboxes are unavailable in this session.');
    }
    if (this.activeSandboxId === sandboxId) {
      return;
    }

    const sandbox = await this.db.getSandbox(sandboxId);
    if (!sandbox) {
      throw new Error(`Unknown sandbox: ${sandboxId}`);
    }
    const repo = await this.db.getRepo(sandbox.repoId);
    if (!repo) {
      throw new Error(`Unknown repo: ${sandbox.repoId}`);
    }

    this.callbacks?.onSwitchingStateChanged(true);

    try {
      // Snapshot the outgoing session off the critical path: it stays live
      // (its VFS doesn't change under us), and eviction/beforeunload also
      // persist it. Awaiting here made every switch pay a full VFS walk.
      void this.saveCurrentProject().catch((error) => {
        console.warn('[projects] background save before switch failed', error);
      });

      const savedFiles = await this.db.getSandboxFiles(sandboxId);
      const baseFiles = savedFiles.length > 0
        ? []
        : await this.db.getProjectFiles(sandbox.repoId);

      const { workspaceReplaced } = await host.openSandboxSession(
        repo,
        sandbox,
        savedFiles,
        baseFiles,
        repo.dbPrefix,
        getProjectDefaultDatabaseName(repo),
      );
      await host.syncProjectGit(repo);
      if (workspaceReplaced) {
        const agentState = await this.db.getSandboxAgentState(sandboxId);
        await host.restoreAgentStateSnapshot(agentState ?? null);
      }

      this.activeSandboxId = sandboxId;
      this.callbacks?.onActiveSandboxChanged?.(sandboxId);
      if (this.activeProjectId !== sandbox.repoId) {
        this.activeProjectId = sandbox.repoId;
        writeActiveProjectId(sandbox.repoId);
        writeUrlProjectId(sandbox.repoId);
        this.callbacks?.onActiveProjectChanged(sandbox.repoId);
      }

      await this.touchSandbox(sandboxId);
      await this.syncActiveProjectThreads();
    } finally {
      this.callbacks?.onSwitchingStateChanged(false);
    }
  }

  /** Alias of {@link openSandbox} — switching IS opening (live sessions re-attach). */
  async switchToSandbox(sandboxId: string): Promise<void> {
    await this.openSandbox(sandboxId);
  }

  /**
   * Open a repo for WORK: its most recently active sandbox, creating the
   * first one when none exist. Main never opens writable — all work happens
   * on sandbox branches — but users land in a usable workspace instead of a
   * read-only base that refuses edits and agent launches. Viewing main
   * read-only stays available via {@link switchProject}.
   */
  async openRepo(repoId: string): Promise<void> {
    if (!this.host?.openSandboxSession) {
      // Hosts without sandbox support (bare embeds) keep the legacy flow.
      await this.switchProject(repoId);
      return;
    }

    const sandboxes = await this.db.listSandboxes(repoId);
    if (sandboxes.length > 0) {
      const latest = sandboxes.reduce((a, b) =>
        (b.lastActive ?? 0) > (a.lastActive ?? 0) ? b : a,
      );
      await this.openSandbox(latest.id);
      return;
    }

    const hadBaseFiles =
      (await this.db.getProjectFiles(repoId)).length > 0;
    const sandbox = await this.createSandbox(repoId);
    await this.openSandbox(sandbox.id);

    // First sandbox of a template-fresh repo: the sandbox just seeded the
    // workspace, but the repo base is still empty — promote the pristine
    // post-seed state so future forks (and "main") aren't empty.
    if (!hadBaseFiles) {
      const vfs = this.host?.getVfsForSession?.(sandbox.id);
      if (vfs) {
        await this.db.saveProjectFiles(
          repoId,
          collectProjectFilesBase64(vfs, { includeGit: true }),
        );
      }
    }
  }

  async saveCurrentProject(): Promise<void> {
    if (!this.host) {
      return;
    }

    if (this.activeSandboxId) {
      await this.persistSandbox(this.activeSandboxId);
    }

    if (!this.activeProjectId) {
      return;
    }

    // Read from the session that owns the project — never another session
    // that happens to be active in the workbench. While a sandbox is in the
    // foreground the repo base may have no live session: never fall back to
    // the active (sandbox) VFS, that would overwrite main with fork state.
    // The bare `getVfs()` fallback is ONLY for legacy hosts without session
    // machinery: on session-aware hosts an unbound project means "no live
    // workspace" (e.g. the empty bootstrap container at boot), and saving
    // that would wipe the repo's stored files.
    const vfs =
      this.host.getVfsForProject?.(this.activeProjectId)
      ?? (this.activeSandboxId || this.host.getVfsForProject
        ? null
        : this.host.getVfs());
    if (vfs) {
      const files = collectProjectFilesBase64(vfs, { includeGit: true });
      await this.db.saveProjectFiles(this.activeProjectId, files);

      const agentState = await this.host.collectAgentStateSnapshot(
        this.activeProjectId,
      );
      await this.db.putProjectAgentState({
        projectId: this.activeProjectId,
        ...agentState,
        openCodeDb: await this.resolveOpenCodeDbForSave(
          'project',
          this.activeProjectId,
          agentState,
        ),
        savedAt: Date.now(),
      });
    }

    await this.syncActiveProjectThreads();

    const project = await this.db.getProject(this.activeProjectId);
    if (project) {
      project.lastModified = Date.now();
      await this.db.putProject(project);
    }
  }

  /**
   * Snapshot every live session — the active project/sandbox via
   * `saveCurrentProject`, plus all background sessions. Runs on the
   * auto-save cadence, on beforeunload, and when an AI tab closes.
   */
  async saveAllSessions(): Promise<void> {
    await this.saveCurrentProject();

    const host = this.host;
    const sessionIds = host?.getLiveSessionIds?.();
    if (!host || !sessionIds) {
      return;
    }

    const activeSessionId = host.getActiveSessionId?.() ?? null;
    for (const sessionId of sessionIds) {
      // Skip sessions saveCurrentProject already covered.
      if (sessionId === activeSessionId) continue;
      if (sessionId === this.activeSandboxId) continue;
      if (
        this.activeProjectId
        && host.getProjectIdForSession?.(sessionId) === this.activeProjectId
      ) {
        continue;
      }
      try {
        await this.persistSessionById(sessionId);
      } catch (error) {
        console.warn(`[projects] failed to snapshot session ${sessionId}`, error);
      }
    }
  }

  /** Snapshot one sandbox's files + agent state from its live session. */
  private async persistSandbox(sandboxId: string): Promise<void> {
    const host = this.host;
    const vfs = host?.getVfsForSession?.(sandboxId);
    if (!host || !vfs) {
      return;
    }

    const files = collectProjectFilesBase64(vfs, { includeGit: true });
    await this.db.saveSandboxFiles(sandboxId, files);

    const agentState = await host.collectAgentStateSnapshotForSession?.(sandboxId);
    if (agentState) {
      await this.db.putSandboxAgentState({
        sandboxId,
        ...agentState,
        openCodeDb: await this.resolveOpenCodeDbForSave(
          'sandbox',
          sandboxId,
          agentState,
        ),
        savedAt: Date.now(),
      });
    }
  }

  /**
   * Snapshot any live session by id: sandbox sessions persist to the
   * sandbox stores, project-bound sessions to the project stores. Also the
   * host's pre-eviction snapshot (registered in `setHost`).
   */
  private async persistSessionById(sessionId: string): Promise<void> {
    const host = this.host;
    if (!host) {
      return;
    }

    const sandbox = await this.db.getSandbox(sessionId);
    if (sandbox) {
      await this.persistSandbox(sessionId);
      return;
    }

    const projectId = host.getProjectIdForSession?.(sessionId);
    if (!projectId) {
      return;
    }
    const project = await this.db.getProject(projectId);
    const vfs = host.getVfsForSession?.(sessionId);
    if (!project || !vfs) {
      return;
    }

    const files = collectProjectFilesBase64(vfs, { includeGit: true });
    await this.db.saveProjectFiles(projectId, files);

    const agentState =
      (await host.collectAgentStateSnapshotForSession?.(sessionId))
      ?? (await host.collectAgentStateSnapshot(projectId));
    await this.db.putProjectAgentState({
      projectId,
      ...agentState,
      openCodeDb: await this.resolveOpenCodeDbForSave(
        'project',
        projectId,
        agentState,
      ),
      savedAt: Date.now(),
    });
  }

  /**
   * `openCodeDb` value for an agent-state save: an explicitly collected
   * blob wins (legacy host shapes/tests), otherwise the record's existing
   * legacy blob is carried forward so saves never erase it.
   */
  private async resolveOpenCodeDbForSave(
    kind: 'project' | 'sandbox',
    id: string,
    snapshot: ProjectAgentStateSnapshot,
  ): Promise<Uint8Array | null> {
    if (snapshot.openCodeDb !== undefined) {
      return snapshot.openCodeDb;
    }

    const cacheKey = `${kind}:${id}`;
    if (this.legacyOpenCodeDbCache.has(cacheKey)) {
      return this.legacyOpenCodeDbCache.get(cacheKey) ?? null;
    }

    const record = kind === 'project'
      ? await this.db.getProjectAgentState?.(id)
      : await this.db.getSandboxAgentState?.(id);
    const blob = record?.openCodeDb ?? null;
    this.legacyOpenCodeDbCache.set(cacheKey, blob);
    return blob;
  }

  async resumeThread(threadId: string): Promise<void> {
    const host = this.host;
    if (!host) {
      return;
    }

    const thread = await this.db.getResumableThread(threadId);
    if (!thread) {
      return;
    }

    // Sandbox chats resume inside their owning sandbox's session, wherever
    // the resume came from — never in whichever session happens to be
    // active. (Legacy records carry sandboxId === projectId, so only a
    // real sandbox record selects this path.)
    const sandbox = thread.sandboxId
      ? await this.db.getSandbox?.(thread.sandboxId)
      : undefined;
    if (sandbox && host.openSandboxSession) {
      if (this.activeSandboxId !== sandbox.id) {
        await this.openSandbox(sandbox.id);
      }
      await host.resumeResumableThread(thread);
      await this.syncActiveProjectThreads();
      return;
    }

    if (thread.projectId !== this.activeProjectId) {
      await this.switchProject(thread.projectId);
    }

    // Legacy repo-level thread: the repo base is read-only, so resuming
    // there would only fire the fork-requested event. Fork a sandbox seeded
    // with the repo's legacy agent state (transcripts included) and resume
    // the thread inside it. The fork is recorded on the thread so the next
    // resume reuses it instead of forking another sandbox.
    const repo = await this.db.getProject(thread.projectId);
    if (repo && host.openSandboxSession) {
      const agentState = await this.db.getProjectAgentState(thread.projectId);
      const fork = await this.createSandbox(thread.projectId);
      if (agentState) {
        // Seed BEFORE opening so the fresh session restores the transcripts.
        await this.saveSandboxAgentState(fork.id, {
          claudeFiles: agentState.claudeFiles,
          openCodeDb: agentState.openCodeDb ?? null,
        });
      }
      await this.db.putResumableThread({ ...thread, sandboxId: fork.id });
      await this.openSandbox(fork.id);
    }

    await host.resumeResumableThread(thread);
    await this.syncActiveProjectThreads();
  }

  async syncActiveProjectThreads(): Promise<ResumableThreadRecord[]> {
    if (!this.activeProjectId) {
      this.callbacks?.onResumableThreadsChanged([]);
      return [];
    }

    // While a sandbox is foreground the active VFS is the SANDBOX's:
    // repo-level discovery would read sandbox transcripts and file them
    // under the repo (chats landing in the wrong history). Discover into
    // the sandbox's own bucket instead.
    if (this.activeSandboxId) {
      try {
        return await this.discoverSandboxThreads(this.activeSandboxId);
      } catch {
        await this.notifyResumableThreadsChanged();
        return [];
      }
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
    if (this.threadRefreshTimer) {
      clearTimeout(this.threadRefreshTimer);
      this.threadRefreshTimer = null;
    }

    window.removeEventListener(
      AI_SIDEBAR_TAB_CLOSED_EVENT,
      this.handleAiSidebarTabClosed,
    );
    window.removeEventListener(
      AGENT_THREAD_UPDATED_EVENT,
      this.handleAgentThreadUpdated,
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
      void this.saveAllSessions().finally(() => {
        this.scheduleAutoSave();
      });
    }, AUTO_SAVE_DEBOUNCE_MS);
  }

  private async notifyProjectsChanged(): Promise<void> {
    const projects = await this.db.listProjects();
    this.callbacks?.onProjectsChanged(projects);
  }

  private async notifySandboxesChanged(): Promise<void> {
    if (!this.callbacks?.onSandboxesChanged) {
      return;
    }
    const grouped = await this.getSandboxesGroupedByRepo();
    this.callbacks.onSandboxesChanged?.(grouped);
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
    await this.notifySandboxesChanged();
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
    // The in-place restore re-attached the previous repo base — read-only.
    this.host.markActiveSessionReadOnly?.();
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
    defaultBranch: REPO_DEFAULT_BRANCH,
  };
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * `gh pr create` prints the new PR's URL on stdout
 * (e.g. "https://github.com/owner/repo/pull/123").
 */
export function parsePrCreateOutput(stdout: string): SandboxPrRecord | null {
  const match = stdout.match(/https?:\/\/\S+\/pull\/(\d+)/);
  if (!match) {
    return null;
  }
  return {
    number: Number.parseInt(match[1]!, 10),
    url: match[0],
    state: 'open',
  };
}

/**
 * `gh pr view <n> --json state` prints `{ "state": "OPEN" | "MERGED" |
 * "CLOSED" }`; sandbox records store the lowercased form.
 */
export function parsePrViewState(stdout: string): string | null {
  try {
    const parsed = JSON.parse(stdout) as { state?: unknown };
    return typeof parsed.state === 'string'
      ? parsed.state.toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function allocateSandboxBranch(name: string, existing: SandboxRecord[]): string {
  const taken = new Set(existing.map((sandbox) => sandbox.branch));
  const slug = toSandboxBranchSlug(name);
  let branch = `sandbox/${slug}`;
  for (let suffix = 2; taken.has(branch); suffix += 1) {
    branch = `sandbox/${slug}-${suffix}`;
  }
  return branch;
}

function toSandboxBranchSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 50)
    .replace(/^-+|-+$/g, '');

  return slug || 'sandbox';
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
