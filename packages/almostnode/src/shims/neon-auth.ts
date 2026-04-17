import { getDefaultNetworkController, networkFetch } from '../network';
import type { VirtualFS } from '../virtual-fs';
import * as path from './path';

export const DEFAULT_NEON_API_HOST = 'https://console.neon.tech/api/v2';
export const DEFAULT_NEON_OAUTH_HOST = 'https://oauth2.neon.tech';
export const DEFAULT_NEON_CLIENT_ID = 'neonctl';
export const DEFAULT_NEON_CONFIG_DIR = '/home/user/.config/neonctl';
export const NEON_CREDENTIALS_PATH = '/home/user/.config/neonctl/credentials.json';
export const NEON_PENDING_AUTH_PATH = '/home/user/.config/neonctl/pending-auth.json';
export const NEON_CALLBACK_REDIRECT_URI = 'http://127.0.0.1:44555/callback';

const ALWAYS_PRESENT_SCOPES = ['openid', 'offline', 'offline_access'] as const;
const NEON_SCOPES = [
  ...ALWAYS_PRESENT_SCOPES,
  'urn:neoncloud:projects:create',
  'urn:neoncloud:projects:read',
  'urn:neoncloud:projects:update',
  'urn:neoncloud:projects:delete',
  'urn:neoncloud:orgs:create',
  'urn:neoncloud:orgs:read',
  'urn:neoncloud:orgs:update',
  'urn:neoncloud:orgs:delete',
  'urn:neoncloud:orgs:permission',
] as const;

export interface NeonCredentials {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  expires_at?: number;
  id_token?: string;
  user_id?: string;
  personal_api_key?: string;
  personal_api_key_id?: string;
  personal_api_key_name?: string;
}

export interface NeonPendingAuthState {
  state: string;
  code_verifier: string;
  oauth_host?: string;
  client_id?: string;
  redirect_uri?: string;
  created_at?: number;
}

interface NeonTokenResponse {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  scope?: string;
  expires_in?: number;
  id_token?: string;
  error?: string;
  error_description?: string;
}

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function ensureParentDir(vfs: VirtualFS, filePath: string): void {
  const parent = path.dirname(filePath);
  if (!vfs.existsSync(parent)) {
    vfs.mkdirSync(parent, { recursive: true });
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  let binary = '';
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]);
  }

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function parseJwtPayload(token: string | undefined): Record<string, unknown> | null {
  if (!token) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length < 2) {
    return null;
  }

  try {
    const segment = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const decoded =
      typeof Buffer !== 'undefined'
        ? Buffer.from(segment, 'base64').toString('utf8')
        : atob(segment);
    return JSON.parse(decoded);
  } catch {
    return null;
  }
}

function normalizeNeonCredentials(value: unknown): NeonCredentials | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const credentials: NeonCredentials = {};

  if (typeof record.access_token === 'string' && record.access_token.trim()) {
    credentials.access_token = record.access_token.trim();
  }
  if (typeof record.refresh_token === 'string' && record.refresh_token.trim()) {
    credentials.refresh_token = record.refresh_token.trim();
  }
  if (typeof record.token_type === 'string' && record.token_type.trim()) {
    credentials.token_type = record.token_type.trim();
  }
  if (typeof record.scope === 'string' && record.scope.trim()) {
    credentials.scope = record.scope.trim();
  }
  if (typeof record.id_token === 'string' && record.id_token.trim()) {
    credentials.id_token = record.id_token.trim();
  }
  if (typeof record.user_id === 'string' && record.user_id.trim()) {
    credentials.user_id = record.user_id.trim();
  }
  if (typeof record.expires_in === 'number' && Number.isFinite(record.expires_in)) {
    credentials.expires_in = record.expires_in;
  }
  if (typeof record.expires_at === 'number' && Number.isFinite(record.expires_at)) {
    credentials.expires_at = record.expires_at;
  }
  if (typeof record.personal_api_key === 'string' && record.personal_api_key.trim()) {
    credentials.personal_api_key = record.personal_api_key.trim();
  }
  if (
    (typeof record.personal_api_key_id === 'string' && record.personal_api_key_id.trim())
    || typeof record.personal_api_key_id === 'number'
  ) {
    credentials.personal_api_key_id = String(record.personal_api_key_id).trim();
  }
  if (typeof record.personal_api_key_name === 'string' && record.personal_api_key_name.trim()) {
    credentials.personal_api_key_name = record.personal_api_key_name.trim();
  }

  return credentials.access_token || credentials.refresh_token ? credentials : null;
}

