/**
 * IndexedDB wrapper for multi-project persistence.
 *
 * DB: "almostnode-webide"
 * Stores: projects, project-files, project-agent-state, resumable-threads
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

export type AgentHarness = 'claude' | 'opencode';

export interface ProjectAgentStateSnapshot {
  claudeFiles: SerializedFile[];
  openCodeDb: Uint8Array | null;
}

export interface ProjectAgentStateRecord extends ProjectAgentStateSnapshot {
  projectId: string;
  savedAt: number;
}

export interface ResumableThreadRecord {
  id: string;
  projectId: string;
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
const DB_VERSION = 4;

const STORE_PROJECTS = 'projects';
const STORE_PROJECT_FILES = 'project-files';
const STORE_PROJECT_AGENT_STATE = 'project-agent-state';
const STORE_RESUMABLE_THREADS = 'resumable-threads';
const STORE_APP_BUILDING_CONFIG = 'app-building-config';
const STORE_APP_BUILDING_JOBS = 'app-building-jobs';

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

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_PROJECTS)) {
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
      }

      if (!db.objectStoreNames.contains(STORE_APP_BUILDING_CONFIG)) {
        db.createObjectStore(STORE_APP_BUILDING_CONFIG, { keyPath: 'projectId' });
      }

      if (!db.objectStoreNames.contains(STORE_APP_BUILDING_JOBS)) {
        const jobs = db.createObjectStore(STORE_APP_BUILDING_JOBS, { keyPath: 'id' });
        jobs.createIndex('projectId', 'projectId', { unique: false });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
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
      await txDelete(db, STORE_PROJECTS, id);
      await txDelete(db, STORE_PROJECT_FILES, id);
      await txDelete(db, STORE_PROJECT_AGENT_STATE, id);
      await txDelete(db, STORE_APP_BUILDING_CONFIG, id);
      await txDeleteByIndex(db, STORE_APP_BUILDING_JOBS, 'projectId', id);
      await txDeleteByIndex(db, STORE_RESUMABLE_THREADS, 'projectId', id);
    });
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
