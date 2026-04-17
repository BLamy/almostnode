import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';
import {
  buildWranglerAuthorizationUrl,
  cancelPreparedCloudflareAuthPopup,
  CloudflareAccount,
  createWranglerPkcePair,
  DEFAULT_CLOUDFLARE_API_BASE_URL,
  DEFAULT_CLOUDFLARE_AUTH_URL,
  DEFAULT_CLOUDFLARE_REVOKE_URL,
  DEFAULT_CLOUDFLARE_TOKEN_URL,
  DEFAULT_WRANGLER_CALLBACK_HOST,
  DEFAULT_WRANGLER_CALLBACK_PORT,
  DEFAULT_WRANGLER_CLIENT_ID,
  DEFAULT_WRANGLER_OAUTH_SCOPES,
  deletePendingWranglerAuthState,
  deleteWranglerAuthConfig,
  exchangeWranglerAuthorizationCode,
  fetchCloudflareAccounts,
  fetchCloudflareCurrentUser,
  isWranglerAccessTokenExpired,
  normalizeCloudflareApiBaseUrl,
  normalizeCloudflareAuthUrl,
  normalizeCloudflareRevokeUrl,
  normalizeCloudflareTokenUrl,
  openCloudflareAuthWindow,
  readPendingWranglerAuthState,
  readWranglerAuthConfig,
  refreshWranglerAccessToken,
  revokeWranglerRefreshToken,
  verifyCloudflareUserApiToken,
  WRANGLER_CALLBACK_PATH,
  WRANGLER_CALLBACK_URL,
  writePendingWranglerAuthState,
  writeWranglerAuthConfig,
} from './wrangler-auth';

