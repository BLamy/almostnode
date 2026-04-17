import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';
import {
  DEFAULT_NEON_CLIENT_ID,
  DEFAULT_NEON_OAUTH_HOST,
  NEON_CALLBACK_REDIRECT_URI,
  buildDefaultNeonApiKeyName,
  buildNeonAuthorizationUrl,
  createNeonApiKey,
  createNeonPkcePair,
  deleteNeonApiKey,
  deleteNeonCredentials,
  deletePendingNeonAuthState,
  exchangeNeonAuthorizationCode,
  getDefaultNeonConfigDir,
  getNeonCredentialsPath,
  getNeonIdentityLabel,
  getNeonPendingAuthPath,
  normalizeNeonApiHost,
  normalizeNeonOauthHost,
  readPendingNeonAuthState,
  readNeonCredentials,
  refreshNeonCredentials,
  writePendingNeonAuthState,
  writeNeonCredentials,
  type NeonCredentials,
} from './neon-auth';

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
  return err('neon: command aborted\n', 130);
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DESKTOP_OAUTH_LOOPBACK_BRIDGE_KEY = Symbol.for(
  'almostnode.desktopOAuthLoopback',
);
const DESKTOP_NEON_SUCCESS_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Neon authentication complete</title>
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
      <h1>Neon authentication complete</h1>
      <p>You can close this window and return to almostnode.</p>
    </main>
  </body>
</html>`;
const NEON_DESKTOP_AUTH_TIMEOUT_MS = 180_000;

interface DesktopOAuthLoopbackBridge {
  createSession(input?: { callbackPath?: string }): Promise<{
    sessionId: string;
    redirectUri: string;
  }>;
  openExternal(input: { sessionId: string; url: string }): Promise<{ opened: true }>;
  waitForCallback(input: {
    sessionId: string;
    timeoutMs?: number;
    successHtml?: string;
  }): Promise<{ callbackUrl: string }>;
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

function parseCommonFlags(args: string[]): {
  options: {
    configDir?: string;
    apiHost?: string;
    oauthHost?: string;
    clientId?: string;
    apiKey?: string;
  };
  rest: string[];
  error?: string;
} {
  const options: {
    configDir?: string;
    apiHost?: string;
    oauthHost?: string;
    clientId?: string;
    apiKey?: string;
  } = {};
  let index = 0;

  while (index < args.length) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === '--config-dir') {
      if (!next) return { options, rest: [], error: 'missing value for --config-dir' };
      options.configDir = next;
      index += 2;
      continue;
    }
    if (arg.startsWith('--config-dir=')) {
      options.configDir = arg.slice('--config-dir='.length);
      index += 1;
      continue;
    }
    if (arg === '--api-host') {
      if (!next) return { options, rest: [], error: 'missing value for --api-host' };
      options.apiHost = next;
      index += 2;
      continue;
    }
    if (arg.startsWith('--api-host=')) {
      options.apiHost = arg.slice('--api-host='.length);
      index += 1;
      continue;
    }
    if (arg === '--oauth-host') {
      if (!next) return { options, rest: [], error: 'missing value for --oauth-host' };
      options.oauthHost = next;
      index += 2;
      continue;
    }
    if (arg.startsWith('--oauth-host=')) {
      options.oauthHost = arg.slice('--oauth-host='.length);
      index += 1;
      continue;
    }
    if (arg === '--client-id') {
      if (!next) return { options, rest: [], error: 'missing value for --client-id' };
      options.clientId = next;
      index += 2;
      continue;
    }
    if (arg.startsWith('--client-id=')) {
      options.clientId = arg.slice('--client-id='.length);
      index += 1;
      continue;
    }
    if (arg === '--api-key') {
      if (!next) return { options, rest: [], error: 'missing value for --api-key' };
      options.apiKey = next;
      index += 2;
      continue;
    }
    if (arg.startsWith('--api-key=')) {
      options.apiKey = arg.slice('--api-key='.length);
      index += 1;
      continue;
    }
    break;
  }

  return { options, rest: args.slice(index) };
}

function resolveCommonOptions(args: string[], ctx: CommandContext): {
  configDir: string;
  credentialsPath: string;
  pendingAuthPath: string;
  apiHost: string;
  oauthHost: string;
  clientId: string;
  apiKey: string | null;
  rest: string[];
  error?: string;
} {
  const parsed = parseCommonFlags(args);
  const env = envToRecord(ctx.env);
  const configDir = parsed.options.configDir?.trim()
    || getDefaultNeonConfigDir(env);

  return {
    configDir,
    credentialsPath: getNeonCredentialsPath(configDir),
    pendingAuthPath: getNeonPendingAuthPath(configDir),
    apiHost: normalizeNeonApiHost(parsed.options.apiHost || env.NEON_API_HOST),
    oauthHost: normalizeNeonOauthHost(parsed.options.oauthHost || env.NEON_OAUTH_HOST),
    clientId: parsed.options.clientId?.trim() || env.NEON_CLIENT_ID?.trim() || DEFAULT_NEON_CLIENT_ID,
    apiKey: parsed.options.apiKey?.trim() || env.NEON_API_KEY?.trim() || null,
    rest: parsed.rest,
    error: parsed.error,
  };
}

function parseCallbackUrl(rawInput: string, expectedState: string): URL {
  const trimmed = rawInput.trim();
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    if (trimmed.startsWith('/')) {
      parsed = new URL(trimmed, NEON_CALLBACK_REDIRECT_URI);
    } else if (trimmed.startsWith('?')) {
      parsed = new URL(`${NEON_CALLBACK_REDIRECT_URI}${trimmed}`);
    } else {
      throw new Error('Expected a full callback URL such as http://127.0.0.1:44555/callback?code=...');
    }
  }

  const returnedState = parsed.searchParams.get('state');
  if (!returnedState) {
    throw new Error('The pasted callback URL did not include a state parameter.');
  }
  if (returnedState !== expectedState) {
    throw new Error('The pasted callback URL did not match this Neon login request.');
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

function formatLoginSuccessMessage(credentials: NeonCredentials): string {
  const identity = getNeonIdentityLabel(credentials);
  return identity
    ? `Authentication complete.\nLogged in to Neon as ${identity}\nRun \`neon auth token\` for an OAuth bearer token or \`neon auth api-key create --name <name>\` for a long-lived personal API key.\n`
    : 'Authentication complete.\nLogged in to Neon.\nRun `neon auth token` for an OAuth bearer token or `neon auth api-key create --name <name>` for a long-lived personal API key.\n';
}

