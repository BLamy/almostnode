import { getDefaultNetworkController, networkFetch } from '../network';
import type { VirtualFS } from '../virtual-fs';
import * as path from './path';

export const DEFAULT_NETLIFY_API_BASE_URL = 'https://api.netlify.com/api/v1';
export const DEFAULT_NETLIFY_WEB_UI_URL = 'https://app.netlify.com';
export const NETLIFY_CONFIG_PATH = '/home/user/.config/netlify/config.json';
export const NETLIFY_LEGACY_CONFIG_PATH = '/home/user/.netlify/config.json';
export const NETLIFY_CLI_CLIENT_ID = 'd6f37de6614df7ae58664cfca524744d73807a377f5ee71f1a254f78412e3750';

export interface NetlifyStoredUser {
  id: string;
  name: string | null;
  email: string | null;
  accessToken: string | null;
}

export interface NetlifyConfig {
  accessToken: string | null;
  currentUser: NetlifyStoredUser | null;
  path: string | null;
  raw: Record<string, unknown>;
  userId: string | null;
  users: Record<string, NetlifyStoredUser>;
}

export interface NetlifyTicket {
  authorized: boolean;
  clientId: string | null;
  createdAt: string | null;
  id: string;
}

export interface NetlifyTicketExchange {
  accessToken: string | null;
  createdAt: string | null;
  id: string;
  userEmail: string | null;
  userId: string | null;
}

export interface NetlifyCurrentUser {
  email: string | null;
  id: string | null;
  name: string | null;
}

let preparedNetlifyAuthPopup: Window | null = null;

