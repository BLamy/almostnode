import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import {
  OAUTH_CALLBACK_BROADCAST_CHANNEL,
  OAUTH_CALLBACK_MESSAGE_TYPE,
} from "../features/oauth-services/authorize-popup";

/**
 * The OAuth popup callback route.
 *
 * The popup that runs the authorization step lands here when the AS
 * redirects back to `${origin}${BASE_URL}oauth/callback?code=…&state=…`.
 * We relay the result to the IDE tab via TWO channels, because in practice
 * neither is reliable on its own:
 *
 *  1. `window.opener.postMessage(...)` — works when the opener↔popup
 *     relationship is still intact. Many OAuth providers set
 *     Cross-Origin-Opener-Policy headers that sever the relationship
 *     during the cross-origin hop, at which point `window.opener` is
 *     `null` here and this path silently does nothing.
 *
 *  2. `BroadcastChannel` — a same-origin pub/sub that is unaffected by
 *     COOP. This is the fallback the IDE listener actually uses when
 *     COOP severed the opener link. Both paths carry identical payloads
 *     and the listener is idempotent (first message wins).
 *
 * On GitHub Pages the same logic is mirrored in `public/404.html` because
 * GH Pages 404s on URLs with no static asset; this component is what runs
 * in dev mode (where Vite serves the SPA at any path) and in any future
 * setup where this route actually has a static asset.
 *
 * For the `window.opener` path, `targetOrigin` is set to
 * `window.location.origin` so other origins cannot read the `code`. The
 * IDE listener verifies `event.origin` symmetrically.
 */
export const Route = createFileRoute("/oauth/callback")({
  component: OAuthCallbackRoute,
});

function OAuthCallbackRoute() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const payload = {
      type: OAUTH_CALLBACK_MESSAGE_TYPE,
      code: params.get("code") || undefined,
      state: params.get("state") || undefined,
      error: params.get("error") || undefined,
      errorDescription: params.get("error_description") || undefined,
    };

    try {
      if (window.opener) {
        window.opener.postMessage(payload, window.location.origin);
      }
    } catch {
      // The opener may be from a different origin, in which case the
      // postMessage is silently dropped — the BroadcastChannel below is
      // the authoritative delivery path after COOP severance.
    }

    // Mirror the payload onto a BroadcastChannel so the IDE listener
    // receives it even when COOP nulls `window.opener` here. We hold the
    // channel open until `window.close()` either succeeds (destroying us)
    // or the post has been delivered (queued synchronously by the browser
    // runtime before we unwind).
    try {
      const BroadcastChannelImpl = (window as unknown as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
      if (typeof BroadcastChannelImpl === "function") {
        const channel = new BroadcastChannelImpl(OAUTH_CALLBACK_BROADCAST_CHANNEL);
        channel.postMessage(payload);
        // Close after the event loop turn so the post has been dispatched.
        setTimeout(() => {
          try { channel.close(); } catch { /* ignore */ }
        }, 0);
      }
    } catch {
      // ignore — BroadcastChannel unavailable, nothing else we can do.
    }

    // Close ourselves. Browsers may refuse `window.close()` if this tab
    // wasn't opened by `window.open()` from script — in that case we just
    // show the explanation below.
    try {
      window.close();
    } catch {
      // ignore
    }
  }, []);

  return (
    <div
      style={{
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
        padding: "32px",
        maxWidth: "480px",
        margin: "10vh auto",
        textAlign: "center",
        color: "#0f172a",
        background: "#f8fafc",
      }}
    >
      <h1 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "12px" }}>
        Sign-in complete
      </h1>
      <p style={{ fontSize: "14px", lineHeight: 1.5, color: "#475569" }}>
        You can close this window and return to the workspace.
      </p>
    </div>
  );
}
