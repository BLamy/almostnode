import { afterEach, describe, expect, it, vi } from "vitest";

import {
  parseCodexIdToken,
  runCodexBrowserLogin,
  runCodexChatGptLogin,
} from "../../src/features/codex-auth";
import { CODEX_AUTH_PATH } from "../../src/features/keychain";

const DESKTOP_OAUTH_LOOPBACK_BRIDGE_KEY = Symbol.for(
  "almostnode.desktopOAuthLoopback",
);

class FakeVfs {
  files = new Map<string, string>();
  dirs = new Set<string>();

  mkdirSync(path: string): void {
    this.dirs.add(path);
  }

  writeFileSync(path: string, content: string): void {
    this.files.set(path, content);
  }
}

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[DESKTOP_OAUTH_LOOPBACK_BRIDGE_KEY];
  vi.restoreAllMocks();
});

describe("runCodexChatGptLogin", () => {
  it("runs the Codex OAuth callback flow and persists native auth.json", async () => {
    const vfs = new FakeVfs();
    let openedUrl = "";
    const bridge = {
      createSession: vi.fn(async () => ({
        sessionId: "codex-login-session",
        redirectUri: "http://127.0.0.1:1455/auth/callback",
      })),
      openExternal: vi.fn(async ({ url }: { url: string }) => {
        openedUrl = url;
        return { opened: true as const };
      }),
      waitForCallback: vi.fn(async () => {
        const state = new URL(openedUrl).searchParams.get("state");
        return {
          callbackUrl: `http://localhost:1455/auth/callback?code=oauth-code&state=${state}`,
        };
      }),
    };
    (globalThis as Record<symbol, unknown>)[DESKTOP_OAUTH_LOOPBACK_BRIDGE_KEY] =
      bridge;

    const idToken = fakeCodexJwt({
      email: "brett@example.com",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "account-123",
        chatgpt_user_id: "user-123",
        chatgpt_account_is_fedramp: true,
      },
    });
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body ?? ""));
      if (body.get("grant_type") === "authorization_code") {
        expect(body.get("redirect_uri")).toBe(
          "http://localhost:1455/auth/callback",
        );
        expect(body.get("client_id")).toBe("app_EMoamEEZ73f0CkXaXp7hrann");
        return Response.json({
          id_token: idToken,
          access_token: "chatgpt-access",
          refresh_token: "chatgpt-refresh",
        });
      }
      expect(body.get("grant_type")).toBe(
        "urn:ietf:params:oauth:grant-type:token-exchange",
      );
      expect(body.get("requested_token")).toBe("openai-api-key");
      return Response.json({ access_token: "sk-from-token-exchange" });
    });

    const result = await runCodexChatGptLogin({
      vfs: vfs as never,
      oauthFetchOptions: { fetchImpl, proxyBase: "" },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Starting local login server");
    expect(result.stderr).toContain("Successfully logged in");
    expect(result.env).toMatchObject({
      CODEX_ACCESS_TOKEN: "chatgpt-access",
      CODEX_API_KEY: "sk-from-token-exchange",
      OPENAI_API_KEY: "sk-from-token-exchange",
      CODEX_CHATGPT_ACCOUNT_ID: "account-123",
      CODEX_CHATGPT_ACCOUNT_IS_FEDRAMP: "true",
    });
    expect(bridge.createSession).toHaveBeenCalledWith({
      callbackPath: "/auth/callback",
      preferredPort: 1455,
    });
    expect(openedUrl).toContain("https://auth.openai.com/oauth/authorize?");
    expect(openedUrl).toContain("originator=codex_cli_rs");

    const auth = JSON.parse(vfs.files.get(CODEX_AUTH_PATH) ?? "{}");
    expect(auth).toMatchObject({
      auth_mode: "chatgpt",
      OPENAI_API_KEY: "sk-from-token-exchange",
      tokens: {
        id_token: idToken,
        access_token: "chatgpt-access",
        refresh_token: "chatgpt-refresh",
        account_id: "account-123",
      },
    });
    expect(typeof auth.last_refresh).toBe("string");
  });
});