function normalizePendingAuthState(value: unknown): NeonPendingAuthState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;
  const state = typeof record.state === 'string' ? record.state.trim() : '';
  const codeVerifier =
    typeof record.code_verifier === 'string'
      ? record.code_verifier.trim()
      : typeof record.codeVerifier === 'string'
        ? record.codeVerifier.trim()
        : '';

  if (!state || !codeVerifier) {
    return null;
  }

  const pendingState: NeonPendingAuthState = {
    state,
    code_verifier: codeVerifier,
  };

  if (typeof record.oauth_host === 'string' && record.oauth_host.trim()) {
    pendingState.oauth_host = record.oauth_host.trim();
  }
  if (typeof record.client_id === 'string' && record.client_id.trim()) {
    pendingState.client_id = record.client_id.trim();
  }
  if (typeof record.redirect_uri === 'string' && record.redirect_uri.trim()) {
    pendingState.redirect_uri = record.redirect_uri.trim();
  }
  if (typeof record.created_at === 'number' && Number.isFinite(record.created_at)) {
    pendingState.created_at = record.created_at;
  }

  return pendingState;
}

function inferUserId(credentials: NeonCredentials): string | undefined {
  const payload = parseJwtPayload(credentials.id_token);
  return typeof payload?.sub === 'string' && payload.sub.trim()
    ? payload.sub.trim()
    : credentials.user_id;
}

function extendTokenSet(tokenSet: NeonTokenResponse, previous?: NeonCredentials | null): NeonCredentials {
  const expiresIn = typeof tokenSet.expires_in === 'number' ? tokenSet.expires_in : 0;
  const credentials: NeonCredentials = {
    access_token: tokenSet.access_token?.trim() || previous?.access_token,
    refresh_token: tokenSet.refresh_token?.trim() || previous?.refresh_token,
    token_type: tokenSet.token_type?.trim() || previous?.token_type,
    scope: tokenSet.scope?.trim() || previous?.scope,
    expires_in: expiresIn || previous?.expires_in,
    expires_at: Date.now() + expiresIn * 1000,
    id_token: tokenSet.id_token?.trim() || previous?.id_token,
    personal_api_key: previous?.personal_api_key,
    personal_api_key_id: previous?.personal_api_key_id,
    personal_api_key_name: previous?.personal_api_key_name,
  };
  credentials.user_id = inferUserId(credentials);
  return credentials;
}

async function neonFetch(url: string, init: RequestInit = {}): Promise<Response> {
  return networkFetch(url, init, getDefaultNetworkController());
}

async function postTokenRequest(
  oauthHost: string,
  body: URLSearchParams,
): Promise<NeonTokenResponse> {
  const response = await neonFetch(`${normalizeNeonOauthHost(oauthHost)}/oauth2/token`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });

  const text = await response.text();
  let parsed: NeonTokenResponse | null = null;

  try {
    parsed = text ? JSON.parse(text) as NeonTokenResponse : {};
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const detail = parsed?.error_description || parsed?.error || text || `${response.status} ${response.statusText}`;
    throw new Error(`Neon token request failed: ${detail}`);
  }

  if (!parsed?.access_token) {
    throw new Error('Neon token request did not return an access token.');
  }

  return parsed;
}

function getJsonObject(value: string): Record<string, unknown> | null {
  if (!value.trim()) {
    return null;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function extractNeonApiKey(response: Record<string, unknown>): {
  id: string | number | null;
  key: string | null;
  name: string | null;
} {
  const nested =
    response.api_key && typeof response.api_key === 'object'
      ? response.api_key as Record<string, unknown>
      : null;

  const key =
    typeof response.key === 'string' && response.key.trim()
      ? response.key.trim()
      : typeof nested?.key === 'string' && nested.key.trim()
        ? nested.key.trim()
        : null;
  const name =
    typeof response.name === 'string' && response.name.trim()
      ? response.name.trim()
      : typeof response.key_name === 'string' && response.key_name.trim()
        ? response.key_name.trim()
        : typeof nested?.name === 'string' && nested.name.trim()
          ? nested.name.trim()
          : typeof nested?.key_name === 'string' && nested.key_name.trim()
            ? nested.key_name.trim()
            : null;
  const idValue =
    typeof response.id === 'string' || typeof response.id === 'number'
      ? response.id
      : typeof nested?.id === 'string' || typeof nested?.id === 'number'
        ? nested.id
        : null;

  return { id: idValue, key, name };
}

export function normalizeNeonApiHost(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_NEON_API_HOST;
  }
  return trimmed.replace(/\/+$/g, '') || DEFAULT_NEON_API_HOST;
}

export function normalizeNeonOauthHost(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_NEON_OAUTH_HOST;
  }
  return trimmed.replace(/\/+$/g, '') || DEFAULT_NEON_OAUTH_HOST;
}