async function completePendingNeonLogin(
  vfs: VirtualFS,
  options: ReturnType<typeof resolveCommonOptions>,
  callbackUrlInput: string,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<NeonCredentials> {
  const pending = readPendingNeonAuthState(vfs, options.pendingAuthPath);
  if (!pending) {
    throw new Error(
      'No pending Neon browser login was found. Run `neon auth login` to start a new login flow.',
    );
  }

  const callbackUrl = parseCallbackUrl(callbackUrlInput, pending.state);
  const credentials = await exchangeNeonAuthorizationCode({
    oauthHost: pending.oauth_host || options.oauthHost,
    clientId: pending.client_id || options.clientId,
    code: callbackUrl.searchParams.get('code') || '',
    codeVerifier: pending.code_verifier,
    redirectUri: pending.redirect_uri || NEON_CALLBACK_REDIRECT_URI,
  });

  const withApiKey = await mintPersonalApiKey(credentials, options);

  writeNeonCredentials(vfs, withApiKey, options.credentialsPath);
  deletePendingNeonAuthState(vfs, options.pendingAuthPath);
  await persistKeychainState(keychain);
  return withApiKey;
}

async function mintPersonalApiKey(
  credentials: NeonCredentials,
  options: ReturnType<typeof resolveCommonOptions>,
): Promise<NeonCredentials> {
  if (credentials.personal_api_key || !credentials.access_token) {
    return credentials;
  }

  const keyName = buildDefaultNeonApiKeyName();
  try {
    const created = await createNeonApiKey(credentials.access_token, {
      apiHost: options.apiHost,
      keyName,
    });
    return {
      ...credentials,
      personal_api_key: created.key,
      personal_api_key_id: created.id != null ? String(created.id) : undefined,
      personal_api_key_name: created.name || keyName,
    };
  } catch {
    return credentials;
  }
}

function parseApiKeyCreateArgs(args: string[]): {
  keyName: string | null;
  callbackUrl: string | null;
  rest: string[];
  error?: string;
} {
  let keyName: string | null = null;
  let callbackUrl: string | null = null;
  let index = 0;

  while (index < args.length) {
    const arg = args[index];
    const next = args[index + 1];

    if (arg === '--name') {
      if (!next) return { keyName, callbackUrl, rest: [], error: 'missing value for --name' };
      keyName = next.trim();
      index += 2;
      continue;
    }
    if (arg.startsWith('--name=')) {
      keyName = arg.slice('--name='.length).trim();
      index += 1;
      continue;
    }
    if (arg === '--callback-url') {
      if (!next) return { keyName, callbackUrl, rest: [], error: 'missing value for --callback-url' };
      callbackUrl = next.trim();
      index += 2;
      continue;
    }
    if (arg.startsWith('--callback-url=')) {
      callbackUrl = arg.slice('--callback-url='.length).trim();
      index += 1;
      continue;
    }
    break;
  }

  return {
    keyName,
    callbackUrl,
    rest: args.slice(index),
  };
}

function buildDefaultApiKeyName(): string {
  const iso = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  return `almostnode-${iso}`;
}

async function resolveStoredNeonCredentials(
  vfs: VirtualFS,
  options: ReturnType<typeof resolveCommonOptions>,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<NeonCredentials | null> {
  if (options.apiKey) {
    return {
      access_token: options.apiKey,
      token_type: 'Bearer',
    };
  }

  const stored = readNeonCredentials(vfs, options.credentialsPath);
  if (!stored) {
    return null;
  }

  if (stored.access_token && typeof stored.expires_at === 'number' && stored.expires_at > Date.now()) {
    return stored;
  }

  if (!stored.refresh_token) {
    return stored.access_token ? stored : null;
  }

  const refreshed = await refreshNeonCredentials(stored, {
    oauthHost: options.oauthHost,
    clientId: options.clientId,
  });
  writeNeonCredentials(vfs, refreshed, options.credentialsPath);
  await persistKeychainState(keychain);
  return refreshed;
}

function buildHelpText(): string {
  return (
    'neon - Neon auth integration for almostnode\n\n' +
    'Commands:\n' +
    '  auth                         Start the browser login flow\n' +
    '  auth login                   Start the browser login flow\n' +
    '  auth complete <callback-url> Finish a pending browser login using the pasted callback URL\n' +
    '  auth logout                  Remove the saved Neon credentials\n' +
    '  auth token                   Print the current Neon bearer token\n' +
    '  auth whoami                  Show the current Neon identity\n' +
    '  auth status                  Show current Neon authentication status\n' +
    '  auth api-key create          Create and print a long-lived personal Neon API key\n' +
    '  login                        Alias for `auth login`\n' +
    '  logout                       Alias for `auth logout`\n' +
    '  me                           Alias for `auth whoami`\n\n' +
    'Notes:\n' +
    '  In the desktop runtime, almostnode can capture the localhost callback automatically.\n' +
    '  In the browser runtime, the flow mirrors neonctl OAuth, but almostnode cannot host the localhost callback.\n' +
    '  After signing in, copy the final http://127.0.0.1:44555/callback?... URL from the browser\n' +
    '  address bar and paste it back into the prompt, or finish it later with:\n' +
    '    neon auth complete "<callback-url>"\n'
  );
}

async function runLoginCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  if (signalAborted(ctx.signal)) {
    return abortResult();
  }

  const resolved = resolveCommonOptions(args, ctx);
  if (resolved.error) {
    return err(`neon auth login: ${resolved.error}\n`);
  }

  if (resolved.apiKey) {
    return ok('Using NEON_API_KEY from the environment or --api-key.\n');
  }

  const existing = readNeonCredentials(vfs, resolved.credentialsPath);
  if (existing?.refresh_token || existing?.access_token) {
    const identity = getNeonIdentityLabel(existing);
    return ok(
      identity
        ? `Already logged in to Neon as ${identity}\n  To re-authenticate, run: neon auth logout && neon auth login\n`
        : 'Already logged in to Neon.\n  To re-authenticate, run: neon auth logout && neon auth login\n',
    );
  }

  if (typeof window === 'undefined') {
    return err('Neon login requires a browser environment.\n');
  }

  const { codeVerifier, codeChallenge, state } = await createNeonPkcePair();
  const desktopLoopbackBridge = getDesktopOAuthLoopbackBridge();
  let redirectUri = NEON_CALLBACK_REDIRECT_URI;
  let desktopSessionId: string | null = null;

  if (desktopLoopbackBridge) {
    try {
      const session = await desktopLoopbackBridge.createSession({
        callbackPath: '/callback',
      });
      desktopSessionId = session.sessionId;
      redirectUri = session.redirectUri;
    } catch (error) {
      return err(`Neon login failed: ${formatErrorMessage(error)}\n`);
    }
  }

  const authUrl = buildNeonAuthorizationUrl({
    oauthHost: resolved.oauthHost,
    clientId: resolved.clientId,
    redirectUri,
    state,
    codeChallenge,
  });
  writePendingNeonAuthState(vfs, {
    state,
    code_verifier: codeVerifier,
    oauth_host: resolved.oauthHost,
    client_id: resolved.clientId,
    redirect_uri: redirectUri,
    created_at: Date.now(),
  }, resolved.pendingAuthPath);
  await persistKeychainState(keychain);

  if (desktopLoopbackBridge && desktopSessionId) {
    try {
      await desktopLoopbackBridge.openExternal({
        sessionId: desktopSessionId,
        url: authUrl,
      });
    } catch {
      try {
        window.open(authUrl, '_blank');
      } catch {
        // Ignore popup errors. The callback listener is already waiting.
      }
    }

    try {
      const { callbackUrl } = await desktopLoopbackBridge.waitForCallback({
        sessionId: desktopSessionId,
        timeoutMs: NEON_DESKTOP_AUTH_TIMEOUT_MS,
        successHtml: DESKTOP_NEON_SUCCESS_HTML,
      });
      const credentials = await completePendingNeonLogin(
        vfs,
        resolved,
        callbackUrl,
        keychain,
      );
      return ok(formatLoginSuccessMessage(credentials));
    } catch (error) {
      return err(
        'Neon login failed: '
        + `${formatErrorMessage(error)}\n`
        + 'If the browser already redirected, you can still finish manually with:\n'
        + '  neon auth complete "<callback-url>"\n',
      );
    }
  }

  try {
    window.open(authUrl, '_blank');
  } catch {
    // Ignore popup errors and fall back to the manual URL shown below.
  }

  try {
    if (typeof window.alert === 'function') {
      window.alert(
        'Finish the Neon login in the browser tab that just opened.\n\n' +
          'When Neon redirects to http://127.0.0.1:44555/callback and the page fails to load, ' +
          'copy the full URL from the address bar and paste it into the next prompt.\n\n' +
          `If the browser tab did not open, open this URL manually:\n${authUrl}`,
      );
    }
  } catch {
    // ignore alert failures
  }

  if (typeof window.prompt !== 'function') {
    return err('Neon login requires a browser prompt when desktop loopback is unavailable.\n');
  }

  const pastedCallback = window.prompt(
    'Paste the full Neon callback URL from the browser address bar after login completes:',
    '',
  );
  if (!pastedCallback?.trim()) {
    return err(
      'Neon login is waiting for the browser callback.\n' +
      'After Neon redirects to http://127.0.0.1:44555/callback, run:\n' +
      '  neon auth complete "<callback-url>"\n',
    );
  }

  try {
    const credentials = await completePendingNeonLogin(
      vfs,
      resolved,
      pastedCallback,
      keychain,
    );
    return ok(formatLoginSuccessMessage(credentials));
  } catch (error) {
    return err(`Neon login failed: ${formatErrorMessage(error)}\n`);
  }
}

async function runCompleteCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const resolved = resolveCommonOptions(args, ctx);
  if (resolved.error) {
    return err(`neon auth complete: ${resolved.error}\n`);
  }

  const callbackUrl = resolved.rest[0]?.trim()
    || (typeof window !== 'undefined' && typeof window.prompt === 'function'
      ? window.prompt(
        'Paste the full Neon callback URL from the browser address bar after login completes:',
        '',
      )?.trim()
      : '');
  if (!callbackUrl) {
    return err('neon auth complete: missing callback URL\n');
  }

  try {
    const credentials = await completePendingNeonLogin(vfs, resolved, callbackUrl, keychain);
    return ok(formatLoginSuccessMessage(credentials));
  } catch (error) {
    return err(`neon auth complete: ${formatErrorMessage(error)}\n`);
  }
}

