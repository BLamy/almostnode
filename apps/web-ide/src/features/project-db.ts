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
const DB_VERSION = 2;

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
    const projects = await txGetAll<ProjectRecord>(db, STORE_PROJECTS);
    return projects.sort((a, b) => b.lastModified - a.lastModified);
  }

  async getProject(id: string): Promise<ProjectRecord | undefined> {
    const db = await this.getDb();
    return txGet<ProjectRecord>(db, STORE_PROJECTS, id);
  }

  async putProject(project: ProjectRecord): Promise<void> {
    const db = await this.getDb();
    await txPut(db, STORE_PROJECTS, project);
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
