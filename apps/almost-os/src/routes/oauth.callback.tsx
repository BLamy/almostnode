import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import {
  OAUTH_CALLBACK_BROADCAST_CHANNEL,
  OAUTH_CALLBACK_MESSAGE_TYPE,
} from "@agent-wasm/keychain/oauth";

/**
 * The OAuth popup callback route (mirrors web-ide's).
 *
 * The authorize popup lands here when the AS redirects back to
 * `${origin}${BASE_URL}oauth/callback?code=…&state=…`. The result is relayed
 * to the desktop tab via TWO channels because neither is reliable alone:
 * `window.opener.postMessage` (severed by many providers' COOP headers) and
 * a same-origin `BroadcastChannel` (unaffected by COOP). The listener in
 * `awaitAuthorizationCallback` is idempotent — first message wins.
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
      // COOP severed the opener — the BroadcastChannel below delivers.
    }

    try {
      const BroadcastChannelImpl = (window as unknown as {
        BroadcastChannel?: typeof BroadcastChannel;
      }).BroadcastChannel;
      if (typeof BroadcastChannelImpl === "function") {
        const channel = new BroadcastChannelImpl(OAUTH_CALLBACK_BROADCAST_CHANNEL);
        channel.postMessage(payload);
        setTimeout(() => {
          try {
            channel.close();
          } catch {
            /* ignore */
          }
        }, 0);
      }
    } catch {
      // BroadcastChannel unavailable — nothing else we can do.
    }

    try {
      window.close();
    } catch {
      /* ignore */
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
        color: "#e2e8f0",
        background: "transparent",
      }}
    >
      <h1 style={{ fontSize: "20px", fontWeight: 600, marginBottom: "12px" }}>
        Sign-in complete
      </h1>
      <p style={{ fontSize: "14px", lineHeight: 1.5, color: "#94a3b8" }}>
        You can close this window and return to AlmostOS.
      </p>
    </div>
  );
}
