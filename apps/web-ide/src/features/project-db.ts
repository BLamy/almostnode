/**
 * IndexedDB wrapper for multi-project persistence.
 *
 * DB: "almostnode-webide"
 * Stores: projects, project-files, project-agent-state, resumable-threads,
 * sandboxes, sandbox-files, sandbox-agent-state
 *
 * Repo > Sandbox model: repo records live in the legacy "projects" store
 * (on-disk store names are kept to limit migration risk). A repo's base
 * snapshot (the working copy of its default branch) stays in "project-files"
 * keyed by repo id; each sandbox gets its own VFS + agent-state snapshot in
 * the parallel per-sandbox stores.
 */

import type { SerializedFile } from '../desktop/project-snapshot';
import type { TemplateId } from './workspace-seed';

// ── Record types ──────────────────────────────────────────────────────────────

export interface ProjectRecord {
  id: string;
  name: string;
  templateId: TemplateId;
  createdAt: number;
  lastModified: number;
  dbPrefix: string;
  defaultDatabaseName?: string;
  gitRemote?: ProjectGitRemoteRecord;
  /** Branch sandboxes fork from. Optional pre-migration; see {@link RepoRecord}. */
  defaultBranch?: string;
}

/**
 * A project promoted to the Repo > Sandbox model. Same on-disk record as
 * ProjectRecord (stored in the "projects" store); `defaultBranch` is filled
 * with "main" by the v5 migration for records that predate it.
 */
export interface RepoRecord extends ProjectRecord {
  defaultBranch: string;
}

export interface SandboxPrRecord {
  number: number;
  url: string;
  state: string;
}

export interface SandboxRecord {
  id: string;
  repoId: string;
  name: string;
  /** Git branch the sandbox is bound to, e.g. "sandbox/fix-login". */
  branch: string;
  createdAt: number;
  lastActive: number;
  pr?: SandboxPrRecord;
  /** Key into the "sandbox-files" store holding the persisted VFS snapshot. */
  filesKey: string;
  /** Key into the "sandbox-agent-state" store holding the agent-state snapshot. */
  agentStateKey: string;
}

export interface ProjectGitRemoteRecord {
  name: string;
  url: string;
  provider?: 'github';
  repositoryFullName?: string;
  repositoryUrl?: string;
}

export interface ProjectFilesRecord {
  projectId: string;
  files: SerializedFile[];
  savedAt: number;
}

export type AgentHarness = 'claude' | 'opencode' | 'codex';

/**
 * Persisted transcript of one Codex thread. The WASM Codex build keeps no
 * rollout files, so the app-server JSON-RPC tee (codexConversationBus) is
 * the only record of a conversation — these captured events are what makes
 * a Codex chat survive a page reload: the sidebar lists the thread from
 * this record and clicking it replays the events into the chat surface.
 */
export interface CodexThreadTranscriptRecord {
  id: string;
  title: string | null;
  createdAt: number;
  updatedAt: number;
  /** Captured codexConversationBus events (bounded; oldest dropped). */
  events: unknown[];
}

export interface ProjectAgentStateSnapshot {
  claudeFiles: SerializedFile[];
  /**
   * Legacy per-project/per-sandbox OpenCode DB blob. OpenCode history now
   * lives in ONE host-level browser DB (persisted by db.browser's own
   * auto-persist loop; see opencode-browser-session.ts) so new snapshots no
   * longer collect this — existing blobs are carried forward untouched for
   * one release as the migration seed / recovery fallback.
   */
  openCodeDb?: Uint8Array | null;
  /** Codex thread transcripts observed in this workspace's sessions. */
  codexThreads?: CodexThreadTranscriptRecord[];
}

/**
 * Manual backup of the host-level OpenCode browser DB. The live store is
 * db.browser's own IndexedDB (the single writer); this record is written
 * on demand only — never on the auto-save cadence.
 */
export interface GlobalOpenCodeStateRecord {
  id: typeof GLOBAL_OPENCODE_STATE_KEY;
  db: Uint8Array;
  savedAt: number;
}

export const GLOBAL_OPENCODE_STATE_KEY = 'opencode-db';

