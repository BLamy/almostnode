import { describe, expect, it, vi } from "vitest";

import {
  buildProvisionedTailscaleNetworkOptions,
  getOrCreateTailscaleHostname,
  normalizeTailscaleHostname,
  requestTailscaleAuthKey,
  TAILSCALE_HOSTNAME_STORAGE_KEY,
  TailscaleAuthKeyProvisioningError,
} from "../../src/features/tailscale-provisioning";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("tailscale auth-key provisioning", () => {
  it("normalizes hostnames into Tailscale-safe labels", () => {
    expect(normalizeTailscaleHostname(" Brett's Browser_01!! ")).toBe(
      "brett-s-browser-01",
    );
    expect(normalizeTailscaleHostname("---")).toBeNull();
    expect(normalizeTailscaleHostname(`${"a".repeat(62)}-suffix`)).toBe(
      "a".repeat(62),
    );
  });

  it("keeps a stable browser hostname without persisting auth-key material", () => {
    const storage = new MemoryStorage();

    const first = getOrCreateTailscaleHostname(storage);
    const second = getOrCreateTailscaleHostname(storage);

    expect(first).toMatch(
      /^almostnode-[a-f0-9]{8}$|^almostnode-[a-z0-9]{1,8}$/,
    );
    expect(second).toBe(first);
    expect(storage.values).toEqual(
      new Map([[TAILSCALE_HOSTNAME_STORAGE_KEY, first]]),
    );
  });

  it("posts the stable hostname to the provisioning endpoint with Auth0 cookies", async () => {
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(input).toBe("/api/headscale/auth-key");
        expect(init?.method).toBe("POST");
        expect(init?.credentials).toBe("include");
        expect(init?.headers).toMatchObject({
          accept: "application/json",
          "content-type": "application/json",
        });
        expect(JSON.parse(String(init?.body))).toEqual({
          hostname: "almostnode-browser",
        });

        return Response.json({
          auth_key: "tskey-auth-test",
          controlURL: "https://headscale.example.com",
          hostname: "AlmostNode Browser",
          useExitNode: false,
          acceptDns: false,
          expires_at: "2026-06-18T00:00:00Z",
        });
      },
    );

    await expect(
      requestTailscaleAuthKey({
        endpoint: " /api/headscale/auth-key ",
        fetchImpl,
        hostname: "AlmostNode Browser",
      }),
    ).resolves.toEqual({
      authKey: "tskey-auth-test",
      controlUrl: "https://headscale.example.com",
      hostname: "almostnode-browser",
      useExitNode: false,
      acceptDns: false,
      expiresAt: "2026-06-18T00:00:00Z",
    });
  });

  it("maps a provisioned auth key onto browser Tailscale network options", () => {
    expect(
      buildProvisionedTailscaleNetworkOptions({
        authKey: "tskey-auth-test",
        controlUrl: "https://headscale.example.com",
        hostname: "almostnode-browser",
        useExitNode: true,
        acceptDns: true,
        expiresAt: null,
      }),
    ).toEqual({
      provider: "tailscale",
      authMode: "auth-key",
      authKey: "tskey-auth-test",
      controlUrl: "https://headscale.example.com",
      hostname: "almostnode-browser",
      useExitNode: true,
      acceptDns: true,
    });
  });

  it("falls back to interactive login when the endpoint is unavailable", async () => {
    await expect(
      requestTailscaleAuthKey({
        endpoint: "/missing",
        fetchImpl: vi.fn(async () => new Response("missing", { status: 404 })),
        hostname: "almostnode-browser",
      }),
    ).resolves.toBeNull();

    await expect(
      requestTailscaleAuthKey({
        endpoint: "/html",
        fetchImpl: vi.fn(
          async () =>
            new Response("<!doctype html>", {
              headers: { "content-type": "text/html" },
              status: 200,
            }),
        ),
        hostname: "almostnode-browser",
      }),
    ).resolves.toBeNull();

    await expect(
      requestTailscaleAuthKey({
        endpoint: "/offline",
        fetchImpl: vi.fn(async () => {
          throw new TypeError("network failed");
        }),
        hostname: "almostnode-browser",
      }),
    ).resolves.toBeNull();
  });

  it("surfaces authenticated provisioning failures", async () => {
    await expect(
      requestTailscaleAuthKey({
        endpoint: "/forbidden",
        fetchImpl: vi.fn(
          async () =>
            new Response("forbidden", {
              status: 403,
            }),
        ),
        hostname: "almostnode-browser",
      }),
    ).rejects.toThrow(TailscaleAuthKeyProvisioningError);

    await expect(
      requestTailscaleAuthKey({
        endpoint: "/bad-json",
        fetchImpl: vi.fn(
          async () =>
            new Response("{", {
              headers: { "content-type": "application/json" },
              status: 200,
            }),
        ),
        hostname: "almostnode-browser",
      }),
    ).rejects.toThrow("malformed JSON");

    await expect(
      requestTailscaleAuthKey({
        endpoint: "/missing-key",
        fetchImpl: vi.fn(async () => Response.json({ hostname: "browser" })),
        hostname: "almostnode-browser",
      }),
    ).rejects.toThrow("did not include an auth key");
  });
});
