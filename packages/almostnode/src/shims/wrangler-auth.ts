import { getDefaultNetworkController, networkFetch } from '../network';
import type { VirtualFS } from '../virtual-fs';
import * as path from './path';

export const DEFAULT_CLOUDFLARE_API_BASE_URL = 'https://api.cloudflare.com/client/v4';
export const DEFAULT_CLOUDFLARE_AUTH_URL = 'https://dash.cloudflare.com/oauth2/auth';
export const DEFAULT_CLOUDFLARE_TOKEN_URL = 'https://dash.cloudflare.com/oauth2/token';
export const DEFAULT_CLOUDFLARE_REVOKE_URL = 'https://dash.cloudflare.com/oauth2/revoke';
export const DEFAULT_WRANGLER_CLIENT_ID = '54d11594-84e4-41aa-b438-e81b8fa78ee7';
export const DEFAULT_WRANGLER_CALLBACK_HOST = 'localhost';
export const DEFAULT_WRANGLER_CALLBACK_PORT = 8976;
export const WRANGLER_CALLBACK_PATH = '/oauth/callback';
export const WRANGLER_CALLBACK_URL = `http://${DEFAULT_WRANGLER_CALLBACK_HOST}:${DEFAULT_WRANGLER_CALLBACK_PORT}${WRANGLER_CALLBACK_PATH}`;
export const WRANGLER_LEGACY_AUTH_CONFIG_PATH = '/home/user/.wrangler/config/default.toml';
export const WRANGLER_AUTH_CONFIG_PATH = '/home/user/.config/.wrangler/config/default.toml';

export const DEFAULT_WRANGLER_OAUTH_SCOPES = [
  'account:read',
  'user:read',
  'workers:write',
  'workers_kv:write',
  'workers_routes:write',
  'workers_scripts:write',
  'workers_tail:read',
  'd1:write',
  'pages:write',
  'zone:read',
  'ssl_certs:write',
  'ai:write',
  'ai-search:write',
  'ai-search:run',
  'queues:write',
  'pipelines:write',
  'secrets_store:write',
  'artifacts:write',
  'flagship:write',
  'containers:write',
  'cloudchamber:write',
  'connectivity:admin',
  'email_routing:write',
  'email_sending:write',
  'browser:write',
] as const;

export interface WranglerAuthConfig {
  accessToken: string | null;
  expirationTime: string | null;
  path: string | null;
  rawText: string;
  refreshToken: string | null;
  scopes: string[];
}

export interface PendingWranglerAuthState {
  authUrl: string;
  clientId: string;
  codeVerifier: string;
  createdAt: number;
  redirectUri: string;
  scopes: string[];
  state: string;
  tokenUrl: string;
}

export interface CloudflareApiErrorShape {
  code?: number;
  message?: string;
}

export interface CloudflareUser {
  email: string | null;
  id: string | null;
  name: string | null;
}

export interface CloudflareAccount {
  id: string;
  name: string;
}

export interface CloudflareTokenVerification {
  expiresOn: string | null;
  id: string | null;
  notBefore: string | null;
  status: string | null;
}

export type CloudflareAuthHeaders =
  | { apiToken: string }
  | { apiKey: string; email: string };

let preparedCloudflareAuthPopup: Window | null = null;

interface CloudflareEnvelope<T> {
  errors?: CloudflareApiErrorShape[];
  messages?: Array<{ code?: number; message?: string }>;
  result?: T;
  success?: boolean;
}

function withDefaultController() {
  return getDefaultNetworkController();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function coerceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function ensureParentDir(vfs: VirtualFS, filePath: string): void {
  const parent = path.dirname(filePath);
  if (!vfs.existsSync(parent)) {
    vfs.mkdirSync(parent, { recursive: true });
  }
}

function parseTomlString(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    if (trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed.slice(1, -1);
      }
    }
    return trimmed.slice(1, -1).replace(/''/g, '\'');
  }
  return trimmed;
}

