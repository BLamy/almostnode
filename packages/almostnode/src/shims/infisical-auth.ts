import { getDefaultNetworkController, networkFetch } from '../network';
import type { VirtualFS } from '../virtual-fs';
import * as path from './path';

export const INFISICAL_CONFIG_DIR = '/home/user/.infisical';
export const INFISICAL_CONFIG_PATH = `${INFISICAL_CONFIG_DIR}/infisical-config.json`;
export const INFISICAL_AUTH_PATH = `${INFISICAL_CONFIG_DIR}/auth.json`;
export const INFISICAL_WORKSPACE_FILE_NAME = '.infisical.json';
export const DEFAULT_INFISICAL_DOMAIN = 'https://app.infisical.com';

const INFISICAL_STORAGE_VERSION = 2;
const INFISICAL_EXPIRY_BUFFER_MS = 30_000;

export type InfisicalVaultBackend = 'auto' | 'file';
export type InfisicalAuthMethod = 'universal-auth' | 'user';

export interface InfisicalMachineIdentityConfig {
  method: InfisicalAuthMethod;
  clientId: string | null;
  clientSecret: string | null;
  organizationSlug: string | null;
}

export interface InfisicalConfigFile {
  version: number;
  domain: string;
  domains: string[];
  loggedInUserEmail: string | null;
  machineIdentity: InfisicalMachineIdentityConfig | null;
  path: string;
  raw: Record<string, unknown>;
  vaultBackendType: InfisicalVaultBackend;
}

export interface InfisicalAuthFile {
  version: number;
  accessToken: string | null;
  email: string | null;
  refreshToken: string | null;
  privateKey: string | null;
  tokenType: string | null;
  expiresAt: string | null;
  issuedAt: string | null;
  domain: string;
  method: InfisicalAuthMethod | null;
  clientId: string | null;
  organizationSlug: string | null;
}

export interface InfisicalStoredStateSummary {
  clientId: string | null;
  domain: string;
  email: string | null;
  expiresAt: string | null;
  hasAuth: boolean;
  hasConfig: boolean;
  hasMachineIdentity: boolean;
  hasValidAccessToken: boolean;
  organizationSlug: string | null;
}

export interface InfisicalWorkspaceConfigFile {
  defaultEnvironment: string | null;
  gitBranchToEnvironmentMapping: Record<string, string> | null;
  path: string | null;
  raw: Record<string, unknown>;
  workspaceId: string | null;
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
  vfs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function coerceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function coerceStringRecord(
  value: unknown,
): Record<string, string> | null {
  if (!isRecord(value)) {
    return null;
  }

  const next: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    const normalizedKey = key.trim();
    const normalizedValue = coerceString(entry);
    if (!normalizedKey || !normalizedValue) {
      continue;
    }
    next[normalizedKey] = normalizedValue;
  }

  return Object.keys(next).length > 0 ? next : null;
}

function normalizeVaultBackend(value: unknown): InfisicalVaultBackend {
  return value === 'file' ? 'file' : 'auto';
}

function normalizeIsoTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) {
    return null;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return null;
  }

  return new Date(timestamp).toISOString();
}

function parseJwtTimestamp(token: string | null, claim: 'exp' | 'iat'): string | null {
  if (!token) {
    return null;
  }

  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) {
    return null;
  }

  try {
    const base64 = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .padEnd(Math.ceil(parts[1].length / 4) * 4, '=');
    const decoded = typeof Buffer !== 'undefined'
      ? Buffer.from(base64, 'base64').toString('utf8')
      : atob(base64);
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    const value = parsed[claim];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return null;
    }
    return new Date(value * 1000).toISOString();
  } catch {
    return null;
  }
}

export function normalizeInfisicalDomain(value: unknown): string {
  const raw = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_INFISICAL_DOMAIN;
  const withoutTrailingSlash = raw.replace(/\/+$/g, '');
  const withoutApiSuffix = withoutTrailingSlash.replace(/\/api$/i, '');
  let parsed: URL;

  try {
    parsed = new URL(withoutApiSuffix);
  } catch {
    return DEFAULT_INFISICAL_DOMAIN;
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    return DEFAULT_INFISICAL_DOMAIN;
  }

  parsed.pathname = parsed.pathname.replace(/\/+$/g, '') || '';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/g, '');
}

