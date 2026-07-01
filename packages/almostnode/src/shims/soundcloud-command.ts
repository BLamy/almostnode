import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';
import { getDefaultNetworkController, networkFetch } from '../network';
import {
  buildAuthorizeUrl,
  clearScPending,
  deleteScConfig,
  pkceChallenge,
  randomUrlToken,
  readScConfig,
  readScPending,
  SC_API_REG_URL,
  SC_CLIENT_ID,
  SC_REDIRECT_URI,
  SC_TOKEN_URL,
  writeScConfig,
  writeScPending,
  type SoundCloudConfig,
} from './soundcloud-auth';

// The `sc` / `soundcloud` CLI. Search + download SoundCloud tracks and drive the
// almost-os player (Winamp/Webamp) over a VFS bridge. Playback is keyless (the
// browser SoundCloud widget); only search/resolve/whoami need an OAuth token.

const API_BASE = 'https://api.soundcloud.com';
const DOWNLOADS_DIR = '/home/user/Desktop/Napster Downloads';
const BRIDGE_DIR = '/home/user/.winamp';
const COMMAND_PATH = `${BRIDGE_DIR}/command.json`;
const VMP3_MAGIC = 'NAPSTER-VMP3/1';

function ok(stdout: string): JustBashExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}
function err(stderr: string, exitCode = 1): JustBashExecResult {
  return { stdout: '', stderr, exitCode };
}

function fetchNet(url: string, options: RequestInit = {}): Promise<Response> {
  return networkFetch(url, options, getDefaultNetworkController());
}

// ── client_credentials (app-only, no redirect) ───────────────────────────────

function basicAuth(id: string, secret: string): string {
  return `Basic ${btoa(`${id}:${secret}`)}`;
}

async function clientCredentialsToken(
  id: string,
  secret: string,
): Promise<{ access_token: string; expires_in?: number }> {
  const res = await fetchNet(SC_TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: basicAuth(id, secret),
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json; charset=utf-8',
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`client_credentials failed (${res.status})`);
  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) throw new Error('No access_token from client_credentials.');
  return { access_token: data.access_token, expires_in: data.expires_in };
}

function withExpiry(base: SoundCloudConfig, access_token: string, expires_in?: number): SoundCloudConfig {
  return {
    ...base,
    access_token,
    expires_at: expires_in ? Date.now() + expires_in * 1000 : undefined,
  };
}

// ── track shape ─────────────────────────────────────────────────────────────

interface RawTrack {
  id: number;
  urn?: string;
  title?: string;
  permalink_url?: string;
  artwork_url?: string | null;
  duration?: number;
  user?: { username?: string };
  kind?: string;
}

interface Track {
  title: string;
  artist: string;
  url: string;
  artwork: string | null;
  duration: number;
}

function normalize(raw: RawTrack): Track {
  return {
    title: raw.title ?? 'Untitled',
    artist: raw.user?.username ?? 'Unknown Artist',
    url: raw.permalink_url ?? '',
    artwork: raw.artwork_url ?? null,
    duration: raw.duration ?? 0,
  };
}

// ── auth-backed API ───────────────────────────────────────────────────────────

async function refreshIfNeeded(vfs: VirtualFS, cfg: SoundCloudConfig): Promise<SoundCloudConfig> {
  if (!cfg.expires_at || cfg.expires_at - Date.now() > 60_000) return cfg;
  // Our own app → client_credentials (no user, no redirect).
  if (cfg.client_id && cfg.client_secret) {
    try {
      const t = await clientCredentialsToken(cfg.client_id, cfg.client_secret);
      const next = withExpiry(cfg, t.access_token, t.expires_in);
      writeScConfig(vfs, next);
      return next;
    } catch {
      return cfg;
    }
  }
  if (!cfg.refresh_token) return cfg;
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: cfg.refresh_token,
    client_id: SC_CLIENT_ID,
  });
  const res = await fetchNet(SC_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) return cfg; // fall through; API call will 401 if truly dead
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
  };
  if (!data.access_token) return cfg;
  const next: SoundCloudConfig = {
    ...cfg,
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? cfg.refresh_token,
    expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
  };
  writeScConfig(vfs, next);
  return next;
}