function withDefaultController() {
  return getDefaultNetworkController();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function ensureParentDir(vfs: VirtualFS, filePath: string): void {
  const parent = path.dirname(filePath);
  if (!vfs.existsSync(parent)) {
    vfs.mkdirSync(parent, { recursive: true });
  }
}

function readJsonFile(vfs: VirtualFS, filePath: string): Record<string, unknown> | null {
  if (!vfs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw = vfs.readFileSync(filePath, 'utf8');
    const parsed = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return null;
  }
}

function writeJsonFile(vfs: VirtualFS, filePath: string, value: Record<string, unknown>): void {
  ensureParentDir(vfs, filePath);
  vfs.writeFileSync(filePath, JSON.stringify(value, null, '\t'));
}

function coerceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function mapStoredUser(raw: unknown, fallbackId: string): NetlifyStoredUser {
  const user = isRecord(raw) ? raw : {};
  const auth = isRecord(user.auth) ? user.auth : {};

  return {
    id: coerceString(user.id) || fallbackId,
    name: coerceString(user.name),
    email: coerceString(user.email),
    accessToken: coerceString(auth.token),
  };
}

function mapNetlifyTicket(raw: unknown): NetlifyTicket {
  const ticket = isRecord(raw) ? raw : {};
  return {
    id: coerceString(ticket.id) || '',
    clientId: coerceString(ticket.client_id),
    authorized: ticket.authorized === true,
    createdAt: coerceString(ticket.created_at),
  };
}

function mapNetlifyTicketExchange(raw: unknown): NetlifyTicketExchange {
  const exchange = isRecord(raw) ? raw : {};
  return {
    id: coerceString(exchange.id) || '',
    accessToken: coerceString(exchange.access_token),
    userId: coerceString(exchange.user_id),
    userEmail: coerceString(exchange.user_email),
    createdAt: coerceString(exchange.created_at),
  };
}

function getConfigCandidatePaths(): readonly string[] {
  return [NETLIFY_CONFIG_PATH, NETLIFY_LEGACY_CONFIG_PATH];
}

function buildEmptyNetlifyConfig(): NetlifyConfig {
  return {
    accessToken: null,
    currentUser: null,
    path: null,
    raw: {},
    userId: null,
    users: {},
  };
}

function mapNetlifyConfig(raw: Record<string, unknown>, filePath: string): NetlifyConfig {
  const usersRaw = isRecord(raw.users) ? raw.users : {};
  const users: Record<string, NetlifyStoredUser> = {};

  for (const [userId, userValue] of Object.entries(usersRaw)) {
    users[userId] = mapStoredUser(userValue, userId);
  }

  const userId = coerceString(raw.userId);
  const currentUser = userId ? users[userId] ?? null : null;

  return {
    accessToken: currentUser?.accessToken ?? null,
    currentUser,
    path: filePath,
    raw,
    userId,
    users,
  };
}

function readPreferredNetlifyConfigData(vfs: VirtualFS): {
  data: Record<string, unknown>;
  path: string;
  legacyExists: boolean;
} {
  const primary = readJsonFile(vfs, NETLIFY_CONFIG_PATH);
  const legacy = readJsonFile(vfs, NETLIFY_LEGACY_CONFIG_PATH);

  return {
    data: primary ?? legacy ?? {},
    path: primary ? NETLIFY_CONFIG_PATH : legacy ? NETLIFY_LEGACY_CONFIG_PATH : NETLIFY_CONFIG_PATH,
    legacyExists: vfs.existsSync(NETLIFY_LEGACY_CONFIG_PATH),
  };
}

function mergeUserRecord(
  existingRaw: unknown,
  updates: {
    accessToken?: string | null;
    email?: string | null;
    id: string;
    name?: string | null;
  },
): Record<string, unknown> {
  const existing = isRecord(existingRaw) ? existingRaw : {};
  const existingAuth = isRecord(existing.auth) ? existing.auth : {};
  const nextAuth: Record<string, unknown> = { ...existingAuth };

  if (updates.accessToken === null) {
    delete nextAuth.token;
  } else if (typeof updates.accessToken === 'string' && updates.accessToken.trim()) {
    nextAuth.token = updates.accessToken.trim();
  }

  const next: Record<string, unknown> = {
    ...existing,
    id: updates.id,
    auth: nextAuth,
  };

  if (typeof updates.name === 'string' && updates.name.trim()) {
    next.name = updates.name.trim();
  }
  if (typeof updates.email === 'string' && updates.email.trim()) {
    next.email = updates.email.trim();
  }

  return next;
}

function writeNetlifyConfigData(
  vfs: VirtualFS,
  data: Record<string, unknown>,
  options?: { syncLegacyIfPresent?: boolean },
): void {
  writeJsonFile(vfs, NETLIFY_CONFIG_PATH, data);
  if (options?.syncLegacyIfPresent && vfs.existsSync(NETLIFY_LEGACY_CONFIG_PATH)) {
    writeJsonFile(vfs, NETLIFY_LEGACY_CONFIG_PATH, data);
  }
}

async function netlifyFetch(
  apiBaseUrl: string,
  pathname: string,
  init: RequestInit = {},
): Promise<Response> {
  return networkFetch(
    `${normalizeNetlifyApiBaseUrl(apiBaseUrl)}${pathname.startsWith('/') ? pathname : `/${pathname}`}`,
    init,
    withDefaultController(),
  );
}

async function readErrorMessage(response: Response, fallbackPrefix: string): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const payload = await response.json() as unknown;
      if (isRecord(payload) && typeof payload.message === 'string' && payload.message.trim()) {
        return `${fallbackPrefix}: ${payload.message.trim()}`;
      }
    } else {
      const text = (await response.text()).trim();
      if (text) {
        return `${fallbackPrefix}: ${text}`;
      }
    }
  } catch {
    // ignore
  }

  return `${fallbackPrefix}: ${response.status} ${response.statusText}`;
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

export function normalizeNetlifyApiBaseUrl(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_NETLIFY_API_BASE_URL;
  }
  return trimmed.replace(/\/+$/, '') || DEFAULT_NETLIFY_API_BASE_URL;
}

export function normalizeNetlifyWebUiUrl(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_NETLIFY_WEB_UI_URL;
  }
  return trimmed.replace(/\/+$/, '') || DEFAULT_NETLIFY_WEB_UI_URL;
}

