import { describe, expect, it } from "vitest";
import {
  buildTokenFile,
  deleteTokenFile,
  readTokenFile,
  secondsUntilExpiry,
  writeTokenFile,
} from "../../../src/features/oauth-services/token-store";
import {
  OAUTH_TOKEN_DIR,
  tokenFilePathForService,
} from "../../../src/features/oauth-services/registry";
import type {
  OAuthServiceConfig,
  OAuthTokenFile,
} from "../../../src/features/oauth-services/types";

/**
 * Minimal in-memory implementation of the small VFS surface the token-store
 * uses. Mirrors `existsSync` / `mkdirSync` / `readFileSync` / `writeFileSync` /
 * `unlinkSync` from {@link import("almostnode").VirtualFS}.
 */
class FakeVfs {
  files = new Map<string, string>();
  dirs = new Set<string>();

  existsSync(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  mkdirSync(path: string, _options?: { recursive?: boolean }): void {
    this.dirs.add(path);
  }

  // `readFileSync(path, "utf8")` returns string in the real VFS.
  readFileSync(path: string, _encoding: "utf8"): string {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`ENOENT: ${path}`);
    }
    return content;
  }

  writeFileSync(path: string, content: string): void {
    this.files.set(path, content);
  }

  unlinkSync(path: string): void {
    if (!this.files.delete(path)) {
      throw new Error(`ENOENT: ${path}`);
    }
  }
}

function asVfs(fake: FakeVfs): import("almostnode").VirtualFS {
  // The real VirtualFS has many more methods, but token-store only uses the
  // five above. Cast through unknown so the structural check passes.
  return fake as unknown as import("almostnode").VirtualFS;
}

function makeService(overrides: Partial<OAuthServiceConfig> = {}): OAuthServiceConfig {
  return {
    id: "github-aaaaaa",
    displayName: "GitHub",
    issuer: "https://github.com",
    authorizationEndpoint: "https://github.com/login/oauth/authorize",
    tokenEndpoint: "https://github.com/login/oauth/access_token",
    scopesRequested: ["repo"],
    clientId: "client-1",
    redirectUri: "https://app.example.com/oauth/callback",
    codeChallengeMethod: "S256",
    addedAt: "2026-04-19T12:00:00.000Z",
    discoveredAt: "2026-04-19T12:00:00.000Z",
    ...overrides,
  };
}

describe("buildTokenFile", () => {
  it("computes expiresAt from expires_in when present", () => {
    const service = makeService();
    const now = new Date("2026-04-19T12:00:00.000Z");
    const file = buildTokenFile({
      service,
      response: {
        access_token: "AT-1",
        refresh_token: "RT-1",
        expires_in: 3600,
        scope: "repo",
        token_type: "Bearer",
      },
      now,
    });

    expect(file).toEqual({
      version: 1,
      serviceId: service.id,
      tokenType: "Bearer",
      accessToken: "AT-1",
      refreshToken: "RT-1",
      expiresAt: "2026-04-19T13:00:00.000Z",
      scope: "repo",
      tokenEndpoint: service.tokenEndpoint,
      clientId: service.clientId,
      clientSecret: undefined,
      obtainedAt: "2026-04-19T12:00:00.000Z",
      refreshedAt: undefined,
    });
  });

  it("preserves the previous refresh_token when refresh response omits one (rotation-safe)", () => {
    const service = makeService();
    const previous: OAuthTokenFile = {
      version: 1,
      serviceId: service.id,
      tokenType: "Bearer",
      accessToken: "old",
      refreshToken: "RT-prev",
      expiresAt: "2026-04-19T11:30:00.000Z",
      scope: "repo",
      tokenEndpoint: service.tokenEndpoint,
      clientId: service.clientId,
      obtainedAt: "2026-04-18T12:00:00.000Z",
    };
    const now = new Date("2026-04-19T12:00:00.000Z");

    const file = buildTokenFile({
      service,
      response: { access_token: "AT-new", expires_in: 1800 },
      previous,
      now,
    });

    expect(file.refreshToken).toBe("RT-prev");
    expect(file.scope).toBe("repo");
    expect(file.obtainedAt).toBe("2026-04-18T12:00:00.000Z");
    expect(file.refreshedAt).toBe("2026-04-19T12:00:00.000Z");
    expect(file.expiresAt).toBe("2026-04-19T12:30:00.000Z");
  });

  it("falls back to previous expiresAt when expires_in is missing", () => {
    const service = makeService();
    const previous: OAuthTokenFile = {
      version: 1,
      serviceId: service.id,
      tokenType: "Bearer",
      accessToken: "old",
      expiresAt: "2030-01-01T00:00:00.000Z",
      tokenEndpoint: service.tokenEndpoint,
      clientId: service.clientId,
      obtainedAt: "2026-04-18T12:00:00.000Z",
    };

    const file = buildTokenFile({
      service,
      response: { access_token: "AT-new" },
      previous,
      now: new Date("2026-04-19T12:00:00.000Z"),
    });

    expect(file.expiresAt).toBe("2030-01-01T00:00:00.000Z");
  });

  it("ignores non-finite or non-positive expires_in values", () => {
    const service = makeService();
    const file = buildTokenFile({
      service,
      response: {
        access_token: "AT",
        expires_in: 0,
      },
      now: new Date("2026-04-19T12:00:00.000Z"),
    });
    expect(file.expiresAt).toBeUndefined();
  });

  it("captures the service's client_secret in the token file (for standalone refresh)", () => {
    const service = makeService({ clientSecret: "shhh" });
    const file = buildTokenFile({
      service,
      response: { access_token: "AT" },
      now: new Date("2026-04-19T12:00:00.000Z"),
    });
    expect(file.clientSecret).toBe("shhh");
  });
});

