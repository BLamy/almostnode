// Browser-side SoundCloud API client. Powers Napster 4.0 search + the resolve
// step Winamp uses when you Add-URL. Calls go straight to the napster gateway
// (a Cloudflare Worker that holds the SoundCloud app secret server-side) using
// the almost-os desktop's own Auth0 ID token as the Bearer — the gateway
// verifies that exact token, so there's no separate SoundCloud sign-in step.

import { getSession } from "../auth/auth0";

const GATEWAY_URL = "https://napster.brett-lamy.workers.dev";

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
  constructor(message = "Not signed into almost-os yet — reload the page and try again.") {
    super(message);
    this.name = "SoundCloudAuthError";
  }
}

export function isSignedIn(): boolean {
  return getSession() !== null;
}

/** Authenticated GET against the gateway; `subpath` is the full path (e.g. "/sc/tracks", "/genre/rock"). */
async function gatewayGet<T>(subpath: string, params: Record<string, string | number> = {}): Promise<T> {
  const session = getSession();
  if (!session) throw new SoundCloudAuthError();
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) search.set(k, String(v));
  const qs = search.toString();
  const res = await fetch(`${GATEWAY_URL}${subpath}${qs ? `?${qs}` : ""}`, {
    headers: { Authorization: `Bearer ${session.id_token}`, Accept: "application/json; charset=utf-8" },
  });
  if (res.status === 401) throw new SoundCloudAuthError("almost-os session expired — reload the page.");
  if (!res.ok) throw new Error(`SoundCloud API ${res.status}: ${await res.text().catch(() => res.statusText)}`);
  return (await res.json()) as T;
}

function scGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  return gatewayGet<T>(`/sc${path}`, params);
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

// Curated artist lists per genre. SoundCloud's free-text search for a bare
// genre word ("Classical") returns noise, so genre browsing instead searches a
// hand-picked roster of real artists for that genre and merges the results —
// yielding genre-appropriate tracks with good, resolvable permalinks. Results
// are cached per genre for the session.
export const GENRE_ARTISTS: Record<string, string[]> = {
  Alternative: ["Radiohead", "Arctic Monkeys", "Tame Impala", "The Strokes"],
  "Hip-Hop": ["Kendrick Lamar", "J. Cole", "Travis Scott", "Tyler, The Creator"],
  Electronic: ["deadmau5", "ODESZA", "Flume", "Disclosure", "John Summit"],
  Rock: ["Foo Fighters", "Red Hot Chili Peppers", "Queens of the Stone Age", "Nirvana"],
  Pop: ["Dua Lipa", "The Weeknd", "Ariana Grande", "Charli XCX"],
  Classical: ["Ludovico Einaudi", "Max Richter", "Hans Zimmer", "Ólafur Arnalds"],
  Jazz: ["Miles Davis", "John Coltrane", "Robert Glasper", "Kamasi Washington"],
  Country: ["Zach Bryan", "Chris Stapleton", "Luke Combs", "Morgan Wallen"],
};

const genreCache = new Map<string, SCTrack[]>();

/**
 * Genre browse: search the curated roster for `genre`, merge + dedupe by
 * permalink, cap to `limit`. Falls back to a plain keyword search if the genre
 * isn't curated or the roster returns nothing. Cached per genre.
 */
export async function searchGenre(genre: string, opts: SearchOptions = {}): Promise<SCTrack[]> {
  const limit = opts.limit ?? 30;
  const cached = genreCache.get(genre);
  if (cached) return cached.slice(0, limit);

  // Prefer the gateway's server-side curated+cached endpoint; if it isn't
  // deployed (404) or errors, fall back to client-side curation below.
  try {
    const hosted = await gatewayGet<SCTrack[]>(`/genre/${encodeURIComponent(genre.toLowerCase())}`, {
      limit,
    });
    if (Array.isArray(hosted) && hosted.length) {
      genreCache.set(genre, hosted);
      return hosted.slice(0, limit);
    }
  } catch {
    /* endpoint not deployed yet or transient — use client curation */
  }

  const artists = GENRE_ARTISTS[genre];
  let tracks: SCTrack[] = [];
  if (artists?.length) {
    const per = Math.max(4, Math.ceil(limit / artists.length));
    const batches = await Promise.all(
      artists.map((a) => searchTracks(a, { limit: per }).catch(() => [] as SCTrack[])),
    );
    const seen = new Set<string>();
    for (const batch of batches) {
      for (const t of batch) {
        if (t.permalinkUrl && !seen.has(t.permalinkUrl)) {
          seen.add(t.permalinkUrl);
          tracks.push(t);
        }
      }
    }
  }
  if (tracks.length === 0) tracks = await searchTracks(genre, { limit });
  genreCache.set(genre, tracks);
  return tracks.slice(0, limit);
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
