import http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin, PreviewServer, ViteDevServer } from "vite";

// Dev-only helper for SoundCloud OAuth. The bundled sc-api-auth client only
// permits the redirect http://127.0.0.1:8765/callback, which a browser sandbox
// can't host. So during dev we run a tiny listener on that exact address: when
// SoundCloud redirects the login popup there, we capture the `code` and expose
// it at /__api/sc-oauth-result on the app origin, which the app polls to finish
// the PKCE exchange. Mirrors how SoundCloud's own CLI catches the callback.

export const SC_OAUTH_RESULT_PATH = "/__api/sc-oauth-result";
const CALLBACK_PORT = 8765;
const CALLBACK_HOST = "127.0.0.1";

let captured: { code: string; state: string } | null = null;
let callbackServer: http.Server | null = null;

const DONE_PAGE = `<!doctype html><meta charset="utf-8"><title>SoundCloud · almost-os</title>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#0f1115;color:#e8eaed;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center;max-width:340px">
<div style="font-size:40px">🎧</div>
<h2 style="margin:8px 0">Signed in to SoundCloud</h2>
<p style="color:#9aa0aa">You can close this window and return to almost-os.</p>
</div>
<script>setTimeout(function(){try{window.close()}catch(e){}},500)</script>`;

function startCallbackServer(): void {
  if (callbackServer) return;
  const srv = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${CALLBACK_HOST}:${CALLBACK_PORT}`);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state") ?? "";
    if (code) captured = { code, state };
    res.statusCode = code ? 200 : 400;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(code ? DONE_PAGE : "Missing ?code");
  });
  srv.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      // Another dev server already owns the port; the flow still works via it.
      console.warn(`[sc-oauth] ${CALLBACK_HOST}:${CALLBACK_PORT} already in use — reusing existing listener`);
    } else {
      console.warn("[sc-oauth] callback server error:", err.message);
    }
    callbackServer = null;
  });
  srv.listen(CALLBACK_PORT, CALLBACK_HOST);
  callbackServer = srv;
}

function attach(server: ViteDevServer | PreviewServer): void {
  startCallbackServer();
  server.middlewares.use((req, res, next) => {
    const pathname = req.url ? new URL(req.url, "http://127.0.0.1").pathname : "";
    if (pathname !== SC_OAUTH_RESULT_PATH) {
      next();
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    // One-shot read: hand the code to the app then forget it.
    res.end(JSON.stringify(captured ?? {}));
    captured = null;
  });
  server.httpServer?.on("close", () => {
    callbackServer?.close();
    callbackServer = null;
  });
}

/** Dev/preview SoundCloud OAuth callback catcher (127.0.0.1:8765) + result feed. */
export function scOauthPlugin(): Plugin {
  return {
    name: "almostos-sc-oauth",
    configureServer: attach,
    configurePreviewServer: attach,
  };
}
