import { describe, expect, it } from "vitest";
import {
  generateServiceId,
  OAUTH_REGISTRY_STORAGE_KEY,
  OAUTH_TOKEN_DIR,
  OAuthServiceRegistry,
  tokenFilePathForService,
} from "@agent-wasm/keychain/oauth/registry";
import type { OAuthServiceConfig } from "@agent-wasm/keychain/oauth/types";

interface MemoryStorage {
  store: Map<string, string>;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function createMemoryStorage(): MemoryStorage {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
  };
}

function makeConfig(id: string, overrides: Partial<OAuthServiceConfig> = {}): OAuthServiceConfig {
  return {
    id,
    displayName: `${id} display`,
    issuer: `https://${id}.example.com`,
    authorizationEndpoint: `https://${id}.example.com/authorize`,
    tokenEndpoint: `https://${id}.example.com/token`,
    scopesRequested: ["openid"],
    clientId: `${id}-client`,
    redirectUri: "https://app.example.com/oauth/callback",
    codeChallengeMethod: "S256",
    addedAt: "2026-04-19T12:00:00.000Z",
    discoveredAt: "2026-04-19T12:00:00.000Z",
    ...overrides,
  };
}

describe("tokenFilePathForService", () => {
  it("derives a path under the canonical OAuth dir", () => {
    expect(tokenFilePathForService("github-abc123")).toBe(
      `${OAUTH_TOKEN_DIR}/github-abc123.json`,
    );
  });
});

describe("generateServiceId", () => {
  it("produces a slug-prefixed id with a 6-char suffix", () => {
    const id = generateServiceId("api.example.com");
    expect(id).toMatch(/^api-example-com-[a-z0-9]{6}$/);
  });

  it("collapses non-alphanumerics in the slug", () => {
    const id = generateServiceId("HTTPS://Foo.Bar/Baz");
    expect(id.startsWith("foo-bar-baz-")).toBe(true);
  });

  it("falls back to 'oauth-' when the hostname is empty", () => {
    expect(generateServiceId("")).toMatch(/^oauth-[a-z0-9]{6}$/);
  });
});

describe("OAuthServiceRegistry", () => {
  it("starts empty when no storage entry is present", () => {
    const storage = createMemoryStorage();
    const registry = new OAuthServiceRegistry({ storage });
    expect(registry.list()).toEqual([]);
    expect(registry.has("anything")).toBe(false);
    expect(registry.get("anything")).toBeUndefined();
  });

  it("upsert persists a service to storage and notifies subscribers", () => {
    const storage = createMemoryStorage();
    const registry = new OAuthServiceRegistry({ storage });
    const updates: OAuthServiceConfig[][] = [];
    const unsubscribe = registry.subscribe((services) => {
      updates.push(services);
    });

    const config = makeConfig("github-aaaaaa");
    registry.upsert(config);

    expect(registry.list()).toEqual([config]);
    expect(registry.get("github-aaaaaa")).toEqual(config);
    expect(registry.has("github-aaaaaa")).toBe(true);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual([config]);

    const stored = JSON.parse(storage.getItem(OAUTH_REGISTRY_STORAGE_KEY)!);
    expect(stored.version).toBe(1);
    expect(stored.services).toEqual([config]);

    unsubscribe();
    registry.upsert(makeConfig("linear-bbbbbb"));
    expect(updates).toHaveLength(1); // unsubscribed
  });

  it("upsert updates an existing entry in place (preserves order)", () => {
    const storage = createMemoryStorage();
    const registry = new OAuthServiceRegistry({ storage });
    registry.upsert(makeConfig("a-aaaaaa"));
    registry.upsert(makeConfig("b-bbbbbb"));

    registry.upsert(makeConfig("a-aaaaaa", { displayName: "Renamed" }));

    const list = registry.list();
    expect(list.map((s) => s.id)).toEqual(["a-aaaaaa", "b-bbbbbb"]);
    expect(list[0]!.displayName).toBe("Renamed");
  });

  it("remove returns false for unknown ids and does not persist", () => {
    const storage = createMemoryStorage();
    const registry = new OAuthServiceRegistry({ storage });
    expect(registry.remove("missing")).toBe(false);
    expect(storage.getItem(OAUTH_REGISTRY_STORAGE_KEY)).toBeNull();
  });

  it("remove deletes an existing service and notifies", () => {
    const storage = createMemoryStorage();
    const registry = new OAuthServiceRegistry({ storage });
    registry.upsert(makeConfig("a-aaaaaa"));
    const updates: OAuthServiceConfig[][] = [];
    registry.subscribe((services) => updates.push(services));

    expect(registry.remove("a-aaaaaa")).toBe(true);
    expect(registry.list()).toEqual([]);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual([]);
  });

  it("returns deep copies from list/get so callers cannot mutate state", () => {
    const storage = createMemoryStorage();
    const registry = new OAuthServiceRegistry({ storage });
    registry.upsert(makeConfig("a-aaaaaa"));

    const fromList = registry.list()[0]!;
    fromList.displayName = "ZZZ";
    const fromGet = registry.get("a-aaaaaa")!;
    fromGet.displayName = "YYY";

    expect(registry.list()[0]!.displayName).toBe("a-aaaaaa display");
    expect(registry.get("a-aaaaaa")!.displayName).toBe("a-aaaaaa display");
  });

  it("loads pre-existing services synchronously at construction", () => {
    const storage = createMemoryStorage();
    const seeded = makeConfig("seeded-cccccc");
    storage.setItem(
      OAUTH_REGISTRY_STORAGE_KEY,
      JSON.stringify({ version: 1, services: [seeded] }),
    );
    const registry = new OAuthServiceRegistry({ storage });
    expect(registry.list()).toEqual([seeded]);
  });

  it("ignores stored entries with mismatched version", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      OAUTH_REGISTRY_STORAGE_KEY,
      JSON.stringify({ version: 99, services: [makeConfig("a")] }),
    );
    const registry = new OAuthServiceRegistry({ storage });
    expect(registry.list()).toEqual([]);
  });

  it("ignores entries that fail the schema check", () => {
    const storage = createMemoryStorage();
    storage.setItem(
      OAUTH_REGISTRY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        services: [
          { id: "broken" }, // missing required fields
          makeConfig("good-aaaaaa"),
        ],
      }),
    );
    const registry = new OAuthServiceRegistry({ storage });
    expect(registry.list().map((s) => s.id)).toEqual(["good-aaaaaa"]);
  });

  it("survives malformed stored JSON", () => {
    const storage = createMemoryStorage();
    storage.setItem(OAUTH_REGISTRY_STORAGE_KEY, "this is not JSON");
    const registry = new OAuthServiceRegistry({ storage });
    expect(registry.list()).toEqual([]);
  });

  it("operates without storage (in-memory only)", () => {
    const registry = new OAuthServiceRegistry({ storage: null });
    registry.upsert(makeConfig("a-aaaaaa"));
    expect(registry.list().map((s) => s.id)).toEqual(["a-aaaaaa"]);
  });
});
