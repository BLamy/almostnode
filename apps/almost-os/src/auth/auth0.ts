// OS-level login gate against Auth0, redirect-based (the whole desktop is
// behind this, so a full-page redirect - not a popup - is the right shape).
//
// Defaults mirror the Replay dashboard Auth0 application used elsewhere in
// this monorepo. Vite env vars can still override these for other environments.

const DEFAULT_DOMAIN = "webreplay.us.auth0.com";
const DEFAULT_CLIENT_ID = "J0U5KKcVSO451nCeBO0XaOfgrQrtXpu2";
const DEFAULT_FLOW: Auth0Flow = "implicit";
const SESSION_KEY = "almostos.auth0.session";
const PENDING_KEY = "almostos.auth0.pending";
const AUTH_CALLBACK_PARAMS = [
  "access_token",
  "code",
  "error",
  "error_description",
  "error_uri",
  "expires_in",
  "id_token",
  "scope",
  "state",
  "token_type",
] as const;

type Auth0Flow = "implicit" | "pkce";

export interface Auth0Profile {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
}

export interface Auth0Session {
  access_token: string;
  id_token: string;
  expires_at: number;
  profile: Auth0Profile;
}

interface PendingLogin {
  flow: Auth0Flow;
  state: string;
  redirectUri: string;
  nonce?: string;
  verifier?: string;
}

export function getAuth0Domain(): string {
  return (import.meta.env.VITE_AUTH0_DOMAIN as string | undefined)?.trim() || DEFAULT_DOMAIN;
}

export function getAuth0ClientId(): string | undefined {
  return (import.meta.env.VITE_AUTH0_CLIENT_ID as string | undefined)?.trim() || DEFAULT_CLIENT_ID;
}

export function getAuth0Flow(): Auth0Flow {
  const flow = (import.meta.env.VITE_AUTH0_FLOW as string | undefined)?.trim().toLowerCase();
  if (flow === "pkce" || flow === "code") return "pkce";
  if (flow === "implicit") return "implicit";
  return DEFAULT_FLOW;
}

export function isAuth0Configured(): boolean {
  return !!getAuth0ClientId();
}

function redirectUri(): string {
  return window.location.origin + window.location.pathname;
}

// ── PKCE helpers ─────────────────────────────────────────────────────────────

function base64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function randomToken(len = 48): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const payload = jwt.split(".")[1] ?? "";
  const padded = payload.replace(/-/g, "+").replace(/_/g, "/").padEnd(payload.length + ((4 - (payload.length % 4)) % 4), "=");
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

function parseHashParams(url: URL): URLSearchParams {
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  if (!hash || hash.startsWith("/") || hash.startsWith("!")) {
    return new URLSearchParams();
  }
  return new URLSearchParams(hash);
}

function getAuthParam(url: URL, hashParams: URLSearchParams, name: string): string | null {
  return url.searchParams.get(name) ?? hashParams.get(name);
}

function hasAuthCallback(url: URL, hashParams: URLSearchParams): boolean {
  return AUTH_CALLBACK_PARAMS.some((name) => url.searchParams.has(name) || hashParams.has(name));
}

function stripAuthParams(url: URL): void {
  for (const name of AUTH_CALLBACK_PARAMS) {
    url.searchParams.delete(name);
  }

  const hashParams = parseHashParams(url);
  const hasHashAuthParams = AUTH_CALLBACK_PARAMS.some((name) => hashParams.has(name));
  if (hasHashAuthParams) {
    for (const name of AUTH_CALLBACK_PARAMS) {
      hashParams.delete(name);
    }
    const remainingHash = hashParams.toString();
    url.hash = remainingHash ? `#${remainingHash}` : "";
  }

  window.history.replaceState({}, "", url.toString());
}

function consumePendingLogin(): PendingLogin | null {
  const pendingRaw = sessionStorage.getItem(PENDING_KEY);
  sessionStorage.removeItem(PENDING_KEY);
  if (!pendingRaw) return null;
  try {
    return JSON.parse(pendingRaw) as PendingLogin;
  } catch {
    return null;
  }
}