const WRANGLER_VERSION = '4.83.0';
const WRANGLER_DESKTOP_AUTH_TIMEOUT_MS = 180_000;
const DESKTOP_OAUTH_LOOPBACK_BRIDGE_KEY = Symbol.for(
  'almostnode.desktopOAuthLoopback',
);
const DESKTOP_CLOUDFLARE_SUCCESS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Cloudflare authentication complete</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: #0f172a;
        color: #e2e8f0;
        font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      main {
        max-width: 32rem;
        padding: 2rem;
        text-align: center;
      }
      h1 {
        margin: 0 0 0.75rem;
        font-size: 1.5rem;
      }
      p {
        margin: 0;
        color: #cbd5e1;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Cloudflare authentication complete</h1>
      <p>You can close this window and return to almostnode.</p>
    </main>
  </body>
</html>`;

interface DesktopOAuthLoopbackBridge {
  createSession(input?: { callbackPath?: string; preferredPort?: number }): Promise<{
    redirectUri: string;
    sessionId: string;
  }>;
  openExternal(input: { sessionId: string; url: string }): Promise<{ opened: true }>;
  waitForCallback(input: {
    sessionId: string;
    successHtml?: string;
    timeoutMs?: number;
  }): Promise<{ callbackUrl: string }>;
}

interface WranglerResolvedOptions {
  apiUrl: string;
  authUrl: string;
  browser: boolean;
  callbackHost: string;
  callbackPort: number;
  clientId: string;
  rest: string[];
  revokeUrl: string;
  scopes: string[];
  scopesList: boolean;
  tokenUrl: string;
  error?: string;
}

type WranglerAuthSource =
  | { type: 'api_key'; apiKey: string; email: string }
  | { type: 'api_token'; token: string }
  | {
      type: 'oauth';
      expirationTime: string | null;
      refreshToken: string | null;
      scopes: string[];
      token: string;
    };

interface WranglerWhoamiResult {
  accounts: CloudflareAccount[];
  authType: 'Account API Token' | 'Global API Key' | 'OAuth Token' | 'User API Token';
  email: string | null;
  loggedIn: true;
  tokenPermissions: string[] | null;
}

function ok(stdout: string): JustBashExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function err(stderr: string, exitCode = 1): JustBashExecResult {
  return { stdout: '', stderr, exitCode };
}

function envToRecord(
  env: Map<string, string> | Record<string, string> | undefined,
): Record<string, string> {
  if (!env) {
    return {};
  }
  if (env instanceof Map) {
    return Object.fromEntries(env);
  }
  return env;
}

function signalAborted(signal?: AbortSignal): boolean {
  return signal?.aborted === true;
}

function abortResult(): JustBashExecResult {
  return err('wrangler: command aborted\n', 130);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parseBooleanFlagValue(value: string): boolean | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === 'true' || trimmed === '1' || trimmed === 'yes') {
    return true;
  }
  if (trimmed === 'false' || trimmed === '0' || trimmed === 'no') {
    return false;
  }
  return null;
}

function parsePortValue(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    return null;
  }
  return parsed;
}

function getDesktopOAuthLoopbackBridge(): DesktopOAuthLoopbackBridge | null {
  const candidate = (
    globalThis as typeof globalThis & {
      [DESKTOP_OAUTH_LOOPBACK_BRIDGE_KEY]?: DesktopOAuthLoopbackBridge;
    }
  )[DESKTOP_OAUTH_LOOPBACK_BRIDGE_KEY];

  if (!candidate) {
    return null;
  }
  if (
    typeof candidate.createSession !== 'function'
    || typeof candidate.openExternal !== 'function'
    || typeof candidate.waitForCallback !== 'function'
  ) {
    return null;
  }

  return candidate;
}

async function persistKeychainState(
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<void> {
  await keychain?.persistCurrentState().catch(() => {});
}

function parseCommonFlags(args: string[], ctx: CommandContext): WranglerResolvedOptions {
  const env = envToRecord(ctx.env);
  const scopes = [...DEFAULT_WRANGLER_OAUTH_SCOPES] as string[];
  let apiUrl = normalizeCloudflareApiBaseUrl(
    env.CLOUDFLARE_API_BASE_URL || DEFAULT_CLOUDFLARE_API_BASE_URL,
  );
  let authUrl = normalizeCloudflareAuthUrl(
    env.CLOUDFLARE_AUTH_URL || env.WRANGLER_AUTH_URL || DEFAULT_CLOUDFLARE_AUTH_URL,
  );
  let tokenUrl = normalizeCloudflareTokenUrl(
    env.CLOUDFLARE_TOKEN_URL || env.WRANGLER_TOKEN_URL || DEFAULT_CLOUDFLARE_TOKEN_URL,
  );
  let revokeUrl = normalizeCloudflareRevokeUrl(
    env.CLOUDFLARE_REVOKE_URL || env.WRANGLER_REVOKE_URL || DEFAULT_CLOUDFLARE_REVOKE_URL,
  );
  let clientId = env.CLOUDFLARE_OAUTH_CLIENT_ID?.trim()
    || env.WRANGLER_CLIENT_ID?.trim()
    || DEFAULT_WRANGLER_CLIENT_ID;
  let callbackHost = env.WRANGLER_CALLBACK_HOST?.trim() || DEFAULT_WRANGLER_CALLBACK_HOST;
  let callbackPort = parsePortValue(env.WRANGLER_CALLBACK_PORT) ?? DEFAULT_WRANGLER_CALLBACK_PORT;
  let browser = true;
  let scopesList = false;
  const rest: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === '--api-url') {
      if (!next) return { apiUrl, authUrl, tokenUrl, revokeUrl, clientId, callbackHost, callbackPort, browser, scopesList, scopes, rest: [], error: 'missing value for --api-url' };
      apiUrl = normalizeCloudflareApiBaseUrl(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--api-url=')) {
      apiUrl = normalizeCloudflareApiBaseUrl(arg.slice('--api-url='.length));
      continue;
    }
    if (arg === '--auth-url') {
      if (!next) return { apiUrl, authUrl, tokenUrl, revokeUrl, clientId, callbackHost, callbackPort, browser, scopesList, scopes, rest: [], error: 'missing value for --auth-url' };
      authUrl = normalizeCloudflareAuthUrl(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--auth-url=')) {
      authUrl = normalizeCloudflareAuthUrl(arg.slice('--auth-url='.length));
      continue;
    }
    if (arg === '--token-url') {
      if (!next) return { apiUrl, authUrl, tokenUrl, revokeUrl, clientId, callbackHost, callbackPort, browser, scopesList, scopes, rest: [], error: 'missing value for --token-url' };
      tokenUrl = normalizeCloudflareTokenUrl(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--token-url=')) {
      tokenUrl = normalizeCloudflareTokenUrl(arg.slice('--token-url='.length));
      continue;
    }
    if (arg === '--revoke-url') {
      if (!next) return { apiUrl, authUrl, tokenUrl, revokeUrl, clientId, callbackHost, callbackPort, browser, scopesList, scopes, rest: [], error: 'missing value for --revoke-url' };
      revokeUrl = normalizeCloudflareRevokeUrl(next);
      index += 1;
      continue;
    }
    if (arg.startsWith('--revoke-url=')) {
      revokeUrl = normalizeCloudflareRevokeUrl(arg.slice('--revoke-url='.length));
      continue;
    }
    if (arg === '--client-id') {
      if (!next) return { apiUrl, authUrl, tokenUrl, revokeUrl, clientId, callbackHost, callbackPort, browser, scopesList, scopes, rest: [], error: 'missing value for --client-id' };
      clientId = next.trim() || clientId;
      index += 1;
      continue;
    }
    if (arg.startsWith('--client-id=')) {
      clientId = arg.slice('--client-id='.length).trim() || clientId;
      continue;
    }
    if (arg === '--callback-host') {
      if (!next) return { apiUrl, authUrl, tokenUrl, revokeUrl, clientId, callbackHost, callbackPort, browser, scopesList, scopes, rest: [], error: 'missing value for --callback-host' };
      callbackHost = next.trim() || callbackHost;
      index += 1;
      continue;
    }
    if (arg.startsWith('--callback-host=')) {
      callbackHost = arg.slice('--callback-host='.length).trim() || callbackHost;
      continue;
    }
    if (arg === '--callback-port') {
      const parsed = parsePortValue(next);
      if (parsed == null) return { apiUrl, authUrl, tokenUrl, revokeUrl, clientId, callbackHost, callbackPort, browser, scopesList, scopes, rest: [], error: 'invalid --callback-port value' };
      callbackPort = parsed;
      index += 1;
      continue;
    }
    if (arg.startsWith('--callback-port=')) {
      const parsed = parsePortValue(arg.slice('--callback-port='.length));
      if (parsed == null) return { apiUrl, authUrl, tokenUrl, revokeUrl, clientId, callbackHost, callbackPort, browser, scopesList, scopes, rest: [], error: 'invalid --callback-port value' };
      callbackPort = parsed;
      continue;
    }
    if (arg === '--browser') {
      if (next && !next.startsWith('-')) {
        const parsed = parseBooleanFlagValue(next);
        if (parsed == null) {
          return { apiUrl, authUrl, tokenUrl, revokeUrl, clientId, callbackHost, callbackPort, browser, scopesList, scopes, rest: [], error: 'invalid value for --browser' };
        }
        browser = parsed;
        index += 1;
      } else {
        browser = true;
      }
      continue;
    }
    if (arg === '--no-browser') {
      browser = false;
      continue;
    }
    if (arg.startsWith('--browser=')) {
      const parsed = parseBooleanFlagValue(arg.slice('--browser='.length));
      if (parsed == null) {
        return { apiUrl, authUrl, tokenUrl, revokeUrl, clientId, callbackHost, callbackPort, browser, scopesList, scopes, rest: [], error: 'invalid value for --browser' };
      }
      browser = parsed;
      continue;
    }
    if (arg === '--scopes-list') {
      scopesList = true;
      continue;
    }
    if (arg === '--scopes') {
      if (!next) return { apiUrl, authUrl, tokenUrl, revokeUrl, clientId, callbackHost, callbackPort, browser, scopesList, scopes, rest: [], error: 'missing value for --scopes' };
      scopes.splice(0, scopes.length, ...next.split(/\s+/).map((value) => value.trim()).filter(Boolean));
      index += 1;
      continue;
    }
    if (arg.startsWith('--scopes=')) {
      scopes.splice(0, scopes.length, ...arg.slice('--scopes='.length).split(/\s+/).map((value) => value.trim()).filter(Boolean));
      continue;
    }

    rest.push(...args.slice(index));
    break;
  }

  return {
    apiUrl,
    authUrl,
    tokenUrl,
    revokeUrl,
    clientId,
    callbackHost,
    callbackPort,
    browser,
    scopesList,
    scopes,
    rest,
  };
}

function getAuthFromEnv(ctx: CommandContext): WranglerAuthSource | null {
  const env = envToRecord(ctx.env);
  const apiKey = env.CLOUDFLARE_API_KEY?.trim();
  const email = env.CLOUDFLARE_EMAIL?.trim();
  const apiToken = env.CLOUDFLARE_API_TOKEN?.trim();

  if (apiKey && email) {
    return {
      type: 'api_key',
      apiKey,
      email,
    };
  }

  if (apiToken) {
    return {
      type: 'api_token',
      token: apiToken,
    };
  }

  return null;
}

function parseCallbackUrl(rawInput: string, expectedState: string): URL {
  const trimmed = rawInput.trim();
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    if (trimmed.startsWith('/')) {
      parsed = new URL(trimmed, WRANGLER_CALLBACK_URL);
    } else if (trimmed.startsWith('?')) {
      parsed = new URL(`${WRANGLER_CALLBACK_URL}${trimmed}`);
    } else {
      throw new Error('Expected a full callback URL such as http://localhost:8976/oauth/callback?code=...');
    }
  }

  const returnedState = parsed.searchParams.get('state');
  if (!returnedState) {
    throw new Error('The pasted callback URL did not include a state parameter.');
  }
  if (returnedState !== expectedState) {
    throw new Error('The pasted callback URL did not match this Wrangler login request.');
  }

  const errorValue = parsed.searchParams.get('error');
  if (errorValue) {
    const description = parsed.searchParams.get('error_description');
    throw new Error(description || errorValue);
  }

  const code = parsed.searchParams.get('code');
  if (!code) {
    throw new Error('The pasted callback URL did not include an authorization code.');
  }

  return parsed;
}

function buildHelpText(): string {
  return (
    'wrangler - Cloudflare auth and local dev integration for almostnode\n\n' +
    'Supported commands:\n' +
    '  login                        Start the browser-based Cloudflare OAuth flow\n' +
    '  login complete <url>         Finish a pending login with the localhost callback URL\n' +
    '  logout                       Remove the saved Cloudflare auth state\n' +
    '  whoami [--json]              Show the current Cloudflare identity\n' +
    '  dev [entry]                  Run a local Workers-style dev server\n' +
    '  pages dev [dir]              Run a local Pages-style static dev server\n' +
    '  auth token [--json]          Print the current auth token details\n' +
    '  auth whoami [--json]         Alias for `wrangler whoami`\n' +
    '  auth login                   Alias for `wrangler login`\n' +
    '  auth logout                  Alias for `wrangler logout`\n' +
    '  auth complete <url>          Alias for `wrangler login complete`\n\n' +
    'Common flags:\n' +
    '      --api-url <url>          Override the Cloudflare API base URL\n' +
    '      --auth-url <url>         Override the Cloudflare OAuth authorization URL\n' +
    '      --token-url <url>        Override the Cloudflare OAuth token URL\n' +
    '      --revoke-url <url>       Override the Cloudflare OAuth revoke URL\n' +
    '      --client-id <id>         Override the Wrangler OAuth client id\n' +
    '      --browser[=bool]         Control whether login opens a browser window\n' +
    '      --callback-host <host>   Listener host for advanced/manual login flows\n' +
    '      --callback-port <port>   Listener port for advanced/manual login flows\n' +
    '      --scopes "<list>"        Override the OAuth scopes requested during login\n'
  );
}

function formatScopesList(scopes: readonly string[]): string {
  return `Available Wrangler OAuth scopes:\n${scopes.map((scope) => `- ${scope}`).join('\n')}\n`;
}

async function resolveStoredOauthAuth(
  vfs: VirtualFS,
  options: Pick<WranglerResolvedOptions, 'clientId' | 'tokenUrl'>,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<WranglerAuthSource | null> {
  const config = readWranglerAuthConfig(vfs);
  if (!config.accessToken && !config.refreshToken) {
    return null;
  }

  if (config.accessToken && !isWranglerAccessTokenExpired(config)) {
    return {
      type: 'oauth',
      token: config.accessToken,
      refreshToken: config.refreshToken,
      expirationTime: config.expirationTime,
      scopes: [...config.scopes],
    };
  }

  if (!config.refreshToken) {
    throw new Error('Stored Cloudflare OAuth credentials have expired. Run `wrangler login` again.');
  }

  const refreshed = await refreshWranglerAccessToken({
    clientId: options.clientId,
    refreshToken: config.refreshToken,
    tokenUrl: options.tokenUrl,
  });
  const scopes = refreshed.scopes.length > 0 ? refreshed.scopes : config.scopes;
  writeWranglerAuthConfig(vfs, {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expirationTime: refreshed.expirationTime,
    scopes,
  });
  await persistKeychainState(keychain);

  return {
    type: 'oauth',
    token: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expirationTime: refreshed.expirationTime,
    scopes,
  };
}

async function resolveAuthSource(
  vfs: VirtualFS,
  ctx: CommandContext,
  options: Pick<WranglerResolvedOptions, 'clientId' | 'tokenUrl'>,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<WranglerAuthSource | null> {
  return getAuthFromEnv(ctx) || resolveStoredOauthAuth(vfs, options, keychain);
}

async function resolveWhoami(
  vfs: VirtualFS,
  ctx: CommandContext,
  options: Pick<WranglerResolvedOptions, 'apiUrl' | 'clientId' | 'tokenUrl'>,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<WranglerWhoamiResult | null> {
  const auth = await resolveAuthSource(vfs, ctx, options, keychain);
  if (!auth) {
    return null;
  }

  if (auth.type === 'api_key') {
    const accounts = await fetchCloudflareAccounts(options.apiUrl, {
      apiKey: auth.apiKey,
      email: auth.email,
    });
    return {
      loggedIn: true,
      authType: 'Global API Key',
      email: auth.email,
      accounts,
      tokenPermissions: null,
    };
  }

  if (auth.type === 'api_token') {
    let authType: WranglerWhoamiResult['authType'] = 'User API Token';
    try {
      await verifyCloudflareUserApiToken(options.apiUrl, auth.token);
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code
        : null;
      if (code === 10000) {
        authType = 'Account API Token';
      } else {
        throw error;
      }
    }

    let email: string | null = null;
    try {
      email = (await fetchCloudflareCurrentUser(options.apiUrl, {
        apiToken: auth.token,
      })).email;
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? (error as { code?: unknown }).code
        : null;
      if (code !== 9109) {
        throw error;
      }
    }

    const accounts = await fetchCloudflareAccounts(options.apiUrl, {
      apiToken: auth.token,
    });
    return {
      loggedIn: true,
      authType,
      email,
      accounts,
      tokenPermissions: null,
    };
  }

  const user = await fetchCloudflareCurrentUser(options.apiUrl, {
    apiToken: auth.token,
  });
  const accounts = await fetchCloudflareAccounts(options.apiUrl, {
    apiToken: auth.token,
  });
  return {
    loggedIn: true,
    authType: 'OAuth Token',
    email: user.email,
    accounts,
    tokenPermissions: auth.scopes.length > 0 ? [...auth.scopes] : null,
  };
}

function formatWhoamiText(result: WranglerWhoamiResult): string {
  const lines: string[] = [];

  if (result.authType === 'Account API Token' && result.accounts[0]?.name) {
    lines.push(
      `You are logged in with an ${result.authType}, associated with the account ${result.accounts[0].name}.`,
    );
  } else if (result.email) {
    lines.push(
      `You are logged in with an ${result.authType}, associated with the email ${result.email}.`,
    );
  } else {
    lines.push(`You are logged in with an ${result.authType}.`);
  }

  if (result.accounts.length > 0) {
    lines.push('');
    lines.push('Accounts:');
    for (const account of result.accounts) {
      lines.push(`- ${account.name || '(unnamed)'} (${account.id})`);
    }
  }

  if (result.tokenPermissions && result.tokenPermissions.length > 0) {
    lines.push('');
    lines.push('Token Permissions:');
    for (const permission of result.tokenPermissions) {
      lines.push(`- ${permission}`);
    }
  }

  return `${lines.join('\n')}\n`;
}

function formatLoginInstructions(authUrl: string): string {
  return (
    `Open this URL in your browser to authorize Wrangler:\n${authUrl}\n\n` +
    `Cloudflare will redirect to ${WRANGLER_CALLBACK_URL}.\n` +
    'If that page fails to load, copy the full callback URL from the browser address bar and run:\n' +
    '  wrangler login complete "<callback-url>"\n'
  );
}

function formatLoginSuccessMessage(email: string | null): string {
  return email
    ? `Authentication complete.\nLogged in to Cloudflare as ${email}\n`
    : 'Authentication complete.\nLogged in to Cloudflare.\n';
}

async function completePendingWranglerLogin(
  vfs: VirtualFS,
  options: Pick<WranglerResolvedOptions, 'apiUrl' | 'clientId' | 'tokenUrl'>,
  callbackUrlInput: string,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<{ email: string | null }> {
  const pending = readPendingWranglerAuthState(vfs);
  if (!pending) {
    throw new Error(
      'No pending Wrangler browser login was found. Run `wrangler login` to start a new login flow.',
    );
  }

  const callbackUrl = parseCallbackUrl(callbackUrlInput, pending.state);
  const exchange = await exchangeWranglerAuthorizationCode({
    clientId: pending.clientId || options.clientId,
    code: callbackUrl.searchParams.get('code') || '',
    codeVerifier: pending.codeVerifier,
    redirectUri: pending.redirectUri || WRANGLER_CALLBACK_URL,
    tokenUrl: pending.tokenUrl || options.tokenUrl,
  });

  writeWranglerAuthConfig(vfs, {
    accessToken: exchange.accessToken,
    refreshToken: exchange.refreshToken,
    expirationTime: exchange.expirationTime,
    scopes: exchange.scopes.length > 0 ? exchange.scopes : pending.scopes,
  });
  deletePendingWranglerAuthState(vfs);
  await persistKeychainState(keychain);

  let email: string | null = null;
  try {
    email = (await fetchCloudflareCurrentUser(options.apiUrl, {
      apiToken: exchange.accessToken,
    })).email;
  } catch {
    // Ignore identity lookup failures after the token is saved.
  }

  return { email };
}

async function runLoginCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const resolved = parseCommonFlags(args, ctx);
  if (resolved.error) {
    cancelPreparedCloudflareAuthPopup();
    return err(`wrangler login: ${resolved.error}\n`);
  }

  if (resolved.scopesList) {
    return ok(formatScopesList(resolved.scopes));
  }

  const envAuth = getAuthFromEnv(ctx);
  if (envAuth?.type === 'api_token') {
    cancelPreparedCloudflareAuthPopup();
    return ok(
      'Using CLOUDFLARE_API_TOKEN from the environment. Unset it to log in via OAuth.\n',
    );
  }
  if (envAuth?.type === 'api_key') {
    cancelPreparedCloudflareAuthPopup();
    return ok(
      'Using CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL from the environment. Unset them to log in via OAuth.\n',
    );
  }

  try {
    const existing = await resolveStoredOauthAuth(vfs, resolved, keychain);
    if (existing) {
      const identity = await resolveWhoami(vfs, ctx, resolved, keychain).catch(() => null);
      return ok(
        identity?.email
          ? `Already logged in to Cloudflare as ${identity.email}\n  To re-authenticate, run: wrangler logout && wrangler login\n`
          : 'Already logged in to Cloudflare.\n  To re-authenticate, run: wrangler logout && wrangler login\n',
      );
    }
  } catch (error) {
    deleteWranglerAuthConfig(vfs);
    deletePendingWranglerAuthState(vfs);
    await persistKeychainState(keychain);
    return err(`wrangler login: ${formatErrorMessage(error)}\n`);
  }

  const { codeVerifier, codeChallenge, state } = await createWranglerPkcePair();
  const authUrl = buildWranglerAuthorizationUrl({
    authUrl: resolved.authUrl,
    clientId: resolved.clientId,
    codeChallenge,
    scopes: resolved.scopes,
    state,
  });

  writePendingWranglerAuthState(vfs, {
    authUrl: resolved.authUrl,
    clientId: resolved.clientId,
    codeVerifier,
    createdAt: Date.now(),
    redirectUri: WRANGLER_CALLBACK_URL,
    scopes: resolved.scopes,
    state,
    tokenUrl: resolved.tokenUrl,
  });
  await persistKeychainState(keychain);

  const desktopLoopbackBridge = getDesktopOAuthLoopbackBridge();
  const canAutoCaptureDesktopCallback = resolved.browser
    && resolved.callbackPort === DEFAULT_WRANGLER_CALLBACK_PORT
    && (resolved.callbackHost === 'localhost' || resolved.callbackHost === '127.0.0.1')
    && desktopLoopbackBridge;

  if (canAutoCaptureDesktopCallback && desktopLoopbackBridge) {
    let sessionId: string | null = null;
    try {
      const session = await desktopLoopbackBridge.createSession({
        callbackPath: WRANGLER_CALLBACK_PATH,
        preferredPort: DEFAULT_WRANGLER_CALLBACK_PORT,
      });
      sessionId = session.sessionId;
      await desktopLoopbackBridge.openExternal({
        sessionId,
        url: authUrl,
      });
      const { callbackUrl } = await desktopLoopbackBridge.waitForCallback({
        sessionId,
        timeoutMs: WRANGLER_DESKTOP_AUTH_TIMEOUT_MS,
        successHtml: DESKTOP_CLOUDFLARE_SUCCESS_HTML,
      });
      const completed = await completePendingWranglerLogin(
        vfs,
        resolved,
        callbackUrl,
        keychain,
      );
      return ok(formatLoginSuccessMessage(completed.email));
    } catch (error) {
      if (signalAborted(ctx.signal)) {
        return abortResult();
      }
      return err(
        `Cloudflare login failed: ${formatErrorMessage(error)}\n` +
        formatLoginInstructions(authUrl),
      );
    }
  }

  if (!resolved.browser) {
    return ok(formatLoginInstructions(authUrl));
  }

  if (typeof window === 'undefined') {
    return err(
      'wrangler login requires a browser environment. Re-run with `--browser=false` to print the login URL.\n',
    );
  }

  openCloudflareAuthWindow(authUrl);

  try {
    if (typeof window.alert === 'function') {
      window.alert(
        'Finish the Cloudflare login in the browser tab that just opened.\n\n' +
        `Cloudflare will redirect to ${WRANGLER_CALLBACK_URL}.\n` +
        'When that page fails to load, copy the full callback URL from the browser address bar and paste it into the next prompt.\n\n' +
        `If the browser tab did not open, open this URL manually:\n${authUrl}`,
      );
    }
  } catch {
    // Ignore alert failures and continue with manual completion.
  }

  if (typeof window.prompt !== 'function') {
    return ok(formatLoginInstructions(authUrl));
  }

  const pastedCallback = window.prompt(
    'Paste the full Cloudflare callback URL from the browser address bar after login completes:',
    '',
  );

  if (!pastedCallback?.trim()) {
    return ok(formatLoginInstructions(authUrl));
  }

  try {
    const completed = await completePendingWranglerLogin(
      vfs,
      resolved,
      pastedCallback,
      keychain,
    );
    return ok(formatLoginSuccessMessage(completed.email));
  } catch (error) {
    return err(`Cloudflare login failed: ${formatErrorMessage(error)}\n`);
  }
}

async function runCompleteCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const resolved = parseCommonFlags(args, ctx);
  if (resolved.error) {
    return err(`wrangler login complete: ${resolved.error}\n`);
  }

  const callbackUrl = resolved.rest[0]?.trim()
    || (typeof window !== 'undefined' && typeof window.prompt === 'function'
      ? window.prompt(
        'Paste the full Cloudflare callback URL from the browser address bar after login completes:',
        '',
      )?.trim()
      : '');
  if (!callbackUrl) {
    return err('wrangler login complete: missing callback URL\n');
  }

  try {
    const completed = await completePendingWranglerLogin(
      vfs,
      resolved,
      callbackUrl,
      keychain,
    );
    return ok(formatLoginSuccessMessage(completed.email));
  } catch (error) {
    return err(`wrangler login complete: ${formatErrorMessage(error)}\n`);
  }
}

async function runLogoutCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const resolved = parseCommonFlags(args, ctx);
  if (resolved.error) {
    return err(`wrangler logout: ${resolved.error}\n`);
  }

  const envAuth = getAuthFromEnv(ctx);
  const config = readWranglerAuthConfig(vfs);
  if (config.refreshToken) {
    await revokeWranglerRefreshToken({
      clientId: resolved.clientId,
      refreshToken: config.refreshToken,
      revokeUrl: resolved.revokeUrl,
    });
  }

  const removed = deleteWranglerAuthConfig(vfs);
  const removedPending = deletePendingWranglerAuthState(vfs);
  if (removed || removedPending) {
    await persistKeychainState(keychain);
  }

  if (envAuth?.type === 'api_token') {
    return ok(
      removed || removedPending
        ? 'Removed saved Cloudflare login state. CLOUDFLARE_API_TOKEN is still set in the environment.\n'
        : 'CLOUDFLARE_API_TOKEN is still set in the environment. Unset it to log out completely.\n',
    );
  }
  if (envAuth?.type === 'api_key') {
    return ok(
      removed || removedPending
        ? 'Removed saved Cloudflare login state. CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL are still set in the environment.\n'
        : 'CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL are still set in the environment. Unset them to log out completely.\n',
    );
  }

  if (removed || removedPending) {
    return ok('Successfully logged out.\n');
  }

  return ok('Not logged in, exiting...\n');
}

async function runWhoamiCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const resolved = parseCommonFlags(args, ctx);
  if (resolved.error) {
    return err(`wrangler whoami: ${resolved.error}\n`);
  }

  let json = false;
  for (const arg of resolved.rest) {
    if (arg === '--json') {
      json = true;
      continue;
    }
    return err(`wrangler whoami: unknown argument '${arg}'\n`);
  }

  try {
    const whoami = await resolveWhoami(vfs, ctx, resolved, keychain);
    if (!whoami) {
      if (json) {
        return { stdout: `${JSON.stringify({ loggedIn: false }, null, 2)}\n`, stderr: '', exitCode: 1 };
      }
      return err('You are not authenticated. Please run `wrangler login`.\n');
    }

    if (json) {
      return ok(`${JSON.stringify(whoami, null, 2)}\n`);
    }

    return ok(formatWhoamiText(whoami));
  } catch (error) {
    return err(`wrangler whoami: ${formatErrorMessage(error)}\n`);
  }
}

async function runTokenCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const resolved = parseCommonFlags(args, ctx);
  if (resolved.error) {
    return err(`wrangler auth token: ${resolved.error}\n`);
  }

  let json = false;
  for (const arg of resolved.rest) {
    if (arg === '--json') {
      json = true;
      continue;
    }
    return err(`wrangler auth token: unknown argument '${arg}'\n`);
  }

  try {
    const auth = await resolveAuthSource(vfs, ctx, resolved, keychain);
    if (!auth) {
      return err('Not logged in. Please run `wrangler login` to authenticate.\n');
    }

    if (auth.type === 'api_key') {
      const payload = {
        type: 'api_key',
        key: auth.apiKey,
        email: auth.email,
      };
      if (json) {
        return ok(`${JSON.stringify(payload, null, 2)}\n`);
      }
      return err(
        'Cannot output a single token when using CLOUDFLARE_API_KEY and CLOUDFLARE_EMAIL.\n' +
        'Use --json to get both key and email, or use CLOUDFLARE_API_TOKEN instead.\n',
      );
    }

    const payload = auth.type === 'api_token'
      ? { type: 'api_token', token: auth.token }
      : { type: 'oauth', token: auth.token };

    if (json) {
      return ok(`${JSON.stringify(payload, null, 2)}\n`);
    }

    return ok(`${payload.token}\n`);
  } catch (error) {
    return err(`wrangler auth token: ${formatErrorMessage(error)}\n`);
  }
}

export async function runWranglerCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  if (signalAborted(ctx.signal)) {
    return abortResult();
  }

  const firstArg = args[0];
  if (!firstArg || firstArg === 'help' || firstArg === '--help' || firstArg === '-h') {
    return ok(buildHelpText());
  }

  if (firstArg === '--version' || firstArg === '-v' || firstArg === 'version') {
    return ok(`${WRANGLER_VERSION}\n`);
  }

  if (firstArg === 'login') {
    if (args[1] === 'complete') {
      return runCompleteCommand(args.slice(2), ctx, vfs, keychain);
    }
    return runLoginCommand(args.slice(1), ctx, vfs, keychain);
  }

  if (firstArg === 'logout') {
    return runLogoutCommand(args.slice(1), ctx, vfs, keychain);
  }

  if (firstArg === 'whoami') {
    return runWhoamiCommand(args.slice(1), ctx, vfs, keychain);
  }

  if (firstArg === 'auth') {
    const authCommand = args[1];
    if (!authCommand || authCommand === 'help' || authCommand === '--help' || authCommand === '-h') {
      return ok(buildHelpText());
    }
    if (authCommand === 'token') {
      return runTokenCommand(args.slice(2), ctx, vfs, keychain);
    }
    if (authCommand === 'whoami') {
      return runWhoamiCommand(args.slice(2), ctx, vfs, keychain);
    }
    if (authCommand === 'login') {
      return runLoginCommand(args.slice(2), ctx, vfs, keychain);
    }
    if (authCommand === 'logout') {
      return runLogoutCommand(args.slice(2), ctx, vfs, keychain);
    }
    if (authCommand === 'complete') {
      return runCompleteCommand(args.slice(2), ctx, vfs, keychain);
    }
    return err(`wrangler auth: unsupported subcommand '${authCommand}'\n`);
  }

  if (firstArg === 'dev' || firstArg === 'pages') {
    return err(
      `wrangler ${args.join(' ')} is handled by the builtin dev-server integration and should not be delegated here.\n`,
    );
  }

  return err(`wrangler: unsupported command '${args.join(' ')}'\n`);
}