function splitTomlArrayItems(rawValue: string): string[] {
  const trimmed = rawValue.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return [];
  }

  const items: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;
  let escaped = false;

  for (const char of trimmed.slice(1, -1)) {
    if (quote) {
      current += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      current += char;
      continue;
    }

    if (char === ',') {
      if (current.trim()) {
        items.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    items.push(current.trim());
  }

  return items;
}

function readTomlKey(rawText: string, key: string): string | null {
  const matcher = new RegExp(`^${key}\\s*=\\s*(.+?)\\s*$`, 'm');
  const match = rawText.match(matcher);
  if (!match) {
    return null;
  }
  return match[1] ?? null;
}

function getWranglerAuthCandidatePaths(): readonly string[] {
  return [WRANGLER_LEGACY_AUTH_CONFIG_PATH, WRANGLER_AUTH_CONFIG_PATH];
}

function getPendingAuthCandidatePaths(): readonly string[] {
  return [
    path.join(path.dirname(WRANGLER_LEGACY_AUTH_CONFIG_PATH), 'pending-login.json'),
    path.join(path.dirname(WRANGLER_AUTH_CONFIG_PATH), 'pending-login.json'),
  ];
}

function readRawTextFile(vfs: VirtualFS, filePath: string): string {
  if (!vfs.existsSync(filePath)) {
    return '';
  }

  try {
    return String(vfs.readFileSync(filePath, 'utf8'));
  } catch {
    return '';
  }
}

function writePendingAuthStateFile(
  vfs: VirtualFS,
  state: PendingWranglerAuthState,
  filePath: string,
): void {
  ensureParentDir(vfs, filePath);
  vfs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}

function readPendingAuthStateFile(
  vfs: VirtualFS,
  filePath: string,
): PendingWranglerAuthState | null {
  if (!vfs.existsSync(filePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(vfs.readFileSync(filePath, 'utf8'));
    if (!isRecord(parsed)) {
      return null;
    }

    const state = coerceString(parsed.state);
    const codeVerifier = coerceString(parsed.codeVerifier);
    const clientId = coerceString(parsed.clientId);
    const redirectUri = coerceString(parsed.redirectUri);
    const authUrl = coerceString(parsed.authUrl);
    const tokenUrl = coerceString(parsed.tokenUrl);
    const createdAt = typeof parsed.createdAt === 'number' && Number.isFinite(parsed.createdAt)
      ? parsed.createdAt
      : Date.now();
    const scopes = Array.isArray(parsed.scopes)
      ? parsed.scopes.map((scope) => coerceString(scope)).filter(Boolean) as string[]
      : [];

    if (!state || !codeVerifier || !clientId || !redirectUri || !authUrl || !tokenUrl) {
      return null;
    }

    return {
      state,
      codeVerifier,
      clientId,
      redirectUri,
      authUrl,
      tokenUrl,
      createdAt,
      scopes,
    };
  } catch {
    return null;
  }
}

function getCloudflareHeaders(auth: CloudflareAuthHeaders, headers?: HeadersInit): Headers {
  const next = new Headers(headers);
  if ('apiToken' in auth) {
    next.set('authorization', `Bearer ${auth.apiToken.trim()}`);
  } else {
    next.set('x-auth-key', auth.apiKey.trim());
    next.set('x-auth-email', auth.email.trim());
  }
  return next;
}

function createCloudflareApiError(
  fallbackMessage: string,
  error?: CloudflareApiErrorShape | null,
): Error & { code?: number } {
  const message = error?.message?.trim() || fallbackMessage;
  const next = new Error(message) as Error & { code?: number };
  if (typeof error?.code === 'number') {
    next.code = error.code;
  }
  return next;
}

async function cloudflareFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return networkFetch(url, init, withDefaultController());
}

async function readCloudflareEnvelopeError(
  response: Response,
  fallbackMessage: string,
): Promise<Error & { code?: number }> {
  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const parsed = await response.json() as unknown;
      if (isRecord(parsed)) {
        const envelope = parsed as CloudflareEnvelope<unknown>;
        const firstError = Array.isArray(envelope.errors) ? envelope.errors[0] : null;
        if (firstError) {
          return createCloudflareApiError(fallbackMessage, firstError);
        }
        if (typeof parsed.message === 'string' && parsed.message.trim()) {
          return createCloudflareApiError(`${fallbackMessage}: ${parsed.message.trim()}`);
        }
      }
    } else {
      const text = (await response.text()).trim();
      if (text) {
        return createCloudflareApiError(`${fallbackMessage}: ${text}`);
      }
    }
  } catch {
    // Ignore envelope parsing errors and fall through to a generic message.
  }

  return createCloudflareApiError(`${fallbackMessage}: ${response.status} ${response.statusText}`);
}