async function apiGet<T>(
  vfs: VirtualFS,
  path: string,
  params: Record<string, string | number>,
): Promise<T> {
  let cfg = readScConfig(vfs);
  if (!cfg?.access_token) {
    throw new Error('Not signed in. Run `sc login` first.');
  }
  cfg = await refreshIfNeeded(vfs, cfg);
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) search.set(k, String(v));
  const res = await fetchNet(`${API_BASE}${path}?${search.toString()}`, {
    headers: {
      Authorization: `OAuth ${cfg.access_token}`,
      Accept: 'application/json; charset=utf-8',
    },
  });
  if (res.status === 401) throw new Error('SoundCloud session expired. Run `sc login` again.');
  if (!res.ok) throw new Error(`SoundCloud API ${res.status}`);
  return (await res.json()) as T;
}

function unwrap(data: RawTrack[] | { collection?: RawTrack[] }): RawTrack[] {
  return Array.isArray(data) ? data : data.collection ?? [];
}

async function searchTracks(vfs: VirtualFS, query: string, limit = 20): Promise<Track[]> {
  // NB: no `access=playable` — with an app-only (client_credentials) token there
  // is no per-user "playable" context, so that filter returns an empty set.
  const data = await apiGet<RawTrack[] | { collection?: RawTrack[] }>(vfs, '/tracks', {
    q: query,
    limit,
    linked_partitioning: 'true',
  });
  return unwrap(data)
    .filter((t) => t.kind === undefined || t.kind === 'track')
    .map(normalize);
}

async function resolveTrack(vfs: VirtualFS, url: string): Promise<Track> {
  const raw = await apiGet<RawTrack>(vfs, '/resolve', { url });
  if (!raw || typeof raw.id !== 'number') throw new Error('URL did not resolve to a track.');
  return normalize(raw);
}

/** Turn a URL-or-query into a single track. URLs try /resolve then fall back to
 * a widget-playable URL with a name derived from the path (works without auth). */
async function toTrack(vfs: VirtualFS, target: string): Promise<Track> {
  if (/^https?:\/\//.test(target)) {
    try {
      return await resolveTrack(vfs, target);
    } catch {
      const slug = decodeURIComponent(target.split('?')[0].split('/').filter(Boolean).pop() ?? target);
      return { title: slug.replace(/-/g, ' '), artist: 'SoundCloud', url: target, artwork: null, duration: 0 };
    }
  }
  const results = await searchTracks(vfs, target, 1);
  if (results.length === 0) throw new Error(`No results for "${target}".`);
  return results[0];
}

// ── VFS helpers: virtual mp3 + player bridge ─────────────────────────────────

