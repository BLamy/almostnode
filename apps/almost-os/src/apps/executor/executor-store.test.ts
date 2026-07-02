import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExecutorStore, type ExecutorStoreDeps } from "./executor-store";

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, value);
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
}

const OPENAPI_SPEC = {
  openapi: "3.0.0",
  info: { title: "Demo", version: "1" },
  servers: [{ url: "https://api.demo.test" }],
  paths: {
    "/ping": {
      get: {
        operationId: "ping",
        summary: "Ping",
        responses: {
          "200": { description: "ok", content: { "application/json": { schema: { type: "object" } } } },
        },
      },
    },
  },
};

function makeDeps(overrides: Partial<ExecutorStoreDeps> = {}): ExecutorStoreDeps {
  return {
    storage: new MemoryStorage(),
    fetchImpl: vi.fn(async (url: string) => {
      if (url.includes("openapi")) {
        return new Response(JSON.stringify(OPENAPI_SPEC), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ pong: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
    getVfs: () => ({ existsSync: () => false }) as never,
    refreshIfNeeded: async () => undefined,
    removeOAuthService: () => undefined,
    getApprovalMode: () => "full",
    now: () => new Date("2026-07-02T00:00:00Z"),
    ...overrides,
  };
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** addSource fires a background sync; wait for it to settle. */
async function waitForSync(store: ExecutorStore, id: string): Promise<void> {
  for (let i = 0; i < 100; i++) {
    const state = store.getState();
    const source = state.sources.find((s) => s.id === id);
    if (!state.syncing[id] && (state.toolsBySource[id] !== undefined || source?.syncError)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("ExecutorStore", () => {
  let store: ExecutorStore;
  let deps: ExecutorStoreDeps;

  beforeEach(() => {
    deps = makeDeps();
    store = new ExecutorStore(deps);
  });

  it("adds an OpenAPI source and syncs its tools", async () => {
    const source = store.addSource({ kind: "openapi", label: "Demo", url: "https://api.demo.test/openapi.json" });
    await waitForSync(store, source.id);
    const tools = store.getState().toolsBySource[source.id] ?? [];
    expect(tools.map((t) => t.name)).toEqual(["ping"]);
    expect(store.findTool(`${source.id}.ping`)?.http?.method).toBe("GET");
  });

  it("invokes a synced tool through the HTTP binding", async () => {
    const source = store.addSource({ kind: "openapi", label: "Demo", url: "https://api.demo.test/openapi.json" });
    await waitForSync(store, source.id);
    const result = await store.invokeTool(`${source.id}.ping`, {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data).toEqual({ pong: true });
  });

  it("returns tool_not_found for unknown paths", async () => {
    const result = await store.invokeTool("nope.tool", {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("tool_not_found");
  });

  it("blocks tools when the source policy is block", async () => {
    const source = store.addSource({ kind: "openapi", label: "Demo", url: "https://api.demo.test/openapi.json" });
    await waitForSync(store, source.id);
    store.setSourcePolicy(source.id, "block");
    const result = await store.invokeTool(`${source.id}.ping`, {});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("tool_blocked");
  });

  it("requires approval in ask mode and honors denial", async () => {
    deps = makeDeps({ getApprovalMode: () => "ask" });
    store = new ExecutorStore(deps);
    const source = store.addSource({ kind: "openapi", label: "Demo", url: "https://api.demo.test/openapi.json" });
    await waitForSync(store, source.id);

    store.setApprovalHandler(async () => false);
    const denied = await store.invokeTool(`${source.id}.ping`, {});
    expect(denied.ok).toBe(false);
    if (!denied.ok) expect(denied.error.code).toBe("approval_denied");

    store.setApprovalHandler(async () => true);
    const approved = await store.invokeTool(`${source.id}.ping`, {});
    expect(approved.ok).toBe(true);
  });

  it("runs a code-mode program end to end and records a run", async () => {
    const source = store.addSource({ kind: "openapi", label: "Demo", url: "https://api.demo.test/openapi.json" });
    await waitForSync(store, source.id);
    const run = await store.execute(
      `const r = await tools.${source.id}.ping({}); return r.ok ? r.data : 'fail';`,
    );
    expect(run.status).toBe("ok");
    expect(run.resultPreview).toContain("pong");
    expect(run.toolCalls.map((c) => c.path)).toEqual([`${source.id}.ping`]);
    expect(store.getState().runs[0]?.id).toBe(run.id);
  });

  it("exposes search + describe built-ins to code mode", async () => {
    const source = store.addSource({ kind: "openapi", label: "Demo", url: "https://api.demo.test/openapi.json" });
    await waitForSync(store, source.id);
    const run = await store.execute(
      `const hits = await tools.search({ query: 'ping' }); return hits.map((h) => h.address);`,
    );
    expect(run.status).toBe("ok");
    expect(run.resultPreview).toContain(`${source.id}.ping`);
  });

  it("persists sources/connections and reloads them", async () => {
    const source = store.addSource({ kind: "openapi", label: "Demo", url: "https://api.demo.test/openapi.json" });
    await waitForSync(store, source.id);
    await flush();
    const reloaded = new ExecutorStore(deps);
    expect(reloaded.getState().sources.map((s) => s.id)).toContain(source.id);
    expect(reloaded.getState().toolsBySource[source.id]?.length).toBe(1);
  });
});