async function cloudflareApiFetchResult<T>(
  apiBaseUrl: string,
  pathname: string,
  auth: CloudflareAuthHeaders,
): Promise<T> {
  const response = await cloudflareFetch(
    `${normalizeCloudflareApiBaseUrl(apiBaseUrl)}${pathname.startsWith('/') ? pathname : `/${pathname}`}`,
    {
      headers: getCloudflareHeaders(auth),
    },
  );

  const contentType = response.headers.get('content-type') ?? '';
  const parsed = contentType.includes('application/json')
    ? await response.json() as CloudflareEnvelope<T>
    : null;

  if (!response.ok) {
    throw await readCloudflareEnvelopeError(response, `${pathname} failed`);
  }

  if (!parsed || parsed.success === false || parsed.result === undefined) {
    throw createCloudflareApiError(
      `${pathname} returned an invalid response`,
      parsed?.errors?.[0],
    );
  }

  return parsed.result;
}

function encodeBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomToken(length = 64): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let output = '';

  for (const byte of bytes) {
    output += alphabet[byte % alphabet.length];
  }

  return output;
}

export function normalizeCloudflareApiBaseUrl(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_CLOUDFLARE_API_BASE_URL;
  }
  return trimmed.replace(/\/+$/, '') || DEFAULT_CLOUDFLARE_API_BASE_URL;
}

export function normalizeCloudflareAuthUrl(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_CLOUDFLARE_AUTH_URL;
  }
  return trimmed.replace(/\/+$/, '') || DEFAULT_CLOUDFLARE_AUTH_URL;
}

export function normalizeCloudflareTokenUrl(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_CLOUDFLARE_TOKEN_URL;
  }
  return trimmed.replace(/\/+$/, '') || DEFAULT_CLOUDFLARE_TOKEN_URL;
}

export function normalizeCloudflareRevokeUrl(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_CLOUDFLARE_REVOKE_URL;
  }
  return trimmed.replace(/\/+$/, '') || DEFAULT_CLOUDFLARE_REVOKE_URL;
}

export function readWranglerAuthConfig(vfs: VirtualFS): WranglerAuthConfig {
  for (const filePath of getWranglerAuthCandidatePaths()) {
    if (!vfs.existsSync(filePath)) {
      continue;
    }

    const rawText = readRawTextFile(vfs, filePath);
    const accessToken = coerceString(parseTomlString(readTomlKey(rawText, 'oauth_token') ?? ''));
    const refreshToken = coerceString(parseTomlString(readTomlKey(rawText, 'refresh_token') ?? ''));
    const expirationTime = coerceString(parseTomlString(readTomlKey(rawText, 'expiration_time') ?? ''));
    const scopesRaw = readTomlKey(rawText, 'scopes');
    const scopes = scopesRaw
      ? splitTomlArrayItems(scopesRaw).map(parseTomlString).map((scope) => scope.trim()).filter(Boolean)
      : [];

    return {
      accessToken,
      refreshToken,
      expirationTime,
      scopes,
      path: filePath,
      rawText,
    };
  }

  return {
    accessToken: null,
    refreshToken: null,
    expirationTime: null,
    scopes: [],
    path: null,
    rawText: '',
  };
}

export function getPreferredWranglerAuthConfigPath(vfs: VirtualFS): string {
  if (vfs.existsSync(WRANGLER_LEGACY_AUTH_CONFIG_PATH)) {
    return WRANGLER_LEGACY_AUTH_CONFIG_PATH;
  }
  return WRANGLER_AUTH_CONFIG_PATH;
}

export function getPreferredWranglerPendingAuthPath(vfs: VirtualFS): string {
  return path.join(
    path.dirname(getPreferredWranglerAuthConfigPath(vfs)),
    'pending-login.json',
  );
}

export function writeWranglerAuthConfig(
  vfs: VirtualFS,
  input: {
    accessToken: string;
    expirationTime?: string | null;
    refreshToken?: string | null;
    scopes?: readonly string[];
  },
): void {
  const filePath = getPreferredWranglerAuthConfigPath(vfs);
  const lines = [
    `oauth_token = ${JSON.stringify(input.accessToken.trim())}`,
    input.refreshToken?.trim()
      ? `refresh_token = ${JSON.stringify(input.refreshToken.trim())}`
      : null,
    input.expirationTime?.trim()
      ? `expiration_time = ${JSON.stringify(input.expirationTime.trim())}`
      : null,
    `scopes = ${JSON.stringify([...(input.scopes ?? [])])}`,
    '',
  ].filter((line): line is string => line !== null);

  ensureParentDir(vfs, filePath);
  vfs.writeFileSync(filePath, lines.join('\n'));
}

