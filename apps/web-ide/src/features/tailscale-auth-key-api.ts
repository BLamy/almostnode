import { createPublicKey, verify, type JsonWebKey } from "node:crypto";

export const TAILSCALE_AUTH_KEY_API_PATH = "/__api/tailscale/auth-key";
export const DEFAULT_AUTH0_ISSUER = "https://webreplay.us.auth0.com/";
export const DEFAULT_AUTH0_JWKS_URL =
  "https://webreplay.us.auth0.com/.well-known/jwks.json";
export const DEFAULT_REPLAY_API_AUDIENCE = "https://api.replay.io";
export const DEFAULT_REPLAY_AUTH0_AUDIENCE =
  "https://webreplay.us.auth0.com/me/";
export const DEFAULT_REPLAY_DASHBOARD_AUTH0_CLIENT_ID =
  "J0U5KKcVSO451nCeBO0XaOfgrQrtXpu2";
export const REPLAY_ACCESS_TOKEN_COOKIE = "replay:access-token";

const DEFAULT_AUTH_KEY_TTL_SECONDS = 10 * 60;
const CLOCK_TOLERANCE_SECONDS = 60;

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface TailscaleAuthKeyApiRequest {
  method: string;
  headers: Headers;
  bodyText?: string;
}

export interface TailscaleAuthKeyApiResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface TailscaleAuthKeyApiEnv {
  ALMOSTNODE_TAILSCALE_AUTH0_ISSUER?: string;
  ALMOSTNODE_TAILSCALE_AUTH0_JWKS_URL?: string;
  ALMOSTNODE_TAILSCALE_AUTH0_AUDIENCE?: string;
  ALMOSTNODE_TAILSCALE_AUTH0_CLIENT_ID?: string;
  AUTH0_ISSUER?: string;
  AUTH0_ISSUER_BASE_URL?: string;
  AUTH0_JWKS_URI?: string;
  AUTH0_AUDIENCE?: string;
  AUTH0_CLIENT_ID?: string;
  ALMOSTNODE_HEADSCALE_URL?: string;
  ALMOSTNODE_TAILSCALE_CONTROL_URL?: string;
  HEADSCALE_URL?: string;
  TAILSCALE_CONTROL_URL?: string;
  ALMOSTNODE_HEADSCALE_API_KEY?: string;
  HEADSCALE_API_KEY?: string;
  ALMOSTNODE_HEADSCALE_USER?: string;
  HEADSCALE_USER?: string;
  HEADSCALE_USER_ID?: string;
  ALMOSTNODE_HEADSCALE_ACL_TAGS?: string;
  HEADSCALE_ACL_TAGS?: string;
  ALMOSTNODE_HEADSCALE_REUSABLE?: string;
  HEADSCALE_REUSABLE?: string;
  ALMOSTNODE_HEADSCALE_EPHEMERAL?: string;
  HEADSCALE_EPHEMERAL?: string;
  ALMOSTNODE_HEADSCALE_AUTHKEY_EXPIRATION_SECONDS?: string;
  HEADSCALE_AUTHKEY_EXPIRATION_SECONDS?: string;
}

export interface TailscaleAuthKeyApiOptions {
  env?: TailscaleAuthKeyApiEnv;
  fetchImpl?: FetchLike;
  now?: () => Date;
}

interface Jwk extends JsonWebKey {
  kid?: string;
  kty?: string;
  alg?: string;
  use?: string;
  n?: string;
  e?: string;
}

interface JwksPayload {
  keys?: Jwk[];
}

interface JwtClaims {
  iss?: string;
  sub?: string;
  aud?: string | string[];
  azp?: string;
  client_id?: string;
  exp?: number;
  nbf?: number;
  iat?: number;
  email?: string;
}

interface HeadscaleConfig {
  controlUrl: string;
  apiKey: string;
  user: string;
  aclTags: string[];
  reusable: boolean;
  ephemeral: boolean;
  expirationSeconds: number;
}

const jsonHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
};

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
): TailscaleAuthKeyApiResponse {
  return {
    status,
    headers: jsonHeaders,
    body: JSON.stringify(body),
  };
}

function readEnv(env: TailscaleAuthKeyApiEnv, keys: string[]): string | null {
  for (const key of keys) {
    const value = env[key as keyof TailscaleAuthKeyApiEnv];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function normalizeIssuer(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function splitList(value: string | null): string[] {
  return (value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (!value) {
    return fallback;
  }
  if (/^(1|true|yes)$/i.test(value)) {
    return true;
  }
  if (/^(0|false|no)$/i.test(value)) {
    return false;
  }
  return fallback;
}

function parsePositiveInteger(value: string | null, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function base64UrlDecode(value: string): Buffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = padded.length % 4;
  return Buffer.from(
    padded + (padding ? "=".repeat(4 - padding) : ""),
    "base64",
  );
}

function decodeJsonSegment<T>(segment: string): T {
  return JSON.parse(base64UrlDecode(segment).toString("utf8")) as T;
}

function parseCookies(cookieHeader: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName || rawValue.length === 0) {
      continue;
    }
    try {
      cookies[rawName] = decodeURIComponent(rawValue.join("="));
    } catch {
      cookies[rawName] = rawValue.join("=");
    }
  }
  return cookies;
}

export function extractAuthToken(headers: Headers): string | null {
  const authorization = headers.get("authorization");
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match?.[1]) {
      return match[1].trim();
    }
  }

  const cookies = parseCookies(headers.get("cookie"));
  return (
    cookies[REPLAY_ACCESS_TOKEN_COOKIE] ||
    cookies["access_token"] ||
    cookies["auth-token"] ||
    null
  );
}

function getAuthConfig(env: TailscaleAuthKeyApiEnv): {
  issuer: string;
  jwksUrl: string;
  audiences: string[];
  clientIds: string[];
} {
  const configuredAudiences = splitList(
    readEnv(env, [
      "ALMOSTNODE_TAILSCALE_AUTH0_AUDIENCE",
      "AUTH0_AUDIENCE",
    ]),
  );
  const configuredClientIds = splitList(
    readEnv(env, [
      "ALMOSTNODE_TAILSCALE_AUTH0_CLIENT_ID",
      "AUTH0_CLIENT_ID",
    ]),
  );
  const issuer = normalizeIssuer(
    readEnv(env, [
      "ALMOSTNODE_TAILSCALE_AUTH0_ISSUER",
      "AUTH0_ISSUER",
      "AUTH0_ISSUER_BASE_URL",
    ]) || DEFAULT_AUTH0_ISSUER,
  );
  const jwksUrl =
    readEnv(env, ["ALMOSTNODE_TAILSCALE_AUTH0_JWKS_URL", "AUTH0_JWKS_URI"]) ||
    DEFAULT_AUTH0_JWKS_URL;
  const audiences =
    configuredAudiences.length > 0
      ? configuredAudiences
      : [
          DEFAULT_REPLAY_API_AUDIENCE,
          DEFAULT_REPLAY_AUTH0_AUDIENCE,
          DEFAULT_REPLAY_DASHBOARD_AUTH0_CLIENT_ID,
        ];
  const clientIds =
    configuredClientIds.length > 0
      ? configuredClientIds
      : [DEFAULT_REPLAY_DASHBOARD_AUTH0_CLIENT_ID];

  return { issuer, jwksUrl, audiences, clientIds };
}

