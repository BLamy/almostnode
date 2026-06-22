/**
 * Read/write {@link OAuthTokenFile} entries in the VFS.
 *
 * Writing through the VFS is what triggers the keychain watcher to encrypt
 * the token into the vault, so callers do not need to call into the keychain
 * directly. The watcher also re-encrypts on every change, so refresh-token
 * rotation is captured automatically.
 */

import type { VirtualFS } from "@agent-wasm/core";
import { OAUTH_TOKEN_DIR, tokenFilePathForService } from "./registry";
import type { OAuthServiceConfig, OAuthTokenFile } from "./types";

/**
 * Standard OAuth 2.0 token endpoint response (RFC 6749 §5.1) plus a few
 * common refresh-rotation fields.
 */
export interface TokenEndpointResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

function ensureParentDir(vfs: VirtualFS): void {
  if (!vfs.existsSync(OAUTH_TOKEN_DIR)) {
    vfs.mkdirSync(OAUTH_TOKEN_DIR, { recursive: true });
  }
}

function isOAuthTokenFile(value: unknown): value is OAuthTokenFile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === 1
    && typeof v.serviceId === "string"
    && v.tokenType === "Bearer"
    && typeof v.accessToken === "string"
    && typeof v.tokenEndpoint === "string"
    && typeof v.clientId === "string"
    && typeof v.obtainedAt === "string"
  );
}

/**
 * Build the persisted {@link OAuthTokenFile} from a fresh token-endpoint
 * response. When `expires_in` is provided, an absolute `expiresAt` is
 * computed.
 */
export function buildTokenFile(options: {
  service: OAuthServiceConfig;
  response: TokenEndpointResponse;
  /** When refreshing, the previous file lets us preserve a non-rotated refresh_token. */
  previous?: OAuthTokenFile | null;
  /** Override "now" for tests. */
  now?: Date;
}): OAuthTokenFile {
  const now = options.now ?? new Date();
  const previous = options.previous ?? null;
  const refreshToken = options.response.refresh_token
    ?? previous?.refreshToken;
  const expiresAt = typeof options.response.expires_in === "number"
    && Number.isFinite(options.response.expires_in)
    && options.response.expires_in > 0
    ? new Date(now.getTime() + options.response.expires_in * 1000).toISOString()
    : previous?.expiresAt;

  return {
    version: 1,
    serviceId: options.service.id,
    tokenType: "Bearer",
    accessToken: options.response.access_token,
    refreshToken,
    expiresAt,
    scope: options.response.scope ?? previous?.scope,
    tokenEndpoint: options.service.tokenEndpoint,
    clientId: options.service.clientId,
    clientSecret: options.service.clientSecret,
    obtainedAt: previous ? previous.obtainedAt : now.toISOString(),
    refreshedAt: previous ? now.toISOString() : undefined,
  };
}

/** Write a token file to the VFS. Creates `/home/user/.config/oauth/` if missing. */
export function writeTokenFile(vfs: VirtualFS, file: OAuthTokenFile): void {
  ensureParentDir(vfs);
  vfs.writeFileSync(
    tokenFilePathForService(file.serviceId),
    `${JSON.stringify(file, null, 2)}\n`,
  );
}

/** Returns null if the file is missing, unreadable, or fails the schema check. */
export function readTokenFile(vfs: VirtualFS, serviceId: string): OAuthTokenFile | null {
  const path = tokenFilePathForService(serviceId);
  try {
    if (!vfs.existsSync(path)) return null;
    // `readFileSync(path, "utf8")` is typed as string; passing the encoding
    // is what guarantees we don't get a Buffer back.
    const raw = vfs.readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    return isOAuthTokenFile(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Remove the token file. Safe to call even when no file exists. */
export function deleteTokenFile(vfs: VirtualFS, serviceId: string): void {
  const path = tokenFilePathForService(serviceId);
  try {
    if (vfs.existsSync(path)) {
      vfs.unlinkSync(path);
    }
  } catch {
    // ignore — the keychain watcher will reconcile on next change
  }
}

/** Returns the seconds remaining until the token expires, or null when unknown. */
export function secondsUntilExpiry(file: OAuthTokenFile, now: Date = new Date()): number | null {
  if (!file.expiresAt) return null;
  const expires = Date.parse(file.expiresAt);
  if (!Number.isFinite(expires)) return null;
  return Math.floor((expires - now.getTime()) / 1000);
}
