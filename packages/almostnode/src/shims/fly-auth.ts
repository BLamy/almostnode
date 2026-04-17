import { getDefaultNetworkController, networkFetch } from '../network';
import type { VirtualFS } from '../virtual-fs';
import * as path from './path';

export const DEFAULT_FLY_API_BASE_URL = 'https://api.fly.io';
export const FLY_CONFIG_PATH = '/home/user/.fly/config.yml';

export interface FlyConfig {
  accessToken: string | null;
  lastLogin: string | null;
  appName: string | null;
  rawText: string;
}

export interface FlyCliSession {
  id: string;
  authUrl: string | null;
  accessToken: string | null;
  metadata?: Record<string, unknown>;
}

export interface FlyCurrentUser {
  id?: string;
  email: string | null;
}

interface FlyGraphQlResponse<TData> {
  data?: TData;
  errors?: Array<{ message?: string }>;
}

let preparedFlyAuthPopup: Window | null = null;

function normalizeLineEndings(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ensureParentDir(vfs: VirtualFS, filePath: string): void {
  const parent = path.dirname(filePath);
  if (!vfs.existsSync(parent)) {
    vfs.mkdirSync(parent, { recursive: true });
  }
}

function decodeYamlScalar(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return '';
  }
  if (trimmed === 'null' || trimmed === '~') {
    return '';
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    try {
      if (trimmed.startsWith('"')) {
        return JSON.parse(trimmed);
      }
    } catch {
      // Fall through and strip quotes manually.
    }
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function encodeYamlScalar(value: string): string {
  return JSON.stringify(value);
}

function readRawFlyConfig(vfs: VirtualFS): string {
  if (!vfs.existsSync(FLY_CONFIG_PATH)) {
    return '';
  }
  try {
    return normalizeLineEndings(vfs.readFileSync(FLY_CONFIG_PATH, 'utf8'));
  } catch {
    return '';
  }
}

function readTopLevelYamlScalar(rawText: string, key: string): string | null {
  const pattern = new RegExp(`^${escapeRegExp(key)}:\\s*(.*?)\\s*$`, 'm');
  const match = rawText.match(pattern);
  if (!match) {
    return null;
  }
  return decodeYamlScalar(match[1] ?? '');
}

function upsertTopLevelYamlScalar(rawText: string, key: string, value: string): string {
  const normalized = normalizeLineEndings(rawText);
  const lines = normalized ? normalized.split('\n') : [];
  const updatedLine = `${key}: ${encodeYamlScalar(value)}`;
  const nextLines: string[] = [];
  let replaced = false;

  for (const line of lines) {
    if (line.startsWith(`${key}:`)) {
      if (!replaced) {
        nextLines.push(updatedLine);
        replaced = true;
      }
      continue;
    }
    nextLines.push(line);
  }

  if (!replaced) {
    while (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') {
      nextLines.pop();
    }
    nextLines.push(updatedLine);
  }

  return ensureTrailingNewline(nextLines.join('\n'));
}

function removeTopLevelYamlScalars(rawText: string, keys: readonly string[]): string {
  if (!rawText) {
    return '';
  }

  const keySet = new Set(keys);
  const nextLines = normalizeLineEndings(rawText)
    .split('\n')
    .filter((line) => !Array.from(keySet).some((key) => line.startsWith(`${key}:`)));

  while (nextLines.length > 0 && nextLines[nextLines.length - 1] === '') {
    nextLines.pop();
  }

  return nextLines.length > 0 ? ensureTrailingNewline(nextLines.join('\n')) : '';
}

function mapCliSession(raw: Record<string, unknown>): FlyCliSession {
  return {
    id: typeof raw.id === 'string' ? raw.id : '',
    authUrl:
      typeof raw.auth_url === 'string'
        ? raw.auth_url
        : typeof raw.url === 'string'
          ? raw.url
          : null,
    accessToken:
      typeof raw.access_token === 'string' && raw.access_token
        ? raw.access_token
        : null,
    metadata:
      raw.metadata && typeof raw.metadata === 'object'
        ? raw.metadata as Record<string, unknown>
        : undefined,
  };
}

function withDefaultController() {
  return getDefaultNetworkController();
}

async function flyFetch(
  apiBaseUrl: string,
  pathname: string,
  init: RequestInit = {},
): Promise<Response> {
  return networkFetch(
    `${normalizeFlyApiBaseUrl(apiBaseUrl)}${pathname.startsWith('/') ? pathname : `/${pathname}`}`,
    init,
    withDefaultController(),
  );
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const handle = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(handle);
      signal?.removeEventListener('abort', onAbort);
      reject(new DOMException('Aborted', 'AbortError'));
    };

    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function normalizeFlyApiBaseUrl(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_FLY_API_BASE_URL;
  }
  return trimmed.replace(/\/+$/, '') || DEFAULT_FLY_API_BASE_URL;
}

export function readFlyConfig(vfs: VirtualFS): FlyConfig {
  const rawText = readRawFlyConfig(vfs);
  const accessToken = readTopLevelYamlScalar(rawText, 'access_token');
  const lastLogin = readTopLevelYamlScalar(rawText, 'last_login');
  const appName = readTopLevelYamlScalar(rawText, 'app');
  return {
    accessToken: accessToken?.trim() ? accessToken : null,
    lastLogin: lastLogin?.trim() ? lastLogin : null,
    appName: appName?.trim() ? appName.trim() : null,
    rawText,
  };
}

export function readFlyAccessToken(vfs: VirtualFS): string | null {
  return readFlyConfig(vfs).accessToken;
}

export function readFlyAppName(vfs: VirtualFS): string | null {
  return readFlyConfig(vfs).appName;
}

export function writeFlyAccessToken(
  vfs: VirtualFS,
  token: string,
  lastLogin = new Date().toISOString(),
): void {
  const normalizedToken = token.trim();
  const normalizedLastLogin = lastLogin.trim();
  let rawText = readRawFlyConfig(vfs);
  rawText = upsertTopLevelYamlScalar(rawText, 'access_token', normalizedToken);
  rawText = upsertTopLevelYamlScalar(rawText, 'last_login', normalizedLastLogin);
  ensureParentDir(vfs, FLY_CONFIG_PATH);
  vfs.writeFileSync(FLY_CONFIG_PATH, rawText);
}

export function writeFlyAppName(vfs: VirtualFS, appName: string): void {
  const normalized = appName.trim();
  let rawText = readRawFlyConfig(vfs);
  if (!normalized) {
    const updated = removeTopLevelYamlScalars(rawText, ['app']);
    if (updated === rawText) return;
    ensureParentDir(vfs, FLY_CONFIG_PATH);
    if (updated) {
      vfs.writeFileSync(FLY_CONFIG_PATH, updated);
    } else {
      try {
        vfs.unlinkSync(FLY_CONFIG_PATH);
      } catch {
        // Ignore — file may not exist.
      }
    }
    return;
  }
  rawText = upsertTopLevelYamlScalar(rawText, 'app', normalized);
  ensureParentDir(vfs, FLY_CONFIG_PATH);
  vfs.writeFileSync(FLY_CONFIG_PATH, rawText);
}

export function deleteFlyAccessToken(vfs: VirtualFS): boolean {
  if (!vfs.existsSync(FLY_CONFIG_PATH)) {
    return false;
  }

  const rawText = readRawFlyConfig(vfs);
  const updated = removeTopLevelYamlScalars(rawText, ['access_token', 'last_login']);

  if (!updated) {
    try {
      vfs.unlinkSync(FLY_CONFIG_PATH);
      return true;
    } catch {
      return false;
    }
  }

  if (updated === rawText) {
    return false;
  }

  ensureParentDir(vfs, FLY_CONFIG_PATH);
  vfs.writeFileSync(FLY_CONFIG_PATH, updated);
  return true;
}

export function prepareFlyAuthPopup(): Window | null {
  if (typeof window === 'undefined' || typeof window.open !== 'function') {
    return null;
  }
  if (preparedFlyAuthPopup && !preparedFlyAuthPopup.closed) {
    return preparedFlyAuthPopup;
  }

  try {
    const popup = window.open('', '_blank');
    if (!popup) {
      return null;
    }
    try {
      popup.document.title = 'Fly.io Login';
      popup.document.body.textContent = 'Preparing Fly.io login...';
      (popup as Window & { opener: Window | null }).opener = null;
    } catch {
      // Ignore same-origin/setup issues; navigation will still work if the popup opened.
    }
    preparedFlyAuthPopup = popup;
    return popup;
  } catch {
    return null;
  }
}

export function cancelPreparedFlyAuthPopup(): void {
  if (!preparedFlyAuthPopup) {
    return;
  }
  try {
    preparedFlyAuthPopup.close();
  } catch {
    // ignore
  }
  preparedFlyAuthPopup = null;
}

export function openFlyAuthWindow(url: string): void {
  const popup = preparedFlyAuthPopup;
  preparedFlyAuthPopup = null;

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

export async function startFlyCliSession(
  apiBaseUrl: string,
  sessionName: string,
  options?: {
    signup?: boolean;
    target?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<FlyCliSession> {
  const response = await flyFetch(
    apiBaseUrl,
    '/api/v1/cli_sessions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: sessionName,
        signup: options?.signup ?? false,
        target: options?.target ?? 'auth',
        ...(options?.metadata ? { metadata: options.metadata } : {}),
      }),
    },
  );

  if (response.status !== 201) {
    throw new Error(`Fly CLI session request failed: ${response.status} ${response.statusText}`);
  }

  return mapCliSession(await response.json() as Record<string, unknown>);
}

export async function getFlyCliSessionState(
  apiBaseUrl: string,
  sessionId: string,
): Promise<FlyCliSession> {
  const response = await flyFetch(apiBaseUrl, `/api/v1/cli_sessions/${encodeURIComponent(sessionId)}`);
  if (response.status === 404) {
    throw new Error('Fly CLI session not ready');
  }
  if (!response.ok) {
    throw new Error(`Fly CLI session poll failed: ${response.status} ${response.statusText}`);
  }
  return mapCliSession(await response.json() as Record<string, unknown>);
}

export async function waitForFlyCliSessionToken(
  apiBaseUrl: string,
  sessionId: string,
  options?: {
    signal?: AbortSignal;
    timeoutMs?: number;
    pollIntervalMs?: number;
  },
): Promise<string> {
  const startedAt = Date.now();
  const timeoutMs = options?.timeoutMs ?? 15 * 60 * 1000;
  const pollIntervalMs = options?.pollIntervalMs ?? 1000;

  while (Date.now() - startedAt < timeoutMs) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    try {
      const state = await getFlyCliSessionState(apiBaseUrl, sessionId);
      if (state.accessToken?.trim()) {
        return state.accessToken.trim();
      }
    } catch {
      // Fly's own CLI retries polling errors until timeout; do the same here.
    }

    await delay(pollIntervalMs, options?.signal);
  }

  throw new Error('Login expired, please try again');
}

