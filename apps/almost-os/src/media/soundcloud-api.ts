// Browser-side SoundCloud API client. Powers Napster 4.0 search + the resolve
// step Winamp uses when you Add-URL. Calls are routed through almost-os's CORS
// proxy (the same path Chrome tabs use) and authenticated with the OAuth token
// that `sc login` writes into the VFS. We pass the token as the `oauth_token`
// query param (a supported v1 alternative to the Authorization header) so the
// call works through any CORS proxy without header forwarding.

import { getWorkspace } from "../runtime/runtime";
import { CORS_PROXY_URL } from "../apps/tailscale/tailscale-config";

const API_BASE = "https://api.soundcloud.com";
export const SC_CONFIG_PATH = "/home/user/.config/sc/config.json";

export interface SCTrack {
  id: number;
  urn: string;
  title: string;
  artist: string;
  permalinkUrl: string;
  artwork: string | null;
  /** ms */
  duration: number;
  streamable: boolean;
}

export class SoundCloudAuthError extends Error {
  constructor(message = "Not signed in to SoundCloud. Run `sc login` in Terminal.") {
    super(message);
    this.name = "SoundCloudAuthError";
  }
}

/** Read the access token `sc login` persisted, or null if not signed in. */
export function readAccessToken(): string | null {
  try {
    const raw = getWorkspace().vfs.readFileSync(SC_CONFIG_PATH, "utf8");
    const cfg = JSON.parse(String(raw)) as { access_token?: string };
    return cfg.access_token ?? null;
  } catch {
    return null;
  }
}

export function isSignedIn(): boolean {
  return readAccessToken() !== null;
}

function proxied(url: string): string {
  return `${CORS_PROXY_URL}${encodeURIComponent(url)}`;
}

async function scGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const token = readAccessToken();
  if (!token) throw new SoundCloudAuthError();
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) search.set(k, String(v));
  search.set("oauth_token", token);
  const res = await fetch(proxied(`${API_BASE}${path}?${search.toString()}`), {
    headers: { Accept: "application/json; charset=utf-8" },
  });
  if (res.status === 401) throw new SoundCloudAuthError("SoundCloud session expired. Run `sc login` again.");
  if (!res.ok) throw new Error(`SoundCloud API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  return (await res.json()) as T;
}

interface RawTrack {
  id: number;
  urn?: string;
  title?: string;
  permalink_url?: string;
  artwork_url?: string | null;
  duration?: number;
  streamable?: boolean;
  user?: { username?: string };
  kind?: string;
}

function normalize(raw: RawTrack): SCTrack {
  return {
    id: raw.id,
    urn: raw.urn ?? `soundcloud:tracks:${raw.id}`,
    title: raw.title ?? "Untitled",
    artist: raw.user?.username ?? "Unknown Artist",
    permalinkUrl: raw.permalink_url ?? "",
    // Ask for the bigger artwork variant SoundCloud omits by default.
    artwork: raw.artwork_url ? raw.artwork_url.replace("-large", "-t300x300") : null,
    duration: raw.duration ?? 0,
    streamable: raw.streamable ?? true,
  };
}

/** `linked_partitioning` responses wrap the array in `{ collection, next_href }`. */
function unwrap(data: RawTrack[] | { collection?: RawTrack[] }): RawTrack[] {
  if (Array.isArray(data)) return data;
  return data.collection ?? [];
}

export interface SearchOptions {
  limit?: number;
  genre?: string;
}

export async function searchTracks(query: string, opts: SearchOptions = {}): Promise<SCTrack[]> {
  // No `access=playable`: an app-only (client_credentials) token has no per-user
  // "playable" context, so that filter would return nothing.
  const params: Record<string, string | number> = {
    q: query,
    limit: opts.limit ?? 24,
    linked_partitioning: "true",
  };
  if (opts.genre) params.genres = opts.genre;
  const data = await scGet<RawTrack[] | { collection?: RawTrack[] }>("/tracks", params);
  return unwrap(data)
    .filter((t) => t.kind === undefined || t.kind === "track")
    .map(normalize);
}

/** Resolve a soundcloud.com share/permalink URL into a track. */
export async function resolveTrack(url: string): Promise<SCTrack> {
  const raw = await scGet<RawTrack>("/resolve", { url });
  if (!raw || typeof raw.id !== "number") throw new Error("That SoundCloud URL did not resolve to a track.");
  return normalize(raw);
}

/**
 * Home-page sections. SoundCloud's v1 API has no real "charts" endpoint, so New
 * Releases / Top 10s / Staff Picks are approximated with curated genre queries.
 */
export async function sectionTracks(section: string, limit = 8): Promise<SCTrack[]> {
  const queries: Record<string, string> = {
    "new-releases": "new music 2026",
    "staff-picks": "essential mix",
    "top-tracks": "top hits",
    hiphop: "hip hop",
    electronic: "electronic",
    rock: "rock",
  };
  return searchTracks(queries[section] ?? section, { limit });
}