export function readNeonCredentials(vfs: VirtualFS, filePath = NEON_CREDENTIALS_PATH): NeonCredentials | null {
  if (!vfs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = normalizeLineEndings(vfs.readFileSync(filePath, 'utf8'));
    return normalizeNeonCredentials(JSON.parse(content));
  } catch {
    return null;
  }
}

export function readPendingNeonAuthState(
  vfs: VirtualFS,
  filePath = NEON_PENDING_AUTH_PATH,
): NeonPendingAuthState | null {
  if (!vfs.existsSync(filePath)) {
    return null;
  }

  try {
    const content = normalizeLineEndings(vfs.readFileSync(filePath, 'utf8'));
    return normalizePendingAuthState(JSON.parse(content));
  } catch {
    return null;
  }
}

export function writeNeonCredentials(
  vfs: VirtualFS,
  credentials: NeonCredentials,
  filePath = NEON_CREDENTIALS_PATH,
): void {
  const normalized = normalizeNeonCredentials(credentials);
  if (!normalized) {
    throw new Error('Cannot write empty Neon credentials.');
  }

  ensureParentDir(vfs, filePath);
  vfs.writeFileSync(filePath, JSON.stringify(normalized, null, 2) + '\n');
}

export function writePendingNeonAuthState(
  vfs: VirtualFS,
  state: NeonPendingAuthState,
  filePath = NEON_PENDING_AUTH_PATH,
): void {
  const normalized = normalizePendingAuthState(state);
  if (!normalized) {
    throw new Error('Cannot write empty Neon pending auth state.');
  }

  ensureParentDir(vfs, filePath);
  vfs.writeFileSync(filePath, JSON.stringify(normalized, null, 2) + '\n');
}

export function deleteNeonCredentials(vfs: VirtualFS, filePath = NEON_CREDENTIALS_PATH): boolean {
  if (!vfs.existsSync(filePath)) {
    return false;
  }

  try {
    vfs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function deletePendingNeonAuthState(vfs: VirtualFS, filePath = NEON_PENDING_AUTH_PATH): boolean {
  if (!vfs.existsSync(filePath)) {
    return false;
  }

  try {
    vfs.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

export function getNeonIdentityLabel(credentials: NeonCredentials | null): string | null {
  if (!credentials) {
    return null;
  }

  const payload = parseJwtPayload(credentials.id_token);
  const email =
    typeof payload?.email === 'string' && payload.email.trim()
      ? payload.email.trim()
      : null;
  if (email) {
    return email;
  }

  const userId = inferUserId(credentials);
  return userId?.trim() ? userId.trim() : null;
}

export function getDefaultNeonConfigDir(env?: Record<string, string>): string {
  const xdgConfigHome = env?.XDG_CONFIG_HOME?.trim();
  if (xdgConfigHome) {
    return path.join(xdgConfigHome, 'neonctl');
  }

  const home = env?.HOME?.trim() || '/home/user';
  return path.join(home, '.config', 'neonctl');
}

export function getNeonCredentialsPath(configDir: string): string {
  return path.join(configDir, 'credentials.json');
}

export function getNeonPendingAuthPath(configDir: string): string {
  return path.join(configDir, 'pending-auth.json');
}

export function buildNeonAuthorizationUrl(options: {
  oauthHost?: string;
  clientId?: string;
  redirectUri?: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    client_id: (options.clientId || DEFAULT_NEON_CLIENT_ID).trim() || DEFAULT_NEON_CLIENT_ID,
    response_type: 'code',
    scope: NEON_SCOPES.join(' '),
    state: options.state,
    code_challenge: options.codeChallenge,
    code_challenge_method: 'S256',
    redirect_uri: options.redirectUri || NEON_CALLBACK_REDIRECT_URI,
  });

  return `${normalizeNeonOauthHost(options.oauthHost)}/oauth2/auth?${params.toString()}`;
}

export async function createNeonPkcePair(): Promise<{ codeVerifier: string; codeChallenge: string; state: string }> {
  const codeVerifier = base64UrlEncode(randomBytes(48));
  const state = base64UrlEncode(randomBytes(24));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codeVerifier));
  const codeChallenge = base64UrlEncode(new Uint8Array(digest));
  return { codeVerifier, codeChallenge, state };
}

export async function exchangeNeonAuthorizationCode(options: {
  oauthHost?: string;
  clientId?: string;
  code: string;
  codeVerifier: string;
  redirectUri?: string;
}): Promise<NeonCredentials> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    client_id: (options.clientId || DEFAULT_NEON_CLIENT_ID).trim() || DEFAULT_NEON_CLIENT_ID,
    code: options.code,
    code_verifier: options.codeVerifier,
    redirect_uri: options.redirectUri || NEON_CALLBACK_REDIRECT_URI,
  });

  const tokenSet = await postTokenRequest(options.oauthHost || DEFAULT_NEON_OAUTH_HOST, body);
  return extendTokenSet(tokenSet);
}

