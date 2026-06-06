import { describe, expect, it } from "vitest";
import {
  buildWellKnownUrl,
  discoverAuthorizationServer,
  discoverOAuthService,
  discoverProtectedResource,
  normalizeIssuerInput,
  OAuthDiscoveryError,
} from "../../../src/features/oauth-services/discovery";
import type { FetchLike } from "../../../src/features/oauth-services/proxy-fetch";

interface RouteHandler {
  status?: number;
  json?: unknown;
  body?: string;
  /** When true, throw a network error instead of responding. */
  fail?: boolean;
}

function createMockFetch(routes: Record<string, RouteHandler>): {
  fetchImpl: FetchLike;
  calls: string[];
} {
  const calls: string[] = [];
  const fetchImpl: FetchLike = async (input) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push(url);
    const handler = routes[url];
    if (!handler || handler.fail) {
      throw new Error(`network error: ${url}`);
    }
    const status = handler.status ?? 200;
    const body = handler.json !== undefined ? JSON.stringify(handler.json) : (handler.body ?? "");
    return new Response(body, {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

describe("normalizeIssuerInput", () => {
  it("rejects an empty input", () => {
    expect(() => normalizeIssuerInput("   ")).toThrow(OAuthDiscoveryError);
  });

  it("prefixes https:// when no scheme is supplied", () => {
    expect(normalizeIssuerInput("example.com")).toBe("https://example.com");
  });

  it("trims a single trailing slash", () => {
    expect(normalizeIssuerInput("https://example.com/")).toBe("https://example.com");
  });

  it("preserves paths verbatim (sans trailing slash)", () => {
    expect(normalizeIssuerInput("https://example.com/api/")).toBe(
      "https://example.com/api",
    );
  });

  it("rejects unsupported schemes", () => {
    expect(() => normalizeIssuerInput("ftp://example.com")).toThrow(/http/);
  });

  it("rejects garbage that won't parse as a URL", () => {
    expect(() => normalizeIssuerInput("https://[badurl")).toThrow(OAuthDiscoveryError);
  });
});

describe("buildWellKnownUrl", () => {
  it("joins base + path with a single slash", () => {
    expect(buildWellKnownUrl("https://example.com", "/.well-known/foo"))
      .toBe("https://example.com/.well-known/foo");
  });

  it("normalises relative paths missing a leading slash", () => {
    expect(buildWellKnownUrl("https://example.com", ".well-known/foo"))
      .toBe("https://example.com/.well-known/foo");
  });

  it("strips trailing slash from the base", () => {
    expect(buildWellKnownUrl("https://example.com/", "/.well-known/foo"))
      .toBe("https://example.com/.well-known/foo");
  });

  it("drops the base URL's path so the well-known doc is fetched from the origin root", () => {
    // Regression: for an MCP resource at `https://dispatch.replay.io/nut/mcp`,
    // we must fetch `https://dispatch.replay.io/.well-known/...` — NOT
    // `https://dispatch.replay.io/nut/mcp/.well-known/...`.
    expect(
      buildWellKnownUrl(
        "https://dispatch.replay.io/nut/mcp",
        "/.well-known/oauth-protected-resource",
      ),
    ).toBe("https://dispatch.replay.io/.well-known/oauth-protected-resource");
  });

  it("drops the base URL's path plus query/fragment when building the well-known URL", () => {
    expect(
      buildWellKnownUrl(
        "https://example.com/some/deep/path?x=1#frag",
        "/.well-known/openid-configuration",
      ),
    ).toBe("https://example.com/.well-known/openid-configuration");
  });

  it("preserves non-default ports when collapsing to origin", () => {
    expect(
      buildWellKnownUrl(
        "https://example.com:8443/some/path",
        "/.well-known/foo",
      ),
    ).toBe("https://example.com:8443/.well-known/foo");
  });
});

describe("discoverProtectedResource", () => {
  it("returns the parsed body when the well-known doc exists", async () => {
    const { fetchImpl } = createMockFetch({
      "https://app.example.com/.well-known/oauth-protected-resource": {
        json: {
          resource: "https://app.example.com",
          authorization_servers: ["https://auth.example.com"],
          scopes_supported: ["read", "write"],
        },
      },
    });

    const meta = await discoverProtectedResource(
      "https://app.example.com",
      { fetchImpl, tryDirectFirst: true },
    );
    expect(meta).toEqual({
      resource: "https://app.example.com",
      authorization_servers: ["https://auth.example.com"],
      scopes_supported: ["read", "write"],
    });
  });

  it("returns null on 404", async () => {
    const { fetchImpl } = createMockFetch({
      "https://app.example.com/.well-known/oauth-protected-resource": { status: 404 },
    });
    const meta = await discoverProtectedResource(
      "https://app.example.com",
      { fetchImpl, tryDirectFirst: true, proxyBase: "" },
    );
    expect(meta).toBeNull();
  });

  it("returns null on a network error", async () => {
    const { fetchImpl } = createMockFetch({
      "https://app.example.com/.well-known/oauth-protected-resource": { fail: true },
    });
    const meta = await discoverProtectedResource(
      "https://app.example.com",
      { fetchImpl, tryDirectFirst: true, proxyBase: "" },
    );
    expect(meta).toBeNull();
  });
});

describe("discoverAuthorizationServer", () => {
  it("prefers the RFC 8414 oauth-authorization-server document", async () => {
    const { fetchImpl, calls } = createMockFetch({
      "https://auth.example.com/.well-known/oauth-authorization-server": {
        json: {
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
        },
      },
    });
    const meta = await discoverAuthorizationServer(
      "https://auth.example.com",
      { fetchImpl, tryDirectFirst: true, proxyBase: "" },
    );
    expect(meta.token_endpoint).toBe("https://auth.example.com/token");
    expect(calls).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server",
    ]);
  });

  it("falls back to OIDC openid-configuration if the first candidate is missing endpoints", async () => {
    const { fetchImpl, calls } = createMockFetch({
      "https://auth.example.com/.well-known/oauth-authorization-server": {
        json: { issuer: "https://auth.example.com" /* no endpoints */ },
      },
      "https://auth.example.com/.well-known/openid-configuration": {
        json: {
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
        },
      },
    });
    const meta = await discoverAuthorizationServer(
      "https://auth.example.com",
      { fetchImpl, tryDirectFirst: true, proxyBase: "" },
    );
    expect(meta.authorization_endpoint).toBe("https://auth.example.com/authorize");
    expect(calls).toEqual([
      "https://auth.example.com/.well-known/oauth-authorization-server",
      "https://auth.example.com/.well-known/openid-configuration",
    ]);
  });

  it("throws OAuthDiscoveryError when both candidates fail with non-OK responses", async () => {
    const { fetchImpl } = createMockFetch({
      "https://auth.example.com/.well-known/oauth-authorization-server": { status: 404 },
      "https://auth.example.com/.well-known/openid-configuration": { status: 404 },
    });
    await expect(() =>
      discoverAuthorizationServer(
        "https://auth.example.com",
        { fetchImpl, tryDirectFirst: true, proxyBase: "" },
      ),
    ).rejects.toBeInstanceOf(OAuthDiscoveryError);
  });

  it("throws when both candidates throw network errors", async () => {
    const { fetchImpl } = createMockFetch({
      "https://auth.example.com/.well-known/oauth-authorization-server": { fail: true },
      "https://auth.example.com/.well-known/openid-configuration": { fail: true },
    });
    await expect(() =>
      discoverAuthorizationServer(
        "https://auth.example.com",
        { fetchImpl, tryDirectFirst: true, proxyBase: "" },
      ),
    ).rejects.toBeInstanceOf(OAuthDiscoveryError);
  });
});

describe("discoverOAuthService", () => {
  it("end-to-end: protected resource → AS metadata → preview", async () => {
    const { fetchImpl } = createMockFetch({
      "https://app.example.com/.well-known/oauth-protected-resource": {
        json: {
          resource: "https://app.example.com",
          authorization_servers: ["https://auth.example.com"],
          scopes_supported: ["read"],
        },
      },
      "https://auth.example.com/.well-known/oauth-authorization-server": {
        json: {
          issuer: "https://auth.example.com",
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          registration_endpoint: "https://auth.example.com/register",
          scopes_supported: ["read", "write"],
          code_challenge_methods_supported: ["S256"],
        },
      },
    });

    const preview = await discoverOAuthService(
      "https://app.example.com/",
      { fetchImpl, tryDirectFirst: true, proxyBase: "" },
    );

    expect(preview).toEqual({
      inputUrl: "https://app.example.com",
      issuer: "https://auth.example.com",
      resourceUrl: "https://app.example.com",
      authorizationEndpoint: "https://auth.example.com/authorize",
      tokenEndpoint: "https://auth.example.com/token",
      registrationEndpoint: "https://auth.example.com/register",
      revocationEndpoint: undefined,
      scopesSupported: ["read", "write"],
      supportsS256: true,
      supportsDynamicRegistration: true,
      suggestedDisplayName: "auth.example.com",
    });
  });

  it("treats the input URL as the AS when no protected-resource doc exists", async () => {
    const { fetchImpl } = createMockFetch({
      "https://auth.example.com/.well-known/oauth-protected-resource": { status: 404 },
      "https://auth.example.com/.well-known/oauth-authorization-server": {
        json: {
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
        },
      },
    });

    const preview = await discoverOAuthService(
      "https://auth.example.com",
      { fetchImpl, tryDirectFirst: true, proxyBase: "" },
    );

    expect(preview.issuer).toBe("https://auth.example.com");
    expect(preview.supportsDynamicRegistration).toBe(false);
    expect(preview.resourceUrl).toBeUndefined();
  });

  it("rejects if the AS lists code_challenge_methods_supported without S256", async () => {
    const { fetchImpl } = createMockFetch({
      "https://auth.example.com/.well-known/oauth-protected-resource": { status: 404 },
      "https://auth.example.com/.well-known/oauth-authorization-server": {
        json: {
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
          code_challenge_methods_supported: ["plain"],
        },
      },
    });

    await expect(() =>
      discoverOAuthService(
        "https://auth.example.com",
        { fetchImpl, tryDirectFirst: true, proxyBase: "" },
      ),
    ).rejects.toThrowError(/S256/i);
  });

  it("optimistically allows S256 when code_challenge_methods_supported is omitted", async () => {
    const { fetchImpl } = createMockFetch({
      "https://auth.example.com/.well-known/oauth-protected-resource": { status: 404 },
      "https://auth.example.com/.well-known/oauth-authorization-server": {
        json: {
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
        },
      },
    });
    const preview = await discoverOAuthService(
      "https://auth.example.com",
      { fetchImpl, tryDirectFirst: true, proxyBase: "" },
    );
    expect(preview.supportsS256).toBe(true);
  });

  it("falls back to scopes from the protected-resource doc when AS doesn't list any", async () => {
    const { fetchImpl } = createMockFetch({
      "https://app.example.com/.well-known/oauth-protected-resource": {
        json: {
          resource: "https://app.example.com",
          authorization_servers: ["https://auth.example.com"],
          scopes_supported: ["mcp.read"],
        },
      },
      "https://auth.example.com/.well-known/oauth-authorization-server": {
        json: {
          authorization_endpoint: "https://auth.example.com/authorize",
          token_endpoint: "https://auth.example.com/token",
        },
      },
    });
    const preview = await discoverOAuthService(
      "https://app.example.com",
      { fetchImpl, tryDirectFirst: true, proxyBase: "" },
    );
    expect(preview.scopesSupported).toEqual(["mcp.read"]);
  });

  it("fetches well-known docs from the origin root for a path-bearing MCP resource URL", async () => {
    // Regression test for a bug where pasting `https://dispatch.replay.io/nut/mcp`
    // caused discovery to fetch
    // `https://dispatch.replay.io/nut/mcp/.well-known/oauth-protected-resource`
    // instead of `https://dispatch.replay.io/.well-known/oauth-protected-resource`.
    const { fetchImpl, calls } = createMockFetch({
      "https://dispatch.replay.io/.well-known/oauth-protected-resource": {
        json: {
          resource: "https://dispatch.replay.io/nut/mcp",
          authorization_servers: ["https://dispatch.replay.io"],
          scopes_supported: ["mcp.read"],
        },
      },
      "https://dispatch.replay.io/.well-known/oauth-authorization-server": {
        json: {
          issuer: "https://dispatch.replay.io",
          authorization_endpoint: "https://dispatch.replay.io/oauth/authorize",
          token_endpoint: "https://dispatch.replay.io/oauth/token",
          code_challenge_methods_supported: ["S256"],
        },
      },
    });

    const preview = await discoverOAuthService(
      "https://dispatch.replay.io/nut/mcp",
      { fetchImpl, tryDirectFirst: true, proxyBase: "" },
    );

    expect(calls).toEqual([
      "https://dispatch.replay.io/.well-known/oauth-protected-resource",
      "https://dispatch.replay.io/.well-known/oauth-authorization-server",
    ]);
    expect(preview.authorizationEndpoint).toBe(
      "https://dispatch.replay.io/oauth/authorize",
    );
    expect(preview.tokenEndpoint).toBe("https://dispatch.replay.io/oauth/token");
    // The resource identifier returned by the AS is preserved even though
    // the discovery fetch was origin-rooted.
    expect(preview.resourceUrl).toBe("https://dispatch.replay.io/nut/mcp");
  });
});