function normalizeDomains(raw: unknown, domain: string): string[] {
  const values = Array.isArray(raw)
    ? raw
      .map((entry) => normalizeInfisicalDomain(entry))
      .filter(Boolean)
    : [];
  if (!values.includes(domain)) {
    values.push(domain);
  }
  return Array.from(new Set(values));
}

function normalizeMachineIdentity(value: unknown): InfisicalMachineIdentityConfig | null {
  if (!isRecord(value)) {
    return null;
  }

  const method = value.method === 'universal-auth' ? 'universal-auth' : 'universal-auth';
  const clientId = coerceString(value.clientId);
  const clientSecret = coerceString(value.clientSecret);
  const organizationSlug = coerceString(value.organizationSlug);

  if (!clientId && !clientSecret && !organizationSlug) {
    return null;
  }

  return {
    method,
    clientId,
    clientSecret,
    organizationSlug,
  };
}

export function readInfisicalConfig(vfs: VirtualFS): InfisicalConfigFile {
  const raw = readJsonFile(vfs, INFISICAL_CONFIG_PATH) ?? {};
  const domain = normalizeInfisicalDomain(raw.domain);

  return {
    version: INFISICAL_STORAGE_VERSION,
    domain,
    domains: normalizeDomains(raw.domains, domain),
    loggedInUserEmail: coerceString(raw.loggedInUserEmail),
    machineIdentity: normalizeMachineIdentity(raw.machineIdentity),
    path: INFISICAL_CONFIG_PATH,
    raw,
    vaultBackendType: normalizeVaultBackend(raw.vaultBackendType),
  };
}

export function writeInfisicalConfig(vfs: VirtualFS, config: InfisicalConfigFile): void {
  const domain = normalizeInfisicalDomain(config.domain);
  const raw = isRecord(config.raw) ? { ...config.raw } : {};
  raw.version = INFISICAL_STORAGE_VERSION;
  raw.domain = domain;
  raw.domains = normalizeDomains(config.domains, domain);
  raw.vaultBackendType = normalizeVaultBackend(config.vaultBackendType);

  if (config.loggedInUserEmail) {
    raw.loggedInUserEmail = config.loggedInUserEmail;
    raw.LoggedInUserDomain = domain;
    raw.loggedInUsers = [{
      email: config.loggedInUserEmail,
      domain,
    }];
  } else {
    delete raw.loggedInUserEmail;
    delete raw.LoggedInUserDomain;
    delete raw.loggedInUsers;
  }

  if (config.machineIdentity?.clientId || config.machineIdentity?.clientSecret || config.machineIdentity?.organizationSlug) {
    raw.machineIdentity = {
      method: 'universal-auth',
      clientId: config.machineIdentity.clientId || '',
      clientSecret: config.machineIdentity.clientSecret || '',
      organizationSlug: config.machineIdentity.organizationSlug || undefined,
    };
  } else {
    delete raw.machineIdentity;
  }

  writeJsonFile(vfs, INFISICAL_CONFIG_PATH, raw);
}

export function readInfisicalAuth(vfs: VirtualFS): InfisicalAuthFile {
  const raw = readJsonFile(vfs, INFISICAL_AUTH_PATH) ?? {};
  const accessToken = coerceString(raw.accessToken);
  const refreshToken = coerceString(raw.refreshToken)
    || coerceString(raw.RefreshToken);
  const privateKey = coerceString(raw.privateKey);
  const email = coerceString(raw.email);
  const method = raw.method === 'universal-auth'
    ? 'universal-auth'
    : raw.method === 'user'
      ? 'user'
      : email || privateKey || refreshToken
        ? 'user'
        : null;

  return {
    version: INFISICAL_STORAGE_VERSION,
    accessToken,
    email,
    refreshToken,
    privateKey,
    tokenType: coerceString(raw.tokenType),
    expiresAt: normalizeIsoTimestamp(raw.expiresAt) || parseJwtTimestamp(accessToken, 'exp'),
    issuedAt: normalizeIsoTimestamp(raw.issuedAt) || parseJwtTimestamp(accessToken, 'iat'),
    domain: normalizeInfisicalDomain(raw.domain),
    method,
    clientId: coerceString(raw.clientId),
    organizationSlug: coerceString(raw.organizationSlug),
  };
}

