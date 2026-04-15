import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';
import { getDefaultNetworkController, networkFetch } from '../network';
import { readGhToken, writeGhToken, deleteGhToken } from './gh-auth';
import * as path from './path';
import { runGitCommand } from './git-command';

const GH_CLIENT_ID = 'Ov23li3di39s0mmKf6HE';
const DEFAULT_GH_SCOPES = ['repo', 'read:org', 'gist', 'codespace'];

function ok(stdout: string): JustBashExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function err(stderr: string, exitCode = 1): JustBashExecResult {
  return { stdout: '', stderr, exitCode };
}

function normalizePath(input: string): string {
  if (!input) return '/';
  const normalized = input.replace(/\\/g, '/').replace(/\/+/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function resolvePath(cwd: string, maybePath: string): string {
  return normalizePath(path.isAbsolute(maybePath)
    ? path.normalize(maybePath)
    : path.resolve(cwd || '/', maybePath));
}

// ── CORS proxy fetch ────────────────────────────────────────────────────────

async function fetchViaProxy(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  return networkFetch(url, options, getDefaultNetworkController());
}

// ── Device Flow ─────────────────────────────────────────────────────────────

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenResponse {
  access_token?: string;
  token_type?: string;
  scope?: string;
  error?: string;
}

function parseScopeList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function mergeScopes(...groups: Array<readonly string[] | null | undefined>): string[] {
  const merged: string[] = [];
  const seen = new Set<string>();

  for (const group of groups) {
    if (!group) continue;
    for (const entry of group) {
      const normalized = entry.trim();
      if (!normalized || seen.has(normalized)) {
        continue;
      }
      seen.add(normalized);
      merged.push(normalized);
    }
  }

  return merged;
}

function formatScopeRequest(scopes: readonly string[]): string {
  return scopes.join(' ');
}

function formatScopeDisplay(scopes: readonly string[]): string {
  return scopes.join(', ');
}

function readRequestedScopes(args: string[]): string[] {
  const requested: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if ((arg === '--scopes' || arg === '-s') && index + 1 < args.length) {
      requested.push(...parseScopeList(args[index + 1]));
      index += 1;
    }
  }

  return requested;
}

async function requestDeviceCode(scope: string): Promise<DeviceCodeResponse> {
  const res = await fetchViaProxy('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: GH_CLIENT_ID,
      scope,
    }),
  });

  if (!res.ok) {
    throw new Error(`GitHub device code request failed: ${res.status} ${res.statusText}`);
  }

  return res.json();
}

async function pollForToken(
  deviceCode: string,
  interval: number,
  expiresIn: number,
  onTick?: (msg: string) => void
): Promise<{ accessToken: string; scopes: string[] }> {
  const deadline = Date.now() + expiresIn * 1000;
  let pollInterval = interval * 1000;

  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollInterval));

    const res = await fetchViaProxy('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: GH_CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }),
    });

    if (!res.ok) {
      throw new Error(`Token poll failed: ${res.status}`);
    }

    const data: TokenResponse = await res.json();

    if (data.access_token) {
      return {
        accessToken: data.access_token,
        scopes: parseScopeList(data.scope),
      };
    }

    if (data.error === 'slow_down') {
      pollInterval += 5000;
      continue;
    }

    if (data.error === 'authorization_pending') {
      continue;
    }

    if (data.error === 'expired_token') {
      throw new Error('Device code expired. Please try again.');
    }

    if (data.error === 'access_denied') {
      throw new Error('Authorization was denied by the user.');
    }

    if (data.error) {
      throw new Error(`OAuth error: ${data.error}`);
    }
  }

  throw new Error('Device code expired (timeout). Please try again.');
}

async function fetchGitHubAuthSession(token: string): Promise<{ login: string; scopes: string[] }> {
  const res = await fetchViaProxy('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch GitHub user: ${res.status}`);
  }

  const payload = await res.json();

  return {
    login: String(payload.login || ''),
    scopes: parseScopeList(res.headers.get('x-oauth-scopes')),
  };
}

async function authenticateWithDeviceFlow(
  args: string[],
  vfs: VirtualFS,
  keychain: { persistCurrentState(): Promise<void> } | null | undefined,
  options?: {
    allowExistingToken?: boolean;
    mode?: 'login' | 'refresh';
  },
): Promise<JustBashExecResult> {
  const host = 'github.com';
  const requestedScopes = mergeScopes(
    DEFAULT_GH_SCOPES,
    readRequestedScopes(args),
  );
  const existing = readGhToken(vfs, host);

  if (options?.allowExistingToken !== false && existing?.oauth_token) {
    return ok(
      `\u2713 Already logged in to ${host} as ${existing.user}\n` +
        `  To re-authenticate, run: gh auth logout && gh auth login\n` +
        `  To request more scopes, run: gh auth refresh --scopes codespace\n`
    );
  }

  let effectiveScopes = requestedScopes;
  if (options?.mode === 'refresh' && existing?.oauth_token) {
    try {
      const currentSession = await fetchGitHubAuthSession(existing.oauth_token);
      effectiveScopes = mergeScopes(
        DEFAULT_GH_SCOPES,
        parseScopeList(existing.oauth_scopes),
        currentSession.scopes,
        readRequestedScopes(args),
      );
    } catch {
      effectiveScopes = mergeScopes(
        DEFAULT_GH_SCOPES,
        parseScopeList(existing.oauth_scopes),
        readRequestedScopes(args),
      );
    }
  }

  let deviceData: DeviceCodeResponse;
  try {
    deviceData = await requestDeviceCode(formatScopeRequest(effectiveScopes));
  } catch (e) {
    return err(`Failed to initiate device flow: ${e instanceof Error ? e.message : String(e)}\n`);
  }

  try {
    await navigator.clipboard.writeText(deviceData.user_code);
  } catch {
    // clipboard may not be available
  }

  try {
    if (typeof window !== 'undefined' && typeof window.alert === 'function') {
      window.alert(
        `Your one-time code is: ${deviceData.user_code}\n\n` +
          `(It has been copied to your clipboard)\n\n` +
          `Click OK to open GitHub in your browser.`
      );
    }
  } catch {
    // ignore
  }

  const output =
    `! First copy your one-time code: ${deviceData.user_code}\n` +
    `- Waiting for authentication...\n`;

  try {
    window.open(deviceData.verification_uri, '_blank');
  } catch {
    // ignore
  }

  let tokenData: { accessToken: string; scopes: string[] };
  try {
    tokenData = await pollForToken(
      deviceData.device_code,
      deviceData.interval,
      deviceData.expires_in,
    );
  } catch (e) {
    return err(
      output + `\u2717 ${e instanceof Error ? e.message : String(e)}\n`
    );
  }

  let authSession: { login: string; scopes: string[] };
  try {
    authSession = await fetchGitHubAuthSession(tokenData.accessToken);
  } catch (e) {
    return err(
      output + `\u2717 Authentication succeeded but failed to fetch user info: ${e instanceof Error ? e.message : String(e)}\n`
    );
  }

  const resolvedScopes = mergeScopes(
    effectiveScopes,
    tokenData.scopes,
    authSession.scopes,
  );

  writeGhToken(vfs, {
    oauth_token: tokenData.accessToken,
    user: authSession.login,
    git_protocol: 'https',
    oauth_scopes: formatScopeRequest(resolvedScopes),
  }, host);

  await keychain?.persistCurrentState().catch(() => {});

  return ok(
    output +
      `\u2713 ${options?.mode === 'refresh' ? 'Authentication refreshed.' : 'Authentication complete.'}\n` +
      `\u2713 Logged in as ${authSession.login}\n` +
      `\u2713 Token scopes: ${formatScopeDisplay(resolvedScopes)}\n`
  );
}