async function runLogoutCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const resolved = resolveCommonOptions(args, ctx);
  if (resolved.error) {
    return err(`neon auth logout: ${resolved.error}\n`);
  }

  const existing = readNeonCredentials(vfs, resolved.credentialsPath);
  if (existing?.access_token && existing.personal_api_key_id) {
    try {
      await deleteNeonApiKey(existing.access_token, existing.personal_api_key_id, {
        apiHost: resolved.apiHost,
      });
    } catch {
      // Best-effort: leave the key if revocation fails so we don't block logout.
    }
  }

  const removed = deleteNeonCredentials(vfs, resolved.credentialsPath);
  const removedPending = deletePendingNeonAuthState(vfs, resolved.pendingAuthPath);
  if (removed || removedPending) {
    await persistKeychainState(keychain);
    return ok('Removed Neon login state.\n');
  }

  return ok('Neon is already logged out.\n');
}

async function runTokenCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const resolved = resolveCommonOptions(args, ctx);
  if (resolved.error) {
    return err(`neon auth token: ${resolved.error}\n`);
  }

  try {
    const credentials = await resolveStoredNeonCredentials(vfs, resolved, keychain);
    const token = credentials?.access_token?.trim();
    if (!token) {
      return err('Not authenticated. Run `neon auth login` first.\n');
    }
    return ok(`${token}\n`);
  } catch (error) {
    return err(`neon auth token: ${formatErrorMessage(error)}\n`);
  }
}