function getHeadscaleConfig(
  env: TailscaleAuthKeyApiEnv,
): HeadscaleConfig | null {
  const controlUrl = readEnv(env, [
    "ALMOSTNODE_HEADSCALE_URL",
    "ALMOSTNODE_TAILSCALE_CONTROL_URL",
    "HEADSCALE_URL",
    "TAILSCALE_CONTROL_URL",
  ]);
  const apiKey = readEnv(env, [
    "ALMOSTNODE_HEADSCALE_API_KEY",
    "HEADSCALE_API_KEY",
  ]);
  const user = readEnv(env, [
    "ALMOSTNODE_HEADSCALE_USER",
    "HEADSCALE_USER",
    "HEADSCALE_USER_ID",
  ]);
  if (!controlUrl || !apiKey || !user) {
    return null;
  }

  return {
    controlUrl: controlUrl.replace(/\/+$/, ""),
    apiKey,
    user,
    aclTags: splitList(
      readEnv(env, ["ALMOSTNODE_HEADSCALE_ACL_TAGS", "HEADSCALE_ACL_TAGS"]),
    ),
    reusable: parseBoolean(
      readEnv(env, ["ALMOSTNODE_HEADSCALE_REUSABLE", "HEADSCALE_REUSABLE"]),
      false,
    ),
    ephemeral: parseBoolean(
      readEnv(env, ["ALMOSTNODE_HEADSCALE_EPHEMERAL", "HEADSCALE_EPHEMERAL"]),
      true,
    ),
    expirationSeconds: parsePositiveInteger(
      readEnv(env, [
        "ALMOSTNODE_HEADSCALE_AUTHKEY_EXPIRATION_SECONDS",
        "HEADSCALE_AUTHKEY_EXPIRATION_SECONDS",
      ]),
      DEFAULT_AUTH_KEY_TTL_SECONDS,
    ),
  };
}

function audienceMatches(
  tokenAudience: string | string[] | undefined,
  allowed: string[],
): boolean {
  if (!tokenAudience) {
    return false;
  }
  const audiences = Array.isArray(tokenAudience)
    ? tokenAudience
    : [tokenAudience];
  return audiences.some((audience) => allowed.includes(audience));
}

function validateJwtClaims(
  claims: JwtClaims,
  auth: ReturnType<typeof getAuthConfig>,
  now: Date,
): void {
  if (claims.iss !== auth.issuer) {
    throw new Error("Unexpected token issuer");
  }
  if (!claims.sub) {
    throw new Error("Token is missing subject");
  }
  if (!audienceMatches(claims.aud, auth.audiences)) {
    throw new Error("Unexpected token audience");
  }

  const presentedClientId = claims.azp || claims.client_id;
  if (
    presentedClientId &&
    auth.clientIds.length > 0 &&
    !auth.clientIds.includes(presentedClientId)
  ) {
    throw new Error("Unexpected token client");
  }

  const nowSeconds = Math.floor(now.getTime() / 1000);
  if (
    typeof claims.exp === "number" &&
    claims.exp + CLOCK_TOLERANCE_SECONDS < nowSeconds
  ) {
    throw new Error("Token expired");
  }
  if (
    typeof claims.nbf === "number" &&
    claims.nbf - CLOCK_TOLERANCE_SECONDS > nowSeconds
  ) {
    throw new Error("Token not yet valid");
  }
}

async function fetchJwks(
  jwksUrl: string,
  fetchImpl: FetchLike,
): Promise<JwksPayload> {
  const response = await fetchImpl(jwksUrl, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`JWKS fetch failed with HTTP ${response.status}`);
  }
  return (await response.json()) as JwksPayload;
}

export async function verifyAuth0Jwt(
  token: string,
  options: {
    env: TailscaleAuthKeyApiEnv;
    fetchImpl: FetchLike;
    now: Date;
  },
): Promise<JwtClaims> {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Token is not a compact JWT");
  }

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header =
    decodeJsonSegment<{ alg?: string; kid?: string }>(encodedHeader);
  if (header.alg !== "RS256") {
    throw new Error("Unsupported token algorithm");
  }
  if (!header.kid) {
    throw new Error("Token is missing kid");
  }

  const auth = getAuthConfig(options.env);
  const jwks = await fetchJwks(auth.jwksUrl, options.fetchImpl);
  const key = jwks.keys?.find((candidate) => candidate.kid === header.kid);
  if (!key) {
    throw new Error("JWKS key not found");
  }

  const publicKey = createPublicKey({ key, format: "jwk" });
  const verified = verify(
    "RSA-SHA256",
    Buffer.from(`${encodedHeader}.${encodedPayload}`),
    publicKey,
    base64UrlDecode(encodedSignature),
  );
  if (!verified) {
    throw new Error("Invalid token signature");
  }

  const claims = decodeJsonSegment<JwtClaims>(encodedPayload);
  validateJwtClaims(claims, auth, options.now);
  return claims;
}

