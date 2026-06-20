// @vitest-environment node
import { Buffer } from 'node:buffer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ProjectDB,
  type ProjectRecord,
  type SandboxRecord,
} from '../src/features/project-db';
import { ProjectManager } from '../src/features/project-manager';
import {
  discoverClaudeThreads,
  toOpenCodeThreads,
} from '../src/features/resumable-threads';
import type { SerializedFile } from '../src/desktop/project-snapshot';

vi.mock('../src/features/workspace-seed', () => ({
  isTemplateId: (value: string) => ['vite', 'nextjs', 'tanstack'].includes(value),
}));

// ── Fake IndexedDB ────────────────────────────────────────────────────────────
//
// Same shape as the fake in project-db-app-building.test.ts, extended with an
// upgrade transaction (so the v5 project→repo migration runs), index cursors
// (for delete-by-index), and transaction completion events. Mutations apply
// synchronously; callbacks fire on a microtask, matching IndexedDB ordering
// closely enough for ProjectDB's promise wrappers.

type FakeRequest = {
  error: Error | null;
  onerror: (() => void) | null;
  onsuccess: (() => void) | null;
  onupgradeneeded: (() => void) | null;
  result?: unknown;
  transaction?: unknown;
};

interface FakeStore {
  keyPath: string;
  records: Map<string, Record<string, unknown>>;
  indexes: Map<string, string>;
}

interface FakeStoreSeed {
  name: string;
  keyPath: string;
  indexes?: Array<{ name: string; keyPath: string }>;
  records?: Array<Record<string, unknown>>;
}

const originalIndexedDB = globalThis.indexedDB;

function createRequest(): FakeRequest {
  return {
    error: null,
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
  };
}

interface FakeIDBHandle {
  storeRecords(name: string): Array<Record<string, unknown>>;
  hasStore(name: string): boolean;
}