async function runWhoamiCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const resolved = resolveCommonOptions(args, ctx);
  if (resolved.error) {
    return err(`neon auth whoami: ${resolved.error}\n`);
  }

  if (resolved.apiKey) {
    return ok('Authenticated via NEON_API_KEY\n');
  }

  try {
    const credentials = await resolveStoredNeonCredentials(vfs, resolved, keychain);
    const identity = getNeonIdentityLabel(credentials);
    if (!credentials?.access_token) {
      return err('Not authenticated. Run `neon auth login` first.\n');
    }
    return ok(`${identity || 'authenticated'}\n`);
  } catch (error) {
    return err(`neon auth whoami: ${formatErrorMessage(error)}\n`);
  }
}

async function runStatusCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const resolved = resolveCommonOptions(args, ctx);
  if (resolved.error) {
    return err(`neon auth status: ${resolved.error}\n`);
  }

  if (resolved.apiKey) {
    return ok('Using NEON_API_KEY from the environment or --api-key.\n');
  }

  try {
    const credentials = await resolveStoredNeonCredentials(vfs, resolved, keychain);
    if (!credentials?.access_token) {
      return ok('Not logged in to Neon. Run `neon auth login` to authenticate.\n');
    }

    const identity = getNeonIdentityLabel(credentials);
    const expiresAt = typeof credentials.expires_at === 'number'
      ? new Date(credentials.expires_at)
      : null;
    const expiresLabel =
      expiresAt && !Number.isNaN(expiresAt.getTime())
        ? expiresAt.toLocaleString()
        : null;

    if (identity && expiresLabel) {
      return ok(`Logged in to Neon as ${identity} (token expires ${expiresLabel})\n`);
    }
    if (identity) {
      return ok(`Logged in to Neon as ${identity}\n`);
    }
    if (expiresLabel) {
      return ok(`Logged in to Neon (token expires ${expiresLabel})\n`);
    }
    return ok('Logged in to Neon\n');
  } catch (error) {
    return err(`neon auth status: ${formatErrorMessage(error)}\n`);
  }
}