export function writeInfisicalAuth(vfs: VirtualFS, auth: InfisicalAuthFile): void {
  const expiresAt = normalizeIsoTimestamp(auth.expiresAt)
    || parseJwtTimestamp(auth.accessToken, 'exp');
  const issuedAt = normalizeIsoTimestamp(auth.issuedAt)
    || parseJwtTimestamp(auth.accessToken, 'iat')
    || new Date().toISOString();
  const payload: Record<string, unknown> = {
    version: INFISICAL_STORAGE_VERSION,
    accessToken: auth.accessToken || '',
    email: auth.email || '',
    refreshToken: auth.refreshToken || '',
    privateKey: auth.privateKey || '',
    tokenType: auth.tokenType || 'Bearer',
    expiresAt,
    issuedAt,
    domain: normalizeInfisicalDomain(auth.domain),
    method: auth.method || 'user',
    clientId: auth.clientId || '',
  };

  if (auth.organizationSlug) {
    payload.organizationSlug = auth.organizationSlug;
  }

  writeJsonFile(vfs, INFISICAL_AUTH_PATH, payload);
}

export function deleteInfisicalAuth(vfs: VirtualFS): boolean {
  if (!vfs.existsSync(INFISICAL_AUTH_PATH)) {
    return false;
  }

  try {
    vfs.unlinkSync(INFISICAL_AUTH_PATH);
  } catch {
    // Ignore cleanup failures for compatibility with the other auth shims.
  }

  return true;
}

export function hasInfisicalAuth(vfs: VirtualFS): boolean {
  const auth = readInfisicalAuth(vfs);
  return Boolean(auth.accessToken);
}

export function isInfisicalAccessTokenValid(auth: InfisicalAuthFile, now = Date.now()): boolean {
  if (!auth.accessToken) {
    return false;
  }

  const expiresAt = Date.parse(auth.expiresAt || parseJwtTimestamp(auth.accessToken, 'exp') || '');
  if (!Number.isFinite(expiresAt)) {
    return false;
  }

  return expiresAt > now + INFISICAL_EXPIRY_BUFFER_MS;
}

export function inspectInfisicalStoredState(vfs: VirtualFS): InfisicalStoredStateSummary {
  const config = readInfisicalConfig(vfs);
  const auth = readInfisicalAuth(vfs);
  return {
    clientId: config.machineIdentity?.clientId || auth.clientId,
    domain: config.domain || auth.domain || DEFAULT_INFISICAL_DOMAIN,
    email: auth.email || config.loggedInUserEmail,
    expiresAt: auth.expiresAt,
    hasAuth: hasInfisicalAuth(vfs),
    hasConfig: vfs.existsSync(INFISICAL_CONFIG_PATH),
    hasMachineIdentity: Boolean(config.machineIdentity?.clientId && config.machineIdentity?.clientSecret),
    hasValidAccessToken: isInfisicalAccessTokenValid(auth),
    organizationSlug: config.machineIdentity?.organizationSlug || auth.organizationSlug,
  };
}

function findWorkspaceConfigPath(
  vfs: VirtualFS,
  cwd: string,
): string | null {
  let current = path.resolve(cwd || '/');

  while (true) {
    const candidate = path.join(current, INFISICAL_WORKSPACE_FILE_NAME);
    if (vfs.existsSync(candidate)) {
      return candidate;
    }
    if (current === '/') {
      return null;
    }
    current = path.dirname(current);
  }
}

export function readInfisicalWorkspaceConfig(
  vfs: VirtualFS,
  cwd: string,
): InfisicalWorkspaceConfigFile | null {
  const filePath = findWorkspaceConfigPath(vfs, cwd);
  if (!filePath) {
    return null;
  }

  const raw = readJsonFile(vfs, filePath) ?? {};
  return {
    defaultEnvironment: coerceString(raw.defaultEnvironment),
    gitBranchToEnvironmentMapping: coerceStringRecord(raw.gitBranchToEnvironmentMapping),
    path: filePath,
    raw,
    workspaceId: coerceString(raw.workspaceId),
  };
}

