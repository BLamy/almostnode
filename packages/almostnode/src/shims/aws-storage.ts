import type { VirtualFS } from '../virtual-fs';
import * as path from './path';

export const AWS_CONFIG_PATH = '/home/user/.config/almostnode/aws/config.json';
export const AWS_AUTH_PATH = '/home/user/.config/almostnode/aws/auth.json';
const AWS_STORAGE_VERSION = 1;
const DEFAULT_REGISTRATION_SCOPE = 'sso:account:access';

export type AwsOutputFormat = 'json' | 'text';

export interface AwsSsoSessionConfig {
  startUrl: string;
  region: string;
  registrationScopes: string[];
}

export interface AwsProfileConfig {
  ssoSession: string;
  accountId: string;
  roleName: string;
  region?: string;
  output?: AwsOutputFormat;
}

export interface AwsConfigFile {
  version: number;
  defaultProfile: string | null;
  ssoSessions: Record<string, AwsSsoSessionConfig>;
  profiles: Record<string, AwsProfileConfig>;
}

export interface AwsSsoClientRegistration {
  clientId: string;
  clientSecret: string;
  clientSecretExpiresAt: string;
  region: string;
  startUrl: string;
  registrationScopes: string[];
}

export interface AwsSsoSessionToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  issuedAt: string;
  region: string;
  startUrl: string;
  registrationScopes: string[];
}

export interface AwsRoleCredentialCache {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken: string;
  expiresAt: string;
  accountId: string;
  roleName: string;
  region: string;
  ssoSession: string;
}

export interface AwsAuthFile {
  version: number;
  clients: Record<string, AwsSsoClientRegistration>;
  sessions: Record<string, AwsSsoSessionToken>;
  roleCredentials: Record<string, AwsRoleCredentialCache>;
}

export interface AwsStoredStateSummary {
  hasConfig: boolean;
  hasProfiles: boolean;
  hasSsoSessions: boolean;
  hasAuth: boolean;
  hasValidAccessToken: boolean;
  hasValidRoleCredentials: boolean;
  defaultProfile: string | null;
  profileNames: string[];
  sessionNames: string[];
}

function ensureDir(vfs: VirtualFS, filePath: string): void {
  const dir = path.dirname(filePath);
  if (!vfs.existsSync(dir)) {
    vfs.mkdirSync(dir, { recursive: true });
  }
}