export function buildNetlifyAuthorizeUrl(webUiUrl: string, ticketId: string): string {
  const baseUrl = normalizeNetlifyWebUiUrl(webUiUrl);
  return `${baseUrl}/authorize?response_type=ticket&ticket=${encodeURIComponent(ticketId)}`;
}

export function readNetlifyConfig(vfs: VirtualFS): NetlifyConfig {
  for (const filePath of getConfigCandidatePaths()) {
    const raw = readJsonFile(vfs, filePath);
    if (raw) {
      return mapNetlifyConfig(raw, filePath);
    }
  }

  return buildEmptyNetlifyConfig();
}

export function readNetlifyAccessToken(vfs: VirtualFS): string | null {
  return readNetlifyConfig(vfs).accessToken;
}

export function writeNetlifyAccessToken(
  vfs: VirtualFS,
  session: {
    accessToken: string;
    email?: string | null;
    name?: string | null;
    userId?: string | null;
  },
): void {
  const token = session.accessToken.trim();
  if (!token) {
    return;
  }

  const { data, legacyExists } = readPreferredNetlifyConfigData(vfs);
  const users = isRecord(data.users) ? { ...data.users } : {};
  const userId = session.userId?.trim() || coerceString(data.userId) || 'current';

  users[userId] = mergeUserRecord(users[userId], {
    id: userId,
    accessToken: token,
    email: session.email ?? null,
    name: session.name ?? null,
  });

  writeNetlifyConfigData(
    vfs,
    {
      ...data,
      userId,
      users,
    },
    { syncLegacyIfPresent: legacyExists },
  );
}

export function deleteNetlifyAccessToken(vfs: VirtualFS): boolean {
  let changed = false;

  for (const filePath of getConfigCandidatePaths()) {
    const raw = readJsonFile(vfs, filePath);
    if (!raw) {
      continue;
    }

    const userId = coerceString(raw.userId);
    const users = isRecord(raw.users) ? { ...raw.users } : {};
    let fileChanged = false;

    if (userId) {
      const existingUser = users[userId];
      if (isRecord(existingUser)) {
        const existingAuth = isRecord(existingUser.auth) ? { ...existingUser.auth } : {};
        if ('token' in existingAuth) {
          delete existingAuth.token;
          users[userId] = {
            ...existingUser,
            auth: existingAuth,
          };
          fileChanged = true;
        }
      }
    }

    if (raw.userId !== null) {
      fileChanged = true;
    }

    if (!fileChanged) {
      continue;
    }

    writeJsonFile(vfs, filePath, {
      ...raw,
      userId: null,
      users,
    });
    changed = true;
  }

  return changed;
}

export function prepareNetlifyAuthPopup(): Window | null {
  if (typeof window === 'undefined' || typeof window.open !== 'function') {
    return null;
  }
  if (preparedNetlifyAuthPopup && !preparedNetlifyAuthPopup.closed) {
    return preparedNetlifyAuthPopup;
  }

  try {
    const popup = window.open('', '_blank');
    if (!popup) {
      return null;
    }
    try {
      popup.document.title = 'Netlify Login';
      popup.document.body.textContent = 'Preparing Netlify login...';
      (popup as Window & { opener: Window | null }).opener = null;
    } catch {
      // Ignore same-origin/setup issues; navigation will still work if the popup opened.
    }
    preparedNetlifyAuthPopup = popup;
    return popup;
  } catch {
    return null;
  }
}

export function cancelPreparedNetlifyAuthPopup(): void {
  if (!preparedNetlifyAuthPopup) {
    return;
  }
  try {
    preparedNetlifyAuthPopup.close();
  } catch {
    // ignore
  }
  preparedNetlifyAuthPopup = null;
}

