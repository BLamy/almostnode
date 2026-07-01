// Browser-side SoundCloud OAuth (PKCE) for almost-os. Runs the whole flow in
// the page so the token is saved to the VFS + sealed in the keychain:
//   1. open SoundCloud authorize in a popup
//   2. the dev callback listener (127.0.0.1:8765, vite-plugin-sc-oauth) catches
//      the redirect and exposes the `code` at /__api/sc-oauth-result
//   3. we poll that, exchange the code for a token (through the CORS proxy),
//      write ~/.config/sc/config.json, and persist the keychain
// Exposed as window.almostOS.soundcloud.login() so the `sc login` CLI can start it.

import { getWorkspace } from "../runtime/runtime";
import { getKeychain } from "../keychain/keychain-store";
import { CORS_PROXY_URL } from "../apps/tailscale/tailscale-config";
import { SC_CONFIG_PATH } from "./soundcloud-api";

const CLIENT_ID = "nXIZT4VQQYkgHs75vpIYbnINQciCkV5Y";
const REDIRECT_URI = "http://127.0.0.1:8765/callback";
const AUTHORIZE_URL = "https://secure.soundcloud.com/authorize";
const TOKEN_URL = "https://secure.soundcloud.com/oauth/token";
const RESULT_URL = "/__api/sc-oauth-result";

function proxied(url: string): string {
  return `${CORS_PROXY_URL}${encodeURIComponent(url)}`;
}

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

async function fetchWhoami(token: string): Promise<string | undefined> {
  try {
    const res = await fetch(proxied(`https://api.soundcloud.com/me?oauth_token=${token}`), {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) return undefined;
    const data = (await res.json()) as { username?: string; permalink?: string };
    return data.username ?? data.permalink;
  } catch {
    return undefined;
  }
}

function saveToken(data: {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  oauth_user?: string;
}): void {
  const vfs = getWorkspace().vfs;
  const dir = SC_CONFIG_PATH.slice(0, SC_CONFIG_PATH.lastIndexOf("/"));
  if (!vfs.existsSync(dir)) vfs.mkdirSync(dir, { recursive: true });
  vfs.writeFileSync(
    SC_CONFIG_PATH,
    JSON.stringify(
      {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
        oauth_user: data.oauth_user,
      },
      null,
      2,
    ),
  );
  // Seal it in the vault (the `soundcloud` credential slot covers this path).
  try {
    void getKeychain().persistCurrentState().catch(() => {});
  } catch {
    /* keychain unavailable */
  }
}

let inFlight: Promise<{ user?: string }> | null = null;

/** Run the full popup OAuth flow. Resolves once the token is saved. */
export function login(): Promise<{ user?: string }> {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    const verifier = randomToken();
    const state = randomToken(16);
    const challenge = await pkceChallenge(verifier);
    const params = new URLSearchParams({
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      response_type: "code",
      code_challenge: challenge,
      code_challenge_method: "S256",
      state,
    });
    const popup = window.open(`${AUTHORIZE_URL}?${params.toString()}`, "sc-login", "width=540,height=720");

    // Poll the dev callback feed for the code (~2.5 min budget).
    const code = await new Promise<string>((resolve, reject) => {
      const deadline = Date.now() + 150_000;
      const timer = window.setInterval(async () => {
        if (Date.now() > deadline) {
          window.clearInterval(timer);
          reject(new Error("Login timed out."));
          return;
        }
        try {
          const res = await fetch(RESULT_URL, { cache: "no-store" });
          const data = (await res.json()) as { code?: string; state?: string };
          if (data.code) {
            window.clearInterval(timer);
            if (data.state && data.state !== state) {
              reject(new Error("OAuth state mismatch."));
              return;
            }
            resolve(data.code);
          }
        } catch {
          /* keep polling */
        }
      }, 1200);
    });

    try {
      popup?.close();
    } catch {
      /* ignore */
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      code_verifier: verifier,
      code,
    });
    const res = await fetch(proxied(TOKEN_URL), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) throw new Error(`Token exchange failed (${res.status}).`);
    const token = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    };
    if (!token.access_token) throw new Error("No access_token in response.");
    const user = await fetchWhoami(token.access_token);
    saveToken({ ...token, access_token: token.access_token, oauth_user: user });
    return { user };
  })();
  inFlight.finally(() => {
    inFlight = null;
  });
  return inFlight;
}

/** Expose the flow so the `sc login` CLI (and console) can start it. */
export function installSoundcloudBridge(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { almostOS?: Record<string, unknown> };
  w.almostOS = {
    ...(w.almostOS ?? {}),
    soundcloud: {
      login: () =>
        login().then(
          (r) => console.info(`[soundcloud] signed in${r.user ? ` as ${r.user}` : ""}`),
          (e) => console.error("[soundcloud] login failed:", e),
        ),
    },
  };
}