function readJson<T>(vfs: VirtualFS, filePath: string): T | null {
  if (!vfs.existsSync(filePath)) {
    return null;
  }
  try {
    return JSON.parse(vfs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(vfs: VirtualFS, filePath: string, value: unknown): void {
  ensureDir(vfs, filePath);
  vfs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n');
}

function normalizeScopes(value: unknown): string[] {
  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => String(entry || '').trim())
      .filter(Boolean);
    return normalized.length > 0 ? normalized : [DEFAULT_REGISTRATION_SCOPE];
  }
  if (typeof value === 'string' && value.trim()) {
    return value
      .split(/[,\s]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }
  return [DEFAULT_REGISTRATION_SCOPE];
}

function normalizeOutput(value: unknown): AwsOutputFormat | undefined {
  return value === 'text' ? 'text' : value === 'json' ? 'json' : undefined;
}

function normalizeConfig(raw: Partial<AwsConfigFile> | null): AwsConfigFile {
  const ssoSessions: Record<string, AwsSsoSessionConfig> = {};
  const profiles: Record<string, AwsProfileConfig> = {};

  for (const [name, session] of Object.entries(raw?.ssoSessions || {})) {
    if (!session || typeof session !== 'object') continue;
    const startUrl = String((session as AwsSsoSessionConfig).startUrl || '').trim();
    const region = String((session as AwsSsoSessionConfig).region || '').trim();
    if (!startUrl || !region) continue;
    ssoSessions[name] = {
      startUrl,
      region,
      registrationScopes: normalizeScopes((session as AwsSsoSessionConfig).registrationScopes),
    };
  }

  for (const [name, profile] of Object.entries(raw?.profiles || {})) {
    if (!profile || typeof profile !== 'object') continue;
    const ssoSession = String((profile as AwsProfileConfig).ssoSession || '').trim();
    const accountId = String((profile as AwsProfileConfig).accountId || '').trim();
    const roleName = String((profile as AwsProfileConfig).roleName || '').trim();
    if (!ssoSession || !accountId || !roleName) continue;
    profiles[name] = {
      ssoSession,
      accountId,
      roleName,
      region: String((profile as AwsProfileConfig).region || '').trim() || undefined,
      output: normalizeOutput((profile as AwsProfileConfig).output),
    };
  }

  const defaultProfile = typeof raw?.defaultProfile === 'string' && profiles[raw.defaultProfile]
    ? raw.defaultProfile
    : Object.keys(profiles)[0] || null;

  return {
    version: AWS_STORAGE_VERSION,
    defaultProfile,
    ssoSessions,
    profiles,
  };
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

function normalizeAuth(raw: Partial<AwsAuthFile> | null): AwsAuthFile {
  const clients: Record<string, AwsSsoClientRegistration> = {};
  const sessions: Record<string, AwsSsoSessionToken> = {};
  const roleCredentials: Record<string, AwsRoleCredentialCache> = {};

  for (const [name, client] of Object.entries(raw?.clients || {})) {
    if (!client || typeof client !== 'object') continue;
    const normalizedExpiry = normalizeIsoTimestamp((client as AwsSsoClientRegistration).clientSecretExpiresAt);
    const clientId = String((client as AwsSsoClientRegistration).clientId || '').trim();
    const clientSecret = String((client as AwsSsoClientRegistration).clientSecret || '').trim();
    const region = String((client as AwsSsoClientRegistration).region || '').trim();
    const startUrl = String((client as AwsSsoClientRegistration).startUrl || '').trim();
    if (!normalizedExpiry || !clientId || !clientSecret || !region || !startUrl) continue;
    clients[name] = {
      clientId,
      clientSecret,
      clientSecretExpiresAt: normalizedExpiry,
      region,
      startUrl,
      registrationScopes: normalizeScopes((client as AwsSsoClientRegistration).registrationScopes),
    };
  }

  for (const [name, session] of Object.entries(raw?.sessions || {})) {
    if (!session || typeof session !== 'object') continue;
    const expiresAt = normalizeIsoTimestamp((session as AwsSsoSessionToken).expiresAt);
    const issuedAt = normalizeIsoTimestamp((session as AwsSsoSessionToken).issuedAt) || new Date(0).toISOString();
    const accessToken = String((session as AwsSsoSessionToken).accessToken || '').trim();
    const region = String((session as AwsSsoSessionToken).region || '').trim();
    const startUrl = String((session as AwsSsoSessionToken).startUrl || '').trim();
    if (!expiresAt || !accessToken || !region || !startUrl) continue;
    sessions[name] = {
      accessToken,
      refreshToken: String((session as AwsSsoSessionToken).refreshToken || '').trim() || undefined,
      expiresAt,
      issuedAt,
      region,
      startUrl,
      registrationScopes: normalizeScopes((session as AwsSsoSessionToken).registrationScopes),
    };
  }

  for (const [name, creds] of Object.entries(raw?.roleCredentials || {})) {
    if (!creds || typeof creds !== 'object') continue;
    const expiresAt = normalizeIsoTimestamp((creds as AwsRoleCredentialCache).expiresAt);
    const accessKeyId = String((creds as AwsRoleCredentialCache).accessKeyId || '').trim();
    const secretAccessKey = String((creds as AwsRoleCredentialCache).secretAccessKey || '').trim();
    const sessionToken = String((creds as AwsRoleCredentialCache).sessionToken || '').trim();
    const accountId = String((creds as AwsRoleCredentialCache).accountId || '').trim();
    const roleName = String((creds as AwsRoleCredentialCache).roleName || '').trim();
    const region = String((creds as AwsRoleCredentialCache).region || '').trim();
    const ssoSession = String((creds as AwsRoleCredentialCache).ssoSession || '').trim();
    if (!expiresAt || !accessKeyId || !secretAccessKey || !sessionToken || !accountId || !roleName || !region || !ssoSession) {
      continue;
    }
    roleCredentials[name] = {
      accessKeyId,
      secretAccessKey,
      sessionToken,
      expiresAt,
      accountId,
      roleName,
      region,
      ssoSession,
    };
  }

  return {
    version: AWS_STORAGE_VERSION,
    clients,
    sessions,
    roleCredentials,
  };
}

export function readAwsConfig(vfs: VirtualFS): AwsConfigFile {
  return normalizeConfig(readJson<AwsConfigFile>(vfs, AWS_CONFIG_PATH));
}

export function writeAwsConfig(vfs: VirtualFS, config: AwsConfigFile): void {
  writeJson(vfs, AWS_CONFIG_PATH, normalizeConfig(config));
}

export function readAwsAuth(vfs: VirtualFS): AwsAuthFile {
  return normalizeAuth(readJson<AwsAuthFile>(vfs, AWS_AUTH_PATH));
}

export function writeAwsAuth(vfs: VirtualFS, auth: AwsAuthFile): void {
  writeJson(vfs, AWS_AUTH_PATH, normalizeAuth(auth));
}

export function isAwsTimestampValid(value: string | null | undefined, skewMs = 60_000): boolean {
  if (!value) {
    return false;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now() + skewMs;
}

export function inspectAwsStoredState(vfs: VirtualFS): AwsStoredStateSummary {
  const config = readAwsConfig(vfs);
  const auth = readAwsAuth(vfs);
  const profileNames = Object.keys(config.profiles);
  const sessionNames = Object.keys(config.ssoSessions);

  return {
    hasConfig: vfs.existsSync(AWS_CONFIG_PATH),
    hasProfiles: profileNames.length > 0,
    hasSsoSessions: sessionNames.length > 0,
    hasAuth: vfs.existsSync(AWS_AUTH_PATH),
    hasValidAccessToken: Object.values(auth.sessions).some((session) => isAwsTimestampValid(session.expiresAt)),
    hasValidRoleCredentials: Object.values(auth.roleCredentials).some((credential) => isAwsTimestampValid(credential.expiresAt)),
    defaultProfile: config.defaultProfile,
    profileNames,
    sessionNames,
  };
}
