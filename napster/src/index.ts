import { Hono, type Context, type Next } from "hono";
import { cors } from "hono/cors";
import { createRemoteJWKSet, jwtVerify } from "jose";

// napster gateway — a Cloudflare Worker (Hono) that proxies the SoundCloud API.
// It holds the SoundCloud app secret server-side (client_credentials, cached
// in KV) and serves /sc/* only to callers presenting a valid Auth0 ID token —
// the same token the almost-os desktop already required at login. There is no
// separate sign-in step and no second, gateway-issued token: Auth0 already
// proved who's asking, so /sc/* verifies that exact token directly against
// Auth0's own JWKS, instead of minting and managing a token of our own.

type Env = {
  /** Caches the SoundCloud client_credentials app token. */
  KV: KVNamespace;
  /** SoundCloud app credentials (wrangler secrets). */
  SC_CLIENT_ID: string;
  SC_CLIENT_SECRET: string;
  /** Auth0 tenant that gates the almost-os desktop. */
  AUTH0_DOMAIN: string;
  /** Auth0 client_id the almost-os desktop logs in with (the ID token's `aud`). */
  AUTH0_AUDIENCE: string;
};

const SC_API = "https://api.soundcloud.com";
const SC_TOKEN_URL = "https://secure.soundcloud.com/oauth/token";

const app = new Hono<{ Bindings: Env }>();
app.use("*", cors());

app.get("/", (c) => c.text("napster gateway — SoundCloud proxy, gated by your almost-os Auth0 login.\n"));

// Auth0 verification -----------------------------------------------------------

let auth0Jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let auth0JwksDomain: string | null = null;
function getAuth0Jwks(domain: string): ReturnType<typeof createRemoteJWKSet> {
  if (!auth0Jwks || auth0JwksDomain !== domain) {
    auth0Jwks = createRemoteJWKSet(new URL(`https://${domain}/.well-known/jwks.json`));
    auth0JwksDomain = domain;
  }
  return auth0Jwks;
}

