import { beforeAll, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";

import {
  OAuthRefreshError,
  OAuthServiceOrchestrator,
} from "../../../src/features/oauth-services/orchestrator";
import { OAuthServiceRegistry } from "../../../src/features/oauth-services/registry";
import {
  buildTokenFile,
  readTokenFile,
  writeTokenFile,
} from "../../../src/features/oauth-services/token-store";
import {
  OAUTH_CALLBACK_MESSAGE_TYPE,
} from "../../../src/features/oauth-services/authorize-popup";
import type { FetchLike } from "../../../src/features/oauth-services/proxy-fetch";
import type {
  OAuthDiscoveryPreview,
  OAuthServiceConfig,
} from "../../../src/features/oauth-services/types";

let domWindow: Window;

beforeAll(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "https://app.example.com/",
  });
  domWindow = dom.window as unknown as Window;
  Object.assign(globalThis, {
    window: domWindow,
    document: domWindow.document,
    HTMLElement: (domWindow as unknown as { HTMLElement: unknown }).HTMLElement,
    MessageEvent: (domWindow as unknown as { MessageEvent: unknown }).MessageEvent,
  });
});

class FakeVfs {
  files = new Map<string, string>();
  dirs = new Set<string>();
  existsSync(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }
  mkdirSync(path: string): void {
    this.dirs.add(path);
  }
  readFileSync(path: string, _enc: "utf8"): string {
    const c = this.files.get(path);
    if (c === undefined) throw new Error(`ENOENT: ${path}`);
    return c;
  }
  writeFileSync(path: string, content: string): void {
    this.files.set(path, content);
  }
  unlinkSync(path: string): void {
    this.files.delete(path);
  }
}

function asVfs(fake: FakeVfs): import("almostnode").VirtualFS {
  return fake as unknown as import("almostnode").VirtualFS;
}

interface FakeKeychainCall {
  type: "registerSlot" | "hasSlotData" | "notifyExternalStateChanged";
  args: unknown[];
}

function createFakeKeychain() {
  const calls: FakeKeychainCall[] = [];
  const data = new Set<string>();
  return {
    calls,
    registerSlot(name: string, paths: string[]): void {
      calls.push({ type: "registerSlot", args: [name, paths] });
    },
    hasSlotData(name: string): boolean {
      calls.push({ type: "hasSlotData", args: [name] });
      return data.has(name);
    },
    notifyExternalStateChanged(): void {
      calls.push({ type: "notifyExternalStateChanged", args: [] });
    },
  };
}

function dispatchOAuthMessage(payload: { code?: string; state?: string; error?: string; errorDescription?: string }) {
  const event = new (domWindow as unknown as {
    MessageEvent: typeof MessageEvent;
  }).MessageEvent("message", {
    data: { type: OAUTH_CALLBACK_MESSAGE_TYPE, ...payload },
    origin: "https://app.example.com",
  });
  domWindow.dispatchEvent(event);
}

function makeDiscovered(overrides: Partial<OAuthDiscoveryPreview> = {}): OAuthDiscoveryPreview {
  return {
    inputUrl: "https://api.example.com",
    issuer: "https://auth.example.com",
    authorizationEndpoint: "https://auth.example.com/authorize",
    tokenEndpoint: "https://auth.example.com/token",
    registrationEndpoint: "https://auth.example.com/register",
    supportsS256: true,
    supportsDynamicRegistration: true,
    suggestedDisplayName: "auth.example.com",
    ...overrides,
  };
}

function makeService(id: string, overrides: Partial<OAuthServiceConfig> = {}): OAuthServiceConfig {
  return {
    id,
    displayName: id,
    issuer: "https://auth.example.com",
    authorizationEndpoint: "https://auth.example.com/authorize",
    tokenEndpoint: "https://auth.example.com/token",
    scopesRequested: ["openid"],
    clientId: "client-1",
    redirectUri: "https://app.example.com/oauth/callback",
    codeChallengeMethod: "S256",
    addedAt: "2026-04-19T12:00:00.000Z",
    discoveredAt: "2026-04-19T12:00:00.000Z",
    ...overrides,
  };
}

interface FakeWindow {
  closed: boolean;
  close(): void;
}

function createFakePopup(): FakeWindow {
  return {
    closed: false,
    close() {
      this.closed = true;
    },
  };
}

