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
  activeEnvironment?: ProjectEnvironmentKind;
  repoRef?: ProjectRepoRef | null;
  codespace?: ProjectCodespaceRecord | null;
}

export interface ProjectGitRemoteRecord {
  name: string;
  url: string;
  provider?: 'github';
  repositoryFullName?: string;
  repositoryUrl?: string;
}

export type ProjectEnvironmentKind = 'local' | 'codespace';

export interface ProjectRepoRef {
  owner: string;
  repo: string;
  branch: string;
  remoteUrl: string;
}

export interface ProjectCodespaceRecord {
  name: string;
  displayName: string;
  webUrl: string;
  state: string;
  machine: string | null;
  idleTimeoutMinutes: number | null;
  retentionHours: number | null;
  supportsBridge: boolean;
  lastSyncedAt: number | null;
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

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_NAME = 'almostnode-webide';
const DB_VERSION = 3;

const STORE_PROJECTS = 'projects';
const STORE_PROJECT_FILES = 'project-files';
const STORE_PROJECT_AGENT_STATE = 'project-agent-state';
const STORE_RESUMABLE_THREADS = 'resumable-threads';

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

function normalizeProjectRecord(project: ProjectRecord): ProjectRecord {
  return {
    ...project,
    activeEnvironment: project.activeEnvironment === 'codespace'
      ? 'codespace'
      : 'local',
    repoRef: normalizeProjectRepoRef(project.repoRef),
    codespace: normalizeProjectCodespaceRecord(project.codespace),
  };
}

function normalizeProjectRepoRef(
  repoRef: ProjectRecord['repoRef'],
): ProjectRepoRef | null {
  if (!repoRef) {
    return null;
  }

  const owner = repoRef.owner?.trim();
  const repo = repoRef.repo?.trim();
  const branch = repoRef.branch?.trim();
  const remoteUrl = repoRef.remoteUrl?.trim();

  if (!owner || !repo || !branch || !remoteUrl) {
    return null;
  }

  return {
    owner,
    repo,
    branch,
    remoteUrl,
  };
}

function normalizeProjectCodespaceRecord(
  codespace: ProjectRecord['codespace'],
): ProjectCodespaceRecord | null {
  if (!codespace) {
    return null;
  }

  const name = codespace.name?.trim();
  const displayName = codespace.displayName?.trim() || name;
  const webUrl = codespace.webUrl?.trim();

  if (!name || !displayName || !webUrl) {
    return null;
  }

  return {
    name,
    displayName,
    webUrl,
    state: codespace.state?.trim() || 'unknown',
    machine: codespace.machine?.trim() || null,
    idleTimeoutMinutes:
      typeof codespace.idleTimeoutMinutes === 'number'
        ? codespace.idleTimeoutMinutes
        : null,
    retentionHours:
      typeof codespace.retentionHours === 'number'
        ? codespace.retentionHours
        : null,
    supportsBridge: codespace.supportsBridge === true,
    lastSyncedAt:
      typeof codespace.lastSyncedAt === 'number'
        ? codespace.lastSyncedAt
        : null,
  };
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

  // ── Projects ──

  async listProjects(): Promise<ProjectRecord[]> {
    const db = await this.getDb();
    const projects = (await txGetAll<ProjectRecord>(db, STORE_PROJECTS))
      .map((project) => normalizeProjectRecord(project));
    return projects.sort((a, b) => b.lastModified - a.lastModified);
  }

  async getProject(id: string): Promise<ProjectRecord | undefined> {
    const db = await this.getDb();
    const project = await txGet<ProjectRecord>(db, STORE_PROJECTS, id);
    return project ? normalizeProjectRecord(project) : undefined;
  }

  async putProject(project: ProjectRecord): Promise<void> {
    const db = await this.getDb();
    await txPut(db, STORE_PROJECTS, normalizeProjectRecord(project));
  }

  async deleteProject(id: string): Promise<void> {
    const db = await this.getDb();
    await txDelete(db, STORE_PROJECTS, id);
    await txDelete(db, STORE_PROJECT_FILES, id);
    await txDelete(db, STORE_PROJECT_AGENT_STATE, id);
    await txDeleteByIndex(db, STORE_RESUMABLE_THREADS, 'projectId', id);
  }

  // ── Project Files ──

  async getProjectFiles(projectId: string): Promise<SerializedFile[]> {
    const db = await this.getDb();
    const record = await txGet<ProjectFilesRecord>(db, STORE_PROJECT_FILES, projectId);
    return record?.files ?? [];
  }

  async saveProjectFiles(projectId: string, files: SerializedFile[]): Promise<void> {
    const db = await this.getDb();
    const record: ProjectFilesRecord = {
      projectId,
      files,
      savedAt: Date.now(),
    };
    await txPut(db, STORE_PROJECT_FILES, record);
  }

  // ── Agent State ──

  async getProjectAgentState(projectId: string): Promise<ProjectAgentStateRecord | undefined> {
    const db = await this.getDb();
    return txGet<ProjectAgentStateRecord>(db, STORE_PROJECT_AGENT_STATE, projectId);
  }

  async putProjectAgentState(state: ProjectAgentStateRecord): Promise<void> {
    const db = await this.getDb();
    await txPut(db, STORE_PROJECT_AGENT_STATE, state);
  }

  // ── Resumable Threads ──

  async listResumableThreads(projectId: string): Promise<ResumableThreadRecord[]> {
    const db = await this.getDb();
    const threads = await txGetAllByIndex<ResumableThreadRecord>(
      db,
      STORE_RESUMABLE_THREADS,
      'projectId',
      projectId,
    );
    return threads.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async listAllResumableThreads(): Promise<ResumableThreadRecord[]> {
    const db = await this.getDb();
    const threads = await txGetAll<ResumableThreadRecord>(db, STORE_RESUMABLE_THREADS);
    return threads.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async getResumableThread(id: string): Promise<ResumableThreadRecord | undefined> {
    const db = await this.getDb();
    return txGet<ResumableThreadRecord>(db, STORE_RESUMABLE_THREADS, id);
  }

  async replaceProjectResumableThreads(
    projectId: string,
    threads: ResumableThreadRecord[],
  ): Promise<void> {
    const db = await this.getDb();
    await txDeleteByIndex(db, STORE_RESUMABLE_THREADS, 'projectId', projectId);
    for (const thread of threads) {
      await txPut(db, STORE_RESUMABLE_THREADS, thread);
    }
  }

  async putResumableThread(thread: ResumableThreadRecord): Promise<void> {
    const db = await this.getDb();
    await txPut(db, STORE_RESUMABLE_THREADS, thread);
  }
}