async function runApiKeyCreateCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const resolved = resolveCommonOptions(args, ctx);
  if (resolved.error) {
    return err(`neon auth api-key create: ${resolved.error}\n`);
  }

  const parsed = parseApiKeyCreateArgs(resolved.rest);
  if (parsed.error) {
    return err(`neon auth api-key create: ${parsed.error}\n`);
  }
  if (parsed.rest.length > 0) {
    return err(`neon auth api-key create: unknown argument '${parsed.rest[0]}'\n`, 2);
  }

  try {
    if (parsed.callbackUrl) {
      await completePendingNeonLogin(vfs, resolved, parsed.callbackUrl, keychain);
    }

    const credentials = await resolveStoredNeonCredentials(vfs, resolved, keychain);
    const accessToken = credentials?.access_token?.trim();
    if (!accessToken) {
      return err(
        'Not authenticated. Run `neon auth login` first, or pass `--callback-url "<callback-url>"` if a login is already pending.\n',
      );
    }

    const keyName = parsed.keyName || buildDefaultApiKeyName();
    const created = await createNeonApiKey(accessToken, {
      apiHost: resolved.apiHost,
      keyName,
    });

    writeNeonCredentials(vfs, {
      ...credentials,
      personal_api_key: created.key,
      personal_api_key_id: created.id != null ? String(created.id) : undefined,
      personal_api_key_name: created.name || keyName,
    }, resolved.credentialsPath);
    await persistKeychainState(keychain);

    return ok(
      `Created Neon personal API key${created.name ? ` "${created.name}"` : ''}${created.id != null ? ` (${created.id})` : ''}.\n` +
      'Copy it now. Neon only returns the raw key once.\n' +
      `${created.key}\n`,
    );
  } catch (error) {
    return err(`neon auth api-key create: ${formatErrorMessage(error)}\n`);
  }
}