export interface InfisicalProjectEnvironment {
  id: string | null;
  name: string | null;
  slug: string | null;
}

export interface InfisicalProjectInfo {
  id: string;
  name: string;
  slug: string | null;
  environments: InfisicalProjectEnvironment[];
}

async function infisicalRuntimeFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const controller = getDefaultNetworkController();
  if (controller) {
    return networkFetch(input, init, controller);
  }
  return fetch(input, init);
}

async function readInfisicalErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      const payload = await response.json() as unknown;
      if (isRecord(payload)) {
        const message = coerceString(payload.message)
          ?? coerceString(payload.error)
          ?? (Array.isArray(payload.errors) && typeof payload.errors[0] === 'string'
            ? payload.errors[0]
            : null);
        if (message) {
          return `${fallback}: ${message}`;
        }
      }
    } else {
      const text = (await response.text()).trim();
      if (text) {
        return `${fallback}: ${text}`;
      }
    }
  } catch {
    // ignore body parsing failures
  }
  return `${fallback}: ${response.status} ${response.statusText}`;
}

export async function fetchInfisicalProjects(
  domain: string,
  token: string,
): Promise<InfisicalProjectInfo[]> {
  const url = `${normalizeInfisicalDomain(domain)}/api/v1/projects?type=secret-manager`;
  const response = await infisicalRuntimeFetch(url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token.trim()}`,
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(await readInfisicalErrorMessage(response, 'Failed to load Infisical projects'));
  }

  const payload = await response.json() as unknown;
  const rawProjects = isRecord(payload) && Array.isArray(payload.projects)
    ? payload.projects
    : [];

  const projects: InfisicalProjectInfo[] = [];
  for (const entry of rawProjects) {
    if (!isRecord(entry)) continue;
    const id = coerceString(entry.id);
    const name = coerceString(entry.name);
    if (!id || !name) continue;
    const environments: InfisicalProjectEnvironment[] = [];
    if (Array.isArray(entry.environments)) {
      for (const env of entry.environments) {
        if (!isRecord(env)) continue;
        environments.push({
          id: coerceString(env.id),
          name: coerceString(env.name),
          slug: coerceString(env.slug),
        });
      }
    }
    projects.push({
      id,
      name,
      slug: coerceString(entry.slug),
      environments,
    });
  }

  return projects;
}

export interface InfisicalOrganizationInfo {
  id: string;
  name: string | null;
  slug: string | null;
}

export async function fetchInfisicalOrganizations(
  domain: string,
  token: string,
): Promise<InfisicalOrganizationInfo[]> {
  const url = `${normalizeInfisicalDomain(domain)}/api/v1/organization`;
  const response = await infisicalRuntimeFetch(url, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${token.trim()}`,
      accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(await readInfisicalErrorMessage(response, 'Failed to load Infisical organizations'));
  }

  const payload = await response.json() as unknown;
  const list = isRecord(payload) && Array.isArray(payload.organizations)
    ? payload.organizations
    : Array.isArray(payload)
      ? payload
      : [];

  const orgs: InfisicalOrganizationInfo[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const id = coerceString(entry.id) ?? coerceString(entry._id);
    if (!id) continue;
    orgs.push({
      id,
      name: coerceString(entry.name),
      slug: coerceString(entry.slug),
    });
  }

  return orgs;
}

export interface ProvisionInfisicalUniversalAuthOptions {
  domain: string;
  token: string;
  identityName: string;
  organizationId?: string | null;
  projectId?: string | null;
  projectRole?: string;
}

export interface ProvisionInfisicalUniversalAuthResult {
  identityId: string;
  clientId: string;
  clientSecret: string;
  organizationId: string;
  organizationSlug: string | null;
  attachedToProject: boolean;
}

