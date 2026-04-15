import type { VirtualFS } from '../virtual-fs';
import * as path from './path';

export const DEFAULT_SPRITES_API_URL = 'https://api.sprites.dev';
export const SPRITES_CONFIG_PATH = '/home/user/.sprites/sprites.json';
export const SPRITE_CONTEXT_FILE_NAME = '.sprite';

export interface SpriteOrgConfig {
  name: string;
  keyring_key?: string;
  use_keyring?: boolean;
  api_token?: string;
  sprites?: Record<string, unknown>;
}

export interface SpriteUrlConfig {
  url: string;
  orgs: Record<string, SpriteOrgConfig>;
}

export interface SpriteConfigFile {
  version: string;
  current_selection: {
    url: string;
    org?: string;
  };
  urls: Record<string, SpriteUrlConfig>;
}

export interface SpriteLocalContext {
  organization?: string;
  sprite?: string;
}

export interface ResolvedSpriteSelection {
  apiUrl: string;
  org: string | null;
  sprite: string | null;
  token: string | null;
  config: SpriteConfigFile;
  localContext: SpriteLocalContext | null;
}

function normalizePath(input: string): string {
  if (!input) {
    return '/';
  }
  const normalized = input.replace(/\\/g, '/').replace(/\/+/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function readJson<T>(vfs: VirtualFS, filePath: string): T | null {
  try {
    return JSON.parse(vfs.readFileSync(filePath, 'utf8')) as T;
  } catch {
    return null;
  }
}

function writeJson(vfs: VirtualFS, filePath: string, value: unknown): void {
  const parent = path.dirname(filePath);
  if (!vfs.existsSync(parent)) {
    vfs.mkdirSync(parent, { recursive: true });
  }
  vfs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function createEmptySpriteConfig(): SpriteConfigFile {
  return {
    version: '1',
    current_selection: {
      url: DEFAULT_SPRITES_API_URL,
    },
    urls: {},
  };
}

export function normalizeSpritesApiUrl(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_SPRITES_API_URL;
  }
  return trimmed.replace(/\/+$/, '') || DEFAULT_SPRITES_API_URL;
}

export function inferSpriteOrgFromToken(token?: string | null): string | null {
  const trimmed = token?.trim();
  if (!trimmed) {
    return null;
  }

  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length < 3) {
    return null;
  }

  const org = parts[0]?.trim();
  return org ? org : null;
}

export function readSpriteConfig(vfs: VirtualFS): SpriteConfigFile {
  const config = readJson<SpriteConfigFile>(vfs, SPRITES_CONFIG_PATH);
  if (!config || typeof config !== 'object') {
    return createEmptySpriteConfig();
  }

  const apiUrl = normalizeSpritesApiUrl(config.current_selection?.url);
  const urls: Record<string, SpriteUrlConfig> = {};
  const inputUrls = config.urls && typeof config.urls === 'object' ? config.urls : {};

  for (const [rawUrl, rawEntry] of Object.entries(inputUrls)) {
    if (!rawEntry || typeof rawEntry !== 'object') {
      continue;
    }

    const normalizedUrl = normalizeSpritesApiUrl(rawUrl);
    const orgs: Record<string, SpriteOrgConfig> = {};
    const inputOrgs = rawEntry.orgs && typeof rawEntry.orgs === 'object' ? rawEntry.orgs : {};

    for (const [orgName, rawOrg] of Object.entries(inputOrgs)) {
      if (!rawOrg || typeof rawOrg !== 'object') {
        continue;
      }

      orgs[orgName] = {
        name: typeof rawOrg.name === 'string' && rawOrg.name ? rawOrg.name : orgName,
        keyring_key:
          typeof rawOrg.keyring_key === 'string' && rawOrg.keyring_key
            ? rawOrg.keyring_key
            : undefined,
        use_keyring: rawOrg.use_keyring === true,
        api_token:
          typeof rawOrg.api_token === 'string' && rawOrg.api_token
            ? rawOrg.api_token
            : undefined,
        sprites:
          rawOrg.sprites && typeof rawOrg.sprites === 'object'
            ? rawOrg.sprites
            : {},
      };
    }

    urls[normalizedUrl] = {
      url: normalizedUrl,
      orgs,
    };
  }

  return {
    version: typeof config.version === 'string' && config.version ? config.version : '1',
    current_selection: {
      url: apiUrl,
      org:
        typeof config.current_selection?.org === 'string' && config.current_selection.org
          ? config.current_selection.org
          : undefined,
    },
    urls,
  };
}

export function writeSpriteConfig(vfs: VirtualFS, config: SpriteConfigFile): void {
  writeJson(vfs, SPRITES_CONFIG_PATH, config);
}

export function deleteSpriteConfig(vfs: VirtualFS): boolean {
  if (!vfs.existsSync(SPRITES_CONFIG_PATH)) {
    return false;
  }
  try {
    vfs.unlinkSync(SPRITES_CONFIG_PATH);
    return true;
  } catch {
    return false;
  }
}

export function findSpriteContextPath(vfs: VirtualFS, cwd: string): string | null {
  let current = normalizePath(cwd || '/');

  while (true) {
    const candidate = normalizePath(path.join(current, SPRITE_CONTEXT_FILE_NAME));
    if (vfs.existsSync(candidate)) {
      return candidate;
    }
    if (current === '/') {
      return null;
    }
    current = normalizePath(path.dirname(current));
  }
}

export function readSpriteLocalContext(vfs: VirtualFS, cwd: string): SpriteLocalContext | null {
  const contextPath = findSpriteContextPath(vfs, cwd);
  if (!contextPath) {
    return null;
  }

  const context = readJson<SpriteLocalContext>(vfs, contextPath);
  if (!context || typeof context !== 'object') {
    return null;
  }

  return {
    organization:
      typeof context.organization === 'string' && context.organization
        ? context.organization
        : undefined,
    sprite:
      typeof context.sprite === 'string' && context.sprite
        ? context.sprite
        : undefined,
  };
}

export function writeSpriteLocalContext(vfs: VirtualFS, cwd: string, context: SpriteLocalContext): void {
  const filePath = normalizePath(path.join(cwd, SPRITE_CONTEXT_FILE_NAME));
  writeJson(vfs, filePath, context);
}

export function deleteSpriteLocalContext(vfs: VirtualFS, cwd: string): boolean {
  const filePath = normalizePath(path.join(cwd, SPRITE_CONTEXT_FILE_NAME));
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

export function listConfiguredSpriteOrgs(
  vfs: VirtualFS,
  apiUrl = DEFAULT_SPRITES_API_URL,
): Array<{ apiUrl: string; org: string; hasToken: boolean; current: boolean }> {
  const config = readSpriteConfig(vfs);
  const normalizedUrl = normalizeSpritesApiUrl(apiUrl);
  const currentUrl = normalizeSpritesApiUrl(config.current_selection.url);
  const orgs = config.urls[normalizedUrl]?.orgs ?? {};

  return Object.entries(orgs).map(([org, entry]) => ({
    apiUrl: normalizedUrl,
    org,
    hasToken: Boolean(entry.api_token),
    current: currentUrl === normalizedUrl && config.current_selection.org === org,
  }));
}

export function rememberSpriteSelection(
  vfs: VirtualFS,
  apiUrl: string,
  org?: string | null,
): void {
  const config = readSpriteConfig(vfs);
  config.current_selection = {
    url: normalizeSpritesApiUrl(apiUrl),
    org: org?.trim() || undefined,
  };
  writeSpriteConfig(vfs, config);
}

export function storeSpriteToken(
  vfs: VirtualFS,
  options: {
    apiUrl?: string | null;
    org: string;
    token: string;
  },
): void {
  const apiUrl = normalizeSpritesApiUrl(options.apiUrl);
  const org = options.org.trim();
  const token = options.token.trim();
  const config = readSpriteConfig(vfs);

  if (!config.urls[apiUrl]) {
    config.urls[apiUrl] = {
      url: apiUrl,
      orgs: {},
    };
  }

  const existing = config.urls[apiUrl].orgs[org];
  config.urls[apiUrl].orgs[org] = {
    name: org,
    keyring_key: existing?.keyring_key,
    use_keyring: false,
    api_token: token,
    sprites: existing?.sprites ?? {},
  };
  config.current_selection = { url: apiUrl, org };
  writeSpriteConfig(vfs, config);
}

export function removeSpriteOrg(
  vfs: VirtualFS,
  options?: {
    apiUrl?: string | null;
    org?: string | null;
  },
): boolean {
  const config = readSpriteConfig(vfs);
  const apiUrl = normalizeSpritesApiUrl(options?.apiUrl);

  if (!options?.org) {
    if (!config.urls[apiUrl]) {
      return false;
    }
    delete config.urls[apiUrl];
  } else {
    const org = options.org.trim();
    if (!org || !config.urls[apiUrl]?.orgs[org]) {
      return false;
    }
    delete config.urls[apiUrl].orgs[org];
    if (Object.keys(config.urls[apiUrl].orgs).length === 0) {
      delete config.urls[apiUrl];
    }
  }

  const currentUrl = normalizeSpritesApiUrl(config.current_selection.url);
  const currentOrg = config.current_selection.org;
  const currentUrlMissing = !config.urls[currentUrl];
  const currentOrgMissing = currentOrg
    ? !config.urls[currentUrl]?.orgs[currentOrg]
    : false;

  if (currentUrlMissing || currentOrgMissing) {
    const [nextUrl, nextEntry] = Object.entries(config.urls)[0] ?? [];
    const nextOrg = nextEntry ? Object.keys(nextEntry.orgs)[0] : undefined;
    config.current_selection = {
      url: nextUrl ? normalizeSpritesApiUrl(nextUrl) : DEFAULT_SPRITES_API_URL,
      org: nextOrg,
    };
  }

  if (Object.keys(config.urls).length === 0) {
    return deleteSpriteConfig(vfs);
  }

  writeSpriteConfig(vfs, config);
  return true;
}

export function resolveSpriteSelection(
  vfs: VirtualFS,
  cwd: string,
  env: Record<string, string> = {},
  overrides: {
    apiUrl?: string | null;
    org?: string | null;
    sprite?: string | null;
  } = {},
): ResolvedSpriteSelection {
  const config = readSpriteConfig(vfs);
  const localContext = readSpriteLocalContext(vfs, cwd);

  const apiUrl = normalizeSpritesApiUrl(
    overrides.apiUrl
      ?? env.SPRITES_API_URL
      ?? config.current_selection.url,
  );

  const configuredOrgs = config.urls[apiUrl]?.orgs ?? {};
  const envToken = env.SPRITE_TOKEN?.trim() || env.SPRITES_TOKEN?.trim() || null;
  const inferredOrgFromToken = inferSpriteOrgFromToken(envToken);

  let org = overrides.org?.trim()
    || env.SPRITE_ORG?.trim()
    || localContext?.organization?.trim()
    || config.current_selection.org?.trim()
    || inferredOrgFromToken
    || null;

  if (!org) {
    const availableOrgs = Object.entries(configuredOrgs).filter(([, entry]) => Boolean(entry.api_token));
    if (availableOrgs.length === 1) {
      org = availableOrgs[0]?.[0] ?? null;
    }
  }

  const token = envToken || (org ? configuredOrgs[org]?.api_token?.trim() || null : null);

  return {
    apiUrl,
    org,
    sprite: overrides.sprite?.trim() || localContext?.sprite?.trim() || null,
    token,
    config,
    localContext,
  };
}
