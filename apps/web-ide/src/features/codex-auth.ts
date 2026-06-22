import type { VirtualFS } from "@agent-wasm/core";

import { getDesktopOAuthLoopbackBridge } from "./desktop-oauth-loopback";
import { CODEX_AUTH_PATH } from "@agent-wasm/keychain";
import { generatePkcePair, randomState } from "@agent-wasm/keychain/oauth/pkce";
import { oauthFetch, type OAuthFetchOptions } from "@agent-wasm/keychain/oauth/proxy-fetch";

const CODEX_OAUTH_ISSUER = "https://auth.openai.com";
const CODEX_OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
const CODEX_OAUTH_REDIRECT_PORT = 1455;
const CODEX_OAUTH_REDIRECT_PATH = "/auth/callback";
const CODEX_OAUTH_ORIGINATOR = "codex_cli_rs";
const CODEX_OAUTH_SCOPE =
  "openid profile email offline_access api.connectors.read api.connectors.invoke";
const CODEX_LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const CODEX_DEVICE_LOGIN_TIMEOUT_MS = 15 * 60 * 1000;
const CODEX_BROWSER_CLI_VERSION = "0.137.0";
const CODEX_LOGIN_SUCCESS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Codex login complete</title></head><body><h1>Codex login complete</h1><p>You can return to Codex.</p></body></html>`;

interface CodexAuthVfs
  extends Pick<VirtualFS, "mkdirSync" | "writeFileSync"> {}

interface CodexAuthRefreshVfs
  extends Pick<VirtualFS, "mkdirSync" | "writeFileSync" | "readFileSync" | "existsSync"> {}

export interface RefreshCodexAuthOptions {
  vfs: CodexAuthRefreshVfs;
  oauthFetchOptions?: OAuthFetchOptions;
}

export interface CodexLoginResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  env?: Record<string, string>;
}

export interface RunCodexChatGptLoginOptions {
  vfs: CodexAuthVfs;
  oauthFetchOptions?: OAuthFetchOptions;
  signal?: AbortSignal;
  writeStdout?: (data: string) => void;
}

export interface RunCodexBrowserLoginOptions extends RunCodexChatGptLoginOptions {
  method: "chatgpt" | "deviceCode";
}

interface ExchangedCodexTokens {
  id_token: string;
  access_token: string;
  refresh_token: string;
}

interface CodexIdTokenInfo {
  email?: string;
  chatgpt_plan_type?: unknown;
  chatgpt_user_id?: string;
  chatgpt_account_id?: string;
  chatgpt_account_is_fedramp: boolean;
  raw_jwt: string;
}

interface CodexJwtAuthClaims {
  chatgpt_plan_type?: unknown;
  chatgpt_user_id?: string;
  user_id?: string;
  chatgpt_account_id?: string;
  chatgpt_account_is_fedramp?: boolean;
}

interface CodexDeviceCode {
  verificationUrl: string;
  userCode: string;
  deviceAuthId: string;
  intervalSeconds: number;
}

interface CodexDeviceAuthorization {
  authorizationCode: string;
  codeVerifier: string;
}

export async function runCodexBrowserLogin(
  options: RunCodexBrowserLoginOptions,
): Promise<CodexLoginResult> {
  if (options.method === "chatgpt") {
    return runCodexChatGptLogin(options);
  }
  return runCodexDeviceCodeLogin(options);
}

export async function runCodexChatGptLogin(
  options: RunCodexChatGptLoginOptions,
): Promise<CodexLoginResult> {
  const bridge = getDesktopOAuthLoopbackBridge();
  if (!bridge) {
    return runCodexDeviceCodeLogin(options);
  }

  const pkce = await generatePkcePair();
  const state = randomState();
  const redirectUri = `http://localhost:${CODEX_OAUTH_REDIRECT_PORT}${CODEX_OAUTH_REDIRECT_PATH}`;
  const authUrl = buildCodexAuthorizeUrl({
    redirectUri,
    codeChallenge: pkce.codeChallenge,
    state,
  });

  const intro =
    `Starting local login server on http://localhost:${CODEX_OAUTH_REDIRECT_PORT}.\n`
    + "If your browser did not open, navigate to this URL to authenticate:\n\n"
    + `${authUrl}\n\n`;

  try {
    let callbackUrl: string;
    if (bridge) {
      const session = await bridge.createSession({
        callbackPath: CODEX_OAUTH_REDIRECT_PATH,
        preferredPort: CODEX_OAUTH_REDIRECT_PORT,
      });
      const actualPort = new URL(session.redirectUri).port;
      if (actualPort !== String(CODEX_OAUTH_REDIRECT_PORT)) {
        return {
          stdout: "",
          stderr:
            intro
            + `Error logging in: Codex OAuth requires callback port ${CODEX_OAUTH_REDIRECT_PORT}, but the desktop bridge opened ${actualPort}.\n`,
          exitCode: 1,
        };
      }

      try {
        await bridge.openExternal({ sessionId: session.sessionId, url: authUrl });
      } catch {
        openLoginUrl(authUrl);
      }
      callbackUrl = (
        await bridge.waitForCallback({
          sessionId: session.sessionId,
          timeoutMs: CODEX_LOGIN_TIMEOUT_MS,
          successHtml: CODEX_LOGIN_SUCCESS_HTML,
        })
      ).callbackUrl;
    }
    const code = readCallbackCode(callbackUrl, state);
    const tokens = await exchangeCodeForTokens(
      redirectUri,
      pkce.codeVerifier,
      code,
      options.oauthFetchOptions,
    );
    const apiKey = await obtainApiKey(tokens.id_token, options.oauthFetchOptions);
    const env = persistCodexAuth(options.vfs, tokens, apiKey ?? undefined);
    return {
      stdout: "",
      stderr: `${intro}Successfully logged in\n`,
      exitCode: 0,
      env,
    };
  } catch (error) {
    return {
      stdout: "",
      stderr: `${intro}Error logging in: ${formatCodexLoginError(error)}\n`,
      exitCode: 1,
    };
  }
}

