import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';
import { readGhToken, writeGhToken, deleteGhToken, hasGhToken } from './gh-auth';
import type { GhHostConfig } from './gh-auth';

const GH_CLIENT_ID = 'Ov23li3di39s0mmKf6HE';
const GH_SCOPES = 'repo,read:org,gist';
const CORS_PROXY = 'https://almostnode-cors-proxy.langtail.workers.dev/?url=';

function ok(stdout: string): JustBashExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function err(stderr: string, exitCode = 1): JustBashExecResult {
  return { stdout: '', stderr, exitCode };
}

// ── CORS proxy fetch ────────────────────────────────────────────────────────

async function fetchViaProxy(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const proxiedUrl = `${CORS_PROXY}${encodeURIComponent(url)}`;
  return fetch(proxiedUrl, options);
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

async function requestDeviceCode(): Promise<DeviceCodeResponse> {
  const res = await fetchViaProxy('https://github.com/login/device/code', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: GH_CLIENT_ID,
      scope: GH_SCOPES,
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
): Promise<string> {
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
      return data.access_token;
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

async function fetchGitHubUser(token: string): Promise<{ login: string }> {
  const res = await fetchViaProxy('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch GitHub user: ${res.status}`);
  }

  return res.json();
}

// ── Auth subcommands ────────────────────────────────────────────────────────

async function authLogin(
  _args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const host = 'github.com';

  if (hasGhToken(vfs, host)) {
    const existing = readGhToken(vfs, host)!;
    return ok(
      `\u2713 Already logged in to ${host} as ${existing.user}\n` +
        `  To re-authenticate, run: gh auth logout && gh auth login\n`
    );
  }

  let deviceData: DeviceCodeResponse;
  try {
    deviceData = await requestDeviceCode();
  } catch (e) {
    return err(`Failed to initiate device flow: ${e instanceof Error ? e.message : String(e)}\n`);
  }

  // Copy code to clipboard and show it to the user before opening browser
  try {
    await navigator.clipboard.writeText(deviceData.user_code);
  } catch {
    // clipboard may not be available
  }

  // Show the code in a browser dialog so the user can see it immediately
  // (terminal output won't appear until the command completes)
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

  // Open the verification URI
  try {
    window.open(deviceData.verification_uri, '_blank');
  } catch {
    // ignore — may fail in non-browser env
  }

  let token: string;
  try {
    token = await pollForToken(deviceData.device_code, deviceData.interval, deviceData.expires_in);
  } catch (e) {
    return err(
      output + `\u2717 ${e instanceof Error ? e.message : String(e)}\n`
    );
  }

  let username: string;
  try {
    const user = await fetchGitHubUser(token);
    username = user.login;
  } catch (e) {
    return err(
      output + `\u2717 Authentication succeeded but failed to fetch user info: ${e instanceof Error ? e.message : String(e)}\n`
    );
  }

  writeGhToken(vfs, {
    oauth_token: token,
    user: username,
    git_protocol: 'https',
  }, host);

  await keychain?.persistCurrentState().catch(() => {});

  return ok(
    output +
      `\u2713 Authentication complete.\n` +
      `\u2713 Logged in as ${username}\n`
  );
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
  try {
    const user = await fetchGitHubUser(config.oauth_token);
    username = user.login;
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
      `  - Token scopes: ${GH_SCOPES}\n`
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
    case 'token':
      return authToken(args.slice(1), ctx, vfs);
    default:
      return err(
        `Usage: gh auth <command>\n\n` +
          `Available commands:\n` +
          `  login       Authenticate with a GitHub host\n` +
          `  logout      Log out of a GitHub host\n` +
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
    default:
      return err(
        `Usage: gh repo <command>\n\n` +
          `Available commands:\n` +
          `  list, ls    List repositories owned by user or organization\n`
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