describe("runCodexBrowserLogin", () => {
  it("runs the Codex device-code flow without a localhost callback", async () => {
    const clipboardWrites: string[] = [];
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async (text: string) => {
          clipboardWrites.push(text);
        },
      },
    });
    const vfs = new FakeVfs();
    const idToken = fakeCodexJwt({
      email: "brett@example.com",
      "https://api.openai.com/auth": {
        chatgpt_account_id: "account-device",
      },
    });
    let stdout = "";
    const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const target = String(url);
      if (target.endsWith("/api/accounts/deviceauth/usercode")) {
        expect(JSON.parse(String(init?.body ?? "{}"))).toMatchObject({
          client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
        });
        return Response.json({
          device_auth_id: "device-auth-123",
          user_code: "CODE-12345",
          interval: "1",
        });
      }
      if (target.endsWith("/api/accounts/deviceauth/token")) {
        expect(JSON.parse(String(init?.body ?? "{}"))).toMatchObject({
          device_auth_id: "device-auth-123",
          user_code: "CODE-12345",
        });
        return Response.json({
          authorization_code: "device-oauth-code",
          code_challenge: "unused-challenge",
          code_verifier: "device-code-verifier",
        });
      }

      const body = new URLSearchParams(String(init?.body ?? ""));
      if (body.get("grant_type") === "authorization_code") {
        expect(body.get("redirect_uri")).toBe(
          "https://auth.openai.com/deviceauth/callback",
        );
        expect(body.get("code")).toBe("device-oauth-code");
        expect(body.get("code_verifier")).toBe("device-code-verifier");
        return Response.json({
          id_token: idToken,
          access_token: "device-access",
          refresh_token: "device-refresh",
        });
      }

      expect(body.get("requested_token")).toBe("openai-api-key");
      return Response.json({ access_token: "sk-device-exchange" });
    });

    const result = await runCodexBrowserLogin({
      method: "deviceCode",
      vfs: vfs as never,
      oauthFetchOptions: { fetchImpl, proxyBase: "" },
      writeStdout: (chunk) => {
        stdout += chunk;
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(stdout).toContain("https://auth.openai.com/codex/device");
    expect(stdout).toContain("CODE-12345");
    expect(clipboardWrites).toEqual(["CODE-12345"]);
    expect(stdout).toContain("copied to your clipboard");
    expect(result.stderr).toContain("Successfully logged in");
    expect(result.env).toMatchObject({
      CODEX_ACCESS_TOKEN: "device-access",
      CODEX_API_KEY: "sk-device-exchange",
      OPENAI_API_KEY: "sk-device-exchange",
      CODEX_CHATGPT_ACCOUNT_ID: "account-device",
    });
    const auth = JSON.parse(vfs.files.get(CODEX_AUTH_PATH) ?? "{}");
    expect(auth.tokens).toMatchObject({
      id_token: idToken,
      access_token: "device-access",
      refresh_token: "device-refresh",
      account_id: "account-device",
    });
  });
});

describe("parseCodexIdToken", () => {
  it("extracts Codex account metadata from the native raw JWT string", () => {
    const jwt = fakeCodexJwt({
      "https://api.openai.com/profile": { email: "fallback@example.com" },
      "https://api.openai.com/auth": {
        user_id: "user-from-auth",
        chatgpt_account_id: "workspace-1",
        chatgpt_account_is_fedramp: false,
      },
    });

    expect(parseCodexIdToken(jwt)).toMatchObject({
      email: "fallback@example.com",
      chatgpt_user_id: "user-from-auth",
      chatgpt_account_id: "workspace-1",
      chatgpt_account_is_fedramp: false,
      raw_jwt: jwt,
    });
  });
});

function fakeCodexJwt(payload: Record<string, unknown>): string {
  return [
    base64UrlJson({ alg: "none", typ: "JWT" }),
    base64UrlJson(payload),
    "signature",
  ].join(".");
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
