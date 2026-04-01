// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FakeRequest = {
  error: Error | null;
  onerror: (() => void) | null;
  onsuccess: (() => void) | null;
  onupgradeneeded: (() => void) | null;
  result?: unknown;
};

let persistedData: Uint8Array | null = null;
const originalIndexedDB = globalThis.indexedDB;
const originalInitSqlJs = globalThis.initSqlJs;

function createIndexedDbRequest(): FakeRequest {
  return {
    error: null,
    onerror: null,
    onsuccess: null,
    onupgradeneeded: null,
  };
}

function installFakeIndexedDB(): void {
  const indexedDB = {
    open() {
      const request = createIndexedDbRequest();
      queueMicrotask(() => {
        const database = {
          createObjectStore() {
            return undefined;
          },
          close() {
            return undefined;
          },
          transaction() {
            const tx: {
              error: Error | null;
              oncomplete: (() => void) | null;
              onerror: (() => void) | null;
              objectStore: () => {
                delete: () => FakeRequest;
                get: () => FakeRequest;
                put: (data: Uint8Array) => FakeRequest;
              };
            } = {
              error: null,
              oncomplete: null,
              onerror: null,
              objectStore() {
                return {
                  get() {
                    const result = createIndexedDbRequest();
                    queueMicrotask(() => {
                      result.result = persistedData;
                      result.onsuccess?.();
                      tx.oncomplete?.();
                    });
                    return result;
                  },
                  put(data: Uint8Array) {
                    const result = createIndexedDbRequest();
                    queueMicrotask(() => {
                      persistedData = new Uint8Array(data);
                      result.onsuccess?.();
                      tx.oncomplete?.();
                    });
                    return result;
                  },
                  delete() {
                    const result = createIndexedDbRequest();
                    queueMicrotask(() => {
                      persistedData = null;
                      result.onsuccess?.();
                      tx.oncomplete?.();
                    });
                    return result;
                  },
                };
              },
            };

            return tx;
          },
        };

        request.result = database;
        request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };

  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: indexedDB,
  });
}

describe("OpenCode browser DB recovery", () => {
  beforeEach(() => {
    vi.resetModules();
    persistedData = null;
    installFakeIndexedDB();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (originalIndexedDB === undefined) {
      delete (globalThis as typeof globalThis & { indexedDB?: IDBFactory }).indexedDB;
    } else {
      Object.defineProperty(globalThis, "indexedDB", {
        configurable: true,
        value: originalIndexedDB,
      });
    }

    if (originalInitSqlJs === undefined) {
      delete (globalThis as typeof globalThis & { initSqlJs?: typeof globalThis.initSqlJs }).initSqlJs;
    } else {
      globalThis.initSqlJs = originalInitSqlJs;
    }
  });

  it("clears a persisted snapshot when sql.js reports out of memory during restore", async () => {
    persistedData = new Uint8Array([1, 2, 3]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    class FakeDatabase {
      constructor(data?: Uint8Array) {
        if (data && data.length > 0) {
          throw new Error("out of memory");
        }
      }

      export() {
        return new Uint8Array([9, 9, 9]);
      }

      close() {
        return undefined;
      }
    }

    globalThis.initSqlJs = vi.fn(async () => ({
      Database: FakeDatabase,
    }));

    const db = await import("../../../vendor/opencode/packages/browser/src/shims/db.browser");
    const restored = await db.initBrowserDB();

    expect(restored).toBeInstanceOf(FakeDatabase);
    expect(persistedData).toBeNull();
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