async function infisicalAuthorizedFetch(
  url: string,
  token: string,
  init: { method: string; body?: Record<string, unknown> },
): Promise<unknown> {
  const response = await infisicalRuntimeFetch(url, {
    method: init.method,
    headers: {
      authorization: `Bearer ${token.trim()}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });

  if (!response.ok) {
    throw new Error(await readInfisicalErrorMessage(response, `Infisical ${init.method} ${url} failed`));
  }

  if (response.status === 204) {
    return null;
  }

  try {
    return await response.json();
  } catch {
    return null;
  }
}

function readUniversalAuthClientId(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const direct = coerceString(payload.clientId);
  if (direct) return direct;
  const ua = isRecord(payload.identityUniversalAuth)
    ? payload.identityUniversalAuth
    : null;
  if (ua) {
    const inner = coerceString(ua.clientId);
    if (inner) return inner;
  }
  return null;
}

function readClientSecretValue(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const direct = coerceString(payload.clientSecret);
  if (direct) return direct;
  const data = isRecord(payload.clientSecretData)
    ? payload.clientSecretData
    : null;
  if (data) {
    const inner = coerceString(data.clientSecret);
    if (inner) return inner;
  }
  return null;
}

export async function provisionInfisicalUniversalAuth(
  options: ProvisionInfisicalUniversalAuthOptions,
): Promise<ProvisionInfisicalUniversalAuthResult> {
  const domain = normalizeInfisicalDomain(options.domain);
  const token = options.token;

  let organizationId = options.organizationId?.trim() ?? null;
  let organizationSlug: string | null = null;
  if (!organizationId) {
    const orgs = await fetchInfisicalOrganizations(domain, token);
    if (orgs.length === 0) {
      throw new Error('Infisical returned no organizations for this account.');
    }
    organizationId = orgs[0].id;
    organizationSlug = orgs[0].slug;
  }

  const createIdentityPayload = await infisicalAuthorizedFetch(
    `${domain}/api/v1/identities`,
    token,
    {
      method: 'POST',
      body: {
        name: options.identityName,
        organizationId,
        role: 'no-access',
      },
    },
  );

  const identityId = isRecord(createIdentityPayload)
    && isRecord(createIdentityPayload.identity)
      ? coerceString(createIdentityPayload.identity.id)
      : isRecord(createIdentityPayload)
        ? coerceString(createIdentityPayload.id)
        : null;

  if (!identityId) {
    throw new Error('Infisical identity creation returned no id.');
  }

  const enablePayload = await infisicalAuthorizedFetch(
    `${domain}/api/v1/auth/universal-auth/identities/${encodeURIComponent(identityId)}`,
    token,
    {
      method: 'POST',
      body: {
        accessTokenTTL: 7200,
        accessTokenMaxTTL: 7200,
        accessTokenNumUsesLimit: 0,
        clientSecretTrustedIps: [{ ipAddress: '0.0.0.0/0' }, { ipAddress: '::/0' }],
        accessTokenTrustedIps: [{ ipAddress: '0.0.0.0/0' }, { ipAddress: '::/0' }],
      },
    },
  );

  const clientId = readUniversalAuthClientId(enablePayload);
  if (!clientId) {
    throw new Error('Infisical Universal Auth enable did not return a clientId.');
  }

  const secretPayload = await infisicalAuthorizedFetch(
    `${domain}/api/v1/auth/universal-auth/identities/${encodeURIComponent(identityId)}/client-secrets`,
    token,
    {
      method: 'POST',
      body: {
        description: `Created by almostnode for ${options.identityName}`,
        ttl: 0,
        numUsesLimit: 0,
      },
    },
  );

  const clientSecret = readClientSecretValue(secretPayload);
  if (!clientSecret) {
    throw new Error('Infisical client-secret creation did not return a secret.');
  }

  let attachedToProject = false;
  if (options.projectId) {
    const role = (options.projectRole ?? 'admin').trim() || 'admin';
    try {
      await infisicalAuthorizedFetch(
        `${domain}/api/v2/workspace/${encodeURIComponent(options.projectId)}/identity-memberships/${encodeURIComponent(identityId)}`,
        token,
        {
          method: 'POST',
          body: { role },
        },
      );
      attachedToProject = true;
    } catch (error) {
      throw new Error(
        `Universal Auth credentials created, but failed to attach the identity to project ${options.projectId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    identityId,
    clientId,
    clientSecret,
    organizationId,
    organizationSlug,
    attachedToProject,
  };
}

function isFolderAlreadyExistsError(message: string): boolean {
  const lowered = message.toLowerCase();
  return (
    lowered.includes("already exists")
    || lowered.includes("duplicate")
    || lowered.includes("conflict")
    || lowered.includes("unique constraint")
  );
}

export async function ensureInfisicalFolder(options: {
  domain: string;
  token: string;
  projectId: string;
  environment: string;
  secretPath: string;
}): Promise<void> {
  const trimmedPath = options.secretPath.replace(/\/+$/g, "") || "/";
  if (trimmedPath === "/") {
    return;
  }

  const segments = trimmedPath.split("/").filter(Boolean);
  if (segments.length === 0) {
    return;
  }

  const domain = normalizeInfisicalDomain(options.domain);
  const headers = {
    authorization: `Bearer ${options.token.trim()}`,
    accept: "application/json",
    "content-type": "application/json",
  };

  let parent = "/";
  for (const segment of segments) {
    const body = JSON.stringify({
      workspaceId: options.projectId,
      projectId: options.projectId,
      environment: options.environment,
      name: segment,
      path: parent,
      directory: parent,
    });

    const response = await infisicalRuntimeFetch(`${domain}/api/v1/folders`, {
      method: "POST",
      headers,
      body,
    });

    if (!response.ok) {
      const message = await readInfisicalErrorMessage(
        response,
        `Failed to create Infisical folder ${parent === "/" ? "/" : parent + "/"}${segment}`,
      );
      if (!isFolderAlreadyExistsError(message)) {
        throw new Error(message);
      }
    }

    parent = parent === "/" ? `/${segment}` : `${parent}/${segment}`;
  }
}

export async function upsertInfisicalSecret(options: {
  domain: string;
  token: string;
  projectId: string;
  environment: string;
  key: string;
  value: string;
  secretPath?: string;
  type?: string;
}): Promise<'created' | 'updated'> {
  const domain = normalizeInfisicalDomain(options.domain);
  const secretPath = options.secretPath?.trim() || '/';
  const type = options.type?.trim() || 'shared';
  const url = `${domain}/api/v4/secrets/${encodeURIComponent(options.key)}`;
  const body = JSON.stringify({
    environment: options.environment,
    projectId: options.projectId,
    secretPath,
    secretValue: options.value,
    type,
  });

  const headers = {
    authorization: `Bearer ${options.token.trim()}`,
    accept: 'application/json',
    'content-type': 'application/json',
  };

  const patchResponse = await infisicalRuntimeFetch(url, {
    method: 'PATCH',
    headers,
    body,
  });

  if (patchResponse.ok) {
    return 'updated';
  }

  if (patchResponse.status !== 404) {
    throw new Error(await readInfisicalErrorMessage(patchResponse, `Failed to update secret ${options.key}`));
  }

  const postResponse = await infisicalRuntimeFetch(url, {
    method: 'POST',
    headers,
    body,
  });

  if (!postResponse.ok) {
    throw new Error(await readInfisicalErrorMessage(postResponse, `Failed to create secret ${options.key}`));
  }

  return 'created';
}

export function writeInfisicalWorkspaceConfig(
  vfs: VirtualFS,
  cwd: string,
  config: {
    defaultEnvironment?: string | null;
    gitBranchToEnvironmentMapping?: Record<string, string> | null;
    workspaceId: string;
  },
): string {
  const filePath = path.join(path.resolve(cwd || '/'), INFISICAL_WORKSPACE_FILE_NAME);
  const payload: Record<string, unknown> = {
    workspaceId: config.workspaceId.trim(),
  };

  if (config.defaultEnvironment?.trim()) {
    payload.defaultEnvironment = config.defaultEnvironment.trim();
  }

  if (config.gitBranchToEnvironmentMapping && Object.keys(config.gitBranchToEnvironmentMapping).length > 0) {
    payload.gitBranchToEnvironmentMapping = config.gitBranchToEnvironmentMapping;
  }

  writeJsonFile(vfs, filePath, payload);
  return filePath;
}