export function openNetlifyAuthWindow(url: string): void {
  const popup = preparedNetlifyAuthPopup;
  preparedNetlifyAuthPopup = null;

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

export async function createNetlifyTicket(
  apiBaseUrl: string,
  options?: {
    clientId?: string;
    message?: string;
  },
): Promise<NetlifyTicket> {
  const clientId = options?.clientId?.trim() || NETLIFY_CLI_CLIENT_ID;
  const body = typeof options?.message === 'string' && options.message.trim()
    ? JSON.stringify({ message: options.message.trim() })
    : undefined;

  const response = await netlifyFetch(
    apiBaseUrl,
    `/oauth/tickets?client_id=${encodeURIComponent(clientId)}`,
    {
      method: 'POST',
      headers: body
        ? {
            'Content-Type': 'application/json',
          }
        : undefined,
      body,
    },
  );

  if (response.status !== 201) {
    throw new Error(await readErrorMessage(response, 'Netlify ticket request failed'));
  }

  return mapNetlifyTicket(await response.json() as unknown);
}

export async function getNetlifyTicket(
  apiBaseUrl: string,
  ticketId: string,
): Promise<NetlifyTicket> {
  const response = await netlifyFetch(apiBaseUrl, `/oauth/tickets/${encodeURIComponent(ticketId)}`);

  if (response.status === 401 || response.status === 404) {
    throw new Error('Authorization was denied or the login session expired.');
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Netlify ticket poll failed'));
  }

  return mapNetlifyTicket(await response.json() as unknown);
}

export async function exchangeNetlifyTicket(
  apiBaseUrl: string,
  ticketId: string,
): Promise<NetlifyTicketExchange> {
  const response = await netlifyFetch(
    apiBaseUrl,
    `/oauth/tickets/${encodeURIComponent(ticketId)}/exchange`,
    {
      method: 'POST',
    },
  );

  if (response.status !== 201) {
    throw new Error(await readErrorMessage(response, 'Netlify token exchange failed'));
  }

  return mapNetlifyTicketExchange(await response.json() as unknown);
}

export async function waitForNetlifyTicketAccessToken(
  apiBaseUrl: string,
  ticketId: string,
  options?: {
    pollIntervalMs?: number;
    signal?: AbortSignal;
    timeoutMs?: number;
  },
): Promise<NetlifyTicketExchange> {
  const startedAt = Date.now();
  const timeoutMs = options?.timeoutMs ?? 15 * 60 * 1000;
  const pollIntervalMs = options?.pollIntervalMs ?? 1000;

  while (Date.now() - startedAt < timeoutMs) {
    if (options?.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }

    const ticket = await getNetlifyTicket(apiBaseUrl, ticketId);
    if (ticket.authorized) {
      return exchangeNetlifyTicket(apiBaseUrl, ticketId);
    }

    await delay(pollIntervalMs, options?.signal);
  }

  throw new Error('Login expired, please try again');
}

export interface NetlifyAccount {
  id: string;
  slug: string;
  name: string | null;
  type: string | null;
}

export async function fetchNetlifyAccounts(
  apiBaseUrl: string,
  token: string,
): Promise<NetlifyAccount[]> {
  const response = await netlifyFetch(
    apiBaseUrl,
    '/accounts',
    {
      headers: {
        Authorization: `Bearer ${token.trim()}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load Netlify accounts'));
  }

  const payload = await response.json() as unknown;
  if (!Array.isArray(payload)) {
    return [];
  }

  const accounts: NetlifyAccount[] = [];
  for (const entry of payload) {
    if (!isRecord(entry)) continue;
    const id = coerceString(entry.id);
    const slug = coerceString(entry.slug);
    if (!id || !slug) continue;
    accounts.push({
      id,
      slug,
      name: coerceString(entry.name),
      type: coerceString(entry.type),
    });
  }

  return accounts;
}

export async function fetchNetlifyCurrentUser(
  apiBaseUrl: string,
  token: string,
): Promise<NetlifyCurrentUser> {
  const response = await netlifyFetch(
    apiBaseUrl,
    '/user',
    {
      headers: {
        Authorization: `Bearer ${token.trim()}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to load Netlify user'));
  }

  const payload = await response.json() as unknown;
  const user = isRecord(payload) ? payload : {};

  return {
    id: coerceString(user.id),
    email: coerceString(user.email),
    name: coerceString(user.full_name),
  };
}