function normalizeHostname(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63)
    .replace(/^-|-$/g, "");
  return normalized || null;
}

async function createHeadscalePreAuthKey(
  config: HeadscaleConfig,
  fetchImpl: FetchLike,
  now: Date,
): Promise<{ key: string; expiresAt: string | null }> {
  const expiresAt = new Date(
    now.getTime() + config.expirationSeconds * 1000,
  ).toISOString();
  const response = await fetchImpl(`${config.controlUrl}/api/v1/preauthkey`, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      user: config.user,
      reusable: config.reusable,
      ephemeral: config.ephemeral,
      expiration: expiresAt,
      aclTags: config.aclTags,
    }),
  });

  if (!response.ok) {
    throw new Error(`Headscale preauthkey failed with HTTP ${response.status}`);
  }

  const payload = (await response.json()) as {
    preAuthKey?: { key?: string; expiration?: string };
    key?: string;
    expiration?: string;
  };
  const key = payload.preAuthKey?.key || payload.key;
  if (!key) {
    throw new Error("Headscale response did not include a preauth key");
  }

  return {
    key,
    expiresAt: payload.preAuthKey?.expiration || payload.expiration || expiresAt,
  };
}

export async function handleTailscaleAuthKeyApiRequest(
  request: TailscaleAuthKeyApiRequest,
  options: TailscaleAuthKeyApiOptions = {},
): Promise<TailscaleAuthKeyApiResponse> {
  if (request.method === "OPTIONS") {
    return {
      status: 204,
      headers: {
        "access-control-allow-headers": "authorization, content-type",
        "access-control-allow-methods": "POST, OPTIONS",
        "access-control-max-age": "86400",
      },
      body: "",
    };
  }

  if (request.method !== "POST") {
    return jsonResponse(405, { error: "method_not_allowed" });
  }

  const env = options.env ?? (process.env as TailscaleAuthKeyApiEnv);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!fetchImpl) {
    return jsonResponse(501, { error: "fetch_unavailable" });
  }

  const headscaleConfig = getHeadscaleConfig(env);
  if (!headscaleConfig) {
    return jsonResponse(501, { error: "headscale_not_configured" });
  }

  const token = extractAuthToken(request.headers);
  if (!token) {
    return jsonResponse(401, { error: "missing_auth_token" });
  }

  const now = options.now?.() ?? new Date();
  let claims: JwtClaims;
  try {
    claims = await verifyAuth0Jwt(token, { env, fetchImpl, now });
  } catch (error) {
    return jsonResponse(403, {
      error: "invalid_auth_token",
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  let body: unknown = {};
  if (request.bodyText?.trim()) {
    try {
      body = JSON.parse(request.bodyText);
    } catch {
      return jsonResponse(400, { error: "invalid_json" });
    }
  }

  const requestedHostname =
    body && typeof body === "object" && !Array.isArray(body)
      ? normalizeHostname((body as Record<string, unknown>).hostname)
      : null;
  const hostname =
    requestedHostname ||
    normalizeHostname(claims.email) ||
    `almostnode-${claims.sub.replace(/[^a-zA-Z0-9]/g, "-").slice(-32)}`;

  try {
    const authKey = await createHeadscalePreAuthKey(
      headscaleConfig,
      fetchImpl,
      now,
    );
    return jsonResponse(200, {
      authKey: authKey.key,
      controlUrl: headscaleConfig.controlUrl,
      hostname,
      useExitNode: true,
      acceptDns: true,
      expiresAt: authKey.expiresAt,
    });
  } catch (error) {
    return jsonResponse(502, {
      error: "headscale_provisioning_failed",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
