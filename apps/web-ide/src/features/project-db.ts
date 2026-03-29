/**
 * IndexedDB wrapper for multi-project persistence.
 *
 * DB: "almostnode-webide"
 * Stores: projects, project-files, chat-threads, chat-messages
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

export interface ChatThread {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  lastMessageAt: number;
}

export interface ChatMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const DB_NAME = 'almostnode-webide';
const DB_VERSION = 1;

const STORE_PROJECTS = 'projects';
const STORE_PROJECT_FILES = 'project-files';
const STORE_CHAT_THREADS = 'chat-threads';
const STORE_CHAT_MESSAGES = 'chat-messages';

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

      if (!db.objectStoreNames.contains(STORE_CHAT_THREADS)) {
        const threads = db.createObjectStore(STORE_CHAT_THREADS, { keyPath: 'id' });
        threads.createIndex('projectId', 'projectId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_CHAT_MESSAGES)) {
        const messages = db.createObjectStore(STORE_CHAT_MESSAGES, { keyPath: 'id' });
        messages.createIndex('threadId', 'threadId', { unique: false });
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
    await txDeleteByIndex(db, STORE_CHAT_THREADS, 'projectId', id);
    // Delete messages for all threads belonging to this project
    const threads = await txGetAllByIndex<ChatThread>(db, STORE_CHAT_THREADS, 'projectId', id);
    for (const thread of threads) {
      await txDeleteByIndex(db, STORE_CHAT_MESSAGES, 'threadId', thread.id);
    }
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

  // ── Chat Threads ──

  async listChatThreads(projectId: string): Promise<ChatThread[]> {
    const db = await this.getDb();
    const threads = await txGetAllByIndex<ChatThread>(db, STORE_CHAT_THREADS, 'projectId', projectId);
    return threads.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }

  async getChatThread(id: string): Promise<ChatThread | undefined> {
    const db = await this.getDb();
    return txGet<ChatThread>(db, STORE_CHAT_THREADS, id);
  }

  async putChatThread(thread: ChatThread): Promise<void> {
    const db = await this.getDb();
    await txPut(db, STORE_CHAT_THREADS, thread);
  }

  async deleteChatThread(id: string): Promise<void> {
    const db = await this.getDb();
    await txDeleteByIndex(db, STORE_CHAT_MESSAGES, 'threadId', id);
    await txDelete(db, STORE_CHAT_THREADS, id);
  }

  // ── Chat Messages ──

  async listChatMessages(threadId: string): Promise<ChatMessage[]> {
    const db = await this.getDb();
    const messages = await txGetAllByIndex<ChatMessage>(db, STORE_CHAT_MESSAGES, 'threadId', threadId);
    return messages.sort((a, b) => a.createdAt - b.createdAt);
  }

  async putChatMessage(message: ChatMessage): Promise<void> {
    const db = await this.getDb();
    await txPut(db, STORE_CHAT_MESSAGES, message);
  }

  async deleteChatMessage(id: string): Promise<void> {
    const db = await this.getDb();
    await txDelete(db, STORE_CHAT_MESSAGES, id);
  }
}
