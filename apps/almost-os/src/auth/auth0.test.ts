import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSession,
  handleRedirectCallback,
  loginWithRedirect,
  logout,
} from "./auth0";

const CLIENT_ID = "J0U5KKcVSO451nCeBO0XaOfgrQrtXpu2";
const PENDING_KEY = "almostos.auth0.pending";
const SESSION_KEY = "almostos.auth0.session";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function installBrowser(href: string) {
  let currentUrl = new URL(href);
  const localStorage = new MemoryStorage();
  const sessionStorage = new MemoryStorage();
  const replacedUrls: string[] = [];

  const location = {
    get href() {
      return currentUrl.toString();
    },
    set href(value: string) {
      currentUrl = new URL(value, currentUrl);
    },
    get origin() {
      return currentUrl.origin;
    },
    get pathname() {
      return currentUrl.pathname;
    },
  };

  const history = {
    replaceState: vi.fn((_state: unknown, _title: string, url?: string | URL | null) => {
      if (url) {
        currentUrl = new URL(String(url), currentUrl);
        replacedUrls.push(currentUrl.toString());
      }
    }),
  };

  vi.stubGlobal("window", { location, history });
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("sessionStorage", sessionStorage);

  return {
    history,
    localStorage,
    sessionStorage,
    get href() {
      return currentUrl.toString();
    },
    get replacedUrl() {
      return replacedUrls.at(-1) ?? null;
    },
  };
}

function encodeJwtPart(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeIdToken(claims: Record<string, unknown>): string {
  return [
    encodeJwtPart({ alg: "none", typ: "JWT" }),
    encodeJwtPart(claims),
    "",
  ].join(".");
}

function pendingLogin(overrides: Record<string, unknown> = {}) {
  return {
    flow: "implicit",
    state: "state-1",
    nonce: "nonce-1",
    redirectUri: "http://localhost:4000/",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-01T12:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("almost-os Auth0 login", () => {
  it("returns logout to the deployed application subpath", () => {
    vi.stubEnv("BASE_URL", "/almostnode/os/");
    const browser = installBrowser("https://blamy.github.io/almostnode/os/");

    logout();

    const logoutUrl = new URL(browser.href);
    expect(logoutUrl.pathname).toBe("/v2/logout");
    expect(logoutUrl.searchParams.get("returnTo")).toBe("https://blamy.github.io/almostnode/os/");
  });

  it("uses the configured default Auth0 client with the supported implicit response mode", async () => {
    const browser = installBrowser("http://localhost:4000/");
    vi.spyOn(globalThis.crypto, "getRandomValues").mockImplementation((array) => {
      const bytes = array as Uint8Array;
      bytes.fill(7);
      return array;
    });

    await loginWithRedirect();

    const authUrl = new URL(browser.href);
    expect(authUrl.origin).toBe("https://webreplay.us.auth0.com");
    expect(authUrl.pathname).toBe("/authorize");
    expect(authUrl.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(authUrl.searchParams.get("redirect_uri")).toBe("http://localhost:4000/");
    expect(authUrl.searchParams.get("response_type")).toBe("id_token token");
    expect(authUrl.searchParams.get("response_mode")).toBe("fragment");
    expect(authUrl.searchParams.has("code_challenge")).toBe(false);

    expect(JSON.parse(browser.sessionStorage.getItem(PENDING_KEY) ?? "{}")).toMatchObject({
      flow: "implicit",
      redirectUri: "http://localhost:4000/",
    });
  });

  it("stores an implicit callback session and removes Auth0 tokens from the URL", async () => {
    const idToken = makeIdToken({
      iss: "https://webreplay.us.auth0.com/",
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 3600,
      nonce: "nonce-1",
      sub: "auth0|user-1",
      name: "Test User",
      email: "test@example.com",
      picture: "https://example.com/avatar.png",
    });
    const browser = installBrowser(
      `http://localhost:4000/#access_token=access-1&id_token=${idToken}&expires_in=3600&token_type=Bearer&state=state-1`,
    );
    browser.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pendingLogin()));
    vi.stubGlobal("fetch", vi.fn());

    await handleRedirectCallback();

    expect(browser.replacedUrl).toBe("http://localhost:4000/");
    expect(browser.sessionStorage.getItem(PENDING_KEY)).toBeNull();
    expect(browser.localStorage.getItem(SESSION_KEY)).toContain("access-1");
    expect(getSession()).toMatchObject({
      access_token: "access-1",
      profile: {
        sub: "auth0|user-1",
        name: "Test User",
        email: "test@example.com",
      },
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("surfaces Auth0 callback errors instead of silently returning to login", async () => {
    const browser = installBrowser(
      "http://localhost:4000/?error=unauthorized_client&error_description=Callback%20URL%20mismatch&state=state-1",
    );
    browser.sessionStorage.setItem(PENDING_KEY, JSON.stringify(pendingLogin()));

    await expect(handleRedirectCallback()).rejects.toThrow("Callback URL mismatch");

    expect(browser.replacedUrl).toBe("http://localhost:4000/");
    expect(browser.sessionStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("includes Auth0 token-exchange details when PKCE mode fails", async () => {
    const browser = installBrowser("http://localhost:4000/?code=code-1&state=state-1");
    browser.sessionStorage.setItem(
      PENDING_KEY,
      JSON.stringify(pendingLogin({ flow: "pkce", verifier: "verifier-1" })),
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: "access_denied",
          error_description: "Unauthorized",
        }),
        { status: 401 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(handleRedirectCallback()).rejects.toThrow(
      "Auth0 token exchange failed (401): Unauthorized",
    );

    expect(browser.replacedUrl).toBe("http://localhost:4000/");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://webreplay.us.auth0.com/oauth/token",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("code_verifier=verifier-1"),
      }),
    );
  });
});