export function getFlyAuthorizationHeader(token: string): string {
  const normalized = token.trim();
  if (/^(FlyV1|Bearer)\s+/i.test(normalized)) {
    return normalized;
  }

  for (const rawToken of normalized.split(',')) {
    const prefix = rawToken.trim().split('_', 1)[0];
    if (prefix === 'fm1r' || prefix === 'fm2') {
      return `FlyV1 ${normalized}`;
    }
  }
  return `Bearer ${normalized}`;
}

export interface FlyAppSummary {
  id: string;
  name: string;
  organizationSlug: string | null;
  status: string | null;
}

export async function fetchFlyApps(
  apiBaseUrl: string,
  token: string,
): Promise<FlyAppSummary[]> {
  const response = await flyFetch(
    apiBaseUrl,
    '/graphql',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getFlyAuthorizationHeader(token),
      },
      body: JSON.stringify({
        query: `
          query {
            apps(first: 200) {
              nodes {
                id
                name
              }
            }
          }
        `,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to load Fly apps: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as FlyGraphQlResponse<{
    apps?: {
      nodes?: Array<{
        id?: unknown;
        name?: unknown;
      } | null>;
    };
  }>;

  const nodes = payload.data?.apps?.nodes ?? [];
  const apps: FlyAppSummary[] = [];
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    const id = typeof node.id === 'string' ? node.id : null;
    const name = typeof node.name === 'string' ? node.name.trim() : '';
    if (!id || !name) continue;
    apps.push({
      id,
      name,
      status: null,
      organizationSlug: null,
    });
  }

  if (apps.length === 0 && payload.errors?.length) {
    throw new Error(payload.errors.map((entry) => entry.message).filter(Boolean).join(', ') || 'Fly GraphQL error');
  }

  apps.sort((a, b) => a.name.localeCompare(b.name));
  return apps;
}

export async function fetchFlyCurrentUser(
  apiBaseUrl: string,
  token: string,
): Promise<FlyCurrentUser> {
  const response = await flyFetch(
    apiBaseUrl,
    '/graphql',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: getFlyAuthorizationHeader(token),
      },
      body: JSON.stringify({
        query: `
          query {
            viewer {
              ... on User {
                id
                email
              }
              ... on Macaroon {
                email
              }
            }
          }
        `,
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to load Fly user: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json() as FlyGraphQlResponse<{
    viewer?: {
      id?: unknown;
      email?: unknown;
    };
  }>;
  if (payload.errors?.length) {
    throw new Error(payload.errors.map((entry) => entry.message).filter(Boolean).join(', ') || 'Fly GraphQL error');
  }

  const viewer = payload.data?.viewer;
  return {
    id: typeof viewer?.id === 'string' ? viewer.id : undefined,
    email: typeof viewer?.email === 'string' ? viewer.email : null,
  };
}
