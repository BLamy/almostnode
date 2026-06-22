/**
 * Open the authorize URL in a popup, then wait for the popup to relay the
 * `code`/`state` back via `postMessage`.
 *
 * Important constraints (called out in the plan):
 *
 *  - `window.open` MUST be invoked synchronously in the user-gesture handler
 *    (the "Connect" click). This file exposes a builder that the orchestrator
 *    composes once the URL is already constructed.
 *
 *  - The callback page (`/oauth/callback`) is a tiny shim that calls
 *    `window.opener.postMessage(...)` with an explicit `targetOrigin` of
 *    `window.location.origin`. The listener installed here verifies
 *    `event.origin` matches the IDE's origin before consuming the message.
 *
 *  - We intentionally do NOT poll `popup.closed` to reject the flow. When
 *    the popup navigates to a cross-origin URL (the provider's `/authorize`
 *    page), Cross-Origin-Opener-Policy on either the IDE or the provider's
 *    response typically severs the opener↔popup relationship. After
 *    severance, `popup.closed` returns `true` from the opener's side even
 *    though the user can still see the popup — a false positive we cannot
 *    distinguish from a real close. We rely on `postMessage` from the
 *    callback page (which still works across COOP) and a timeout, with the
 *    modal's "Cancel" button as the user-driven abort.
 */

export const OAUTH_CALLBACK_MESSAGE_TYPE = "almostnode:oauth-callback";
export const OAUTH_CALLBACK_PATH = "/oauth/callback";
/**
 * Name of the `BroadcastChannel` used as a COOP-tolerant backchannel between
 * the callback page and the IDE's listener. See the top-of-file note — when
 * Cross-Origin-Opener-Policy severs the popup's `window.opener`, the classic
 * `window.opener.postMessage(...)` path silently no-ops because `window.opener`
 * is `null`, so we mirror the message onto this channel too. Same-origin only,
 * which matches the IDE ↔ callback relationship.
 */
export const OAUTH_CALLBACK_BROADCAST_CHANNEL = "almostnode:oauth-callback-channel";

export interface OAuthCallbackMessage {
  type: typeof OAUTH_CALLBACK_MESSAGE_TYPE;
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
}

export interface AuthorizePopupOptions {
  /** Fully-built authorize URL with `client_id`, `state`, `code_challenge`, etc. */
  authorizeUrl: string;
  /** Expected `state` we sent to the AS — required for CSRF protection. */
  expectedState: string;
  /** Origin we will accept callbacks from. Defaults to `window.location.origin`. */
  expectedOrigin?: string;
  /** Window features for `window.open`. */
  features?: string;
  /** Window name (defaults to `almostnode-oauth`). */
  name?: string;
  /** Hard cap on wait time. Defaults to 10 minutes. */
  timeoutMs?: number;
  /** Override `window` for tests. */
  windowImpl?: Window;
}

export interface AuthorizeResult {
  code: string;
  state: string;
}

export class OAuthPopupError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "OAuthPopupError";
  }
}

/**
 * Build the authorize URL for the user agent. Caller must invoke
 * `window.open(url)` synchronously in a click handler — we never call
 * `window.open` from inside an `await`-chain because browsers block the
 * popup otherwise.
 */