function installFakeIndexedDB(options: {
  initialVersion?: number;
  initialStores?: FakeStoreSeed[];
} = {}): FakeIDBHandle {
  let version = options.initialVersion ?? 0;
  const stores = new Map<string, FakeStore>();

  const createStore = (seed: FakeStoreSeed): void => {
    const store: FakeStore = {
      keyPath: seed.keyPath,
      records: new Map(),
      indexes: new Map(),
    };
    for (const index of seed.indexes ?? []) {
      store.indexes.set(index.name, index.keyPath);
    }
    for (const record of seed.records ?? []) {
      store.records.set(String(record[seed.keyPath]), record);
    }
    stores.set(seed.name, store);
  };

  for (const store of options.initialStores ?? []) {
    createStore(store);
  }

  const getStoreHandle = (name: string) => {
    const store = stores.get(name);
    if (!store) {
      throw new Error(`Missing store: ${name}`);
    }

    return {
      get(key: string) {
        const request = createRequest();
        queueMicrotask(() => {
          request.result = store.records.get(String(key));
          request.onsuccess?.();
        });
        return request;
      },
      getAll() {
        const request = createRequest();
        queueMicrotask(() => {
          request.result = Array.from(store.records.values());
          request.onsuccess?.();
        });
        return request;
      },
      put(value: Record<string, unknown>) {
        const request = createRequest();
        store.records.set(String(value[store.keyPath]), value);
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
      delete(key: string) {
        const request = createRequest();
        store.records.delete(String(key));
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
      createIndex(indexName: string, keyPath: string) {
        store.indexes.set(indexName, keyPath);
      },
      indexNames: {
        contains: (indexName: string) => store.indexes.has(indexName),
      },
      index(indexName: string) {
        const keyPath = store.indexes.get(indexName);
        if (!keyPath) {
          throw new Error(`Missing index: ${indexName}`);
        }
        const matches = (key: string) => (
          Array.from(store.records.entries()).filter(([, value]) => (
            String(value[keyPath]) === key
          ))
        );
        return {
          getAll(key: string) {
            const request = createRequest();
            queueMicrotask(() => {
              request.result = matches(key).map(([, value]) => value);
              request.onsuccess?.();
            });
            return request;
          },
          openCursor(key: string) {
            const request = createRequest();
            const entries = matches(key);
            let position = 0;
            const advance = () => queueMicrotask(() => {
              if (position < entries.length) {
                const [recordKey] = entries[position]!;
                position += 1;
                request.result = {
                  delete() {
                    store.records.delete(recordKey);
                  },
                  continue() {
                    advance();
                  },
                };
              } else {
                request.result = null;
              }
              request.onsuccess?.();
            });
            advance();
            return request;
          },
        };
      },
    };
  };

  const database = {
    get version() {
      return version;
    },
    objectStoreNames: {
      contains(name: string) {
        return stores.has(name);
      },
    },
    close() {},
    createObjectStore(name: string, options: { keyPath: string }) {
      createStore({ name, keyPath: options.keyPath });
      return getStoreHandle(name);
    },
    transaction(name: string, _mode: 'readonly' | 'readwrite') {
      const tx: {
        error: Error | null;
        oncomplete: (() => void) | null;
        onerror: (() => void) | null;
        objectStore: () => ReturnType<typeof getStoreHandle>;
      } = {
        error: null,
        oncomplete: null,
        onerror: null,
        objectStore: () => getStoreHandle(name),
      };
      // Cursor walks are microtask chains, so a macrotask runs after them.
      setTimeout(() => tx.oncomplete?.(), 0);
      return tx;
    },
  };

  Object.defineProperty(globalThis, 'indexedDB', {
    configurable: true,
    value: {
      open(_name?: string, requestedVersion?: number) {
        const request = createRequest();
        queueMicrotask(() => {
          const nextVersion = requestedVersion ?? 1;
          if (nextVersion < version) {
            request.error = new Error('VersionError');
            request.onerror?.();
            return;
          }

          request.result = database;
          if (version === 0 || nextVersion > version) {
            version = nextVersion;
            request.transaction = {
              objectStore: (name: string) => getStoreHandle(name),
            };
            request.onupgradeneeded?.();
            request.transaction = undefined;
          }
          request.onsuccess?.();
        });
        return request;
      },
    },
  });

  return {
    storeRecords(name: string) {
      const store = stores.get(name);
      if (!store) {
        throw new Error(`Missing store: ${name}`);
      }
      return Array.from(store.records.values());
    },
    hasStore: (name: string) => stores.has(name),
  };
}

function restoreIndexedDB(): void {
  if (originalIndexedDB === undefined) {
    delete (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  } else {
    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      value: originalIndexedDB,
    });
  }
}

// ── Fixtures ──────────────────────────────────────────────────────────────────

function createLegacyProject(id: string, overrides: Partial<ProjectRecord> = {}): ProjectRecord {
  const record: ProjectRecord = {
    id,
    name: `Project ${id}`,
    templateId: 'vite',
    createdAt: 100,
    lastModified: 200,
    dbPrefix: id.slice(0, 8),
    ...overrides,
  };
  // Legacy v4 records never carried defaultBranch.
  delete record.defaultBranch;
  return record;
}

function serializedFile(path: string, content: string): SerializedFile {
  return {
    path,
    contentBase64: Buffer.from(content, 'utf8').toString('base64'),
  };
}

describe('ProjectDB v5 repo migration', () => {
  afterEach(restoreIndexedDB);

  it('promotes v4 projects to repos, backs up files, and creates no sandboxes', async () => {
    const alphaFiles = [serializedFile('/project/a.txt', 'alpha')];
    const betaFiles = [serializedFile('/project/b.txt', 'beta')];

    const handle = installFakeIndexedDB({
      initialVersion: 4,
      initialStores: [
        {
          name: 'projects',
          keyPath: 'id',
          records: [
            createLegacyProject('project-alpha', {
              gitRemote: {
                name: 'origin',
                url: 'https://github.com/owner/alpha.git',
                provider: 'github',
                repositoryFullName: 'owner/alpha',
                repositoryUrl: 'https://github.com/owner/alpha',
              },
            }) as unknown as Record<string, unknown>,
            createLegacyProject('project-beta') as unknown as Record<string, unknown>,
          ],
        },
        {
          name: 'project-files',
          keyPath: 'projectId',
          records: [
            { projectId: 'project-alpha', files: alphaFiles, savedAt: 10 },
            { projectId: 'project-beta', files: betaFiles, savedAt: 11 },
          ],
        },
        {
          name: 'project-agent-state',
          keyPath: 'projectId',
          records: [
            { projectId: 'project-alpha', claudeFiles: [], openCodeDb: null, savedAt: 12 },
          ],
        },
        {
          name: 'resumable-threads',
          keyPath: 'id',
          indexes: [{ name: 'projectId', keyPath: 'projectId' }],
          records: [
            {
              id: 'claude:project-alpha:session-1',
              projectId: 'project-alpha',
              harness: 'claude',
              title: 'Old chat',
              resumeToken: 'session-1',
              createdAt: 1,
              updatedAt: 2,
            },
          ],
        },
        { name: 'app-building-config', keyPath: 'projectId' },
        {
          name: 'app-building-jobs',
          keyPath: 'id',
          indexes: [{ name: 'projectId', keyPath: 'projectId' }],
        },
      ],
    });

    const db = new ProjectDB();

    // Repo records: existing shape preserved, defaultBranch backfilled.
    expect(await db.getProject('project-alpha')).toMatchObject({
      name: 'Project project-alpha',
      templateId: 'vite',
      defaultBranch: 'main',
      gitRemote: { repositoryFullName: 'owner/alpha' },
    });
    const repos = await db.listRepos();
    expect(repos.map((repo) => [repo.id, repo.defaultBranch]).sort()).toEqual([
      ['project-alpha', 'main'],
      ['project-beta', 'main'],
    ]);

    // Files and agent state stay under repo-scoped keys (old project ids).
    expect(await db.getProjectFiles('project-alpha')).toEqual(alphaFiles);
    expect(await db.getProjectFiles('project-beta')).toEqual(betaFiles);
    expect(await db.getProjectAgentState('project-alpha')).toMatchObject({
      projectId: 'project-alpha',
      openCodeDb: null,
    });

    // Pre-migration files snapshotted under the one-release backup store.
    expect(await db.getProjectFilesBackup('project-alpha')).toMatchObject({ files: alphaFiles });
    expect(await db.getProjectFilesBackup('project-beta')).toMatchObject({ files: betaFiles });

    // Old threads survive untouched.
    expect(await db.getResumableThread('claude:project-alpha:session-1')).toMatchObject({
      title: 'Old chat',
    });

    // Sandboxes store exists but migration creates no records.
    expect(await db.listSandboxes('project-alpha')).toEqual([]);
    expect(await db.listSandboxes('project-beta')).toEqual([]);
    expect(handle.hasStore('sandboxes')).toBe(true);
    expect(handle.storeRecords('sandboxes')).toEqual([]);
  });
});

describe('sandbox CRUD', () => {
  afterEach(restoreIndexedDB);

  async function createManagerWithRepo(): Promise<ProjectManager> {
    installFakeIndexedDB();
    const manager = new ProjectManager();
    await manager.db.putProject({
      id: 'repo-1',
      name: 'Repo One',
      templateId: 'vite',
      createdAt: 1,
      lastModified: 2,
      dbPrefix: 'repo-1',
      defaultBranch: 'main',
    });
    return manager;
  }

  it('round-trips sandbox records, snapshots, and PR state', async () => {
    const manager = await createManagerWithRepo();

    const sandbox = await manager.createSandbox('repo-1', 'Fix Login!!');
    expect(sandbox).toMatchObject({
      repoId: 'repo-1',
      name: 'Fix Login!!',
      branch: 'sandbox/fix-login',
      filesKey: sandbox.id,
      agentStateKey: sandbox.id,
    });

    // Branch slugs dedupe against existing sandboxes.
    const second = await manager.createSandbox('repo-1', 'Fix Login');
    expect(second.branch).toBe('sandbox/fix-login-2');

    // Unnamed sandboxes get an ordinal default name.
    const third = await manager.createSandbox('repo-1');
    expect(third.name).toBe('sandbox-3');

    const listed = await manager.listSandboxes('repo-1');
    expect(listed.map((record) => record.id).sort()).toEqual(
      [sandbox.id, second.id, third.id].sort(),
    );

    await manager.updateSandboxPr(sandbox.id, {
      number: 12,
      url: 'https://github.com/owner/alpha/pull/12',
      state: 'open',
    });
    expect((await manager.db.getSandbox(sandbox.id))?.pr).toEqual({
      number: 12,
      url: 'https://github.com/owner/alpha/pull/12',
      state: 'open',
    });

    const stale: SandboxRecord = { ...(await manager.db.getSandbox(sandbox.id))!, lastActive: 5 };
    await manager.db.putSandbox(stale);
    await manager.touchSandbox(sandbox.id);
    expect((await manager.db.getSandbox(sandbox.id))!.lastActive).toBeGreaterThan(5);

    const files = [serializedFile('/project/src/login.ts', 'export const ok = true;')];
    await manager.saveSandboxFiles(sandbox.id, files);
    expect(await manager.loadSandboxFiles(sandbox.id)).toEqual(files);

    await manager.saveSandboxAgentState(sandbox.id, {
      claudeFiles: [serializedFile('/home/user/.claude/projects/p/t.jsonl', '{}')],
      openCodeDb: new Uint8Array([1, 2, 3]),
    });
    expect(await manager.loadSandboxAgentState(sandbox.id)).toMatchObject({
      sandboxId: sandbox.id,
      openCodeDb: new Uint8Array([1, 2, 3]),
    });
  });

  it('deletes a sandbox along with its snapshots and threads', async () => {
    const manager = await createManagerWithRepo();
    const sandbox = await manager.createSandbox('repo-1', 'Cleanup');

    await manager.saveSandboxFiles(sandbox.id, [serializedFile('/project/x.ts', 'x')]);
    await manager.saveSandboxAgentState(sandbox.id, { claudeFiles: [], openCodeDb: null });
    await manager.db.putResumableThread({
      id: `claude:${sandbox.id}:session-9`,
      projectId: 'repo-1',
      sandboxId: sandbox.id,
      harness: 'claude',
      title: 'Sandbox chat',
      resumeToken: 'session-9',
      createdAt: 1,
      updatedAt: 2,
    });

    await manager.deleteSandbox(sandbox.id);

    expect(await manager.db.getSandbox(sandbox.id)).toBeUndefined();
    expect(await manager.loadSandboxFiles(sandbox.id)).toEqual([]);
    expect(await manager.loadSandboxAgentState(sandbox.id)).toBeUndefined();
    expect(await manager.db.getResumableThread(`claude:${sandbox.id}:session-9`)).toBeUndefined();
  });

  it('rejects sandbox creation for unknown repos', async () => {
    installFakeIndexedDB();
    const manager = new ProjectManager();
    await expect(manager.createSandbox('missing-repo')).rejects.toThrow('Unknown repo');
  });
});

describe('thread re-keying', () => {
  it('keys discovered threads by owner id and tags sandboxId', () => {
    const transcript = [
      '{"sessionId":"session-a","type":"user","timestamp":"2026-06-01T10:00:00.000Z","message":{"role":"user","content":"Hello"}}',
    ].join('\n');

    const claude = discoverClaudeThreads('sandbox-123', [
      serializedFile('/home/user/.claude/projects/demo/transcript.jsonl', transcript),
    ]);
    expect(claude).toEqual([
      expect.objectContaining({
        id: 'claude:sandbox-123:session-a',
        projectId: 'sandbox-123',
        sandboxId: 'sandbox-123',
        resumeToken: 'session-a',
      }),
    ]);

    const opencode = toOpenCodeThreads('sandbox-123', [
      { id: 'ses_1', title: 'OpenCode chat' },
    ]);
    expect(opencode).toEqual([
      expect.objectContaining({
        id: 'opencode:sandbox-123:ses_1',
        projectId: 'sandbox-123',
        sandboxId: 'sandbox-123',
        resumeToken: 'ses_1',
      }),
    ]);
  });
});