export async function runCodexDeviceCodeLogin(
  options: RunCodexChatGptLoginOptions,
): Promise<CodexLoginResult> {
  try {
    const deviceCode = await requestCodexDeviceCode(
      options.oauthFetchOptions,
      options.signal,
    );
    const prompt = renderCodexDeviceCodePrompt(
      deviceCode.verificationUrl,
      deviceCode.userCode,
    );
    options.writeStdout?.(prompt);
    // Copy the one-time code before opening the tab so it's ready to paste.
    await copyDeviceCodeToClipboard(deviceCode.userCode, options.writeStdout);
    openLoginUrl(deviceCode.verificationUrl);

    const authorization = await pollCodexDeviceAuthorization(
      deviceCode,
      options.oauthFetchOptions,
      options.signal,
    );
    const tokens = await exchangeDeviceAuthorizationForTokens(
      authorization,
      options.oauthFetchOptions,
    );
    const apiKey = await obtainApiKey(tokens.id_token, options.oauthFetchOptions);
    const env = persistCodexAuth(options.vfs, tokens, apiKey ?? undefined);
    return {
      stdout: options.writeStdout ? "" : prompt,
      stderr: "Successfully logged in\n",
      exitCode: 0,
      env,
    };
  } catch (error) {
    return {
      stdout: "",
      stderr: `Error logging in with device code: ${formatCodexLoginError(error)}\n`,
      exitCode: 1,
    };
  }
}

