import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';
import { getDefaultNetworkController, networkFetch } from '../network';

// The `napster` (aka `soundcloud`) CLI. Search + download SoundCloud tracks and
// drive the almost-os player (Winamp/Webamp) over a VFS bridge.
//
// There is no `napster login`: almost-os already requires an Auth0 login to
// use the desktop at all, and the napster gateway (napster/src/index.ts, a
// Cloudflare Worker holding the SoundCloud app secret) verifies that exact
// Auth0 ID token directly. So every command just asks the OS (via the
// `window.almostOS.soundcloud` bridge installed by media/soundcloud-bridge.ts)
// for the token that's already active, with no separate sign-in step.

const GATEWAY_URL = 'https://napster.brett-lamy.workers.dev';
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

// ── OS session bridge ─────────────────────────────────────────────────────────

function getIdToken(): string | null {
  const bridge = (globalThis as { almostOS?: { soundcloud?: { getIdToken?: () => string | null } } }).almostOS
    ?.soundcloud?.getIdToken;
  return bridge?.() ?? null;
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const payload = jwt.split('.')[1] ?? '';
  const padded = payload
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=');
  try {
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return {};
  }
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

// ── gateway API ───────────────────────────────────────────────────────────────

async function apiGet<T>(path: string, params: Record<string, string | number>): Promise<T> {
  const token = getIdToken();
  if (!token) throw new Error("Not signed in to almost-os yet — reload the desktop and try again.");
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) search.set(k, String(v));
  const res = await fetchNet(`${GATEWAY_URL}/sc${path}?${search.toString()}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json; charset=utf-8' },
  });
  if (res.status === 401) throw new Error('almost-os session expired — reload the desktop and try again.');
  if (!res.ok) throw new Error(`SoundCloud API ${res.status}`);
  return (await res.json()) as T;
}

function unwrap(data: RawTrack[] | { collection?: RawTrack[] }): RawTrack[] {
  return Array.isArray(data) ? data : data.collection ?? [];
}

async function searchTracks(query: string, limit = 20): Promise<Track[]> {
  // NB: no `access=playable` — with an app-only (client_credentials) token there
  // is no per-user "playable" context, so that filter returns an empty set.
  const data = await apiGet<RawTrack[] | { collection?: RawTrack[] }>('/tracks', {
    q: query,
    limit,
    linked_partitioning: 'true',
  });
  return unwrap(data)
    .filter((t) => t.kind === undefined || t.kind === 'track')
    .map(normalize);
}

async function resolveTrack(url: string): Promise<Track> {
  const raw = await apiGet<RawTrack>('/resolve', { url });
  if (!raw || typeof raw.id !== 'number') throw new Error('URL did not resolve to a track.');
  return normalize(raw);
}

/** Turn a URL-or-query into a single track. URLs try /resolve then fall back to
 * a widget-playable URL with a name derived from the path (works without auth). */
async function toTrack(target: string): Promise<Track> {
  if (/^https?:\/\//.test(target)) {
    try {
      return await resolveTrack(target);
    } catch {
      const slug = decodeURIComponent(target.split('?')[0].split('/').filter(Boolean).pop() ?? target);
      return { title: slug.replace(/-/g, ' '), artist: 'SoundCloud', url: target, artwork: null, duration: 0 };
    }
  }
  const results = await searchTracks(target, 1);
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
  _keychain?: { persistCurrentState(): Promise<void> } | null,
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
            'napster — SoundCloud for almost-os (Napster 4.0 + Winamp)',
            '',
            "No sign-in needed — you're already logged into almost-os, and the",
            'napster gateway trusts that same login.',
            '',
            'Usage:',
            '  napster whoami                           Show the signed-in user',
            '  napster search <query…>                  Search tracks',
            '  napster resolve <url>                    Resolve a share URL',
            '  napster download <url|query>             Save a virtual mp3 to the desktop',
            '  napster play <url|query>                 Play in Winamp now',
            '  napster queue <url|query>                Add to the Winamp queue',
            '  napster next | prev | toggle | stop      Transport control',
            '',
          ].join('\n'),
        );

      case 'whoami': {
        const token = getIdToken();
        if (!token) return err('Not signed in to almost-os yet — reload the desktop and try again.\n');
        const claims = decodeJwtPayload(token);
        const who =
          typeof claims.email === 'string'
            ? claims.email
            : typeof claims.name === 'string'
              ? claims.name
              : 'you';
        return ok(`${who} (signed in via almost-os)\n`);
      }

      case 'search': {
        if (rest.length === 0) return err('Usage: napster search <query>\n');
        const tracks = await searchTracks(rest.join(' '));
        return ok(formatTrackList(tracks));
      }

      case 'resolve': {
        if (!rest[0]) return err('Usage: napster resolve <url>\n');
        const track = await resolveTrack(rest[0]);
        return ok(`${track.artist} — ${track.title}\n${track.url}\n`);
      }

      case 'download': {
        if (rest.length === 0) return err('Usage: napster download <url|query>\n');
        const track = await toTrack(rest.join(' '));
        const path = writeVirtualMp3(vfs, track);
        return ok(`⬇ Downloaded ${track.artist} — ${track.title}\n   ${path}\n`);
      }

      case 'play': {
        if (rest.length === 0) return err('Usage: napster play <url|query>\n');
        const track = await toTrack(rest.join(' '));
        sendPlayerCommand(vfs, 'play', track);
        return ok(`▶ Playing in Winamp: ${track.artist} — ${track.title}\n`);
      }

      case 'queue': {
        if (rest.length === 0) return err('Usage: napster queue <url|query>\n');
        const track = await toTrack(rest.join(' '));
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
        return err(`napster: unknown command '${sub}'. Try \`napster help\`.\n`);
    }
  } catch (e) {
    return err(`napster: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}