function createMockFetch(handler: (url: string, init: RequestInit | undefined) => Response | Promise<Response>): {
  fetchImpl: FetchLike;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fetchImpl: FetchLike = async (input, init) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return handler(url, init);
  };
  return { fetchImpl, calls };
}

describe("OAuthServiceOrchestrator", () => {
  describe("registerAllSlots", () => {
    it("registers a slot for every persisted service before keychain init", () => {
      const vfs = new FakeVfs();
      const registry = new OAuthServiceRegistry({ storage: null });
      registry.upsert(makeService("github-aaaaaa"));
      registry.upsert(makeService("linear-bbbbbb"));
      const keychain = createFakeKeychain();
      const orchestrator = new OAuthServiceOrchestrator({
        vfs: asVfs(vfs),
        registry,
        keychain,
        scheduler: {
          setInterval: () => 0,
          clearInterval: () => undefined,
        },
      });

      orchestrator.registerAllSlots();

      const slotRegistrations = keychain.calls.filter((c) => c.type === "registerSlot");
      expect(slotRegistrations).toHaveLength(2);
      expect(slotRegistrations[0]!.args).toEqual([
        "github-aaaaaa",
        ["/home/user/.config/oauth/github-aaaaaa.json"],
      ]);
      expect(slotRegistrations[1]!.args).toEqual([
        "linear-bbbbbb",
        ["/home/user/.config/oauth/linear-bbbbbb.json"],
      ]);
    });
  });

  describe("addService", () => {
    it("DCR → popup → token exchange → write token file", async () => {
      const vfs = new FakeVfs();
      const registry = new OAuthServiceRegistry({ storage: null });
      const keychain = createFakeKeychain();
      const popup = createFakePopup();

      const { fetchImpl, calls } = createMockFetch(async (url, init) => {
        if (url === "https://auth.example.com/register") {
          expect(init?.method).toBe("POST");
          return new Response(JSON.stringify({ client_id: "issued-client-id" }), {
            status: 201,
          });
        }
        if (url === "https://auth.example.com/token") {
          expect(init?.method).toBe("POST");
          const body = new URLSearchParams(String(init?.body ?? ""));
          expect(body.get("grant_type")).toBe("authorization_code");
          expect(body.get("code")).toBe("auth-code-1");
          expect(body.get("client_id")).toBe("issued-client-id");
          expect(body.get("code_verifier")).toBeTruthy();
          return new Response(
            JSON.stringify({
              access_token: "AT-1",
              refresh_token: "RT-1",
              token_type: "Bearer",
              expires_in: 3600,
              scope: "openid",
            }),
            { status: 200 },
          );
        }
        throw new Error(`unexpected fetch ${url}`);
      });

      const orchestrator = new OAuthServiceOrchestrator({
        vfs: asVfs(vfs),
        registry,
        keychain,
        openPopup: () => popup as unknown as Window,
        fetchOptions: { fetchImpl, tryDirectFirst: true, proxyBase: "" },
        scheduler: { setInterval: () => 0, clearInterval: () => undefined },
        now: () => new Date("2026-04-19T12:00:00.000Z"),
      });

      const promise = orchestrator.addService({
        discovered: makeDiscovered(),
        displayName: "Auth Example",
        scopes: ["openid"],
      });

      // Wait for DCR + popup to open + listener installed before posting the message.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      dispatchOAuthMessage({ code: "auth-code-1", state: pendingState(orchestrator) });

      const service = await promise;
      expect(service.clientId).toBe("issued-client-id");
      expect(service.id).toMatch(/^auth-example-com-/);
      expect(registry.has(service.id)).toBe(true);
      expect(popup.closed).toBe(true);

      const tokenFile = readTokenFile(asVfs(vfs), service.id);
      expect(tokenFile?.accessToken).toBe("AT-1");
      expect(tokenFile?.refreshToken).toBe("RT-1");
      expect(tokenFile?.expiresAt).toBe("2026-04-19T13:00:00.000Z");

      const slotRegistrations = keychain.calls.filter((c) => c.type === "registerSlot");
      expect(slotRegistrations).toHaveLength(1);
      expect(slotRegistrations[0]!.args[0]).toBe(service.id);

      // Verify the token endpoint was hit (DCR + token = 2 calls total).
      expect(calls.map((c) => c.url)).toEqual([
        "https://auth.example.com/register",
        "https://auth.example.com/token",
      ]);
    });

    it("uses manualClientId when DCR is not available", async () => {
      const vfs = new FakeVfs();
      const registry = new OAuthServiceRegistry({ storage: null });
      const keychain = createFakeKeychain();
      const popup = createFakePopup();

      const { fetchImpl, calls } = createMockFetch(async (url) => {
        if (url === "https://auth.example.com/token") {
          return new Response(JSON.stringify({ access_token: "AT-x", token_type: "Bearer" }), { status: 200 });
        }
        throw new Error(`unexpected fetch ${url}`);
      });

      const orchestrator = new OAuthServiceOrchestrator({
        vfs: asVfs(vfs),
        registry,
        keychain,
        openPopup: () => popup as unknown as Window,
        fetchOptions: { fetchImpl, tryDirectFirst: true, proxyBase: "" },
        scheduler: { setInterval: () => 0, clearInterval: () => undefined },
        now: () => new Date("2026-04-19T12:00:00.000Z"),
      });

      const promise = orchestrator.addService({
        discovered: makeDiscovered({
          supportsDynamicRegistration: false,
          registrationEndpoint: undefined,
        }),
        displayName: "Manual",
        scopes: [],
        manualClientId: "user-pasted-client",
      });

      // Two microtask flushes match the DCR-path test below; one was enough
      // when this test ran in isolation but flaked under the full suite (the
      // orchestrator's internal Promise chain takes >1 tick to install the
      // message listener once it has the popup).
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      dispatchOAuthMessage({ code: "auth-code-2", state: pendingState(orchestrator) });

      const service = await promise;
      expect(service.clientId).toBe("user-pasted-client");
      expect(calls.map((c) => c.url)).toEqual(["https://auth.example.com/token"]);
    });

    it("resolves via BroadcastChannel when window.opener.postMessage never arrives", async () => {
      // COOP severance scenario: `window.opener` is null inside the callback
      // page, so `window.opener.postMessage(...)` silently no-ops. The IDE
      // listener must still resolve via the BroadcastChannel backchannel.
      const channelRegistry = new Map<string, Set<FakeChannel>>();
      class FakeChannel {
        name: string;
        onmessage: ((event: MessageEvent) => void) | null = null;
        constructor(name: string) {
          this.name = name;
          const set = channelRegistry.get(name) ?? new Set<FakeChannel>();
          set.add(this);
          channelRegistry.set(name, set);
        }
        postMessage(data: unknown): void {
          const peers = channelRegistry.get(this.name);
          if (!peers) return;
          for (const peer of peers) {
            if (peer === this) continue;
            peer.onmessage?.({ data } as unknown as MessageEvent);
          }
        }
        close(): void {
          channelRegistry.get(this.name)?.delete(this);
        }
      }
      const originalBC = (domWindow as unknown as { BroadcastChannel?: unknown }).BroadcastChannel;
      (domWindow as unknown as { BroadcastChannel: unknown }).BroadcastChannel = FakeChannel;

      try {
        const vfs = new FakeVfs();
        const registry = new OAuthServiceRegistry({ storage: null });
        const keychain = createFakeKeychain();
        const popup = createFakePopup();

        const { fetchImpl } = createMockFetch(async (url) => {
          if (url === "https://auth.example.com/token") {
            return new Response(JSON.stringify({ access_token: "AT-bc", token_type: "Bearer" }), { status: 200 });
          }
          throw new Error(`unexpected fetch ${url}`);
        });

        const orchestrator = new OAuthServiceOrchestrator({
          vfs: asVfs(vfs),
          registry,
          keychain,
          openPopup: () => popup as unknown as Window,
          fetchOptions: { fetchImpl, tryDirectFirst: true, proxyBase: "" },
          scheduler: { setInterval: () => 0, clearInterval: () => undefined },
          now: () => new Date("2026-04-19T12:00:00.000Z"),
        });

        const promise = orchestrator.addService({
          discovered: makeDiscovered({
            supportsDynamicRegistration: false,
            registrationEndpoint: undefined,
          }),
          displayName: "Broadcast",
          scopes: [],
          manualClientId: "cid-bc",
        });

        // Let the orchestrator install its listener (and open the BroadcastChannel).
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));

        // Simulate the callback page posting on the same-named channel.
        const sender = new FakeChannel("almostnode:oauth-callback-channel");
        sender.postMessage({
          type: OAUTH_CALLBACK_MESSAGE_TYPE,
          code: "code-bc",
          state: pendingState(orchestrator),
        });

        const service = await promise;
        expect(service.clientId).toBe("cid-bc");
        const tokenFile = readTokenFile(asVfs(vfs), service.id);
        expect(tokenFile?.accessToken).toBe("AT-bc");
      } finally {
        if (originalBC === undefined) {
          delete (domWindow as unknown as { BroadcastChannel?: unknown }).BroadcastChannel;
        } else {
          (domWindow as unknown as { BroadcastChannel: unknown }).BroadcastChannel = originalBC;
        }
      }
    });

    it("still resolves when popup.closed is true the whole time (COOP severance)", async () => {
      // Simulates the Chrome/Firefox behaviour where Cross-Origin-Opener-Policy
      // severs the opener↔popup relationship the instant the provider's
      // authorize page loads. After severance, `popup.closed` returns `true`
      // from the opener's side even though the user still sees the popup.
      // The flow should complete via postMessage regardless.
      const vfs = new FakeVfs();
      const registry = new OAuthServiceRegistry({ storage: null });
      const keychain = createFakeKeychain();
      // closed:true from the start — simulating immediate COOP severance.
      const severedPopup: FakeWindow = { closed: true, close() { /* noop */ } };

      const { fetchImpl } = createMockFetch(async (url) => {
        if (url === "https://auth.example.com/token") {
          return new Response(JSON.stringify({ access_token: "AT-coop", token_type: "Bearer" }), { status: 200 });
        }
        throw new Error(`unexpected fetch ${url}`);
      });

      const orchestrator = new OAuthServiceOrchestrator({
        vfs: asVfs(vfs),
        registry,
        keychain,
        openPopup: () => severedPopup as unknown as Window,
        fetchOptions: { fetchImpl, tryDirectFirst: true, proxyBase: "" },
        scheduler: { setInterval: () => 0, clearInterval: () => undefined },
        now: () => new Date("2026-04-19T12:00:00.000Z"),
      });

      const promise = orchestrator.addService({
        discovered: makeDiscovered({
          supportsDynamicRegistration: false,
          registrationEndpoint: undefined,
        }),
        displayName: "Severed",
        scopes: [],
        manualClientId: "cid",
      });

      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      dispatchOAuthMessage({ code: "code-coop", state: pendingState(orchestrator) });

      const service = await promise;
      expect(service.clientId).toBe("cid");
      const tokenFile = readTokenFile(asVfs(vfs), service.id);
      expect(tokenFile?.accessToken).toBe("AT-coop");
    });

    it("rejects when neither DCR nor a manual client_id is available", async () => {
      const vfs = new FakeVfs();
      const registry = new OAuthServiceRegistry({ storage: null });
      const keychain = createFakeKeychain();

      const orchestrator = new OAuthServiceOrchestrator({
        vfs: asVfs(vfs),
        registry,
        keychain,
        openPopup: () => createFakePopup() as unknown as Window,
        fetchOptions: { tryDirectFirst: true, proxyBase: "" },
        scheduler: { setInterval: () => 0, clearInterval: () => undefined },
      });

      await expect(() =>
        orchestrator.addService({
          discovered: makeDiscovered({
            supportsDynamicRegistration: false,
            registrationEndpoint: undefined,
          }),
          displayName: "x",
          scopes: [],
        }),
      ).rejects.toThrowError(/client_id/);
    });
  });

  describe("removeService", () => {
    it("deletes the registry entry and the token file", () => {
      const vfs = new FakeVfs();
      const registry = new OAuthServiceRegistry({ storage: null });
      const keychain = createFakeKeychain();
      const service = makeService("github-aaaaaa");
      registry.upsert(service);
      writeTokenFile(
        asVfs(vfs),
        buildTokenFile({
          service,
          response: { access_token: "AT" },
          now: new Date("2026-04-19T12:00:00.000Z"),
        }),
      );

      const orchestrator = new OAuthServiceOrchestrator({
        vfs: asVfs(vfs),
        registry,
        keychain,
        scheduler: { setInterval: () => 0, clearInterval: () => undefined },
      });

      orchestrator.removeService("github-aaaaaa");
      expect(registry.has("github-aaaaaa")).toBe(false);
      expect(readTokenFile(asVfs(vfs), "github-aaaaaa")).toBeNull();
      expect(
        keychain.calls.some((c) => c.type === "notifyExternalStateChanged"),
      ).toBe(true);
    });

    it("is a no-op for unknown ids", () => {
      const vfs = new FakeVfs();
      const registry = new OAuthServiceRegistry({ storage: null });
      const keychain = createFakeKeychain();
      const orchestrator = new OAuthServiceOrchestrator({
        vfs: asVfs(vfs),
        registry,
        keychain,
        scheduler: { setInterval: () => 0, clearInterval: () => undefined },
      });
      expect(() => orchestrator.removeService("nope")).not.toThrow();
    });
  });

  describe("refreshIfNeeded", () => {
    it("skips when there is no refresh token", async () => {
      const vfs = new FakeVfs();
      const registry = new OAuthServiceRegistry({ storage: null });
      const keychain = createFakeKeychain();
      const service = makeService("a-aaaaaa");
      registry.upsert(service);
      writeTokenFile(
        asVfs(vfs),
        buildTokenFile({
          service,
          response: { access_token: "AT" },
          now: new Date("2026-04-19T12:00:00.000Z"),
        }),
      );

      const fetchImpl = vi.fn() as unknown as FetchLike;
      const orchestrator = new OAuthServiceOrchestrator({
        vfs: asVfs(vfs),
        registry,
        keychain,
        fetchOptions: { fetchImpl, tryDirectFirst: true, proxyBase: "" },
        scheduler: { setInterval: () => 0, clearInterval: () => undefined },
      });

      await orchestrator.refreshIfNeeded("a-aaaaaa");
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("skips when the access token has more time than the lead-time window", async () => {
      const vfs = new FakeVfs();
      const registry = new OAuthServiceRegistry({ storage: null });
      const keychain = createFakeKeychain();
      const service = makeService("a-aaaaaa");
      registry.upsert(service);
      writeTokenFile(
        asVfs(vfs),
        buildTokenFile({
          service,
          response: { access_token: "AT", refresh_token: "RT", expires_in: 3600 },
          now: new Date("2026-04-19T12:00:00.000Z"),
        }),
      );

      const fetchImpl = vi.fn() as unknown as FetchLike;
      const orchestrator = new OAuthServiceOrchestrator({
        vfs: asVfs(vfs),
        registry,
        keychain,
        fetchOptions: { fetchImpl, tryDirectFirst: true, proxyBase: "" },
        scheduler: { setInterval: () => 0, clearInterval: () => undefined },
        // Set "now" so the token's expiresAt (13:00) is well beyond the
        // 5-minute default lead time (after 12:55).
        now: () => new Date("2026-04-19T12:00:00.000Z"),
      });

      await orchestrator.refreshIfNeeded("a-aaaaaa");
      expect(fetchImpl).not.toHaveBeenCalled();
    });

    it("refreshes when expiresAt is within the lead-time window", async () => {
      const vfs = new FakeVfs();
      const registry = new OAuthServiceRegistry({ storage: null });
      const keychain = createFakeKeychain();
      const service = makeService("a-aaaaaa");
      registry.upsert(service);
      writeTokenFile(
        asVfs(vfs),
        buildTokenFile({
          service,
          response: { access_token: "OLD", refresh_token: "RT-old", expires_in: 60 },
          now: new Date("2026-04-19T12:00:00.000Z"),
        }),
      );

      const { fetchImpl, calls } = createMockFetch(async (url, init) => {
        if (url !== "https://auth.example.com/token") {
          throw new Error(`unexpected ${url}`);
        }
        const body = new URLSearchParams(String(init?.body ?? ""));
        expect(body.get("grant_type")).toBe("refresh_token");
        expect(body.get("refresh_token")).toBe("RT-old");
        return new Response(
          JSON.stringify({
            access_token: "NEW",
            // Note: no refresh_token returned — should preserve "RT-old".
            expires_in: 3600,
          }),
          { status: 200 },
        );
      });

      const orchestrator = new OAuthServiceOrchestrator({
        vfs: asVfs(vfs),
        registry,
        keychain,
        fetchOptions: { fetchImpl, tryDirectFirst: true, proxyBase: "" },
        scheduler: { setInterval: () => 0, clearInterval: () => undefined },
        // Force "now" past the original token's expiry.
        now: () => new Date("2026-04-19T12:30:00.000Z"),
      });

      await orchestrator.refreshIfNeeded("a-aaaaaa");
      expect(calls).toHaveLength(1);

      const updated = readTokenFile(asVfs(vfs), "a-aaaaaa");
      expect(updated?.accessToken).toBe("NEW");
      expect(updated?.refreshToken).toBe("RT-old");
      expect(updated?.expiresAt).toBe("2026-04-19T13:30:00.000Z");
    });

    it("dedupes concurrent refresh calls (single-use refresh-token safety)", async () => {
      const vfs = new FakeVfs();
      const registry = new OAuthServiceRegistry({ storage: null });
      const keychain = createFakeKeychain();
      const service = makeService("a-aaaaaa");
      registry.upsert(service);
      writeTokenFile(
        asVfs(vfs),
        buildTokenFile({
          service,
          response: { access_token: "OLD", refresh_token: "RT-x", expires_in: 1 },
          now: new Date("2026-04-19T12:00:00.000Z"),
        }),
      );

      let invocations = 0;
      const { fetchImpl } = createMockFetch(async () => {
        invocations += 1;
        // Slow response — gives the second concurrent caller time to attach.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return new Response(
          JSON.stringify({ access_token: "NEW", expires_in: 3600 }),
          { status: 200 },
        );
      });

      const orchestrator = new OAuthServiceOrchestrator({
        vfs: asVfs(vfs),
        registry,
        keychain,
        fetchOptions: { fetchImpl, tryDirectFirst: true, proxyBase: "" },
        scheduler: { setInterval: () => 0, clearInterval: () => undefined },
        now: () => new Date("2026-04-19T12:30:00.000Z"),
      });

      await Promise.all([
        orchestrator.refreshIfNeeded("a-aaaaaa"),
        orchestrator.refreshIfNeeded("a-aaaaaa"),
        orchestrator.refreshIfNeeded("a-aaaaaa"),
      ]);

      expect(invocations).toBe(1);
    });

    it("flips the service status to needs-reauth on invalid_grant", async () => {
      const vfs = new FakeVfs();
      const registry = new OAuthServiceRegistry({ storage: null });
      const keychain = createFakeKeychain();
      const service = makeService("a-aaaaaa");
      registry.upsert(service);
      writeTokenFile(
        asVfs(vfs),
        buildTokenFile({
          service,
          response: { access_token: "OLD", refresh_token: "RT-bad", expires_in: 1 },
          now: new Date("2026-04-19T12:00:00.000Z"),
        }),
      );

      const { fetchImpl } = createMockFetch(async () =>
        new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
      );

      let latest: ReturnType<OAuthServiceOrchestrator["getStatuses"]> = [];
      const orchestrator = new OAuthServiceOrchestrator({
        vfs: asVfs(vfs),
        registry,
        keychain,
        fetchOptions: { fetchImpl, tryDirectFirst: true, proxyBase: "" },
        scheduler: { setInterval: () => 0, clearInterval: () => undefined },
        now: () => new Date("2026-04-19T12:30:00.000Z"),
        onStatusChange: (statuses) => {
          latest = statuses;
        },
      });

      await orchestrator.refreshIfNeeded("a-aaaaaa");
      expect(latest.find((s) => s.id === "a-aaaaaa")?.status).toBe("needs-reauth");
    });

    it("retries with client_secret_basic when invalid_client + clientSecret is present", async () => {
      const vfs = new FakeVfs();
      const registry = new OAuthServiceRegistry({ storage: null });
      const keychain = createFakeKeychain();
      const service = makeService("a-aaaaaa", { clientSecret: "shhh" });
      registry.upsert(service);
      writeTokenFile(
        asVfs(vfs),
        buildTokenFile({
          service,
          response: { access_token: "OLD", refresh_token: "RT", expires_in: 1 },
          now: new Date("2026-04-19T12:00:00.000Z"),
        }),
      );

      let attempt = 0;
      const observed: Array<{ headers: Record<string, string>; body: string }> = [];
      const { fetchImpl } = createMockFetch(async (_url, init) => {
        attempt += 1;
        observed.push({
          headers: (init?.headers as Record<string, string>) ?? {},
          body: String(init?.body ?? ""),
        });
        if (attempt === 1) {
          return new Response(JSON.stringify({ error: "invalid_client" }), { status: 401 });
        }
        return new Response(
          JSON.stringify({ access_token: "NEW", expires_in: 3600 }),
          { status: 200 },
        );
      });

      const orchestrator = new OAuthServiceOrchestrator({
        vfs: asVfs(vfs),
        registry,
        keychain,
        fetchOptions: { fetchImpl, tryDirectFirst: true, proxyBase: "" },
        scheduler: { setInterval: () => 0, clearInterval: () => undefined },
        now: () => new Date("2026-04-19T12:30:00.000Z"),
      });

      await orchestrator.refreshIfNeeded("a-aaaaaa");
      expect(attempt).toBe(2);

      // First attempt sent the secret in the body.
      expect(observed[0]!.body).toContain("client_secret=shhh");
      expect(observed[0]!.headers.Authorization).toBeUndefined();

      // Retry should use Basic auth with client_id:client_secret.
      expect(observed[1]!.headers.Authorization).toBe(
        `Basic ${btoa("client-1:shhh")}`,
      );
      expect(observed[1]!.body).not.toContain("client_secret=");
      expect(observed[1]!.body).not.toContain("client_id=");

      const updated = readTokenFile(asVfs(vfs), "a-aaaaaa");
      expect(updated?.accessToken).toBe("NEW");
    });
  });

  describe("OAuthRefreshError", () => {
    it("retains the kind for downstream classification", () => {
      const err = new OAuthRefreshError("nope", "id-1", "invalid_grant");
      expect(err.kind).toBe("invalid_grant");
      expect(err.serviceId).toBe("id-1");
      expect(err).toBeInstanceOf(Error);
    });
  });
});