function buildCodexAuthorizeUrl(input: {
  redirectUri: string;
  codeChallenge: string;
  state: string;
}): string {
  const url = new URL(`${CODEX_OAUTH_ISSUER}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CODEX_OAUTH_CLIENT_ID);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("scope", CODEX_OAUTH_SCOPE);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("state", input.state);
  url.searchParams.set("originator", CODEX_OAUTH_ORIGINATOR);
  return url.toString();
}

async function copyDeviceCodeToClipboard(
  userCode: string,
  writeStdout?: (data: string) => void,
): Promise<void> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return;
  }
  try {
    await navigator.clipboard.writeText(userCode);
    writeStdout?.("\nThe one-time code has been copied to your clipboard.\n");
  } catch {
    // Clipboard access can be denied (no user activation / permissions);
    // the code is already printed in the terminal.
  }
}

function openLoginUrl(authUrl: string): void {
  if (typeof window === "undefined") return;
  try {
    window.open(authUrl, "_blank", "noopener,noreferrer");
  } catch {
    // The URL is also printed in the terminal.
  }
}

function readCallbackCode(callbackUrl: string, expectedState: string): string {
  const parsed = new URL(callbackUrl);
  const state = parsed.searchParams.get("state");
  if (state !== expectedState) {
    throw new Error("OAuth callback state mismatch.");
  }
  const error = parsed.searchParams.get("error");
  if (error) {
    const description = parsed.searchParams.get("error_description");
    throw new Error(description ? `${error}: ${description}` : error);
  }
  const code = parsed.searchParams.get("code");
  if (!code) {
    throw new Error("Missing authorization code.");
  }
  return code;
}

function renderCodexDeviceCodePrompt(
  verificationUrl: string,
  userCode: string,
): string {
  return `\nWelcome to Codex [v${CODEX_BROWSER_CLI_VERSION}]\nOpenAI's command-line coding agent\n\nFollow these steps to sign in with ChatGPT using device code authorization:\n\n1. Open this link in your browser and sign in to your account\n   ${verificationUrl}\n\n2. Enter this one-time code (expires in 15 minutes)\n   ${userCode}\n\nDevice codes are a common phishing target. Never share this code.\n`;
}

async function requestCodexDeviceCode(
  oauthFetchOptions?: OAuthFetchOptions,
  signal?: AbortSignal,
): Promise<CodexDeviceCode> {
  const response = await oauthFetch(
    `${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/usercode`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: CODEX_OAUTH_CLIENT_ID }),
      signal,
    },
    oauthFetchOptions,
  );
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        "device code login is not enabled for this Codex server. Use API key login or try again later.",
      );
    }
    throw new Error(`device code request failed with status ${response.status}`);
  }

  const parsed = (await response.json()) as {
    device_auth_id?: unknown;
    user_code?: unknown;
    usercode?: unknown;
    interval?: unknown;
  };
  const deviceAuthId = typeof parsed.device_auth_id === "string"
    ? parsed.device_auth_id.trim()
    : "";
  const userCode = typeof parsed.user_code === "string"
    ? parsed.user_code.trim()
    : typeof parsed.usercode === "string"
      ? parsed.usercode.trim()
      : "";
  const intervalSeconds = parseDeviceCodeInterval(parsed.interval);
  if (!deviceAuthId || !userCode) {
    throw new Error("device code endpoint returned an incomplete response.");
  }

  return {
    verificationUrl: `${CODEX_OAUTH_ISSUER}/codex/device`,
    userCode,
    deviceAuthId,
    intervalSeconds,
  };
}

