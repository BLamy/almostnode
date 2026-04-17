// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ProjectDB,
  type AppBuildingConfig,
  type AppBuildingJobRecord,
} from '../src/features/project-db';

type FakeRequest = {
  error: Error | null;
  onerror: (() => void) | null;
  onsuccess: (() => void) | null;
  onupgradeneeded: (() => void) | null;
  result?: unknown;
};

interface FakeStore {
  keyPath: string;
  records: Map<string, unknown>;
  indexes: Map<string, string>;
}

interface FakeStoreSeed {
  name: string;
  keyPath: string;
  indexes?: Array<{ name: string; keyPath: string }>;
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

function installFakeIndexedDB(options: {
  initialVersion?: number;
  initialStores?: FakeStoreSeed[];
} = {}): void {
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
    stores.set(seed.name, store);
  };

  for (const store of options.initialStores ?? []) {
    createStore(store);
  }

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
      const store = stores.get(name);
      if (!store) {
        throw new Error(`Failed to create store: ${name}`);
      }
      return {
        createIndex(indexName: string, keyPath: string) {
          store.indexes.set(indexName, keyPath);
        },
      };
    },
    transaction(name: string, _mode: 'readonly' | 'readwrite') {
      const store = stores.get(name);
      if (!store) {
        throw new Error(`Missing store: ${name}`);
      }

      return {
        objectStore() {
          return {
            get(key: string) {
              const request = createRequest();
              queueMicrotask(() => {
                request.result = store.records.get(key);
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
              queueMicrotask(() => {
                store.records.set(String(value[store.keyPath]), value);
                request.onsuccess?.();
              });
              return request;
            },
            index(indexName: string) {
              const keyPath = store.indexes.get(indexName);
              if (!keyPath) {
                throw new Error(`Missing index: ${indexName}`);
              }
              return {
                getAll(key: string) {
                  const request = createRequest();
                  queueMicrotask(() => {
                    request.result = Array.from(store.records.values()).filter((value) => (
                      value
                      && typeof value === 'object'
                      && String((value as Record<string, unknown>)[keyPath]) === key
                    ));
                    request.onsuccess?.();
                  });
                  return request;
                },
              };
            },
          };
        },
      };
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
            request.onupgradeneeded?.();
          }
          request.onsuccess?.();
        });
        return request;
      },
    },
  });
}

function createJob(id: string, updatedAt: number): AppBuildingJobRecord {
  return {
    id,
    projectId: 'project-1',
    appName: `app-${id}`,
    prompt: 'Build it',
    promptSummary: 'Build it',
    status: 'idle',
    repositoryName: 'repo',
    repositoryFullName: 'owner/repo',
    repositoryUrl: 'https://github.com/owner/repo',
    repositoryCloneUrl: 'https://github.com/owner/repo.git',
    cloneBranch: 'main',
    pushBranch: `codex/${id}`,
    flyApp: 'shared-fly-app',
    baseUrl: 'https://shared-fly-app.fly.dev',
    containerName: `container-${id}`,
    machineId: `machine-${id}`,
    volumeId: `volume-${id}`,
    imageRef: null,
    agentCommand: null,
    revision: null,
    queueLength: null,
    pendingTasks: null,
    totalCost: null,
    lastActivityAt: null,
    lastEventOffset: 0,
    lastLogOffset: 0,
    recentEvents: [],
    recentLogs: [],
    error: null,
    createdAt: updatedAt,
    updatedAt,
  };
}

describe('ProjectDB app-building stores', () => {
  beforeEach(() => {
    installFakeIndexedDB();
  });

  afterEach(() => {
    if (originalIndexedDB === undefined) {
      delete (globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB;
    } else {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        value: originalIndexedDB,
      });
    }
  });

  it('persists config summaries and jobs', async () => {
    const db = new ProjectDB();
    const config: AppBuildingConfig = {
      projectId: 'project-1',
      flyAppName: 'shared-fly-app',
      imageRef: null,
      infisicalEnvironment: 'prod',
      hasInfisicalCredentials: true,
      hasFlyApiToken: true,
      updatedAt: 100,
    };

    await db.putAppBuildingConfig(config);
    await db.putAppBuildingJob(createJob('job-1', 50));
    await db.putAppBuildingJob(createJob('job-2', 80));

    expect(await db.getAppBuildingConfig('project-1')).toEqual(config);
    expect((await db.listAppBuildingJobs('project-1')).map((job) => job.id)).toEqual([
      'job-2',
      'job-1',
    ]);
    expect(await db.getAppBuildingJob('job-1')).toMatchObject({
      machineId: 'machine-job-1',
      projectId: 'project-1',
    });
  });

  it('upgrades stale version 3 databases to add app-building stores', async () => {
    installFakeIndexedDB({
      initialVersion: 3,
      initialStores: [
        { name: 'projects', keyPath: 'id' },
        { name: 'project-files', keyPath: 'projectId' },
        { name: 'project-agent-state', keyPath: 'projectId' },
        {
          name: 'resumable-threads',
          keyPath: 'id',
          indexes: [{ name: 'projectId', keyPath: 'projectId' }],
        },
      ],
    });

    const db = new ProjectDB();
    const config: AppBuildingConfig = {
      projectId: 'project-legacy',
      flyAppName: 'shared-fly-app',
      imageRef: null,
      infisicalEnvironment: 'prod',
      hasInfisicalCredentials: true,
      hasFlyApiToken: true,
      updatedAt: 200,
    };

    await db.putAppBuildingConfig(config);

    expect(await db.getAppBuildingConfig('project-legacy')).toEqual(config);
  });
});