/**
 * The orchestrator generates `state` internally, but tests need to know the
 * exact value to construct a matching callback message. We grab it by reading
 * the most recent `state` query parameter the popup was navigated to — which
 * lives in the most recent `addService` invocation's authorize URL. To avoid
 * reaching into the orchestrator's internals, we instead let it generate any
 * state and snoop the URL by attaching a one-shot `openPopup` interceptor at
 * test setup. For these tests we rely on the simpler approach: we know the
 * orchestrator is the only one dispatching messages, and `awaitAuthorizationCallback`
 * will reject unmatched messages. So instead, we mirror what JSDOM sees by
 * reading the popup URL — but since FakeWindow has no navigation, we actually
 * need to capture the URL passed to `openPopup`. This helper is updated by the
 * `openPopup` parameter in each test that uses it.
 */
let lastAuthorizeState = "";

function pendingState(_: OAuthServiceOrchestrator): string {
  return lastAuthorizeState;
}

// Re-wire `openPopup` calls so we can capture state for the message dispatcher.
// We monkey-patch `OAuthServiceOrchestrator.prototype` so every test in this
// suite can call `dispatchOAuthMessage({ code, state: pendingState(...) })`.
const originalAddService = OAuthServiceOrchestrator.prototype.addService;
OAuthServiceOrchestrator.prototype.addService = function patchedAddService(this: OAuthServiceOrchestrator, params) {
  const descriptor = Object.getOwnPropertyDescriptor(this, "openPopupImpl")
    ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(this) as object, "openPopupImpl")
    ?? null;
  // The actual openPopupImpl is a private field stored on the instance. We
  // wrap it transparently to capture the URL it gets called with.
  const self = this as unknown as { openPopupImpl: (url: string) => Window | null };
  const previous = self.openPopupImpl;
  self.openPopupImpl = (url: string) => {
    try {
      const parsed = new URL(url);
      lastAuthorizeState = parsed.searchParams.get("state") ?? "";
    } catch {
      // ignore — leave previous state intact
    }
    return previous(url);
  };
  void descriptor; // touch to silence unused-var lint
  return originalAddService.call(this, params);
};
