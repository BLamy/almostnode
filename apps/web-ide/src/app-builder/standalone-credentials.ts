import type { DecryptedFileMap } from './standalone-vault';

export const CREDENTIAL_PATHS = {
  claude: '/home/user/.claude/.credentials.json',
  gh: '/home/user/.config/gh/hosts.yml',
  replay: '/home/user/.replay/auth.json',
  netlify: '/home/user/.config/netlify/config.json',
  netlifyLegacy: '/home/user/.netlify/config.json',
  neon: '/home/user/.config/neonctl/credentials.json',
  infisicalConfig: '/home/user/.infisical/infisical-config.json',
  infisicalAuth: '/home/user/.infisical/auth.json',
  fly: '/home/user/.fly/config.yml',
} as const;

export interface ExtractedCredentials {
  ANTHROPIC_API_KEY: string | null;
  GITHUB_TOKEN: string | null;
  RECORD_REPLAY_API_KEY: string | null;
  NETLIFY_AUTH_TOKEN: string | null;
  NEON_API_KEY: string | null;
  NEON_ACCESS_TOKEN: string | null;
  INFISICAL_CLIENT_ID: string | null;
  INFISICAL_CLIENT_SECRET: string | null;
  INFISICAL_ACCESS_TOKEN: string | null;
  INFISICAL_DOMAIN: string | null;
  FLY_API_TOKEN: string | null;
}

function safeJson<T>(raw: string | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function parseGhHostsYml(raw: string): string | null {
  let currentHost: string | null = null;
  let ghHostToken: string | null = null;
  let firstToken: string | null = null;

  for (const line of raw.split('\n')) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;

    if (!line.startsWith(' ') && !line.startsWith('\t') && trimmed.endsWith(':')) {
      currentHost = trimmed.slice(0, -1);
      continue;
    }

    if (!currentHost) continue;
    const match = line.trim().match(/^oauth_token:\s*(.*)$/);
    if (!match) continue;
    const token = match[1].trim();
    if (!token) continue;
    if (currentHost === 'github.com') {
      ghHostToken = token;
    }
    if (!firstToken) {
      firstToken = token;
    }
  }

  return ghHostToken ?? firstToken;
}

function parseFlyConfigYml(raw: string): string | null {
  // Fly config.yml is simple. Token lives under `access_token:` or within `tokens:`/`auth_tokens:`.
  for (const line of raw.split('\n')) {
    const match = line.match(/^\s*(access_token|default|token):\s*(.+?)\s*$/);
    if (match) {
      const value = match[2].replace(/^['"]|['"]$/g, '').trim();
      if (value) return value;
    }
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function extractNetlifyToken(raw: string | undefined): string | null {
  const parsed = safeJson<Record<string, unknown>>(raw);
  if (!parsed) return null;

  const direct = stringOrNull((parsed as { accessToken?: unknown }).accessToken);
  if (direct) return direct;

  const users = parsed.users as Record<string, { auth?: { token?: unknown } }> | undefined;
  if (users && typeof users === 'object') {
    for (const record of Object.values(users)) {
      const token = stringOrNull(record?.auth?.token);
      if (token) return token;
    }
  }

  return null;
}

export function extractCredentials(files: DecryptedFileMap): ExtractedCredentials {
  const claude = safeJson<{ claudeAiOauth?: { accessToken?: unknown } }>(files[CREDENTIAL_PATHS.claude]);
  const replay = safeJson<{ accessToken?: unknown }>(files[CREDENTIAL_PATHS.replay]);
  const neon = safeJson<{ personal_api_key?: unknown; access_token?: unknown }>(
    files[CREDENTIAL_PATHS.neon],
  );
  const infisicalConfig = safeJson<{
    machineIdentity?: { clientId?: unknown; clientSecret?: unknown };
    domain?: unknown;
  }>(files[CREDENTIAL_PATHS.infisicalConfig]);
  const infisicalAuth = safeJson<{ accessToken?: unknown; domain?: unknown }>(
    files[CREDENTIAL_PATHS.infisicalAuth],
  );

  const ghToken = files[CREDENTIAL_PATHS.gh] ? parseGhHostsYml(files[CREDENTIAL_PATHS.gh]) : null;
  const flyToken = files[CREDENTIAL_PATHS.fly] ? parseFlyConfigYml(files[CREDENTIAL_PATHS.fly]) : null;
  const netlifyToken = extractNetlifyToken(
    files[CREDENTIAL_PATHS.netlify] ?? files[CREDENTIAL_PATHS.netlifyLegacy],
  );

  return {
    ANTHROPIC_API_KEY: stringOrNull(claude?.claudeAiOauth?.accessToken),
    GITHUB_TOKEN: ghToken,
    RECORD_REPLAY_API_KEY: stringOrNull(replay?.accessToken),
    NETLIFY_AUTH_TOKEN: netlifyToken,
    NEON_API_KEY: stringOrNull(neon?.personal_api_key),
    NEON_ACCESS_TOKEN: stringOrNull(neon?.access_token),
    INFISICAL_CLIENT_ID: stringOrNull(infisicalConfig?.machineIdentity?.clientId),
    INFISICAL_CLIENT_SECRET: stringOrNull(infisicalConfig?.machineIdentity?.clientSecret),
    INFISICAL_ACCESS_TOKEN: stringOrNull(infisicalAuth?.accessToken),
    INFISICAL_DOMAIN:
      stringOrNull(infisicalAuth?.domain) ?? stringOrNull(infisicalConfig?.domain),
    FLY_API_TOKEN: flyToken,
  };
}

export const REQUIRED_CREDENTIAL_KEYS = [
  'ANTHROPIC_API_KEY',
  'GITHUB_TOKEN',
  'RECORD_REPLAY_API_KEY',
  'NETLIFY_AUTH_TOKEN',
  'NEON_API_KEY',
  'INFISICAL_CLIENT_ID',
  'INFISICAL_CLIENT_SECRET',
] as const satisfies readonly (keyof ExtractedCredentials)[];

export type RequiredCredentialKey = (typeof REQUIRED_CREDENTIAL_KEYS)[number];