async function runApiKeyCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const [subcommand = 'create', ...rest] = args;

  switch (subcommand) {
    case 'create':
      return runApiKeyCreateCommand(rest, ctx, vfs, keychain);
    default:
      return err(`neon auth api-key: unknown command '${subcommand}'\n`, 2);
  }
}

async function runAuthCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const [subcommand = 'login', ...rest] = args;

  switch (subcommand) {
    case 'login':
      return runLoginCommand(rest, ctx, vfs, keychain);
    case 'complete':
      return runCompleteCommand(rest, ctx, vfs, keychain);
    case 'logout':
      return runLogoutCommand(rest, ctx, vfs, keychain);
    case 'token':
      return runTokenCommand(rest, ctx, vfs, keychain);
    case 'whoami':
      return runWhoamiCommand(rest, ctx, vfs, keychain);
    case 'status':
      return runStatusCommand(rest, ctx, vfs, keychain);
    case 'api-key':
      return runApiKeyCommand(rest, ctx, vfs, keychain);
    default:
      return err(`neon auth: unknown command '${subcommand}'\n`, 2);
  }
}

export async function runNeonCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  if (signalAborted(ctx.signal)) {
    return abortResult();
  }

  try {
    const [subcommand, ...rest] = args;

    switch (subcommand) {
      case undefined:
      case 'help':
      case '--help':
        return ok(buildHelpText());
      case 'auth':
        return runAuthCommand(rest, ctx, vfs, keychain);
      case 'login':
        return runLoginCommand(rest, ctx, vfs, keychain);
      case 'logout':
        return runLogoutCommand(rest, ctx, vfs, keychain);
      case 'me':
        return runWhoamiCommand(rest, ctx, vfs, keychain);
      case 'version':
      case '--version':
        return ok('neon v0.0.0-almostnode\n');
      default:
        return err(`neon: unknown command '${subcommand}'\n`, 2);
    }
  } catch (error) {
    if (signalAborted(ctx.signal)) {
      return abortResult();
    }
    return err(`neon: ${formatErrorMessage(error)}\n`);
  }
}
