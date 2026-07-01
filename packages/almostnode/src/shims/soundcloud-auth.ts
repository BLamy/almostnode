import type { VirtualFS } from '../virtual-fs';
import * as path from './path';

// SoundCloud OAuth config for the `sc` CLI. Mirrors gh-auth.ts: creds live in
// the VFS under ~/.config so the keychain vault can seal them at rest.
//
// We reuse SoundCloud's own sc-api-auth CLI client (PKCE, no secret). Its only
// registered redirect is http://127.0.0.1:8765/callback, which a browser
// sandbox can't host — so `sc login` runs PKCE but has the user paste the
// `code` back (see soundcloud-command.ts). `--token` skips all of that.

export const SC_CONFIG_PATH = '/home/user/.config/sc/config.json';
export const SC_PENDING_PATH = '/home/user/.config/sc/pending.json';

/** SoundCloud's public sc-api-auth CLI client (PKCE, secret-less). */
export const SC_CLIENT_ID = 'nXIZT4VQQYkgHs75vpIYbnINQciCkV5Y';
export const SC_REDIRECT_URI = 'http://127.0.0.1:8765/callback';
export const SC_AUTHORIZE_URL = 'https://secure.soundcloud.com/authorize';
export const SC_TOKEN_URL = 'https://secure.soundcloud.com/oauth/token';
/** App-registration endpoint — mints your own client_id + client_secret. */
export const SC_API_REG_URL = 'https://api-reg.soundcloud.com/me/apps';

export interface SoundCloudConfig {
  access_token: string;
  refresh_token?: string;
  /** Epoch ms after which the access token is stale. */
  expires_at?: number;
  oauth_user?: string;
  /** Our own registered app (from `sc register`), enabling client_credentials. */
  client_id?: string;
  client_secret?: string;
}

/** A PKCE flow in progress: the verifier we must send at token-exchange time. */
export interface SoundCloudPending {
  code_verifier: string;
  state: string;
}

function ensureDir(vfs: VirtualFS, filePath: string): void {
  const dir = path.dirname(filePath);
  if (!vfs.existsSync(dir)) vfs.mkdirSync(dir, { recursive: true });
}

export function readScConfig(vfs: VirtualFS): SoundCloudConfig | null {
  if (!vfs.existsSync(SC_CONFIG_PATH)) return null;
  try {
    return JSON.parse(vfs.readFileSync(SC_CONFIG_PATH, 'utf8')) as SoundCloudConfig;
  } catch {
    return null;
  }
}

export function writeScConfig(vfs: VirtualFS, config: SoundCloudConfig): void {
  ensureDir(vfs, SC_CONFIG_PATH);
  vfs.writeFileSync(SC_CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function deleteScConfig(vfs: VirtualFS): boolean {
  try {
    vfs.unlinkSync(SC_CONFIG_PATH);
    return true;
  } catch {
    return false;
  }
}

export function readScPending(vfs: VirtualFS): SoundCloudPending | null {
  if (!vfs.existsSync(SC_PENDING_PATH)) return null;
  try {
    return JSON.parse(vfs.readFileSync(SC_PENDING_PATH, 'utf8')) as SoundCloudPending;
  } catch {
    return null;
  }
}

export function writeScPending(vfs: VirtualFS, pending: SoundCloudPending): void {
  ensureDir(vfs, SC_PENDING_PATH);
  vfs.writeFileSync(SC_PENDING_PATH, JSON.stringify(pending, null, 2));
}

export function clearScPending(vfs: VirtualFS): void {
  try {
    vfs.unlinkSync(SC_PENDING_PATH);
  } catch {
    /* ignore */
  }
}

// ── PKCE helpers ────────────────────────────────────────────────────────────

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomUrlToken(byteLength = 48): string {
  const bytes = new Uint8Array(byteLength);
  globalThis.crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/** code_challenge = BASE64URL(SHA256(verifier)). */
export async function pkceChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(new Uint8Array(digest));
}

export function buildAuthorizeUrl(codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    client_id: SC_CLIENT_ID,
    redirect_uri: SC_REDIRECT_URI,
    response_type: 'code',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  });
  return `${SC_AUTHORIZE_URL}?${params.toString()}`;
}