export interface ProjectAgentStateRecord extends ProjectAgentStateSnapshot {
  projectId: string;
  savedAt: number;
}

export interface SandboxFilesRecord {
  sandboxId: string;
  files: SerializedFile[];
  savedAt: number;
}

export interface SandboxAgentStateRecord extends ProjectAgentStateSnapshot {
  sandboxId: string;
  savedAt: number;
}

export interface ResumableThreadRecord {
  id: string;
  projectId: string;
  /** Owning sandbox once the sandbox model lands; absent on legacy records. */
  sandboxId?: string;
  harness: AgentHarness;
  title: string;
  resumeToken: string;
  createdAt: number;
  updatedAt: number;
}

export type AppBuildingJobStatus =
  | 'starting'
  | 'processing'
  | 'idle'
  | 'stopping'
  | 'stopped'
  | 'error';

export interface AppBuildingConfig {
  projectId: string;
  flyAppName: string | null;
  imageRef: string | null;
  infisicalEnvironment: string | null;
  hasInfisicalCredentials: boolean;
  hasFlyApiToken: boolean;
  updatedAt: number;
}

export interface AppBuildingJobRecord {
  id: string;
  projectId: string;
  appName: string;
  prompt: string;
  promptSummary: string;
  status: AppBuildingJobStatus;
  repositoryName: string;
  repositoryFullName: string;
  repositoryUrl: string;
  repositoryCloneUrl: string;
  cloneBranch: string;
  pushBranch: string;
  flyApp: string;
  baseUrl: string;
  containerName: string;
  machineId: string;
  machineInstanceId?: string | null;
  volumeId: string | null;
  imageRef: string | null;
  agentCommand: string | null;
  revision: string | null;
  queueLength: number | null;
  pendingTasks: number | null;
  totalCost: number | null;
  lastActivityAt: string | null;
  lastEventOffset: number;
  lastLogOffset: number;
  /** Opaque Fly logs API pagination cursor (`next_token`). */
  lastLogCursor?: string | null;
  /** ISO timestamp of the most recent log entry we've persisted. */
  lastLogTimestamp?: string | null;
  recentEvents?: string[];
  recentLogs?: string[];
  error: string | null;
  createdAt: number;
  updatedAt: number;
  stoppedAt?: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_NAME = 'almostnode-webide';
const DB_VERSION = 6;

const STORE_PROJECTS = 'projects';
const STORE_PROJECT_FILES = 'project-files';
const STORE_PROJECT_AGENT_STATE = 'project-agent-state';
const STORE_RESUMABLE_THREADS = 'resumable-threads';
const STORE_APP_BUILDING_CONFIG = 'app-building-config';
const STORE_APP_BUILDING_JOBS = 'app-building-jobs';
const STORE_SANDBOXES = 'sandboxes';
const STORE_SANDBOX_FILES = 'sandbox-files';
const STORE_SANDBOX_AGENT_STATE = 'sandbox-agent-state';
/** Singleton store for the manual host-level OpenCode DB backup (v6). */
const STORE_OPENCODE_GLOBAL = 'opencode-global';
/**
 * Pre-v5 snapshot of the project-files store, written once by the repo
 * migration and kept for one release so the migration can be rolled back.
 */
const STORE_PROJECT_FILES_BACKUP_V4 = 'project-files-backup-v4';

export const REPO_DEFAULT_BRANCH = 'main';

const REQUIRED_STORES = [
  STORE_PROJECTS,
  STORE_PROJECT_FILES,
  STORE_PROJECT_AGENT_STATE,
  STORE_RESUMABLE_THREADS,
  STORE_APP_BUILDING_CONFIG,
  STORE_APP_BUILDING_JOBS,
] as const;

function isMissingStoreError(error: unknown): boolean {
  if (
    typeof DOMException !== 'undefined'
    && error instanceof DOMException
    && error.name === 'NotFoundError'
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('specified object stores was not found')
    || message.includes('Object store')
    || message.includes('Missing store:')
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isVersionDowngradeError(error: unknown): boolean {
  if (
    typeof DOMException !== 'undefined'
    && error instanceof DOMException
    && error.name === 'VersionError'
  ) {
    return true;
  }

  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('less than the existing version')
    || message.includes('VersionError')
  );
}

function ensureRequiredStores(db: IDBDatabase): void {
  const missing = REQUIRED_STORES.filter((store) => !db.objectStoreNames.contains(store));
  if (missing.length > 0) {
    throw new Error(`Missing store: ${missing.join(', ')}`);
  }
}

function openDBAtVersion(version?: number): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = version === undefined
      ? indexedDB.open(DB_NAME)
      : indexedDB.open(DB_NAME, version);

    request.onupgradeneeded = () => {
      const db = request.result;
      // The versionchange transaction; null only under minimal test fakes
      // that don't model upgrade transactions (data migration is skipped).
      const tx = request.transaction;
      const hadProjects = db.objectStoreNames.contains(STORE_PROJECTS);
      const hadBackup = db.objectStoreNames.contains(STORE_PROJECT_FILES_BACKUP_V4);

      if (!hadProjects) {
        db.createObjectStore(STORE_PROJECTS, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORE_PROJECT_FILES)) {
        db.createObjectStore(STORE_PROJECT_FILES, { keyPath: 'projectId' });
      }

      if (!db.objectStoreNames.contains(STORE_PROJECT_AGENT_STATE)) {
        db.createObjectStore(STORE_PROJECT_AGENT_STATE, { keyPath: 'projectId' });
      }

      if (!db.objectStoreNames.contains(STORE_RESUMABLE_THREADS)) {
        const threads = db.createObjectStore(STORE_RESUMABLE_THREADS, { keyPath: 'id' });
        threads.createIndex('projectId', 'projectId', { unique: false });
        threads.createIndex('sandboxId', 'sandboxId', { unique: false });
      } else if (tx) {
        const threads = tx.objectStore(STORE_RESUMABLE_THREADS);
        if (!threads.indexNames.contains('sandboxId')) {
          threads.createIndex('sandboxId', 'sandboxId', { unique: false });
        }
      }

      if (!db.objectStoreNames.contains(STORE_APP_BUILDING_CONFIG)) {
        db.createObjectStore(STORE_APP_BUILDING_CONFIG, { keyPath: 'projectId' });
      }

      if (!db.objectStoreNames.contains(STORE_APP_BUILDING_JOBS)) {
        const jobs = db.createObjectStore(STORE_APP_BUILDING_JOBS, { keyPath: 'id' });
        jobs.createIndex('projectId', 'projectId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_SANDBOXES)) {
        const sandboxes = db.createObjectStore(STORE_SANDBOXES, { keyPath: 'id' });
        sandboxes.createIndex('repoId', 'repoId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_SANDBOX_FILES)) {
        db.createObjectStore(STORE_SANDBOX_FILES, { keyPath: 'sandboxId' });
      }

      if (!db.objectStoreNames.contains(STORE_SANDBOX_AGENT_STATE)) {
        db.createObjectStore(STORE_SANDBOX_AGENT_STATE, { keyPath: 'sandboxId' });
      }

      if (!db.objectStoreNames.contains(STORE_OPENCODE_GLOBAL)) {
        db.createObjectStore(STORE_OPENCODE_GLOBAL, { keyPath: 'id' });
      }

      if (!hadBackup) {
        db.createObjectStore(STORE_PROJECT_FILES_BACKUP_V4, { keyPath: 'projectId' });
      }

      // Repo migration: pre-v5 project records become repo records on the
      // default branch. Their file/agent-state snapshots stay where they are
      // (repo-scoped keys === old project ids). No sandboxes are created.
      if (tx && hadProjects) {
        migrateProjectRecordsToRepos(tx);
        if (!hadBackup) {
          backupProjectFilesStore(tx);
        }
      }
    };

    request.onsuccess = () => {
      try {
        ensureRequiredStores(request.result);
        resolve(request.result);
      } catch (error) {
        request.result.close();
        reject(error);
      }
    };
    request.onerror = () => reject(request.error);
  });
}

/** Fills `defaultBranch` on legacy project records inside the upgrade tx. */
function migrateProjectRecordsToRepos(tx: IDBTransaction): void {
  const projects = tx.objectStore(STORE_PROJECTS);
  const req = projects.getAll();
  req.onsuccess = () => {
    for (const record of (req.result as ProjectRecord[] | undefined) ?? []) {
      if (!record.defaultBranch) {
        projects.put({ ...record, defaultBranch: REPO_DEFAULT_BRANCH });
      }
    }
  };
}

/** One-time copy of pre-migration project files into the rollback backup store. */
function backupProjectFilesStore(tx: IDBTransaction): void {
  const source = tx.objectStore(STORE_PROJECT_FILES);
  const backup = tx.objectStore(STORE_PROJECT_FILES_BACKUP_V4);
  const req = source.getAll();
  req.onsuccess = () => {
    for (const record of (req.result as ProjectFilesRecord[] | undefined) ?? []) {
      backup.put(record);
    }
  };
}

async function openDB(): Promise<IDBDatabase> {
  try {
    return await openDBAtVersion(DB_VERSION);
  } catch (error) {
    if (!isVersionDowngradeError(error)) {
      throw error;
    }
    return openDBAtVersion();
  }
}

function txGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function txGetAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function txGetAllByIndex<T>(
  db: IDBDatabase,
  store: string,
  indexName: string,
  key: IDBValidKey,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).index(indexName).getAll(key);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function txPut(db: IDBDatabase, store: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function txDelete(db: IDBDatabase, store: string, key: IDBValidKey): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).delete(key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function txDeleteByIndex(
  db: IDBDatabase,
  store: string,
  indexName: string,
  key: IDBValidKey,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const objectStore = tx.objectStore(store);
    const index = objectStore.index(indexName);
    const cursorReq = index.openCursor(key);

    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

function toRepoRecord(project: ProjectRecord): RepoRecord {
  return { ...project, defaultBranch: project.defaultBranch ?? REPO_DEFAULT_BRANCH };
}

async function deleteSandboxRecords(db: IDBDatabase, sandboxId: string): Promise<void> {
  await txDelete(db, STORE_SANDBOXES, sandboxId);
  await txDelete(db, STORE_SANDBOX_FILES, sandboxId);
  await txDelete(db, STORE_SANDBOX_AGENT_STATE, sandboxId);
  await txDeleteByIndex(db, STORE_RESUMABLE_THREADS, 'sandboxId', sandboxId);
}

// ── ProjectDB ─────────────────────────────────────────────────────────────────

export class ProjectDB {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private getDb(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      this.dbPromise = openDB();
    }
    return this.dbPromise;
  }

  private resetDb(): void {
    const current = this.dbPromise;
    this.dbPromise = null;
    if (current) {
      void current.then((db) => db.close()).catch(() => {});
    }
  }

  private async withDb<T>(operation: (db: IDBDatabase) => Promise<T>): Promise<T> {
    const db = await this.getDb();
    try {
      return await operation(db);
    } catch (error) {
      if (!isMissingStoreError(error)) {
        throw error;
      }
      this.resetDb();
      const repairedDb = await this.getDb();
      return operation(repairedDb);
    }
  }

  // ── Projects ──

  async listProjects(): Promise<ProjectRecord[]> {
    return this.withDb(async (db) => {
      const projects = await txGetAll<ProjectRecord>(db, STORE_PROJECTS);
      return projects.sort((a, b) => b.lastModified - a.lastModified);
    });
  }

  async getProject(id: string): Promise<ProjectRecord | undefined> {
    return this.withDb((db) => txGet<ProjectRecord>(db, STORE_PROJECTS, id));
  }

  async putProject(project: ProjectRecord): Promise<void> {
    await this.withDb((db) => txPut(db, STORE_PROJECTS, project));
  }

  async deleteProject(id: string): Promise<void> {
    await this.withDb(async (db) => {
      const sandboxes = await txGetAllByIndex<SandboxRecord>(db, STORE_SANDBOXES, 'repoId', id);
      for (const sandbox of sandboxes) {
        await deleteSandboxRecords(db, sandbox.id);
      }
      await txDelete(db, STORE_PROJECTS, id);
      await txDelete(db, STORE_PROJECT_FILES, id);
      await txDelete(db, STORE_PROJECT_AGENT_STATE, id);
      await txDelete(db, STORE_APP_BUILDING_CONFIG, id);
      await txDeleteByIndex(db, STORE_APP_BUILDING_JOBS, 'projectId', id);
      await txDeleteByIndex(db, STORE_RESUMABLE_THREADS, 'projectId', id);
    });
  }

  // ── Repos ──
  // Repo records share the "projects" store; these accessors fill
  // defaultBranch for records written before the v5 migration ran.

  async listRepos(): Promise<RepoRecord[]> {
    const projects = await this.listProjects();
    return projects.map(toRepoRecord);
  }

  async getRepo(id: string): Promise<RepoRecord | undefined> {
    const project = await this.getProject(id);
    return project ? toRepoRecord(project) : undefined;
  }

  async putRepo(repo: RepoRecord): Promise<void> {
    await this.putProject(repo);
  }

  // ── Sandboxes ──

  async listSandboxes(repoId: string): Promise<SandboxRecord[]> {
    return this.withDb(async (db) => {
      const sandboxes = await txGetAllByIndex<SandboxRecord>(
        db,
        STORE_SANDBOXES,
        'repoId',
        repoId,
      );
      return sandboxes.sort((a, b) => b.lastActive - a.lastActive);
    });
  }

  async getSandbox(id: string): Promise<SandboxRecord | undefined> {
    return this.withDb((db) => txGet<SandboxRecord>(db, STORE_SANDBOXES, id));
  }

  async putSandbox(sandbox: SandboxRecord): Promise<void> {
    await this.withDb((db) => txPut(db, STORE_SANDBOXES, sandbox));
  }

  async deleteSandbox(id: string): Promise<void> {
    await this.withDb((db) => deleteSandboxRecords(db, id));
  }

  // ── Sandbox Files ──

  async getSandboxFiles(sandboxId: string): Promise<SerializedFile[]> {
    return this.withDb(async (db) => {
      const record = await txGet<SandboxFilesRecord>(db, STORE_SANDBOX_FILES, sandboxId);
      return record?.files ?? [];
    });
  }

  async saveSandboxFiles(sandboxId: string, files: SerializedFile[]): Promise<void> {
    await this.withDb(async (db) => {
      const record: SandboxFilesRecord = {
        sandboxId,
        files,
        savedAt: Date.now(),
      };
      await txPut(db, STORE_SANDBOX_FILES, record);
    });
  }

  // ── Sandbox Agent State ──

  async getSandboxAgentState(sandboxId: string): Promise<SandboxAgentStateRecord | undefined> {
    return this.withDb((db) => txGet<SandboxAgentStateRecord>(db, STORE_SANDBOX_AGENT_STATE, sandboxId));
  }

  async putSandboxAgentState(state: SandboxAgentStateRecord): Promise<void> {
    await this.withDb((db) => txPut(db, STORE_SANDBOX_AGENT_STATE, state));
  }

  // ── Global OpenCode State ──
  // Manual backup/export slot for the single host-level OpenCode browser DB
  // (the live store persists itself; see opencode-browser-session.ts).

  async getGlobalOpenCodeState(): Promise<GlobalOpenCodeStateRecord | undefined> {
    return this.withDb((db) =>
      txGet<GlobalOpenCodeStateRecord>(db, STORE_OPENCODE_GLOBAL, GLOBAL_OPENCODE_STATE_KEY),
    );
  }

  async putGlobalOpenCodeState(dbBlob: Uint8Array): Promise<void> {
    await this.withDb((db) => {
      const record: GlobalOpenCodeStateRecord = {
        id: GLOBAL_OPENCODE_STATE_KEY,
        db: dbBlob,
        savedAt: Date.now(),
      };
      return txPut(db, STORE_OPENCODE_GLOBAL, record);
    });
  }

  // ── Migration Backup ──

  /** Pre-v5 project-files snapshot, kept for one release after the repo migration. */
  async getProjectFilesBackup(projectId: string): Promise<ProjectFilesRecord | undefined> {
    return this.withDb((db) => txGet<ProjectFilesRecord>(db, STORE_PROJECT_FILES_BACKUP_V4, projectId));
  }

  // ── Project Files ──

  async getProjectFiles(projectId: string): Promise<SerializedFile[]> {
    return this.withDb(async (db) => {
      const record = await txGet<ProjectFilesRecord>(db, STORE_PROJECT_FILES, projectId);
      return record?.files ?? [];
    });
  }

  async saveProjectFiles(projectId: string, files: SerializedFile[]): Promise<void> {
    await this.withDb(async (db) => {
      const record: ProjectFilesRecord = {
        projectId,
        files,
        savedAt: Date.now(),
      };
      await txPut(db, STORE_PROJECT_FILES, record);
    });
  }

  // ── Agent State ──

  async getProjectAgentState(projectId: string): Promise<ProjectAgentStateRecord | undefined> {
    return this.withDb((db) => txGet<ProjectAgentStateRecord>(db, STORE_PROJECT_AGENT_STATE, projectId));
  }

  async putProjectAgentState(state: ProjectAgentStateRecord): Promise<void> {
    await this.withDb((db) => txPut(db, STORE_PROJECT_AGENT_STATE, state));
  }

  // ── Resumable Threads ──

  async listResumableThreads(projectId: string): Promise<ResumableThreadRecord[]> {
    return this.withDb(async (db) => {
      const threads = await txGetAllByIndex<ResumableThreadRecord>(
        db,
        STORE_RESUMABLE_THREADS,
        'projectId',
        projectId,
      );
      return threads.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }

  async listSandboxResumableThreads(sandboxId: string): Promise<ResumableThreadRecord[]> {
    return this.withDb(async (db) => {
      const threads = await txGetAllByIndex<ResumableThreadRecord>(
        db,
        STORE_RESUMABLE_THREADS,
        'sandboxId',
        sandboxId,
      );
      return threads.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }

  async listAllResumableThreads(): Promise<ResumableThreadRecord[]> {
    return this.withDb(async (db) => {
      const threads = await txGetAll<ResumableThreadRecord>(db, STORE_RESUMABLE_THREADS);
      return threads.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }

  async getResumableThread(id: string): Promise<ResumableThreadRecord | undefined> {
    return this.withDb((db) => txGet<ResumableThreadRecord>(db, STORE_RESUMABLE_THREADS, id));
  }

  async replaceProjectResumableThreads(
    projectId: string,
    threads: ResumableThreadRecord[],
  ): Promise<void> {
    await this.withDb(async (db) => {
      await txDeleteByIndex(db, STORE_RESUMABLE_THREADS, 'projectId', projectId);
      for (const thread of threads) {
        await txPut(db, STORE_RESUMABLE_THREADS, thread);
      }
    });
  }

  async putResumableThread(thread: ResumableThreadRecord): Promise<void> {
    await this.withDb((db) => txPut(db, STORE_RESUMABLE_THREADS, thread));
  }

  // ── App Building Config ──

  async getAppBuildingConfig(projectId: string): Promise<AppBuildingConfig | undefined> {
    return this.withDb((db) => txGet<AppBuildingConfig>(db, STORE_APP_BUILDING_CONFIG, projectId));
  }

  async putAppBuildingConfig(config: AppBuildingConfig): Promise<void> {
    await this.withDb((db) => txPut(db, STORE_APP_BUILDING_CONFIG, config));
  }

  // ── App Building Jobs ──

  async listAppBuildingJobs(projectId: string): Promise<AppBuildingJobRecord[]> {
    return this.withDb(async (db) => {
      const jobs = await txGetAllByIndex<AppBuildingJobRecord>(
        db,
        STORE_APP_BUILDING_JOBS,
        'projectId',
        projectId,
      );
      return jobs.sort((a, b) => b.updatedAt - a.updatedAt);
    });
  }

  async getAppBuildingJob(id: string): Promise<AppBuildingJobRecord | undefined> {
    return this.withDb((db) => txGet<AppBuildingJobRecord>(db, STORE_APP_BUILDING_JOBS, id));
  }

  async putAppBuildingJob(job: AppBuildingJobRecord): Promise<void> {
    await this.withDb((db) => txPut(db, STORE_APP_BUILDING_JOBS, job));
  }

  async deleteAppBuildingJob(id: string): Promise<void> {
    await this.withDb((db) => txDelete(db, STORE_APP_BUILDING_JOBS, id));
  }
}