function formatAuth0Error(error: string, description: string | null): string {
  return description ? `Auth0 error: ${description} (${error}).` : `Auth0 error: ${error}.`;
}

function assertIdTokenClaims(
  claims: Record<string, unknown>,
  pending: PendingLogin,
  clientId: string,
): void {
  const issuer = `https://${getAuth0Domain()}/`;
  if (claims.iss && claims.iss !== issuer) {
    throw new Error("Auth0 ID token issuer did not match the configured domain.");
  }

  const audience = claims.aud;
  const audienceMatches = Array.isArray(audience)
    ? audience.includes(clientId)
    : audience === clientId;
  if (!audienceMatches) {
    throw new Error("Auth0 ID token audience did not match the configured client.");
  }

  if (typeof claims.exp === "number" && claims.exp * 1000 <= Date.now()) {
    throw new Error("Auth0 ID token is expired.");
  }

  if (pending.nonce && claims.nonce !== pending.nonce) {
    throw new Error("Auth0 nonce mismatch - please sign in again.");
  }
}

function buildSessionFromTokens(params: {
  accessToken: string;
  idToken: string;
  expiresIn?: string | number | null;
  pending: PendingLogin;
  clientId: string;
}): Auth0Session {
  const claims = decodeJwtPayload(params.idToken);
  assertIdTokenClaims(claims, params.pending, params.clientId);

  const expiresInSeconds = Number(params.expiresIn ?? 86400);
  const responseExpiresAt =
    Date.now() + (Number.isFinite(expiresInSeconds) && expiresInSeconds > 0 ? expiresInSeconds : 86400) * 1000;
  const tokenExpiresAt = typeof claims.exp === "number" ? claims.exp * 1000 : responseExpiresAt;

  return {
    access_token: params.accessToken,
    id_token: params.idToken,
    expires_at: Math.min(responseExpiresAt, tokenExpiresAt),
    profile: {
      sub: String(claims.sub ?? ""),
      name: typeof claims.name === "string" ? claims.name : undefined,
      email: typeof claims.email === "string" ? claims.email : undefined,
      picture: typeof claims.picture === "string" ? claims.picture : undefined,
    },
  };
}

async function readTokenExchangeError(res: Response): Promise<string> {
  const body = await res.text().catch(() => "");
  if (body) {
    try {
      const data = JSON.parse(body) as { error?: string; error_description?: string };
      if (data.error_description) {
        return `Auth0 token exchange failed (${res.status}): ${data.error_description}`;
      }
      if (data.error) {
        return `Auth0 token exchange failed (${res.status}): ${data.error}`;
      }
    } catch {
      return `Auth0 token exchange failed (${res.status}): ${body}`;
    }
  }
  return `Auth0 token exchange failed (${res.status}).`;
}

// ── session storage ───────────────────────────────────────────────────────────

// Cache the parsed session by raw string so `getSession` (used as a
// `useSyncExternalStore` snapshot) returns a referentially-stable object
// between calls — re-parsing JSON on every call would return a new object
// each time and trip React's "getSnapshot should be cached" infinite-loop
// guard once a session actually exists. Expiry is still re-checked on every
// call (it's time-based, not reflected by a `raw` string change), but that
// only ever yields `null` or the same cached object reference — both stable.
let cachedRaw: string | null = null;
let cachedSession: Auth0Session | null = null;

function readSession(): Auth0Session | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    try {
      cachedSession = raw ? (JSON.parse(raw) as Auth0Session) : null;
    } catch {
      cachedSession = null;
    }
  }
  if (!cachedSession || !cachedSession.expires_at || cachedSession.expires_at <= Date.now()) {
    return null;
  }
  return cachedSession;
}

function writeSession(session: Auth0Session | null): void {
  if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  else localStorage.removeItem(SESSION_KEY);
  for (const l of listeners) l();
}

const listeners = new Set<() => void>();

// ── public API ────────────────────────────────────────────────────────────────