async function pollCodexDeviceAuthorization(
  deviceCode: CodexDeviceCode,
  oauthFetchOptions?: OAuthFetchOptions,
  signal?: AbortSignal,
): Promise<CodexDeviceAuthorization> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < CODEX_DEVICE_LOGIN_TIMEOUT_MS) {
    const response = await oauthFetch(
      `${CODEX_OAUTH_ISSUER}/api/accounts/deviceauth/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_auth_id: deviceCode.deviceAuthId,
          user_code: deviceCode.userCode,
        }),
        signal,
      },
      oauthFetchOptions,
    );

    if (response.ok) {
      const parsed = (await response.json()) as {
        authorization_code?: unknown;
        code_verifier?: unknown;
      };
      const authorizationCode = typeof parsed.authorization_code === "string"
        ? parsed.authorization_code.trim()
        : "";
      const codeVerifier = typeof parsed.code_verifier === "string"
        ? parsed.code_verifier.trim()
        : "";
      if (!authorizationCode || !codeVerifier) {
        throw new Error("device auth endpoint returned an incomplete token response.");
      }
      return { authorizationCode, codeVerifier };
    }

    if (response.status !== 403 && response.status !== 404) {
      throw new Error(`device auth failed with status ${response.status}`);
    }

    await sleep(Math.max(1, deviceCode.intervalSeconds) * 1000, signal);
  }

  throw new Error("device auth timed out after 15 minutes");
}

function parseDeviceCodeInterval(value: unknown): number {
  const parsed = typeof value === "number"
    ? value
    : typeof value === "string"
      ? Number.parseInt(value.trim(), 10)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

async function exchangeCodeForTokens(
  redirectUri: string,
  codeVerifier: string,
  code: string,
  oauthFetchOptions?: OAuthFetchOptions,
): Promise<ExchangedCodexTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: CODEX_OAUTH_CLIENT_ID,
    code_verifier: codeVerifier,
  });
  const response = await oauthFetch(
    `${CODEX_OAUTH_ISSUER}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    },
    oauthFetchOptions,
  );
  if (!response.ok) {
    throw new Error(`token endpoint returned status ${response.status}: ${await response.text()}`);
  }
  const parsed = (await response.json()) as Partial<ExchangedCodexTokens>;
  if (!parsed.id_token || !parsed.access_token || !parsed.refresh_token) {
    throw new Error("token endpoint returned an incomplete Codex token response.");
  }
  return {
    id_token: parsed.id_token,
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
  };
}

async function exchangeDeviceAuthorizationForTokens(
  authorization: CodexDeviceAuthorization,
  oauthFetchOptions?: OAuthFetchOptions,
): Promise<ExchangedCodexTokens> {
  return exchangeCodeForTokens(
    `${CODEX_OAUTH_ISSUER}/deviceauth/callback`,
    authorization.codeVerifier,
    authorization.authorizationCode,
    oauthFetchOptions,
  );
}

async function obtainApiKey(
  idToken: string,
  oauthFetchOptions?: OAuthFetchOptions,
): Promise<string | null> {
  const body = new URLSearchParams({
    grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
    client_id: CODEX_OAUTH_CLIENT_ID,
    requested_token: "openai-api-key",
    subject_token: idToken,
    subject_token_type: "urn:ietf:params:oauth:token-type:id_token",
  });
  try {
    const response = await oauthFetch(
      `${CODEX_OAUTH_ISSUER}/oauth/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
      },
      oauthFetchOptions,
    );
    if (!response.ok) return null;
    const parsed = (await response.json()) as { access_token?: unknown };
    return typeof parsed.access_token === "string" && parsed.access_token.trim()
      ? parsed.access_token.trim()
      : null;
  } catch {
    return null;
  }
}

/**
 * Refresh the persisted Codex ChatGPT tokens via the OAuth refresh-token
 * grant and rewrite `auth.json`. Returns the refreshed auth env vars — this
 * backs the WASM build's `auth/refresh` host shim, invoked when the Codex
 * backend responds with 401.
 */
export async function refreshCodexAuth(
  options: RefreshCodexAuthOptions,
): Promise<Record<string, string>> {
  const { vfs } = options;
  if (!vfs.existsSync(CODEX_AUTH_PATH)) {
    throw new Error("Codex auth.json is missing; sign in to Codex again.");
  }
  const existing = JSON.parse(vfs.readFileSync(CODEX_AUTH_PATH, "utf8")) as {
    OPENAI_API_KEY?: unknown;
    tokens?: {
      id_token?: unknown;
      access_token?: unknown;
      refresh_token?: unknown;
    };
  };
  const refreshToken =
    typeof existing.tokens?.refresh_token === "string"
      ? existing.tokens.refresh_token.trim()
      : "";
  if (!refreshToken) {
    throw new Error("Codex auth.json has no refresh token; sign in to Codex again.");
  }

  const response = await oauthFetch(
    `${CODEX_OAUTH_ISSUER}/oauth/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: CODEX_OAUTH_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    },
    options.oauthFetchOptions,
  );
  if (!response.ok) {
    throw new Error(
      `Codex token refresh failed with status ${response.status}: ${await response.text()}`,
    );
  }
  const parsed = (await response.json()) as Partial<ExchangedCodexTokens>;
  const accessToken = typeof parsed.access_token === "string" ? parsed.access_token : "";
  if (!accessToken) {
    throw new Error("Codex token refresh response did not include an access token.");
  }
  const idToken =
    typeof parsed.id_token === "string" && parsed.id_token
      ? parsed.id_token
      : typeof existing.tokens?.id_token === "string"
        ? existing.tokens.id_token
        : "";
  if (!idToken) {
    throw new Error("Codex token refresh response did not include an id token.");
  }

  const apiKey =
    typeof existing.OPENAI_API_KEY === "string" && existing.OPENAI_API_KEY.trim()
      ? existing.OPENAI_API_KEY.trim()
      : undefined;
  return persistCodexAuth(
    vfs,
    {
      id_token: idToken,
      access_token: accessToken,
      refresh_token:
        typeof parsed.refresh_token === "string" && parsed.refresh_token
          ? parsed.refresh_token
          : refreshToken,
    },
    apiKey,
  );
}