export function deleteWranglerAuthConfig(vfs: VirtualFS): boolean {
  let removed = false;

  for (const filePath of getWranglerAuthCandidatePaths()) {
    if (!vfs.existsSync(filePath)) {
      continue;
    }
    try {
      vfs.unlinkSync(filePath);
      removed = true;
    } catch {
      // Ignore unlink failures and continue trying the remaining paths.
    }
  }

  return removed;
}

export function writePendingWranglerAuthState(
  vfs: VirtualFS,
  state: PendingWranglerAuthState,
): void {
  writePendingAuthStateFile(vfs, state, getPreferredWranglerPendingAuthPath(vfs));
}

export function readPendingWranglerAuthState(vfs: VirtualFS): PendingWranglerAuthState | null {
  for (const filePath of getPendingAuthCandidatePaths()) {
    const state = readPendingAuthStateFile(vfs, filePath);
    if (state) {
      return state;
    }
  }
  return null;
}

export function deletePendingWranglerAuthState(vfs: VirtualFS): boolean {
  let removed = false;

  for (const filePath of getPendingAuthCandidatePaths()) {
    if (!vfs.existsSync(filePath)) {
      continue;
    }
    try {
      vfs.unlinkSync(filePath);
      removed = true;
    } catch {
      // Ignore unlink failures and continue trying the remaining paths.
    }
  }

  return removed;
}

export function prepareCloudflareAuthPopup(): Window | null {
  if (typeof window === 'undefined' || typeof window.open !== 'function') {
    return null;
  }
  if (preparedCloudflareAuthPopup && !preparedCloudflareAuthPopup.closed) {
    return preparedCloudflareAuthPopup;
  }

  try {
    const popup = window.open('', '_blank');
    if (!popup) {
      return null;
    }
    try {
      popup.document.title = 'Cloudflare Login';
      popup.document.body.textContent = 'Preparing Cloudflare login...';
      (popup as Window & { opener: Window | null }).opener = null;
    } catch {
      // Ignore same-origin restrictions. Navigation will still work if the window opened.
    }
    preparedCloudflareAuthPopup = popup;
    return popup;
  } catch {
    return null;
  }
}

export function cancelPreparedCloudflareAuthPopup(): void {
  if (!preparedCloudflareAuthPopup) {
    return;
  }
  try {
    preparedCloudflareAuthPopup.close();
  } catch {
    // ignore
  }
  preparedCloudflareAuthPopup = null;
}

export function openCloudflareAuthWindow(url: string): void {
  const popup = preparedCloudflareAuthPopup;
  preparedCloudflareAuthPopup = null;

  if (popup && !popup.closed) {
    try {
      popup.location.href = url;
      popup.focus?.();
      return;
    } catch {
      try {
        popup.close();
      } catch {
        // ignore
      }
    }
  }

  try {
    window.open?.(url, '_blank');
  } catch {
    // ignore
  }
}

export async function createWranglerPkcePair(): Promise<{
  codeChallenge: string;
  codeVerifier: string;
  state: string;
}> {
  const codeVerifier = randomToken(96);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(codeVerifier),
  );

  return {
    codeVerifier,
    codeChallenge: encodeBase64Url(digest),
    state: randomToken(48),
  };
}

export function buildWranglerAuthorizationUrl(input: {
  authUrl: string;
  clientId: string;
  codeChallenge: string;
  scopes: readonly string[];
  state: string;
}): string {
  const scopes = Array.from(new Set([...input.scopes, 'offline_access']));
  const search = new URLSearchParams({
    response_type: 'code',
    client_id: input.clientId.trim(),
    redirect_uri: WRANGLER_CALLBACK_URL,
    scope: scopes.join(' '),
    state: input.state.trim(),
    code_challenge: input.codeChallenge.trim(),
    code_challenge_method: 'S256',
  });

  return `${normalizeCloudflareAuthUrl(input.authUrl)}?${search.toString()}`;
}

export async function exchangeWranglerAuthorizationCode(input: {
  clientId: string;
  code: string;
  codeVerifier: string;
  redirectUri?: string;
  tokenUrl: string;
}): Promise<{
  accessToken: string;
  expirationTime: string | null;
  refreshToken: string | null;
  scopes: string[];
}> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code.trim(),
    redirect_uri: input.redirectUri?.trim() || WRANGLER_CALLBACK_URL,
    client_id: input.clientId.trim(),
    code_verifier: input.codeVerifier.trim(),
  });

  const response = await cloudflareFetch(normalizeCloudflareTokenUrl(input.tokenUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const parsed = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof parsed.error === 'string') {
    throw createCloudflareApiError(
      'Cloudflare OAuth code exchange failed',
      {
        message: coerceString(parsed.error_description) || coerceString(parsed.error) || undefined,
      },
    );
  }

  const accessToken = coerceString(parsed.access_token);
  if (!accessToken) {
    throw new Error('Cloudflare did not return an access token.');
  }

  const expiresIn = typeof parsed.expires_in === 'number' && Number.isFinite(parsed.expires_in)
    ? parsed.expires_in
    : null;
  const expirationTime = expiresIn !== null
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  return {
    accessToken,
    refreshToken: coerceString(parsed.refresh_token),
    expirationTime,
    scopes: typeof parsed.scope === 'string'
      ? parsed.scope.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
      : [],
  };
}