/** Navigate the whole tab to Auth0's hosted login. */
export async function loginWithRedirect(): Promise<void> {
  const clientId = getAuth0ClientId();
  if (!clientId) throw new Error("Auth0 is not configured (VITE_AUTH0_CLIENT_ID is unset).");
  const flow = getAuth0Flow();
  const state = randomToken(16);
  const nonce = randomToken(16);
  const callbackUrl = redirectUri();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    scope: "openid profile email",
    state,
    nonce,
  });

  const pending: PendingLogin = {
    flow,
    state,
    nonce,
    redirectUri: callbackUrl,
  };

  if (flow === "pkce") {
    const verifier = randomToken();
    const challenge = await pkceChallenge(verifier);
    pending.verifier = verifier;
    params.set("response_type", "code");
    params.set("code_challenge", challenge);
    params.set("code_challenge_method", "S256");
  } else {
    params.set("response_type", "id_token token");
    params.set("response_mode", "fragment");
  }

  sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  window.location.href = `https://${getAuth0Domain()}/authorize?${params.toString()}`;
}

/**
 * Call once on boot. If the URL carries an Auth0 redirect, saves the session
 * or exchanges the code for tokens, then strips callback params from the URL.
 * No-op otherwise.
 */
export async function handleRedirectCallback(): Promise<void> {
  const url = new URL(window.location.href);
  const hashParams = parseHashParams(url);
  if (!hasAuthCallback(url, hashParams)) return;

  const state = getAuthParam(url, hashParams, "state");
  const authError = getAuthParam(url, hashParams, "error");
  const authErrorDescription = getAuthParam(url, hashParams, "error_description");
  const cleanUp = () => stripAuthParams(url);

  const pending = consumePendingLogin();
  if (authError) {
    cleanUp();
    throw new Error(formatAuth0Error(authError, authErrorDescription));
  }

  if (!state || !pending) {
    cleanUp();
    throw new Error("Auth0 callback had no matching pending login - please sign in again.");
  }
  if (pending.state !== state) {
    cleanUp();
    throw new Error("Auth0 state mismatch — please sign in again.");
  }

  const clientId = getAuth0ClientId();
  if (!clientId) {
    cleanUp();
    return;
  }

  const idToken = getAuthParam(url, hashParams, "id_token");
  const accessToken = getAuthParam(url, hashParams, "access_token");
  if (idToken || accessToken) {
    cleanUp();
    if (!idToken || !accessToken) {
      throw new Error("Auth0 callback was missing tokens.");
    }
    writeSession(
      buildSessionFromTokens({
        accessToken,
        idToken,
        expiresIn: getAuthParam(url, hashParams, "expires_in"),
        pending,
        clientId,
      }),
    );
    return;
  }

  const code = getAuthParam(url, hashParams, "code");
  if (!code) {
    cleanUp();
    throw new Error("Auth0 callback was missing an authorization code.");
  }
  if (!pending.verifier) {
    cleanUp();
    throw new Error("Auth0 callback had no PKCE verifier - please sign in again.");
  }

  cleanUp();
  const res = await fetch(`https://${getAuth0Domain()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: pending.verifier,
      redirect_uri: pending.redirectUri || redirectUri(),
    }).toString(),
  });
  if (!res.ok) throw new Error(await readTokenExchangeError(res));
  const data = (await res.json()) as { access_token?: string; id_token?: string; expires_in?: number };
  if (!data.access_token || !data.id_token) throw new Error("Auth0 response was missing tokens.");
  writeSession(
    buildSessionFromTokens({
      accessToken: data.access_token,
      idToken: data.id_token,
      expiresIn: data.expires_in,
      pending,
      clientId,
    }),
  );
}

/** Clear the local session and end the Auth0 SSO session too. */
export function logout(): void {
  writeSession(null);
  const clientId = getAuth0ClientId();
  if (!clientId) return;
  const params = new URLSearchParams({ client_id: clientId, returnTo: window.location.origin });
  window.location.href = `https://${getAuth0Domain()}/v2/logout?${params.toString()}`;
}

export function getSession(): Auth0Session | null {
  return readSession();
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