function persistCodexAuth(
  vfs: CodexAuthVfs,
  tokens: ExchangedCodexTokens,
  apiKey?: string,
): Record<string, string> {
  const idToken = parseCodexIdToken(tokens.id_token);
  const auth = {
    auth_mode: "chatgpt",
    OPENAI_API_KEY: apiKey ?? null,
    tokens: {
      id_token: tokens.id_token,
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      account_id: idToken.chatgpt_account_id ?? null,
    },
    last_refresh: new Date().toISOString(),
  };
  vfs.mkdirSync(CODEX_AUTH_PATH.slice(0, CODEX_AUTH_PATH.lastIndexOf("/")), {
    recursive: true,
  });
  vfs.writeFileSync(CODEX_AUTH_PATH, `${JSON.stringify(auth, null, 2)}\n`);

  const env: Record<string, string> = {
    CODEX_ACCESS_TOKEN: tokens.access_token,
  };
  if (apiKey) {
    env.OPENAI_API_KEY = apiKey;
    env.CODEX_API_KEY = apiKey;
  }
  if (idToken.chatgpt_account_id) {
    env.CODEX_CHATGPT_ACCOUNT_ID = idToken.chatgpt_account_id;
  }
  if (idToken.chatgpt_account_is_fedramp) {
    env.CODEX_CHATGPT_ACCOUNT_IS_FEDRAMP = "true";
  }
  return env;
}

export function parseCodexIdToken(jwt: string): CodexIdTokenInfo {
  const claims = decodeJwtPayload(jwt) as {
    email?: unknown;
    "https://api.openai.com/profile"?: { email?: unknown };
    "https://api.openai.com/auth"?: CodexJwtAuthClaims;
  };
  const auth = claims["https://api.openai.com/auth"];
  const profile = claims["https://api.openai.com/profile"];
  const email =
    typeof claims.email === "string"
      ? claims.email
      : typeof profile?.email === "string"
        ? profile.email
        : undefined;
  return {
    email,
    raw_jwt: jwt,
    chatgpt_plan_type: auth?.chatgpt_plan_type,
    chatgpt_user_id: auth?.chatgpt_user_id ?? auth?.user_id,
    chatgpt_account_id: auth?.chatgpt_account_id,
    chatgpt_account_is_fedramp: auth?.chatgpt_account_is_fedramp === true,
  };
}

function decodeJwtPayload(jwt: string): unknown {
  const [, payload] = jwt.split(".");
  if (!payload) {
    throw new Error("invalid ID token format");
  }
  const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  if (typeof atob !== "function") {
    throw new Error("base64url decoding is unavailable in this browser.");
  }
  const decoded = atob(padded);
  return JSON.parse(decoded);
}

function formatCodexLoginError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