// ── Auth subcommands ────────────────────────────────────────────────────────

async function authLogin(
  args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  return authenticateWithDeviceFlow(args, vfs, keychain, {
    allowExistingToken: true,
    mode: 'login',
  });
}

async function authRefresh(
  args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  return authenticateWithDeviceFlow(args, vfs, keychain, {
    allowExistingToken: false,
    mode: 'refresh',
  });
}

async function authStatus(
  _args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS
): Promise<JustBashExecResult> {
  const host = 'github.com';
  const config = readGhToken(vfs, host);

  if (!config || !config.oauth_token) {
    return err(
      `${host}\n` +
        `  \u2717 Not logged in to any GitHub hosts. Run gh auth login to authenticate.\n`
    );
  }

  // Verify token is still valid
  let username = config.user;
  let scopes = parseScopeList(config.oauth_scopes);
  try {
    const session = await fetchGitHubAuthSession(config.oauth_token);
    username = session.login;
    scopes = mergeScopes(scopes, session.scopes);
  } catch {
    return err(
      `${host}\n` +
        `  \u2717 Token for ${config.user} is no longer valid. Run gh auth login to re-authenticate.\n`
    );
  }

  return ok(
      `${host}\n` +
      `  \u2713 Logged in to ${host} account ${username} (oauth_token)\n` +
      `  - Active account: true\n` +
      `  - Git operations protocol: ${config.git_protocol}\n` +
      `  - Token scopes: ${scopes.length > 0 ? formatScopeDisplay(scopes) : 'unknown'}\n`
  );
}

async function authLogout(
  _args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const host = 'github.com';
  const config = readGhToken(vfs, host);

  if (!config) {
    return err(`\u2717 Not logged in to ${host}\n`);
  }

  const username = config.user;
  deleteGhToken(vfs, host);

  await keychain?.persistCurrentState().catch(() => {});

  return ok(`\u2713 Logged out of ${host} account ${username}\n`);
}

async function authToken(
  _args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS
): Promise<JustBashExecResult> {
  const host = 'github.com';
  const config = readGhToken(vfs, host);

  if (!config || !config.oauth_token) {
    return err(`no oauth token\n`);
  }

  return ok(config.oauth_token + '\n');
}

async function runAuth(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const sub = args[0];

  switch (sub) {
    case 'login':
      return authLogin(args.slice(1), ctx, vfs, keychain);
    case 'status':
      return authStatus(args.slice(1), ctx, vfs);
    case 'logout':
      return authLogout(args.slice(1), ctx, vfs, keychain);
    case 'refresh':
      return authRefresh(args.slice(1), ctx, vfs, keychain);
    case 'token':
      return authToken(args.slice(1), ctx, vfs);
    default:
      return err(
        `Usage: gh auth <command>\n\n` +
          `Available commands:\n` +
          `  login       Authenticate with a GitHub host\n` +
          `  logout      Log out of a GitHub host\n` +
          `  refresh     Refresh authentication and request additional scopes\n` +
          `  status      View authentication status\n` +
          `  token       Print the auth token\n`
      );
  }
}

// ── API subcommand ──────────────────────────────────────────────────────────