const requireAuth0 = async (c: Context<{ Bindings: Env }>, next: Next) => {
  const token = (c.req.header("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return c.json({ error: "missing_token" }, 401);
  try {
    await jwtVerify(token, getAuth0Jwks(c.env.AUTH0_DOMAIN), {
      issuer: `https://${c.env.AUTH0_DOMAIN}/`,
      audience: c.env.AUTH0_AUDIENCE,
    });
  } catch {
    return c.json({ error: "invalid_token" }, 401);
  }
  await next();
};
app.use("/sc/*", requireAuth0);
app.use("/genre/*", requireAuth0);

// SoundCloud client_credentials proxy ------------------------------------------

interface CachedScToken {
  token: string;
  exp: number;
}

async function getSoundCloudToken(env: Env): Promise<string> {
  const cached = (await env.KV.get("sc:cctoken", "json")) as CachedScToken | null;
  if (cached && cached.exp > Date.now() + 30_000) return cached.token;
  const res = await fetch(SC_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${env.SC_CLIENT_ID}:${env.SC_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`SoundCloud client_credentials failed (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in?: number };
  const ttl = data.expires_in ?? 3600;
  await env.KV.put(
    "sc:cctoken",
    JSON.stringify({ token: data.access_token, exp: Date.now() + ttl * 1000 } satisfies CachedScToken),
    { expirationTtl: ttl },
  );
  return data.access_token;
}

// Curated genre browse ---------------------------------------------------------
// A bare-genre keyword search on SoundCloud returns noise, so each genre maps to
// a hand-picked artist roster. `/genre/:name` searches that roster server-side,
// merges + dedupes into normalized tracks with good permalinks, and caches the
// result in KV so repeat browses are one KV read. Mirrors the client fallback in
// apps/almost-os/src/media/soundcloud-api.ts (searchGenre), letting the client
// offload curation here later without changing shape.

const GENRE_ARTISTS: Record<string, string[]> = {
  alternative: ["Radiohead", "Arctic Monkeys", "Tame Impala", "The Strokes"],
  "hip-hop": ["Kendrick Lamar", "J. Cole", "Travis Scott", "Tyler, The Creator"],
  electronic: ["deadmau5", "ODESZA", "Flume", "Disclosure", "John Summit"],
  rock: ["Foo Fighters", "Red Hot Chili Peppers", "Queens of the Stone Age", "Nirvana"],
  pop: ["Dua Lipa", "The Weeknd", "Ariana Grande", "Charli XCX"],
  classical: ["Ludovico Einaudi", "Max Richter", "Hans Zimmer", "Ólafur Arnalds"],
  jazz: ["Miles Davis", "John Coltrane", "Robert Glasper", "Kamasi Washington"],
  country: ["Zach Bryan", "Chris Stapleton", "Luke Combs", "Morgan Wallen"],
};

const CURATED_TTL = 21_600; // 6h

interface NormalizedTrack {
  id: number;
  urn: string;
  title: string;
  artist: string;
  permalinkUrl: string;
  artwork: string | null;
  duration: number;
  streamable: boolean;
}

interface RawScTrack {
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

function normalizeTrack(raw: RawScTrack): NormalizedTrack {
  return {
    id: raw.id,
    urn: raw.urn ?? `soundcloud:tracks:${raw.id}`,
    title: raw.title ?? "Untitled",
    artist: raw.user?.username ?? "Unknown Artist",
    permalinkUrl: raw.permalink_url ?? "",
    artwork: raw.artwork_url ? raw.artwork_url.replace("-large", "-t300x300") : null,
    duration: raw.duration ?? 0,
    streamable: raw.streamable ?? true,
  };
}

async function scSearch(scToken: string, query: string, limit: number): Promise<NormalizedTrack[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit), linked_partitioning: "true" });
  const res = await fetch(`${SC_API}/tracks?${params.toString()}`, {
    headers: { Authorization: `OAuth ${scToken}`, Accept: "application/json; charset=utf-8" },
  });
  if (!res.ok) return [];
  const data = (await res.json()) as RawScTrack[] | { collection?: RawScTrack[] };
  const rows = Array.isArray(data) ? data : (data.collection ?? []);
  return rows.filter((t) => t.kind === undefined || t.kind === "track").map(normalizeTrack);
}

app.get("/genre/:name", async (c) => {
  const name = c.req.param("name").toLowerCase();
  const limit = Math.min(Number(c.req.query("limit")) || 30, 50);
  const artists = GENRE_ARTISTS[name];
  if (!artists) return c.json({ error: "unknown_genre", genre: name }, 404);

  const cacheKey = `curated:${name}`;
  const cached = (await c.env.KV.get(cacheKey, "json")) as NormalizedTrack[] | null;
  if (cached) return c.json(cached.slice(0, limit));

  const scToken = await getSoundCloudToken(c.env);
  const per = Math.max(4, Math.ceil(limit / artists.length));
  const batches = await Promise.all(artists.map((a) => scSearch(scToken, a, per).catch(() => [])));
  const seen = new Set<string>();
  const tracks: NormalizedTrack[] = [];
  for (const batch of batches) {
    for (const t of batch) {
      if (t.permalinkUrl && !seen.has(t.permalinkUrl)) {
        seen.add(t.permalinkUrl);
        tracks.push(t);
      }
    }
  }
  if (tracks.length) {
    await c.env.KV.put(cacheKey, JSON.stringify(tracks), { expirationTtl: CURATED_TTL });
  }
  return c.json(tracks.slice(0, limit));
});

// Read-only passthrough: /sc/<path> → api.soundcloud.com/<path> (+ query).
app.get("/sc/*", async (c) => {
  const u = new URL(c.req.url);
  const scPath = u.pathname.replace(/^\/sc/, "");
  const target = `${SC_API}${scPath}${u.search}`;
  const scToken = await getSoundCloudToken(c.env);
  const res = await fetch(target, {
    headers: { Authorization: `OAuth ${scToken}`, Accept: "application/json; charset=utf-8" },
  });
  const bodyText = await res.text();
  return new Response(bodyText, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
  });
});

export default app;