export function buildAuthorizeUrl(options: {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
  state: string;
  codeChallenge: string;
  resource?: string;
  /** Extra query params to merge in (e.g. `prompt=consent`). */
  extra?: Record<string, string>;
}): string {
  const url = new URL(options.authorizationEndpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", options.clientId);
  url.searchParams.set("redirect_uri", options.redirectUri);
  url.searchParams.set("state", options.state);
  url.searchParams.set("code_challenge", options.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (options.scope) {
    url.searchParams.set("scope", options.scope);
  }
  if (options.resource) {
    url.searchParams.set("resource", options.resource);
  }
  if (options.extra) {
    for (const [key, value] of Object.entries(options.extra)) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/**
 * Build the absolute callback URL using the current origin and the SPA base
 * path. Extracted so tests can verify and the modal can show it for the
 * manual-client fallback.
 */
export function buildCallbackUrl(baseHref?: string): string {
  if (typeof window === "undefined") {
    throw new OAuthPopupError("Callback URL requires a browser context.");
  }
  const origin = window.location.origin;
  const base = baseHref ?? "/";
  // Ensure the base ends with a slash and the callback path doesn't double up.
  const trimmedBase = base.endsWith("/") ? base : `${base}/`;
  return `${origin}${trimmedBase}oauth/callback`.replace(/([^:]\/)\/+/g, "$1");
}

/**
 * Open the authorize popup and wait for the callback to relay the result.
 * Resolves with `{ code, state }`, rejects with an {@link OAuthPopupError}
 * on timeout, mismatching state, or authorization-server errors. See the
 * top-of-file note on why we no longer reject on `popup.closed`.
 *
 * Caller is responsible for calling this AFTER opening the popup
 * synchronously in a click handler — see {@link openAuthorizePopup}.
 */
export function awaitAuthorizationCallback(
  popup: Window | null,
  options: AuthorizePopupOptions,
): Promise<AuthorizeResult> {
  const win = options.windowImpl ?? (typeof window !== "undefined" ? window : null);
  if (!win) {
    return Promise.reject(new OAuthPopupError("Popup flow requires a browser context."));
  }
  if (!popup) {
    return Promise.reject(
      new OAuthPopupError("The browser blocked the OAuth popup. Allow popups for this site."),
    );
  }

  const expectedOrigin = options.expectedOrigin ?? win.location.origin;
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;

  return new Promise<AuthorizeResult>((resolve, reject) => {
    let settled = false;
    let timeoutHandle = 0;
    // Open a same-origin BroadcastChannel as a COOP-tolerant backchannel from
    // the callback page. `BroadcastChannel` is undefined in jsdom (used by the
    // unit tests), so we guard with `typeof`. In production browsers this is
    // what actually delivers the payload — `window.opener.postMessage` fails
    // silently after COOP severs the opener reference on the popup side.
    const broadcastChannelCtor = (win as unknown as { BroadcastChannel?: typeof BroadcastChannel }).BroadcastChannel;
    const channel = typeof broadcastChannelCtor === "function"
      ? new broadcastChannelCtor(OAUTH_CALLBACK_BROADCAST_CHANNEL)
      : null;

    const cleanup = () => {
      win.removeEventListener("message", onMessage as EventListener);
      if (timeoutHandle) win.clearTimeout(timeoutHandle);
      if (channel) {
        try {
          channel.close();
        } catch {
          // ignore
        }
      }
    };

    const finish = (resolveFn: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      // Best-effort close. Under COOP severance `popup.closed` may lie, and
      // `popup.close()` may no-op — either is fine. The callback page also
      // calls `window.close()` itself.
      try {
        if (!popup.closed) popup.close();
      } catch {
        // ignore
      }
      resolveFn();
    };

    /**
     * Unified handler that both the window-message listener and the
     * BroadcastChannel listener feed into. The window-message path already
     * validates `event.origin`; BroadcastChannel is same-origin by browser
     * contract so the payload itself is the only thing to inspect.
     */
    const handlePayload = (data: Partial<OAuthCallbackMessage> | null) => {
      if (!data || data.type !== OAUTH_CALLBACK_MESSAGE_TYPE) return;

      if (data.error) {
        finish(() =>
          reject(
            new OAuthPopupError(
              `Authorization failed: ${data.error}${
                data.errorDescription ? ` — ${data.errorDescription}` : ""
              }`,
            ),
          ),
        );
        return;
      }

      if (typeof data.code !== "string" || typeof data.state !== "string") {
        finish(() => reject(new OAuthPopupError("Authorization callback was malformed.")));
        return;
      }

      if (data.state !== options.expectedState) {
        finish(() =>
          reject(
            new OAuthPopupError(
              "Authorization callback returned a different `state` than we sent. Aborting.",
            ),
          ),
        );
        return;
      }

      finish(() => resolve({ code: data.code as string, state: data.state as string }));
    };

    const onMessage = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin) return;
      handlePayload(event.data as Partial<OAuthCallbackMessage> | null);
    };

    win.addEventListener("message", onMessage as EventListener);

    if (channel) {
      channel.onmessage = (event: MessageEvent) => {
        handlePayload(event.data as Partial<OAuthCallbackMessage> | null);
      };
    }

    // See the top-of-file comment — we no longer poll `popup.closed` because
    // COOP severance makes it return `true` even while the popup is still
    // open, producing false "popup was closed" rejections the moment the
    // provider's authorize page loads. The modal's Cancel button and the
    // timeout below cover the "user abandoned the flow" case.
    timeoutHandle = win.setTimeout(() => {
      finish(() => reject(new OAuthPopupError("The OAuth popup timed out.")));
    }, timeoutMs);
  });
}

/**
 * Convenience: open the popup AND start awaiting the callback. NOTE: callers
 * must invoke this directly inside a click handler (no preceding `await`)
 * to avoid popup blockers.
 */
export function openAuthorizePopup(
  options: AuthorizePopupOptions,
): { popup: Window | null; result: Promise<AuthorizeResult> } {
  const win = options.windowImpl ?? (typeof window !== "undefined" ? window : null);
  if (!win) {
    return {
      popup: null,
      result: Promise.reject(new OAuthPopupError("Popup flow requires a browser context.")),
    };
  }

  const features = options.features
    ?? "popup=yes,width=520,height=720,menubar=no,toolbar=no,location=yes,resizable=yes,scrollbars=yes,status=no";
  const popup = win.open(options.authorizeUrl, options.name ?? "almostnode-oauth", features);
  const result = awaitAuthorizationCallback(popup, options);
  return { popup, result };
}
