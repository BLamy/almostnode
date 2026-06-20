import {
  generateKeyPairSync,
  sign,
  type JsonWebKey,
} from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_AUTH0_ISSUER,
  DEFAULT_REPLAY_API_AUDIENCE,
  DEFAULT_REPLAY_DASHBOARD_AUTH0_CLIENT_ID,
  handleTailscaleAuthKeyApiRequest,
  REPLAY_ACCESS_TOKEN_COOKIE,
  verifyAuth0Jwt,
} from "../../src/features/tailscale-auth-key-api";

const fixedNow = new Date("2026-06-18T00:00:00Z");
const issuer = DEFAULT_AUTH0_ISSUER;
const jwksUrl = "https://webreplay.us.auth0.com/.well-known/jwks.json";
const headscaleUrl = "https://headscale.example.com";

function base64Url(value: Buffer | string): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createJwtFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  const jwk = publicKey.export({ format: "jwk" }) as JsonWebKey & {
    kid?: string;
    alg?: string;
    use?: string;
  };
  jwk.kid = "test-key";
  jwk.alg = "RS256";
  jwk.use = "sig";

  const makeToken = (
    claims: Record<string, unknown> = {},
    header: Record<string, unknown> = {},
  ) => {
    const encodedHeader = base64Url(
      JSON.stringify({
        alg: "RS256",
        kid: "test-key",
        typ: "JWT",
        ...header,
      }),
    );
    const encodedPayload = base64Url(
      JSON.stringify({
        iss: issuer,
        sub: "auth0|user-123",
        aud: DEFAULT_REPLAY_API_AUDIENCE,
        azp: DEFAULT_REPLAY_DASHBOARD_AUTH0_CLIENT_ID,
        email: "Brett+Browser@example.com",
        exp: Math.floor(fixedNow.getTime() / 1000) + 600,
        ...claims,
      }),
    );
    const signature = sign(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      privateKey,
    );
    return `${encodedHeader}.${encodedPayload}.${base64Url(signature)}`;
  };

  return {
    jwks: { keys: [jwk] },
    makeToken,
    makeTokenWithWrongKey: () => {
      const { privateKey: otherPrivateKey } = generateKeyPairSync("rsa", {
        modulusLength: 2048,
      });
      const encodedHeader = base64Url(
        JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }),
      );
      const encodedPayload = base64Url(
        JSON.stringify({
          iss: issuer,
          sub: "auth0|user-123",
          aud: DEFAULT_REPLAY_API_AUDIENCE,
          exp: Math.floor(fixedNow.getTime() / 1000) + 600,
        }),
      );
      const signature = sign(
        "RSA-SHA256",
        Buffer.from(`${encodedHeader}.${encodedPayload}`),
        otherPrivateKey,
      );
      return `${encodedHeader}.${encodedPayload}.${base64Url(signature)}`;
    },
  };
}

function createEnv(overrides: Record<string, string> = {}) {
  return {
    ALMOSTNODE_TAILSCALE_AUTH0_JWKS_URL: jwksUrl,
    ALMOSTNODE_HEADSCALE_URL: headscaleUrl,
    ALMOSTNODE_HEADSCALE_API_KEY: "hs-api-key",
    ALMOSTNODE_HEADSCALE_USER: "1",
    ...overrides,
  };
}

describe("tailscale auth-key api", () => {
  it("verifies Auth0 JWTs with the configured JWKS", async () => {
    const fixture = createJwtFixture();
    const fetchImpl = vi.fn(async () => Response.json(fixture.jwks));

    await expect(
      verifyAuth0Jwt(fixture.makeToken(), {
        env: createEnv(),
        fetchImpl,
        now: fixedNow,
      }),
    ).resolves.toMatchObject({
      iss: issuer,
      sub: "auth0|user-123",
      aud: DEFAULT_REPLAY_API_AUDIENCE,
    });

    expect(fetchImpl).toHaveBeenCalledWith(jwksUrl, {
      headers: { accept: "application/json" },
    });
  });

  it("rejects JWTs with a mismatched signature or audience", async () => {
    const fixture = createJwtFixture();
    const fetchImpl = vi.fn(async () => Response.json(fixture.jwks));

    await expect(
      verifyAuth0Jwt(fixture.makeTokenWithWrongKey(), {
        env: createEnv(),
        fetchImpl,
        now: fixedNow,
      }),
    ).rejects.toThrow("Invalid token signature");

    await expect(
      verifyAuth0Jwt(fixture.makeToken({ aud: "https://wrong.example.com" }), {
        env: createEnv(),
        fetchImpl,
        now: fixedNow,
      }),
    ).rejects.toThrow("Unexpected token audience");
  });

  it("mints a single-use Headscale auth key for an authenticated browser", async () => {
    const fixture = createJwtFixture();
    const fetchImpl = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url === jwksUrl) {
          return Response.json(fixture.jwks);
        }

        expect(url).toBe(`${headscaleUrl}/api/v1/preauthkey`);
        expect(init?.method).toBe("POST");
        expect(init?.headers).toMatchObject({
          accept: "application/json",
          authorization: "Bearer hs-api-key",
          "content-type": "application/json",
        });
        expect(JSON.parse(String(init?.body))).toMatchObject({
          user: "1",
          reusable: false,
          ephemeral: true,
          aclTags: [],
        });

        return Response.json({
          preAuthKey: {
            key: "tskey-auth-from-headscale",
            expiration: "2026-06-18T00:10:00Z",
          },
        });
      },
    );

    const result = await handleTailscaleAuthKeyApiRequest(
      {
        method: "POST",
        headers: new Headers({
          cookie: `${REPLAY_ACCESS_TOKEN_COOKIE}=${encodeURIComponent(
            fixture.makeToken(),
          )}`,
          "content-type": "application/json",
        }),
        bodyText: JSON.stringify({ hostname: "Brett's Browser" }),
      },
      { env: createEnv(), fetchImpl, now: () => fixedNow },
    );

    expect(result.status).toBe(200);
    expect(JSON.parse(result.body)).toEqual({
      authKey: "tskey-auth-from-headscale",
      controlUrl: headscaleUrl,
      hostname: "brett-s-browser",
      useExitNode: true,
      acceptDns: true,
      expiresAt: "2026-06-18T00:10:00Z",
    });
  });

  it("returns unavailable when Headscale is not configured", async () => {
    const result = await handleTailscaleAuthKeyApiRequest(
      {
        method: "POST",
        headers: new Headers(),
        bodyText: "{}",
      },
      {
        env: {
          ALMOSTNODE_TAILSCALE_AUTH0_JWKS_URL: jwksUrl,
        },
        fetchImpl: vi.fn(),
      },
    );

    expect(result.status).toBe(501);
    expect(JSON.parse(result.body)).toEqual({
      error: "headscale_not_configured",
    });
  });

  it("requires auth once Headscale is configured", async () => {
    const result = await handleTailscaleAuthKeyApiRequest(
      {
        method: "POST",
        headers: new Headers(),
        bodyText: "{}",
      },
      { env: createEnv(), fetchImpl: vi.fn() },
    );

    expect(result.status).toBe(401);
    expect(JSON.parse(result.body)).toEqual({ error: "missing_auth_token" });
  });
});