export async function refreshNeonCredentials(
  credentials: NeonCredentials,
  options?: {
    oauthHost?: string;
    clientId?: string;
  },
): Promise<NeonCredentials> {
  if (!credentials.refresh_token) {
    throw new Error('Saved Neon credentials do not include a refresh token.');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: (options?.clientId || DEFAULT_NEON_CLIENT_ID).trim() || DEFAULT_NEON_CLIENT_ID,
    refresh_token: credentials.refresh_token,
  });

  const tokenSet = await postTokenRequest(options?.oauthHost || DEFAULT_NEON_OAUTH_HOST, body);
  return extendTokenSet(tokenSet, credentials);
}

export const DEFAULT_NEON_PERSONAL_API_KEY_PREFIX = 'almostnode-webide';

export function buildDefaultNeonApiKeyName(now: Date = new Date()): string {
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  return `${DEFAULT_NEON_PERSONAL_API_KEY_PREFIX}-${stamp}`;
}

export async function deleteNeonApiKey(
  accessToken: string,
  keyId: string,
  options?: { apiHost?: string },
): Promise<boolean> {
  const trimmedId = keyId.trim();
  if (!trimmedId) return false;

  const response = await neonFetch(
    `${normalizeNeonApiHost(options?.apiHost)}/api_keys/${encodeURIComponent(trimmedId)}`,
    {
      method: 'DELETE',
      headers: {
        accept: 'application/json',
        authorization: `Bearer ${accessToken}`,
      },
    },
  );

  if (response.ok) return true;
  if (response.status === 404) return false;

  const text = await response.text().catch(() => '');
  const parsed = getJsonObject(text);
  const detail =
    (typeof parsed?.message === 'string' && parsed.message.trim())
    || (typeof parsed?.error === 'string' && parsed.error.trim())
    || text
    || `${response.status} ${response.statusText}`;
  throw new Error(`Neon API key deletion failed: ${detail}`);
}

export async function ensureNeonPersonalApiKey(
  vfs: VirtualFS,
  options: {
    apiHost?: string;
    keyName?: string;
    filePath?: string;
  } = {},
): Promise<NeonCredentials | null> {
  const filePath = options.filePath ?? NEON_CREDENTIALS_PATH;
  const credentials = readNeonCredentials(vfs, filePath);
  if (!credentials?.access_token) return credentials;
  if (credentials.personal_api_key) return credentials;

  const keyName = options.keyName?.trim() || buildDefaultNeonApiKeyName();
  const created = await createNeonApiKey(credentials.access_token, {
    apiHost: options.apiHost,
    keyName,
  });

  const updated: NeonCredentials = {
    ...credentials,
    personal_api_key: created.key,
    personal_api_key_id: created.id != null ? String(created.id) : undefined,
    personal_api_key_name: created.name || keyName,
  };
  writeNeonCredentials(vfs, updated, filePath);
  return updated;
}

export async function createNeonApiKey(
  accessToken: string,
  options: {
    apiHost?: string;
    keyName: string;
  },
): Promise<{ id: string | number | null; key: string; name: string | null }> {
  const keyName = options.keyName.trim();
  if (!keyName) {
    throw new Error('A Neon API key name is required.');
  }

  const response = await neonFetch(`${normalizeNeonApiHost(options.apiHost)}/api_keys`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ key_name: keyName }),
  });

  const text = await response.text();
  const parsed = getJsonObject(text);

  if (!response.ok) {
    const detail =
      (typeof parsed?.message === 'string' && parsed.message.trim())
      || (typeof parsed?.error === 'string' && parsed.error.trim())
      || text
      || `${response.status} ${response.statusText}`;
    throw new Error(`Neon API key creation failed: ${detail}`);
  }

  const created = extractNeonApiKey(parsed || {});
  if (!created.key) {
    throw new Error('Neon API key creation succeeded but no key token was returned.');
  }

  return {
    id: created.id,
    key: created.key,
    name: created.name || keyName,
  };
}
