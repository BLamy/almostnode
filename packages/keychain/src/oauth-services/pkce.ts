/**
 * RFC 7636 PKCE helpers (S256 only) plus a base64url encoder and an URL-safe
 * random state generator. Shape mirrors `createWranglerPkcePair` in
 * `packages/almostnode/src/shims/wrangler-auth.ts` so behaviour and crypto
 * usage stay consistent across the codebase.
 */

const URL_SAFE_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

/** Encode bytes as base64url (no padding). */
export function encodeBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

/**
 * Generate a URL-safe random token. Default length matches the PKCE
 * "code verifier" recommendation of 43-128 characters.
 */
export function randomToken(length = 64): string {
  if (length <= 0) {
    return "";
  }
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let output = "";
  for (const byte of bytes) {
    output += URL_SAFE_ALPHABET[byte % URL_SAFE_ALPHABET.length];
  }
  return output;
}

/** A 256-bit URL-safe state parameter for the authorize step. */
export function randomState(): string {
  return randomToken(48);
}

export interface PkcePair {
  codeVerifier: string;
  codeChallenge: string;
  codeChallengeMethod: "S256";
}

/**
 * Generate a PKCE verifier/challenge pair using S256.
 *
 * - `codeVerifier` is a 96-char URL-safe random string.
 * - `codeChallenge` is `base64url(SHA-256(codeVerifier))`.
 */
export async function generatePkcePair(): Promise<PkcePair> {
  const codeVerifier = randomToken(96);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(codeVerifier),
  );
  return {
    codeVerifier,
    codeChallenge: encodeBase64Url(digest),
    codeChallengeMethod: "S256",
  };
}