describe("writeTokenFile / readTokenFile / deleteTokenFile", () => {
  function file(serviceId: string, overrides: Partial<OAuthTokenFile> = {}): OAuthTokenFile {
    return {
      version: 1,
      serviceId,
      tokenType: "Bearer",
      accessToken: "AT",
      tokenEndpoint: "https://example.com/token",
      clientId: "client-1",
      obtainedAt: "2026-04-19T12:00:00.000Z",
      ...overrides,
    };
  }

  it("writeTokenFile creates the parent directory and writes pretty JSON", () => {
    const fake = new FakeVfs();
    const target = file("github-aaaaaa");

    writeTokenFile(asVfs(fake), target);

    expect(fake.dirs.has(OAUTH_TOKEN_DIR)).toBe(true);
    const path = tokenFilePathForService("github-aaaaaa");
    expect(fake.files.has(path)).toBe(true);
    const written = fake.files.get(path)!;
    expect(written.endsWith("\n")).toBe(true);
    expect(JSON.parse(written)).toEqual(target);
  });

  it("does not re-create the parent directory when it already exists", () => {
    const fake = new FakeVfs();
    fake.mkdirSync(OAUTH_TOKEN_DIR, { recursive: true });
    let mkdirCount = 0;
    const original = fake.mkdirSync.bind(fake);
    fake.mkdirSync = ((p: string, o?: { recursive?: boolean }) => {
      mkdirCount += 1;
      original(p, o);
    }) as typeof fake.mkdirSync;

    writeTokenFile(asVfs(fake), file("a"));
    expect(mkdirCount).toBe(0);
  });

  it("readTokenFile returns the parsed contents", () => {
    const fake = new FakeVfs();
    const target = file("linear-bbbbbb", { scope: "read" });
    writeTokenFile(asVfs(fake), target);
    expect(readTokenFile(asVfs(fake), "linear-bbbbbb")).toEqual(target);
  });

  it("readTokenFile returns null when the file does not exist", () => {
    const fake = new FakeVfs();
    expect(readTokenFile(asVfs(fake), "nope")).toBeNull();
  });

  it("readTokenFile returns null when the JSON fails the schema check", () => {
    const fake = new FakeVfs();
    fake.writeFileSync(
      tokenFilePathForService("bad"),
      JSON.stringify({ version: 99, hello: "world" }),
    );
    expect(readTokenFile(asVfs(fake), "bad")).toBeNull();
  });

  it("readTokenFile swallows read errors", () => {
    const fake = new FakeVfs();
    fake.writeFileSync(tokenFilePathForService("broken"), "{not json}");
    expect(readTokenFile(asVfs(fake), "broken")).toBeNull();
  });

  it("deleteTokenFile removes the file when present", () => {
    const fake = new FakeVfs();
    writeTokenFile(asVfs(fake), file("to-delete"));
    expect(fake.files.has(tokenFilePathForService("to-delete"))).toBe(true);
    deleteTokenFile(asVfs(fake), "to-delete");
    expect(fake.files.has(tokenFilePathForService("to-delete"))).toBe(false);
  });

  it("deleteTokenFile is a no-op when the file does not exist", () => {
    const fake = new FakeVfs();
    expect(() => deleteTokenFile(asVfs(fake), "missing")).not.toThrow();
  });
});

describe("secondsUntilExpiry", () => {
  function fileWithExpiry(expiresAt: string | undefined): OAuthTokenFile {
    return {
      version: 1,
      serviceId: "x",
      tokenType: "Bearer",
      accessToken: "AT",
      tokenEndpoint: "t",
      clientId: "c",
      obtainedAt: "2026-04-19T12:00:00.000Z",
      expiresAt,
    };
  }

  it("returns positive seconds when not yet expired", () => {
    const file = fileWithExpiry("2026-04-19T13:00:00.000Z");
    const now = new Date("2026-04-19T12:30:00.000Z");
    expect(secondsUntilExpiry(file, now)).toBe(1800);
  });

  it("returns negative seconds when already expired", () => {
    const file = fileWithExpiry("2026-04-19T12:00:00.000Z");
    const now = new Date("2026-04-19T12:00:30.000Z");
    expect(secondsUntilExpiry(file, now)).toBe(-30);
  });

  it("returns null when expiresAt is unknown", () => {
    expect(secondsUntilExpiry(fileWithExpiry(undefined))).toBeNull();
  });

  it("returns null when expiresAt is unparseable", () => {
    expect(secondsUntilExpiry(fileWithExpiry("not a date"))).toBeNull();
  });
});