export async function refreshWranglerAccessToken(input: {
  clientId: string;
  refreshToken: string;
  tokenUrl: string;
}): Promise<{
  accessToken: string;
  expirationTime: string | null;
  refreshToken: string | null;
  scopes: string[];
}> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken.trim(),
    client_id: input.clientId.trim(),
  });

  const response = await cloudflareFetch(normalizeCloudflareTokenUrl(input.tokenUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  });

  const parsed = await response.json() as Record<string, unknown>;
  if (!response.ok || typeof parsed.error === 'string') {
    throw createCloudflareApiError(
      'Cloudflare OAuth refresh failed',
      {
        message: coerceString(parsed.error_description) || coerceString(parsed.error) || undefined,
      },
    );
  }

  const accessToken = coerceString(parsed.access_token);
  if (!accessToken) {
    throw new Error('Cloudflare did not return a refreshed access token.');
  }

  const expiresIn = typeof parsed.expires_in === 'number' && Number.isFinite(parsed.expires_in)
    ? parsed.expires_in
    : null;
  const expirationTime = expiresIn !== null
    ? new Date(Date.now() + expiresIn * 1000).toISOString()
    : null;

  return {
    accessToken,
    refreshToken: coerceString(parsed.refresh_token) || input.refreshToken.trim(),
    expirationTime,
    scopes: typeof parsed.scope === 'string'
      ? parsed.scope.split(/\s+/).map((scope) => scope.trim()).filter(Boolean)
      : [],
  };
}

export async function revokeWranglerRefreshToken(input: {
  clientId: string;
  refreshToken: string;
  revokeUrl: string;
}): Promise<void> {
  const body = new URLSearchParams({
    client_id: input.clientId.trim(),
    token_type_hint: 'refresh_token',
    token: input.refreshToken.trim(),
  });

  await cloudflareFetch(normalizeCloudflareRevokeUrl(input.revokeUrl), {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  }).catch(() => {});
}

export async function fetchCloudflareCurrentUser(
  apiBaseUrl: string,
  auth: CloudflareAuthHeaders,
): Promise<CloudflareUser> {
  const result = await cloudflareApiFetchResult<Record<string, unknown>>(
    apiBaseUrl,
    '/user',
    auth,
  );

  const firstName = coerceString(result.first_name);
  const lastName = coerceString(result.last_name);
  const name = [firstName, lastName].filter(Boolean).join(' ').trim() || null;

  return {
    id: coerceString(result.id),
    email: coerceString(result.email),
    name,
  };
}

export async function fetchCloudflareAccounts(
  apiBaseUrl: string,
  auth: CloudflareAuthHeaders,
): Promise<CloudflareAccount[]> {
  const result = await cloudflareApiFetchResult<Array<Record<string, unknown>>>(
    apiBaseUrl,
    '/accounts',
    auth,
  );

  return result.map((account) => ({
    id: coerceString(account.id) || '',
    name: coerceString(account.name) || '',
  })).filter((account) => account.id);
}

export async function verifyCloudflareUserApiToken(
  apiBaseUrl: string,
  apiToken: string,
): Promise<CloudflareTokenVerification> {
  const result = await cloudflareApiFetchResult<Record<string, unknown>>(
    apiBaseUrl,
    '/user/tokens/verify',
    { apiToken },
  );

  return {
    id: coerceString(result.id),
    status: coerceString(result.status),
    expiresOn: coerceString(result.expires_on),
    notBefore: coerceString(result.not_before),
  };
}

export function isWranglerAccessTokenExpired(config: WranglerAuthConfig): boolean {
  if (!config.accessToken) {
    return true;
  }
  if (!config.expirationTime) {
    return false;
  }

  const expiration = Date.parse(config.expirationTime);
  if (Number.isNaN(expiration)) {
    return false;
  }

  return Date.now() >= expiration;
}