async function runApi(
  args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS
): Promise<JustBashExecResult> {
  if (args.length === 0) {
    return err('Usage: gh api <endpoint> [--method METHOD] [-f field=value ...]\n');
  }

  const host = 'github.com';
  const config = readGhToken(vfs, host);
  if (!config || !config.oauth_token) {
    return err('gh: not logged in. Run `gh auth login` first.\n');
  }

  let endpoint = args[0];
  let method = 'GET';
  const fields: Record<string, string> = {};
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${config.oauth_token}`,
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '--method' || arg === '-X') && i + 1 < args.length) {
      method = args[++i].toUpperCase();
    } else if ((arg === '-f' || arg === '--field') && i + 1 < args.length) {
      const kv = args[++i];
      const eqIdx = kv.indexOf('=');
      if (eqIdx > 0) {
        fields[kv.slice(0, eqIdx)] = kv.slice(eqIdx + 1);
      }
    } else if ((arg === '-H' || arg === '--header') && i + 1 < args.length) {
      const h = args[++i];
      const colonIdx = h.indexOf(':');
      if (colonIdx > 0) {
        headers[h.slice(0, colonIdx).trim()] = h.slice(colonIdx + 1).trim();
      }
    }
  }

  // Resolve relative endpoints
  if (endpoint.startsWith('/')) {
    endpoint = `https://api.github.com${endpoint}`;
  } else if (!endpoint.startsWith('http')) {
    endpoint = `https://api.github.com/${endpoint}`;
  }

  const fetchOptions: RequestInit = {
    method,
    headers,
  };

  if (method !== 'GET' && method !== 'HEAD' && Object.keys(fields).length > 0) {
    fetchOptions.body = JSON.stringify(fields);
    (fetchOptions.headers as Record<string, string>)['Content-Type'] = 'application/json';
  }

  try {
    const res = await fetchViaProxy(endpoint, fetchOptions);
    const text = await res.text();

    if (!res.ok) {
      return err(`gh: API error (${res.status}): ${text}\n`);
    }

    // Pretty-print JSON
    try {
      const json = JSON.parse(text);
      return ok(JSON.stringify(json, null, 2) + '\n');
    } catch {
      return ok(text + '\n');
    }
  } catch (e) {
    return err(`gh: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

// ── Repo subcommands ────────────────────────────────────────────────────────

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `about ${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `about ${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `about ${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `about ${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.floor(months / 12);
  return `about ${years} year${years === 1 ? '' : 's'} ago`;
}

async function repoList(
  args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS
): Promise<JustBashExecResult> {
  const host = 'github.com';
  const config = readGhToken(vfs, host);
  if (!config || !config.oauth_token) {
    return err('gh: not logged in. Run `gh auth login` first.\n');
  }

  let owner: string | null = null;
  let limit = 30;
  let visibility: string | null = null;
  let language: string | null = null;
  let showForks: boolean | null = null;
  let showArchived: boolean | null = null;
  let jsonFields: string[] | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-L' || arg === '--limit') && i + 1 < args.length) {
      limit = parseInt(args[++i], 10) || 30;
    } else if (arg === '--visibility' && i + 1 < args.length) {
      visibility = args[++i];
    } else if ((arg === '-l' || arg === '--language') && i + 1 < args.length) {
      language = args[++i];
    } else if (arg === '--fork') {
      showForks = true;
    } else if (arg === '--source') {
      showForks = false;
    } else if (arg === '--archived') {
      showArchived = true;
    } else if (arg === '--no-archived') {
      showArchived = false;
    } else if (arg === '--json' && i + 1 < args.length) {
      jsonFields = args[++i].split(',');
    } else if (!arg.startsWith('-')) {
      owner = arg;
    }
  }

  // Build API URL
  let apiUrl: string;
  if (owner) {
    apiUrl = `https://api.github.com/users/${encodeURIComponent(owner)}/repos`;
  } else {
    apiUrl = 'https://api.github.com/user/repos';
  }

  const perPage = Math.min(Math.max(limit, 30), 100);
  apiUrl += `?per_page=${perPage}&sort=pushed&direction=desc`;

  if (visibility && !owner) {
    apiUrl += `&visibility=${visibility}`;
  }

  try {
    const res = await fetchViaProxy(apiUrl, {
      headers: {
        Authorization: `Bearer ${config.oauth_token}`,
        Accept: 'application/vnd.github+json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      return err(`gh: API error (${res.status}): ${text}\n`);
    }

    let repos: any[] = await res.json();

    // Client-side filtering
    if (showForks === true) repos = repos.filter((r: any) => r.fork);
    if (showForks === false) repos = repos.filter((r: any) => !r.fork);
    if (showArchived === true) repos = repos.filter((r: any) => r.archived);
    if (showArchived === false) repos = repos.filter((r: any) => !r.archived);
    if (language) {
      const lang = language.toLowerCase();
      repos = repos.filter((r: any) => r.language?.toLowerCase() === lang);
    }
    if (visibility && owner) {
      repos = repos.filter((r: any) => {
        if (visibility === 'public') return !r.private;
        if (visibility === 'private') return r.private;
        return true;
      });
    }

    repos = repos.slice(0, limit);

    // JSON output
    if (jsonFields) {
      const fieldMap: Record<string, (r: any) => any> = {
        name: (r) => r.name,
        nameWithOwner: (r) => r.full_name,
        description: (r) => r.description || '',
        visibility: (r) => (r.private ? 'PRIVATE' : 'PUBLIC'),
        isPrivate: (r) => r.private,
        isFork: (r) => r.fork,
        isArchived: (r) => r.archived,
        primaryLanguage: (r) => (r.language ? { name: r.language } : null),
        stargazerCount: (r) => r.stargazers_count,
        forkCount: (r) => r.forks_count,
        url: (r) => r.html_url,
        sshUrl: (r) => r.ssh_url,
        createdAt: (r) => r.created_at,
        updatedAt: (r) => r.updated_at,
        pushedAt: (r) => r.pushed_at,
        owner: (r) => ({ login: r.owner?.login }),
      };

      const output = repos.map((r: any) => {
        const obj: Record<string, any> = {};
        for (const field of jsonFields!) {
          obj[field] = fieldMap[field] ? fieldMap[field](r) : (r[field] ?? null);
        }
        return obj;
      });

      return ok(JSON.stringify(output, null, 2) + '\n');
    }

    // Default table output
    if (repos.length === 0) {
      return ok('No repositories match your search\n');
    }

    const lines = repos.map((r: any) => {
      const name: string = r.full_name;
      const desc: string = r.description || '';
      const vis = r.private ? 'private' : 'public';
      const lang: string = r.language || '';
      const updated = timeAgo(new Date(r.pushed_at));
      const truncDesc = desc.length > 50 ? desc.slice(0, 47) + '...' : desc;
      return `${name}\t${truncDesc}\t${vis}\t${lang}\t${updated}`;
    });

    return ok(lines.join('\n') + '\n');
  } catch (e) {
    return err(`gh: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

interface RepoCreateOptions {
  repoName: string;
  owner?: string;
  visibility: 'public' | 'private';
  description?: string;
  homepage?: string;
  hasIssues: boolean;
  hasWiki: boolean;
  source?: string;
  remote: string;
  push: boolean;
}

interface RepoCoordinates {
  owner: string;
  repoName: string;
}

const GH_DEFAULT_REPO_PATH = '/home/user/.config/gh/default-repo';

function readFlagValue(args: string[], index: number, flag: string): { value?: string; nextIndex: number } {
  const arg = args[index];
  if (arg === flag && index + 1 < args.length) {
    return { value: args[index + 1], nextIndex: index + 1 };
  }
  if (arg.startsWith(`${flag}=`)) {
    return { value: arg.slice(flag.length + 1), nextIndex: index };
  }
  return { nextIndex: index };
}

function readAlternateFlagValue(
  args: string[],
  index: number,
  flags: string[],
): { value?: string; nextIndex: number } {
  for (const flag of flags) {
    const match = readFlagValue(args, index, flag);
    if (match.value !== undefined) {
      return match;
    }
  }
  return { nextIndex: index };
}

function readBooleanFlagValue(arg: string, flag: string): boolean | undefined {
  if (arg === flag || arg === `${flag}=true`) {
    return true;
  }
  if (arg === `${flag}=false`) {
    return false;
  }
  return undefined;
}

function parseRepoCoordinates(input: string, defaultOwner?: string): RepoCoordinates | null {
  let candidate = input.trim();
  if (!candidate) {
    return null;
  }

  candidate = candidate
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/^git@github\.com:/i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '');

  const segments = candidate.split('/').filter(Boolean);
  if (segments.length === 1 && defaultOwner) {
    return {
      owner: defaultOwner,
      repoName: segments[0],
    };
  }

  if (segments.length !== 2) {
    return null;
  }

  return {
    owner: segments[0],
    repoName: segments[1],
  };
}

function ensureGhConfigDir(vfs: VirtualFS): void {
  const dir = path.dirname(GH_DEFAULT_REPO_PATH);
  if (!vfs.existsSync(dir)) {
    vfs.mkdirSync(dir, { recursive: true });
  }
}

function readDefaultRepoCoordinates(vfs: VirtualFS): RepoCoordinates | null {
  if (!vfs.existsSync(GH_DEFAULT_REPO_PATH)) {
    return null;
  }

  try {
    const raw = vfs.readFileSync(GH_DEFAULT_REPO_PATH, 'utf8').trim();
    return parseRepoCoordinates(raw);
  } catch {
    return null;
  }
}

function writeDefaultRepoCoordinates(vfs: VirtualFS, coordinates: RepoCoordinates): void {
  ensureGhConfigDir(vfs);
  vfs.writeFileSync(GH_DEFAULT_REPO_PATH, `${coordinates.owner}/${coordinates.repoName}\n`);
}

function clearDefaultRepoCoordinates(vfs: VirtualFS): boolean {
  if (!vfs.existsSync(GH_DEFAULT_REPO_PATH)) {
    return false;
  }

  try {
    vfs.unlinkSync(GH_DEFAULT_REPO_PATH);
  } catch {
    return false;
  }
  return true;
}

async function inferRepoCoordinatesFromOrigin(
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<RepoCoordinates | null> {
  let result: JustBashExecResult;
  try {
    result = await runGitCommand(['remote', 'get-url', 'origin'], ctx, vfs);
  } catch {
    return null;
  }

  if (result.exitCode !== 0) {
    return null;
  }

  return parseRepoCoordinates(result.stdout.trim());
}

async function resolveRepoCoordinates(
  repoInput: string | undefined,
  ctx: CommandContext,
  vfs: VirtualFS,
  defaultOwner?: string,
): Promise<RepoCoordinates | JustBashExecResult> {
  if (repoInput) {
    const parsed = parseRepoCoordinates(repoInput, defaultOwner);
    if (!parsed) {
      return err(`gh repo: invalid repository '${repoInput}'\n`, 2);
    }
    return parsed;
  }

  const inferred = await inferRepoCoordinatesFromOrigin(ctx, vfs);
  if (inferred) {
    return inferred;
  }

  const defaultRepo = readDefaultRepoCoordinates(vfs);
  if (defaultRepo) {
    return defaultRepo;
  }

  return err('gh repo: could not determine repository from the current directory. Specify OWNER/REPO.\n', 2);
}

function parseRepoCreateArgs(args: string[]): RepoCreateOptions | JustBashExecResult {
  let repoInput: string | undefined;
  let visibility: 'public' | 'private' = 'private';
  let description: string | undefined;
  let homepage: string | undefined;
  let source: string | undefined;
  let remote = 'origin';
  let push = false;
  let hasIssues = true;
  let hasWiki = true;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === '--public') {
      visibility = 'public';
      continue;
    }
    if (arg === '--private') {
      visibility = 'private';
      continue;
    }
    if (arg === '--push') {
      push = true;
      continue;
    }
    if (arg === '--disable-issues') {
      hasIssues = false;
      continue;
    }
    if (arg === '--disable-wiki') {
      hasWiki = false;
      continue;
    }
    if (arg === '--confirm' || arg === '-y') {
      continue;
    }
    if (arg === '--internal') {
      return err("gh repo create: unsupported option '--internal'\n", 2);
    }

    const sourceValue = readFlagValue(args, index, '--source');
    if (sourceValue.value !== undefined) {
      source = sourceValue.value;
      index = sourceValue.nextIndex;
      continue;
    }

    const remoteValue = readFlagValue(args, index, '--remote');
    if (remoteValue.value !== undefined) {
      remote = remoteValue.value;
      index = remoteValue.nextIndex;
      continue;
    }

    const descriptionValue = readFlagValue(args, index, '--description');
    if (descriptionValue.value !== undefined) {
      description = descriptionValue.value;
      index = descriptionValue.nextIndex;
      continue;
    }

    const homepageValue = readFlagValue(args, index, '--homepage');
    if (homepageValue.value !== undefined) {
      homepage = homepageValue.value;
      index = homepageValue.nextIndex;
      continue;
    }

    if (arg.startsWith('-')) {
      return err(`gh repo create: unsupported option '${arg}'\n`, 2);
    }

    if (repoInput) {
      return err('gh repo create: too many arguments\n', 2);
    }
    repoInput = arg;
  }

  if (!repoInput) {
    return err('Usage: gh repo create <name> [--public|--private] [--source <path>] [--push]\n', 2);
  }

  if (push && !source) {
    return err('gh repo create: --push requires --source\n', 2);
  }

  const segments = repoInput.split('/').filter(Boolean);
  if (segments.length === 0 || segments.length > 2) {
    return err(`gh repo create: invalid repository name '${repoInput}'\n`, 2);
  }

  return {
    owner: segments.length === 2 ? segments[0] : undefined,
    repoName: segments[segments.length - 1],
    visibility,
    description,
    homepage,
    hasIssues,
    hasWiki,
    source,
    remote,
    push,
  };
}

async function syncRepoRemote(
  sourceDir: string,
  remoteName: string,
  remoteUrl: string,
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const remoteCtx = { ...ctx, cwd: sourceDir };
  const current = await runGitCommand(['remote', 'get-url', remoteName], remoteCtx, vfs);
  if (current.exitCode === 0) {
    if (current.stdout.trim() === remoteUrl) {
      return ok('');
    }
    return runGitCommand(['remote', 'set-url', remoteName, remoteUrl], remoteCtx, vfs);
  }

  return runGitCommand(['remote', 'add', remoteName, remoteUrl], remoteCtx, vfs);
}

function repoCoordinatesEqual(left: RepoCoordinates, right: RepoCoordinates): boolean {
  return left.owner === right.owner && left.repoName === right.repoName;
}

async function resolveExplicitRepoOption(
  repoOption: string | undefined,
  ctx: CommandContext,
  vfs: VirtualFS,
  defaultOwner?: string,
): Promise<RepoCoordinates | undefined | JustBashExecResult> {
  if (!repoOption) {
    return undefined;
  }

  const parsed = parseRepoCoordinates(repoOption, defaultOwner);
  if (parsed) {
    return parsed;
  }

  const remoteResult = await runGitCommand(['remote', 'get-url', repoOption], ctx, vfs);
  if (remoteResult.exitCode === 0) {
    const remoteRepo = parseRepoCoordinates(remoteResult.stdout.trim(), defaultOwner);
    if (remoteRepo) {
      return remoteRepo;
    }
  }

  return err(`gh repo: invalid repository '${repoOption}'\n`, 2);
}

async function resolveRepoTarget(
  repoInput: string | undefined,
  repoOption: string | undefined,
  ctx: CommandContext,
  vfs: VirtualFS,
  defaultOwner?: string,
): Promise<RepoCoordinates | JustBashExecResult> {
  if (repoInput && repoOption) {
    return err('gh repo: specify only one repository\n', 2);
  }

  const explicitRepo = await resolveExplicitRepoOption(repoOption, ctx, vfs, defaultOwner);
  if (explicitRepo && 'exitCode' in explicitRepo) {
    return explicitRepo;
  }
  if (explicitRepo) {
    return explicitRepo;
  }

  return resolveRepoCoordinates(repoInput, ctx, vfs, defaultOwner);
}

async function repoCreate(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const host = 'github.com';
  const config = readGhToken(vfs, host);
  if (!config || !config.oauth_token) {
    return err('gh: not logged in. Run `gh auth login` first.\n');
  }

  const parsed = parseRepoCreateArgs(args);
  if ('exitCode' in parsed) {
    return parsed;
  }

  const apiUrl = parsed.owner
    ? `https://api.github.com/orgs/${encodeURIComponent(parsed.owner)}/repos`
    : 'https://api.github.com/user/repos';
  const body: Record<string, unknown> = {
    name: parsed.repoName,
    private: parsed.visibility !== 'public',
    has_issues: parsed.hasIssues,
    has_wiki: parsed.hasWiki,
  };

  if (parsed.description) {
    body.description = parsed.description;
  }
  if (parsed.homepage) {
    body.homepage = parsed.homepage;
  }

  let repository: Record<string, unknown>;
  try {
    const response = await fetchViaProxy(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.oauth_token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await response.text();
    if (!response.ok) {
      return err(`gh: API error (${response.status}): ${text}\n`);
    }

    repository = text ? JSON.parse(text) as Record<string, unknown> : {};
  } catch (e) {
    return err(`gh: ${e instanceof Error ? e.message : String(e)}\n`);
  }

  const htmlUrl = typeof repository.html_url === 'string'
    ? repository.html_url
    : `https://github.com/${parsed.owner ? `${parsed.owner}/` : ''}${parsed.repoName}`;
  const fullName = typeof repository.full_name === 'string'
    ? repository.full_name
    : htmlUrl.replace('https://github.com/', '');
  const remoteUrl = typeof repository.clone_url === 'string'
    ? repository.clone_url
    : `${htmlUrl}.git`;

  const output: string[] = [
    `Created repository ${fullName}\n`,
    `${htmlUrl}\n`,
  ];

  if (!parsed.source) {
    return ok(output.join(''));
  }

  const sourceDir = resolvePath(ctx.cwd, parsed.source);
  const gitDir = normalizePath(path.join(sourceDir, '.git'));
  if (!vfs.existsSync(sourceDir)) {
    return err(`gh repo create: source path '${parsed.source}' does not exist\n`, 2);
  }
  if (!vfs.existsSync(gitDir)) {
    return err(
      `Created repository ${fullName}\n${htmlUrl}\n` +
      `gh repo create: source path '${parsed.source}' is not a git repository\n`,
      2,
    );
  }

  const remoteResult = await syncRepoRemote(sourceDir, parsed.remote, remoteUrl, ctx, vfs);
  if (remoteResult.exitCode !== 0) {
    return err(
      `Created repository ${fullName}\n${htmlUrl}\n` +
      (remoteResult.stderr || remoteResult.stdout || `Failed to configure remote '${parsed.remote}'\n`),
      remoteResult.exitCode,
    );
  }

  output.push(`Configured remote '${parsed.remote}'\n`);

  if (!parsed.push) {
    return ok(output.join(''));
  }

  const pushResult = await runGitCommand(['push', '-u', parsed.remote], { ...ctx, cwd: sourceDir }, vfs);
  if (pushResult.exitCode !== 0) {
    return err(
      `${output.join('')}` +
      (pushResult.stderr || pushResult.stdout || `Failed to push to '${parsed.remote}'\n`),
      pushResult.exitCode,
    );
  }

  output.push(`Pushed local commits to ${parsed.remote}\n`);
  return ok(output.join(''));
}

async function repoView(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const host = 'github.com';
  const config = readGhToken(vfs, host);
  if (!config || !config.oauth_token) {
    return err('gh: not logged in. Run `gh auth login` first.\n');
  }

  let repoInput: string | undefined;
  let repoOption: string | undefined;
  let jsonFields: string[] | null = null;
  let openInBrowser = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const repoValue = readAlternateFlagValue(args, index, ['--repo', '-R']);
    if (repoValue.value !== undefined) {
      repoOption = repoValue.value;
      index = repoValue.nextIndex;
      continue;
    }
    if (arg === '--json' && index + 1 < args.length) {
      jsonFields = args[++index].split(',');
      continue;
    }
    if (arg === '--web') {
      openInBrowser = true;
      continue;
    }
    if (arg.startsWith('-')) {
      return err(`gh repo view: unsupported option '${arg}'\n`, 2);
    }
    if (repoInput) {
      return err('gh repo view: too many arguments\n', 2);
    }
    repoInput = arg;
  }

  const targetCoordinates = await resolveRepoTarget(repoInput, repoOption, ctx, vfs, config.user);
  if ('exitCode' in targetCoordinates) {
    return err(`gh repo view: ${targetCoordinates.stderr.replace(/^gh repo:\s*/, '')}`, targetCoordinates.exitCode);
  }

  try {
    const response = await fetchViaProxy(
      `https://api.github.com/repos/${encodeURIComponent(targetCoordinates.owner)}/${encodeURIComponent(targetCoordinates.repoName)}`,
      {
        headers: {
          Authorization: `Bearer ${config.oauth_token}`,
          Accept: 'application/vnd.github+json',
        },
      },
    );
    const text = await response.text();
    if (!response.ok) {
      return err(`gh: API error (${response.status}): ${text}\n`);
    }

    const repository = text ? JSON.parse(text) as Record<string, any> : {};
    const htmlUrl = repository.html_url ?? `https://github.com/${targetCoordinates.owner}/${targetCoordinates.repoName}`;
    if (openInBrowser) {
      try {
        if (typeof window !== 'undefined' && typeof window.open === 'function') {
          window.open(htmlUrl, '_blank');
        }
      } catch {
        // ignore browser open failures
      }
      return ok(`${htmlUrl}\n`);
    }

    if (jsonFields) {
      const output: Record<string, any> = {};
      for (const field of jsonFields) {
        switch (field) {
          case 'name':
            output[field] = repository.name ?? null;
            break;
          case 'nameWithOwner':
            output[field] = repository.full_name ?? null;
            break;
          case 'description':
            output[field] = repository.description || '';
            break;
          case 'url':
            output[field] = repository.html_url ?? null;
            break;
          case 'sshUrl':
            output[field] = repository.ssh_url ?? null;
            break;
          case 'visibility':
            output[field] = repository.private ? 'PRIVATE' : 'PUBLIC';
            break;
          case 'isPrivate':
            output[field] = Boolean(repository.private);
            break;
          case 'isFork':
            output[field] = Boolean(repository.fork);
            break;
          case 'isArchived':
            output[field] = Boolean(repository.archived);
            break;
          case 'defaultBranchRef':
            output[field] = repository.default_branch ? { name: repository.default_branch } : null;
            break;
          case 'owner':
            output[field] = { login: repository.owner?.login };
            break;
          default:
            output[field] = repository[field] ?? null;
            break;
        }
      }
      return ok(`${JSON.stringify(output, null, 2)}\n`);
    }

    const description = repository.description ? `${repository.description}\n` : '';
    const language = repository.language ? `  - language: ${repository.language}\n` : '';
    return ok(
      `${repository.full_name ?? `${targetCoordinates.owner}/${targetCoordinates.repoName}`}\n` +
      description +
      `${htmlUrl}\n` +
      `  - visibility: ${repository.private ? 'private' : 'public'}\n` +
      `  - default branch: ${repository.default_branch ?? 'main'}\n` +
      `  - stars: ${repository.stargazers_count ?? 0}\n` +
      `  - forks: ${repository.forks_count ?? 0}\n` +
      language,
    );
  } catch (e) {
    return err(`gh: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

async function repoClone(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const host = 'github.com';
  const config = readGhToken(vfs, host);
  if (!config || !config.oauth_token) {
    return err('gh: not logged in. Run `gh auth login` first.\n');
  }

  const positionals: string[] = [];
  for (const arg of args) {
    if (arg.startsWith('-')) {
      return err(`gh repo clone: unsupported option '${arg}'\n`, 2);
    }
    positionals.push(arg);
  }

  if (positionals.length === 0 || positionals.length > 2) {
    return err('Usage: gh repo clone <repository> [directory]\n', 2);
  }

  const coordinates = await resolveRepoCoordinates(positionals[0], ctx, vfs, config.user);
  if ('exitCode' in coordinates) {
    return coordinates;
  }

  const cloneArgs = ['clone', `https://github.com/${coordinates.owner}/${coordinates.repoName}.git`];
  if (positionals[1]) {
    cloneArgs.push(positionals[1]);
  }
  return runGitCommand(cloneArgs, ctx, vfs);
}

async function repoDelete(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const host = 'github.com';
  const config = readGhToken(vfs, host);
  if (!config || !config.oauth_token) {
    return err('gh: not logged in. Run `gh auth login` first.\n');
  }

  let repoInput: string | undefined;
  let confirmed = false;

  for (const arg of args) {
    if (arg === '--yes' || arg === '-y') {
      confirmed = true;
      continue;
    }
    if (arg.startsWith('-')) {
      return err(`gh repo delete: unsupported option '${arg}'\n`, 2);
    }
    if (repoInput) {
      return err('gh repo delete: too many arguments\n', 2);
    }
    repoInput = arg;
  }

  if (!confirmed) {
    return err('gh repo delete: pass --yes to confirm deletion\n', 2);
  }

  const coordinates = await resolveRepoCoordinates(repoInput, ctx, vfs, config.user);
  if ('exitCode' in coordinates) {
    return coordinates;
  }

  try {
    const response = await fetchViaProxy(
      `https://api.github.com/repos/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.repoName)}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${config.oauth_token}`,
          Accept: 'application/vnd.github+json',
        },
      },
    );
    if (!response.ok) {
      const text = await response.text();
      return err(`gh: API error (${response.status}): ${text}\n`);
    }
  } catch (e) {
    return err(`gh: ${e instanceof Error ? e.message : String(e)}\n`);
  }

  return ok(`Deleted repository ${coordinates.owner}/${coordinates.repoName}\n`);
}

async function repoSetDefault(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const host = 'github.com';
  const config = readGhToken(vfs, host);
  if (!config || !config.oauth_token) {
    return err('gh: not logged in. Run `gh auth login` first.\n');
  }

  let repoInput: string | undefined;
  let unset = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const repoValue = readAlternateFlagValue(args, index, ['--repo', '-R']);
    if (repoValue.value !== undefined) {
      repoInput = repoValue.value;
      index = repoValue.nextIndex;
      continue;
    }
    if (arg === '--unset' || arg === '-u') {
      unset = true;
      continue;
    }
    if (arg.startsWith('-')) {
      return err(`gh repo set-default: unsupported option '${arg}'\n`, 2);
    }
    if (repoInput) {
      return err('gh repo set-default: too many arguments\n', 2);
    }
    repoInput = arg;
  }

  if (unset) {
    clearDefaultRepoCoordinates(vfs);
    return ok('Cleared default repository\n');
  }

  const coordinates = await resolveRepoTarget(repoInput, undefined, ctx, vfs, config.user);
  if ('exitCode' in coordinates) {
    return err(`gh repo set-default: ${coordinates.stderr.replace(/^gh repo:\s*/, '')}`, coordinates.exitCode);
  }

  writeDefaultRepoCoordinates(vfs, coordinates);
  return ok(`Default repository set to ${coordinates.owner}/${coordinates.repoName}\n`);
}

async function repoRename(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const host = 'github.com';
  const config = readGhToken(vfs, host);
  if (!config || !config.oauth_token) {
    return err('gh: not logged in. Run `gh auth login` first.\n');
  }

  let repoOption: string | undefined;
  let newName: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const repoValue = readAlternateFlagValue(args, index, ['--repo', '-R']);
    if (repoValue.value !== undefined) {
      repoOption = repoValue.value;
      index = repoValue.nextIndex;
      continue;
    }
    if (arg.startsWith('-')) {
      return err(`gh repo rename: unsupported option '${arg}'\n`, 2);
    }
    if (newName) {
      return err('gh repo rename: too many arguments\n', 2);
    }
    newName = arg;
  }

  if (!newName) {
    return err('Usage: gh repo rename <new-name> [-R OWNER/REPO]\n', 2);
  }

  const coordinates = await resolveRepoTarget(undefined, repoOption, ctx, vfs, config.user);
  if ('exitCode' in coordinates) {
    return err(`gh repo rename: ${coordinates.stderr.replace(/^gh repo:\s*/, '')}`, coordinates.exitCode);
  }

  let repository: Record<string, any>;
  try {
    const response = await fetchViaProxy(
      `https://api.github.com/repos/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.repoName)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${config.oauth_token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newName }),
      },
    );
    const text = await response.text();
    if (!response.ok) {
      return err(`gh: API error (${response.status}): ${text}\n`);
    }
    repository = text ? JSON.parse(text) as Record<string, any> : {};
  } catch (e) {
    return err(`gh: ${e instanceof Error ? e.message : String(e)}\n`);
  }

  const nextCoordinates: RepoCoordinates = {
    owner: typeof repository.owner?.login === 'string' ? repository.owner.login : coordinates.owner,
    repoName: typeof repository.name === 'string' ? repository.name : newName,
  };
  const remoteUrl = typeof repository.clone_url === 'string'
    ? repository.clone_url
    : `https://github.com/${nextCoordinates.owner}/${nextCoordinates.repoName}.git`;
  const htmlUrl = typeof repository.html_url === 'string'
    ? repository.html_url
    : `https://github.com/${nextCoordinates.owner}/${nextCoordinates.repoName}`;
  const output = [
    `Renamed repository ${coordinates.owner}/${coordinates.repoName} to ${nextCoordinates.owner}/${nextCoordinates.repoName}\n`,
    `${htmlUrl}\n`,
  ];

  const currentDefault = readDefaultRepoCoordinates(vfs);
  if (currentDefault && repoCoordinatesEqual(currentDefault, coordinates)) {
    writeDefaultRepoCoordinates(vfs, nextCoordinates);
    output.push('Updated default repository\n');
  }

  const currentOrigin = await inferRepoCoordinatesFromOrigin(ctx, vfs);
  if (currentOrigin && repoCoordinatesEqual(currentOrigin, coordinates)) {
    const remoteResult = await syncRepoRemote(ctx.cwd, 'origin', remoteUrl, ctx, vfs);
    if (remoteResult.exitCode === 0) {
      output.push("Updated remote 'origin'\n");
    }
  }

  return ok(output.join(''));
}

async function repoEdit(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const host = 'github.com';
  const config = readGhToken(vfs, host);
  if (!config || !config.oauth_token) {
    return err('gh: not logged in. Run `gh auth login` first.\n');
  }

  let repoInput: string | undefined;
  let repoOption: string | undefined;
  let acceptVisibilityChangeConsequences = false;
  const body: Record<string, unknown> = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const repoValue = readAlternateFlagValue(args, index, ['--repo', '-R']);
    if (repoValue.value !== undefined) {
      repoOption = repoValue.value;
      index = repoValue.nextIndex;
      continue;
    }

    if (arg === '--accept-visibility-change-consequences') {
      acceptVisibilityChangeConsequences = true;
      continue;
    }

    const descriptionValue = readAlternateFlagValue(args, index, ['--description', '-d']);
    if (descriptionValue.value !== undefined) {
      body.description = descriptionValue.value;
      index = descriptionValue.nextIndex;
      continue;
    }

    const homepageValue = readAlternateFlagValue(args, index, ['--homepage', '-h']);
    if (homepageValue.value !== undefined) {
      body.homepage = homepageValue.value;
      index = homepageValue.nextIndex;
      continue;
    }

    const defaultBranchValue = readFlagValue(args, index, '--default-branch');
    if (defaultBranchValue.value !== undefined) {
      body.default_branch = defaultBranchValue.value;
      index = defaultBranchValue.nextIndex;
      continue;
    }

    const visibilityValue = readFlagValue(args, index, '--visibility');
    if (visibilityValue.value !== undefined) {
      const visibility = visibilityValue.value.toLowerCase();
      if (!['public', 'private'].includes(visibility)) {
        return err(`gh repo edit: unsupported visibility '${visibilityValue.value}'\n`, 2);
      }
      body.visibility = visibility;
      index = visibilityValue.nextIndex;
      continue;
    }

    const booleanFields: Array<[string, string]> = [
      ['--enable-issues', 'has_issues'],
      ['--enable-wiki', 'has_wiki'],
      ['--enable-projects', 'has_projects'],
      ['--enable-discussions', 'has_discussions'],
      ['--template', 'is_template'],
      ['--allow-forking', 'allow_forking'],
      ['--delete-branch-on-merge', 'delete_branch_on_merge'],
      ['--allow-update-branch', 'allow_update_branch'],
      ['--enable-merge-commit', 'allow_merge_commit'],
      ['--enable-rebase-merge', 'allow_rebase_merge'],
      ['--enable-squash-merge', 'allow_squash_merge'],
      ['--enable-auto-merge', 'allow_auto_merge'],
    ];
    let matchedBoolean = false;
    for (const [flag, field] of booleanFields) {
      const flagValue = readBooleanFlagValue(arg, flag);
      if (flagValue !== undefined) {
        body[field] = flagValue;
        matchedBoolean = true;
        break;
      }
    }
    if (matchedBoolean) {
      continue;
    }

    if (arg.startsWith('-')) {
      return err(`gh repo edit: unsupported option '${arg}'\n`, 2);
    }
    if (repoInput) {
      return err('gh repo edit: too many arguments\n', 2);
    }
    repoInput = arg;
  }

  if ('visibility' in body && !acceptVisibilityChangeConsequences) {
    return err(
      'gh repo edit: changing repository visibility requires --accept-visibility-change-consequences\n',
      2,
    );
  }

  if (Object.keys(body).length === 0) {
    return err('gh repo edit: no updates specified\n', 2);
  }

  const coordinates = await resolveRepoTarget(repoInput, repoOption, ctx, vfs, config.user);
  if ('exitCode' in coordinates) {
    return err(`gh repo edit: ${coordinates.stderr.replace(/^gh repo:\s*/, '')}`, coordinates.exitCode);
  }

  let repository: Record<string, any>;
  try {
    const response = await fetchViaProxy(
      `https://api.github.com/repos/${encodeURIComponent(coordinates.owner)}/${encodeURIComponent(coordinates.repoName)}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${config.oauth_token}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      },
    );
    const text = await response.text();
    if (!response.ok) {
      return err(`gh: API error (${response.status}): ${text}\n`);
    }
    repository = text ? JSON.parse(text) as Record<string, any> : {};
  } catch (e) {
    return err(`gh: ${e instanceof Error ? e.message : String(e)}\n`);
  }

  return ok(
    `Updated repository ${repository.full_name ?? `${coordinates.owner}/${coordinates.repoName}`}\n` +
    `${repository.html_url ?? `https://github.com/${coordinates.owner}/${coordinates.repoName}`}\n`,
  );
}

async function runRepo(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS
): Promise<JustBashExecResult> {
  const sub = args[0];

  switch (sub) {
    case 'list':
    case 'ls':
      return repoList(args.slice(1), ctx, vfs);
    case 'view':
      return repoView(args.slice(1), ctx, vfs);
    case 'clone':
      return repoClone(args.slice(1), ctx, vfs);
    case 'create':
      return repoCreate(args.slice(1), ctx, vfs);
    case 'edit':
      return repoEdit(args.slice(1), ctx, vfs);
    case 'delete':
      return repoDelete(args.slice(1), ctx, vfs);
    case 'rename':
      return repoRename(args.slice(1), ctx, vfs);
    case 'set-default':
      return repoSetDefault(args.slice(1), ctx, vfs);
    default:
      return err(
        `Usage: gh repo <command>\n\n` +
          `Available commands:\n` +
          `  list, ls    List repositories owned by user or organization\n` +
          `  view        View a repository\n` +
          `  clone       Clone a repository locally\n` +
          `  create      Create a repository on GitHub and optionally wire a local remote\n` +
          `  edit        Edit repository settings on GitHub\n` +
          `  rename      Rename a repository on GitHub\n` +
          `  delete      Delete a repository on GitHub\n` +
          `  set-default Set the default repository for future gh commands\n`
      );
  }
}

// ── Main dispatcher ─────────────────────────────────────────────────────────

export async function runGhCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const sub = args[0];

  if (!sub || sub === 'help' || sub === '--help') {
    return ok(
      `Usage: gh <command> <subcommand> [flags]\n\n` +
        `Available commands:\n` +
        `  auth        Authenticate gh and git with GitHub\n` +
        `  api         Make an authenticated GitHub API request\n` +
        `  repo        Manage repositories\n\n` +
        `Run 'gh <command> --help' for more information about a command.\n`
    );
  }

  if (sub === '--version' || sub === 'version') {
    return ok('gh version 2.62.0 (almostnode)\n');
  }

  switch (sub) {
    case 'auth':
      return runAuth(args.slice(1), ctx, vfs, keychain);
    case 'api':
      return runApi(args.slice(1), ctx, vfs);
    case 'repo':
      return runRepo(args.slice(1), ctx, vfs);
    default:
      return err(`gh: '${sub}' is not a gh command. See 'gh --help'.\n`);
  }
}