function sanitize(part: string): string {
  return part.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function writeVirtualMp3(vfs: VirtualFS, track: Track): string {
  if (!vfs.existsSync(DOWNLOADS_DIR)) vfs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  const file = `${sanitize(track.artist || 'Unknown Artist')} - ${sanitize(track.title || 'Untitled')}.mp3`;
  const payload = {
    url: track.url,
    title: track.title,
    artist: track.artist,
    artwork: track.artwork,
    duration: track.duration,
    downloadedAt: Date.now(),
  };
  const path = `${DOWNLOADS_DIR}/${file}`;
  vfs.writeFileSync(path, `${VMP3_MAGIC}\n${JSON.stringify(payload, null, 2)}\n`);
  return path;
}

function sendPlayerCommand(
  vfs: VirtualFS,
  action: 'play' | 'queue' | 'next' | 'prev' | 'toggle' | 'stop',
  track?: Track,
): void {
  if (!vfs.existsSync(BRIDGE_DIR)) vfs.mkdirSync(BRIDGE_DIR, { recursive: true });
  vfs.writeFileSync(
    COMMAND_PATH,
    JSON.stringify({
      id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
      action,
      url: track?.url,
      title: track?.title,
      artist: track?.artist,
    }),
  );
}

// ── subcommands ───────────────────────────────────────────────────────────────

function getFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

async function fetchWhoami(token: string): Promise<string | undefined> {
  try {
    const res = await fetchNet(`${API_BASE}/me`, {
      headers: { Authorization: `OAuth ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { username?: string; permalink?: string };
    return data.username ?? data.permalink;
  } catch {
    return undefined;
  }
}

async function cmdLogin(
  args: string[],
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  // Your own app creds → client_credentials (no redirect, no popup, headless):
  //   sc login --client-id <id> --client-secret <secret>
  const clientId = getFlag(args, '--client-id');
  const clientSecret = getFlag(args, '--client-secret');
  if (clientId && clientSecret) {
    const t = await clientCredentialsToken(clientId, clientSecret);
    writeScConfig(
      vfs,
      withExpiry({ access_token: '', client_id: clientId, client_secret: clientSecret }, t.access_token, t.expires_in),
    );
    await keychain?.persistCurrentState().catch(() => {});
    return ok('✓ Signed in with your own app (client_credentials). Search is ready — no redirect needed.\n');
  }

  // Bare `sc login` when we already have our own app creds → just refresh.
  if (args.length === 0) {
    const existing = readScConfig(vfs);
    if (existing?.client_id && existing?.client_secret) {
      const t = await clientCredentialsToken(existing.client_id, existing.client_secret);
      writeScConfig(vfs, withExpiry(existing, t.access_token, t.expires_in));
      await keychain?.persistCurrentState().catch(() => {});
      return ok('✓ Refreshed app token (client_credentials).\n');
    }
  }

  // Direct token: `sc login --token <access_token>`
  const token = getFlag(args, '--token');
  if (token) {
    const user = await fetchWhoami(token);
    writeScConfig(vfs, { access_token: token, oauth_user: user });
    await keychain?.persistCurrentState().catch(() => {});
    return ok(`✓ Signed in to SoundCloud${user ? ` as ${user}` : ''}.\n`);
  }

  // Complete a pending PKCE flow: `sc login --code <code>`
  const code = getFlag(args, '--code');
  if (code) {
    const pending = readScPending(vfs);
    if (!pending) return err('No login in progress. Run `sc login` first.\n');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: SC_CLIENT_ID,
      redirect_uri: SC_REDIRECT_URI,
      code_verifier: pending.code_verifier,
      code,
    });
    const res = await fetchNet(SC_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) {
      return err(`Token exchange failed (${res.status}). The code may have expired — run \`sc login\` again.\n`);
    }
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!data.access_token) return err('Token exchange returned no access_token.\n');
    const user = await fetchWhoami(data.access_token);
    writeScConfig(vfs, {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      oauth_user: user,
    });
    clearScPending(vfs);
    await keychain?.persistCurrentState().catch(() => {});
    return ok(`✓ Signed in to SoundCloud${user ? ` as ${user}` : ''}.\n`);
  }

  // Preferred path: hand off to the in-app browser OAuth flow (popup + the dev
  // 127.0.0.1:8765 callback listener), which saves the token to the VFS and
  // seals it in the keychain. Available when running inside almost-os.
  const bridge = (globalThis as { almostOS?: { soundcloud?: { login?: () => unknown } } }).almostOS
    ?.soundcloud?.login;
  if (typeof bridge === "function") {
    try {
      bridge();
    } catch {
      /* fall through to manual flow */
    }
    return ok(
      [
        "Opening SoundCloud sign-in in a popup…",
        "Approve access there; the window closes itself and your token is saved.",
        "Then run `sc whoami` to confirm.",
        "",
      ].join("\n"),
    );
  }

  // Headless fallback: manual PKCE (paste the code back).
  const verifier = randomUrlToken();
  const state = randomUrlToken(16);
  const challenge = await pkceChallenge(verifier);
  writeScPending(vfs, { code_verifier: verifier, state });
  const authorizeUrl = buildAuthorizeUrl(challenge, state);
  try {
    (globalThis as { open?: (u: string, t?: string) => unknown }).open?.(authorizeUrl, '_blank');
  } catch {
    /* headless */
  }
  return ok(
    [
      'Opening SoundCloud authorization in your browser…',
      '',
      authorizeUrl,
      '',
      "After you approve, the browser lands on a 127.0.0.1 page that won't load —",
      "that's expected. Copy the `code` value from its address bar and run:",
      '',
      '    sc login --code <code>',
      '',
      'Already have a token? Skip all this with:  sc login --token <access_token>',
      '',
    ].join('\n'),
  );
}

async function cmdRegister(
  args: string[],
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const cfg = readScConfig(vfs);
  if (!cfg?.access_token) {
    return err('Registering an app needs a user login first. Run `sc login`, then `sc register`.\n');
  }
  const name = getFlag(args, '--name');
  if (!name) return err('Usage: sc register --name <app name> [--description <d>] [--website <url>]\n');
  const res = await fetchNet(SC_API_REG_URL, {
    method: 'POST',
    headers: {
      Authorization: `OAuth ${cfg.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      name,
      description: getFlag(args, '--description') ?? name,
      website: getFlag(args, '--website') ?? 'https://almostos.local',
    }),
  });
  if (!res.ok) {
    return err(`App registration failed (${res.status}): ${(await res.text().catch(() => '')).slice(0, 200)}\n`);
  }
  const app = (await res.json()) as { client_id?: string; client_secret?: string };
  if (!app.client_id || !app.client_secret) return err('Registration returned no client_id/secret.\n');
  const t = await clientCredentialsToken(app.client_id, app.client_secret);
  writeScConfig(
    vfs,
    withExpiry({ ...cfg, client_id: app.client_id, client_secret: app.client_secret }, t.access_token, t.expires_in),
  );
  await keychain?.persistCurrentState().catch(() => {});
  return ok(
    `✓ Registered "${name}" and switched to client_credentials (no redirect needed).\n  client_id=${app.client_id}\n`,
  );
}

function formatTrackList(tracks: Track[]): string {
  if (tracks.length === 0) return 'No results.\n';
  return (
    tracks
      .map((t, i) => `${String(i + 1).padStart(2)}. ${t.artist} — ${t.title}\n    ${t.url}`)
      .join('\n') + '\n'
  );
}

export async function runSoundCloudCommand(
  args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS,
  keychain?: { persistCurrentState(): Promise<void> } | null,
): Promise<JustBashExecResult> {
  const sub = args[0];
  const rest = args.slice(1);
  try {
    switch (sub) {
      case undefined:
      case 'help':
      case '--help':
      case '-h':
        return ok(
          [
            'sc — SoundCloud for almost-os (Napster 4.0 + Winamp)',
            '',
            'Usage:',
            '  sc login --client-id <id> --client-secret <secret>',
            '                                       Sign in with your own app (client_credentials, no redirect)',
            '  sc login [--token <t>] [--code <c>]  Sign in (bundled PKCE, or paste a token)',
            '  sc register --name <n>               Mint your own app (needs a prior `sc login`)',
            '  sc logout                            Forget the saved token',
            '  sc whoami                            Show the signed-in user',
            '  sc search <query…>                   Search tracks',
            '  sc resolve <url>                     Resolve a share URL',
            '  sc download <url|query>              Save a virtual mp3 to the desktop',
            '  sc play <url|query>                  Play in Winamp now',
            '  sc queue <url|query>                 Add to the Winamp queue',
            '  sc next | prev | toggle | stop       Transport control',
            '',
          ].join('\n'),
        );

      case 'login':
        return await cmdLogin(rest, vfs, keychain);

      case 'register':
        return await cmdRegister(rest, vfs, keychain);

      case 'logout':
        deleteScConfig(vfs);
        await keychain?.persistCurrentState().catch(() => {});
        return ok('✓ Signed out of SoundCloud.\n');

      case 'whoami': {
        const cfg = readScConfig(vfs);
        if (!cfg?.access_token) return err('Not signed in. Run `sc login`.\n');
        const user = (await fetchWhoami(cfg.access_token)) ?? cfg.oauth_user;
        return user ? ok(`${user}\n`) : err('Could not fetch user (token may be invalid).\n');
      }

      case 'search': {
        if (rest.length === 0) return err('Usage: sc search <query>\n');
        const tracks = await searchTracks(vfs, rest.join(' '));
        return ok(formatTrackList(tracks));
      }

      case 'resolve': {
        if (!rest[0]) return err('Usage: sc resolve <url>\n');
        const track = await resolveTrack(vfs, rest[0]);
        return ok(`${track.artist} — ${track.title}\n${track.url}\n`);
      }

      case 'download': {
        if (rest.length === 0) return err('Usage: sc download <url|query>\n');
        const track = await toTrack(vfs, rest.join(' '));
        const path = writeVirtualMp3(vfs, track);
        return ok(`⬇ Downloaded ${track.artist} — ${track.title}\n   ${path}\n`);
      }

      case 'play': {
        if (rest.length === 0) return err('Usage: sc play <url|query>\n');
        const track = await toTrack(vfs, rest.join(' '));
        sendPlayerCommand(vfs, 'play', track);
        return ok(`▶ Playing in Winamp: ${track.artist} — ${track.title}\n`);
      }

      case 'queue': {
        if (rest.length === 0) return err('Usage: sc queue <url|query>\n');
        const track = await toTrack(vfs, rest.join(' '));
        sendPlayerCommand(vfs, 'queue', track);
        return ok(`＋ Queued in Winamp: ${track.artist} — ${track.title}\n`);
      }

      case 'next':
        sendPlayerCommand(vfs, 'next');
        return ok('⏭ Next\n');
      case 'prev':
        sendPlayerCommand(vfs, 'prev');
        return ok('⏮ Previous\n');
      case 'toggle':
        sendPlayerCommand(vfs, 'toggle');
        return ok('⏯ Toggled play/pause\n');
      case 'stop':
        sendPlayerCommand(vfs, 'stop');
        return ok('⏹ Stopped\n');

      default:
        return err(`sc: unknown command '${sub}'. Try \`sc help\`.\n`);
    }
  } catch (e) {
    return err(`sc: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}
