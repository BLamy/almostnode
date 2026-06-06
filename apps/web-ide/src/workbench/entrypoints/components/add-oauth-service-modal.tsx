/**
 * Modal that drives the "Add OAuth service" 3-step flow:
 *
 *   1. `prompt`        — user pastes a URL (a resource server, an issuer, or
 *                        anything that exposes `.well-known/oauth-*`).
 *   2. `discovering`   — the host is fetching `.well-known` documents.
 *   3. `preview`       — the host returned a {@link OAuthDiscoveryPreview};
 *                        user reviews display name + scopes and clicks
 *                        "Connect" to open the OAuth popup.
 *   4. `manual-client` — variant of `preview` shown when the AS does not
 *                        advertise dynamic client registration. User pastes a
 *                        `client_id` (and optional secret) before "Connect".
 *   5. `authorizing`   — popup is open; we're waiting for the postMessage
 *                        callback. The host's `oauth:add-connect` handler
 *                        synchronously opens the popup inside the click
 *                        handler — see comments in `workbench-host.ts`.
 *   6. `error`         — discovery, registration, or token-exchange failed.
 *                        Surfaces the message and lets the user start over.
 *
 * The component is an uncontrolled-ish input panel: free-text fields keep
 * local state and only dispatch their values on definitive actions (Discover,
 * Connect) so we don't round-trip every keystroke through the workbench host.
 * `useEffect` syncs local state when the host pushes new values back (e.g.
 * after discovery seeds `displayNameOverride`).
 */

import { useEffect, useState, type CSSProperties } from "react";
import type {
  KeychainAddServiceFlowState,
  KeychainSidebarActions,
} from "../../surface-model-types";
import type { OAuthDiscoveryPreview } from "../../../features/oauth-services/types";

interface Props {
  flow: KeychainAddServiceFlowState;
  callbackUrl: string;
  actions: KeychainSidebarActions;
}

export function AddOAuthServiceModal(props: Props) {
  const { flow, callbackUrl, actions } = props;

  const [urlInput, setUrlInput] = useState(flow.inputUrl ?? "");
  const [displayName, setDisplayName] = useState(
    flow.displayNameOverride ?? "",
  );
  const [scopesInput, setScopesInput] = useState(
    (flow.selectedScopes ?? []).join(" "),
  );
  const [manualClientId, setManualClientId] = useState(
    flow.manualClientId ?? "",
  );
  const [manualClientSecret, setManualClientSecret] = useState(
    flow.manualClientSecret ?? "",
  );

  // Re-seed the local form fields when the host pushes new values (typically
  // because discovery just completed and `displayNameOverride` /
  // `selectedScopes` were filled in from the metadata).
  useEffect(() => {
    setUrlInput(flow.inputUrl ?? "");
  }, [flow.inputUrl]);
  useEffect(() => {
    setDisplayName(flow.displayNameOverride ?? "");
  }, [flow.displayNameOverride]);
  useEffect(() => {
    setScopesInput((flow.selectedScopes ?? []).join(" "));
  }, [flow.selectedScopes]);

  const cancel = () => actions.dispatch("oauth:add-cancel");
  const startOver = () => actions.dispatch("oauth:add-start");
  const discover = (rawUrl: string) => {
    const trimmed = rawUrl.trim();
    if (!trimmed) return;
    actions.dispatch(`oauth:add-discover:${trimmed}`);
  };

  const connect = () => {
    if (!flow.discovered) return;
    // Push local form state into the host BEFORE dispatching connect, so the
    // popup-opening code reads the latest user-entered values. All dispatches
    // are synchronous so the gesture chain is preserved through the
    // `window.open` inside `oauth:add-connect`.
    if (displayName !== (flow.displayNameOverride ?? "")) {
      actions.dispatch(`oauth:add-set-display-name:${displayName}`);
    }
    const scopesNormalized = scopesInput.trim();
    if (scopesNormalized !== (flow.selectedScopes ?? []).join(" ")) {
      actions.dispatch(`oauth:add-set-scopes:${scopesNormalized}`);
    }
    if (flow.status === "manual-client") {
      if (manualClientId !== (flow.manualClientId ?? "")) {
        actions.dispatch(`oauth:add-set-manual-client:${manualClientId}`);
      }
      if (manualClientSecret !== (flow.manualClientSecret ?? "")) {
        actions.dispatch(`oauth:add-set-manual-secret:${manualClientSecret}`);
      }
    }
    actions.dispatch("oauth:add-connect");
  };

  const headline = (() => {
    switch (flow.status) {
      case "prompt":
        return "Add OAuth service";
      case "discovering":
        return "Discovering…";
      case "preview":
        return "Confirm details";
      case "manual-client":
        return "Provide a client ID";
      case "authorizing":
        return "Awaiting authorization…";
      case "error":
        return "Something went wrong";
      default:
        return "Add OAuth service";
    }
  })();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="add-oauth-service-modal-title"
      style={overlayStyles}
      onClick={(event) => {
        if (event.target === event.currentTarget) cancel();
      }}
    >
      <div style={modalCardStyles}>
        <div style={headerStyles}>
          <strong id="add-oauth-service-modal-title" style={titleStyles}>
            {headline}
          </strong>
          <button
            type="button"
            onClick={cancel}
            style={closeButtonStyles}
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {(flow.status === "prompt" || flow.status === "discovering") ? (
          <UrlPromptStep
            urlInput={urlInput}
            setUrlInput={setUrlInput}
            disabled={flow.status === "discovering"}
            onCancel={cancel}
            onDiscover={() => discover(urlInput)}
          />
        ) : null}

        {(flow.status === "preview" || flow.status === "manual-client")
          && flow.discovered ? (
          <PreviewStep
            discovered={flow.discovered}
            callbackUrl={callbackUrl}
            displayName={displayName}
            setDisplayName={setDisplayName}
            scopesInput={scopesInput}
            setScopesInput={setScopesInput}
            manualClient={flow.status === "manual-client"}
            manualClientId={manualClientId}
            setManualClientId={setManualClientId}
            manualClientSecret={manualClientSecret}
            setManualClientSecret={setManualClientSecret}
            onCancel={cancel}
            onConnect={connect}
          />
        ) : null}

        {flow.status === "authorizing" ? (
          <AuthorizingStep onCancel={cancel} />
        ) : null}

        {flow.status === "error" ? (
          <ErrorStep
            message={flow.errorMessage ?? "Unknown error."}
            hadDiscoveredPreview={Boolean(flow.discovered)}
            onCancel={cancel}
            onStartOver={startOver}
          />
        ) : null}
      </div>
    </div>
  );
}

// ── Sub-steps ───────────────────────────────────────────────────────────────

function UrlPromptStep(props: {
  urlInput: string;
  setUrlInput: (value: string) => void;
  disabled: boolean;
  onCancel: () => void;
  onDiscover: () => void;
}) {
  const { urlInput, setUrlInput, disabled, onCancel, onDiscover } = props;
  const trimmed = urlInput.trim();

  return (
    <>
      <label htmlFor="add-oauth-url" style={labelStyles}>
        OAuth provider URL
      </label>
      <input
        id="add-oauth-url"
        type="text"
        value={urlInput}
        onChange={(event) => setUrlInput(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !disabled && trimmed) {
            event.preventDefault();
            onDiscover();
          }
        }}
        placeholder="https://example.com or your MCP server URL"
        style={inputStyles}
        autoFocus
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
      />
      <p style={hintStyles}>
        We&rsquo;ll look up{" "}
        <code style={codeInlineStyles}>
          /.well-known/oauth-protected-resource
        </code>{" "}
        first, then{" "}
        <code style={codeInlineStyles}>
          /.well-known/oauth-authorization-server
        </code>{" "}
        (or OIDC) to discover the endpoints.
      </p>
      <div style={actionsRowStyles}>
        <button type="button" onClick={onCancel} style={secondaryButtonStyles}>
          Cancel
        </button>
        <button
          type="button"
          disabled={!trimmed || disabled}
          onClick={onDiscover}
          style={primaryButtonStyles}
        >
          {disabled ? "Discovering…" : "Discover"}
        </button>
      </div>
    </>
  );
}

function PreviewStep(props: {
  discovered: OAuthDiscoveryPreview;
  callbackUrl: string;
  displayName: string;
  setDisplayName: (value: string) => void;
  scopesInput: string;
  setScopesInput: (value: string) => void;
  manualClient: boolean;
  manualClientId: string;
  setManualClientId: (value: string) => void;
  manualClientSecret: string;
  setManualClientSecret: (value: string) => void;
  onCancel: () => void;
  onConnect: () => void;
}) {
  const {
    discovered,
    callbackUrl,
    displayName,
    setDisplayName,
    scopesInput,
    setScopesInput,
    manualClient,
    manualClientId,
    setManualClientId,
    manualClientSecret,
    setManualClientSecret,
    onCancel,
    onConnect,
  } = props;

  const connectDisabled = manualClient && !manualClientId.trim();

  return (
    <>
      <DiscoveredSummary discovered={discovered} />

      <label htmlFor="add-oauth-display" style={labelStyles}>
        Display name
      </label>
      <input
        id="add-oauth-display"
        type="text"
        value={displayName}
        onChange={(event) => setDisplayName(event.target.value)}
        style={inputStyles}
        spellCheck={false}
        autoComplete="off"
      />

      <label htmlFor="add-oauth-scopes" style={labelStyles}>
        Scopes (space-separated)
      </label>
      <input
        id="add-oauth-scopes"
        type="text"
        value={scopesInput}
        onChange={(event) => setScopesInput(event.target.value)}
        placeholder="openid email profile"
        style={inputStyles}
        spellCheck={false}
        autoComplete="off"
      />
      {discovered.scopesSupported?.length ? (
        <p style={hintStyles}>
          Provider supports: {discovered.scopesSupported.join(", ")}
        </p>
      ) : null}

      {manualClient ? (
        <>
          <div style={dividerStyles} />
          <p style={{ ...hintStyles, marginTop: 0 }}>
            This provider doesn&rsquo;t advertise dynamic client registration.
            Create an OAuth app at the provider, paste the{" "}
            <code style={codeInlineStyles}>client_id</code> below, and use this
            exact redirect URI in the provider&rsquo;s &ldquo;Authorized
            redirect URIs&rdquo; field:
          </p>
          <code style={callbackPillStyles}>
            {callbackUrl || "/oauth/callback"}
          </code>

          <label htmlFor="add-oauth-client-id" style={labelStyles}>
            Client ID
          </label>
          <input
            id="add-oauth-client-id"
            type="text"
            value={manualClientId}
            onChange={(event) => setManualClientId(event.target.value)}
            placeholder="OAuth client identifier from the provider"
            style={inputStyles}
            spellCheck={false}
            autoComplete="off"
          />

          <label htmlFor="add-oauth-client-secret" style={labelStyles}>
            Client secret{" "}
            <span style={{ color: "var(--almostnode-quiet)", fontWeight: 400 }}>
              (only if the provider requires one)
            </span>
          </label>
          <input
            id="add-oauth-client-secret"
            type="password"
            value={manualClientSecret}
            onChange={(event) => setManualClientSecret(event.target.value)}
            placeholder="optional"
            style={inputStyles}
            autoComplete="new-password"
          />
        </>
      ) : null}

      <div style={actionsRowStyles}>
        <button type="button" onClick={onCancel} style={secondaryButtonStyles}>
          Cancel
        </button>
        <button
          type="button"
          disabled={connectDisabled}
          onClick={onConnect}
          style={primaryButtonStyles}
          title={
            connectDisabled
              ? "Paste a client ID first"
              : "Open the OAuth popup and authorize"
          }
        >
          Connect
        </button>
      </div>
    </>
  );
}

function DiscoveredSummary(props: { discovered: OAuthDiscoveryPreview }) {
  const { discovered } = props;
  return (
    <div style={summaryCardStyles}>
      <SummaryRow label="Issuer" value={discovered.issuer} mono />
      {discovered.resourceUrl ? (
        <SummaryRow label="Resource" value={discovered.resourceUrl} mono />
      ) : null}
      <SummaryRow
        label="Authorize"
        value={discovered.authorizationEndpoint}
        mono
      />
      <SummaryRow label="Token" value={discovered.tokenEndpoint} mono />
      {discovered.registrationEndpoint ? (
        <SummaryRow
          label="Registration"
          value={discovered.registrationEndpoint}
          mono
        />
      ) : null}
      <SummaryRow
        label="Dynamic registration"
        value={discovered.supportsDynamicRegistration ? "Yes" : "Not advertised"}
      />
    </div>
  );
}

function SummaryRow(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={summaryRowStyles}>
      <span style={summaryLabelStyles}>{props.label}</span>
      <span
        style={{
          ...summaryValueStyles,
          fontFamily: props.mono
            ? "ui-monospace, SFMono-Regular, Menlo, monospace"
            : "inherit",
        }}
        title={props.value}
      >
        {props.value}
      </span>
    </div>
  );
}

function AuthorizingStep(props: { onCancel: () => void }) {
  return (
    <>
      <div style={spinnerWrapStyles}>
        <span style={spinnerStyles} />
      </div>
      <p style={hintStyles}>
        A popup is open with the provider&rsquo;s sign-in page. Complete the
        sign-in there and we&rsquo;ll save tokens to your encrypted vault
        automatically.
      </p>
      <div style={actionsRowStyles}>
        <button
          type="button"
          onClick={props.onCancel}
          style={secondaryButtonStyles}
        >
          Cancel
        </button>
      </div>
    </>
  );
}

function ErrorStep(props: {
  message: string;
  hadDiscoveredPreview: boolean;
  onCancel: () => void;
  onStartOver: () => void;
}) {
  return (
    <>
      <p style={errorMessageStyles}>{props.message}</p>
      <div style={actionsRowStyles}>
        <button
          type="button"
          onClick={props.onCancel}
          style={secondaryButtonStyles}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={props.onStartOver}
          style={primaryButtonStyles}
        >
          {props.hadDiscoveredPreview ? "Start over" : "Try a different URL"}
        </button>
      </div>
    </>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const overlayStyles: CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0, 0, 0, 0.55)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "20px",
  zIndex: 9999,
};

const modalCardStyles: CSSProperties = {
  width: "100%",
  maxWidth: "440px",
  maxHeight: "calc(100vh - 40px)",
  overflowY: "auto",
  background: "var(--almostnode-card-bg)",
  border: "1px solid var(--almostnode-border-subtle)",
  borderRadius: "8px",
  padding: "16px 18px",
  color: "var(--text)",
  fontSize: "13px",
  fontFamily:
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
  boxShadow: "0 16px 32px rgba(0, 0, 0, 0.35)",
  display: "flex",
  flexDirection: "column",
  gap: "10px",
};

const headerStyles: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: "4px",
};

const titleStyles: CSSProperties = {
  fontSize: "14px",
  fontWeight: 600,
  color: "var(--text)",
};

const closeButtonStyles: CSSProperties = {
  appearance: "none",
  background: "transparent",
  border: "none",
  color: "var(--almostnode-quiet)",
  fontSize: "20px",
  lineHeight: 1,
  cursor: "pointer",
  padding: "2px 6px",
};

const labelStyles: CSSProperties = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.4px",
  color: "var(--almostnode-quiet)",
  marginTop: "8px",
  fontWeight: 600,
};

const inputStyles: CSSProperties = {
  width: "100%",
  padding: "7px 10px",
  borderRadius: "5px",
  border: "1px solid var(--almostnode-border-subtle)",
  background: "var(--almostnode-button-bg)",
  color: "var(--text)",
  fontSize: "13px",
  fontFamily: "inherit",
  marginTop: "4px",
  boxSizing: "border-box",
};

const hintStyles: CSSProperties = {
  fontSize: "11px",
  color: "var(--almostnode-quiet)",
  lineHeight: 1.45,
  marginTop: "8px",
  marginBottom: 0,
};

const codeInlineStyles: CSSProperties = {
  background: "var(--almostnode-button-bg)",
  padding: "1px 4px",
  borderRadius: "3px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontSize: "10.5px",
  color: "var(--text)",
};

const callbackPillStyles: CSSProperties = {
  display: "block",
  background: "var(--almostnode-button-bg)",
  border: "1px solid var(--almostnode-border-subtle)",
  borderRadius: "5px",
  padding: "6px 10px",
  margin: "8px 0",
  fontSize: "12px",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  color: "var(--text)",
  wordBreak: "break-all",
};

const dividerStyles: CSSProperties = {
  borderTop: "1px solid var(--almostnode-border-subtle)",
  margin: "12px 0 4px",
};

const actionsRowStyles: CSSProperties = {
  display: "flex",
  justifyContent: "flex-end",
  gap: "8px",
  marginTop: "14px",
};

const primaryButtonStyles: CSSProperties = {
  background: "var(--almostnode-primary-button-bg)",
  color: "var(--almostnode-primary-button-fg)",
  border: "1px solid transparent",
  padding: "6px 14px",
  borderRadius: "5px",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 500,
};

const secondaryButtonStyles: CSSProperties = {
  background: "var(--almostnode-button-bg)",
  color: "var(--muted)",
  border: "1px solid var(--almostnode-border-subtle)",
  padding: "6px 14px",
  borderRadius: "5px",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 500,
};

const summaryCardStyles: CSSProperties = {
  background: "var(--almostnode-button-bg)",
  border: "1px solid var(--almostnode-border-subtle)",
  borderRadius: "5px",
  padding: "8px 10px",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const summaryRowStyles: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "100px 1fr",
  gap: "8px",
  alignItems: "baseline",
  fontSize: "11px",
  lineHeight: 1.4,
};

const summaryLabelStyles: CSSProperties = {
  color: "var(--almostnode-quiet)",
  textTransform: "uppercase",
  letterSpacing: "0.3px",
  fontWeight: 600,
  fontSize: "10px",
};

const summaryValueStyles: CSSProperties = {
  color: "var(--text)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const spinnerWrapStyles: CSSProperties = {
  display: "flex",
  justifyContent: "center",
  padding: "16px 0",
};

const spinnerStyles: CSSProperties = {
  display: "inline-block",
  width: "24px",
  height: "24px",
  borderRadius: "50%",
  border: "2px solid var(--almostnode-border-subtle)",
  borderTopColor: "var(--accent)",
  animation: "almostnode-oauth-spin 0.9s linear infinite",
};

const errorMessageStyles: CSSProperties = {
  background: "color-mix(in srgb, var(--almostnode-danger, #f87171) 12%, transparent)",
  border: "1px solid color-mix(in srgb, var(--almostnode-danger, #f87171) 35%, transparent)",
  color: "var(--almostnode-danger, #f87171)",
  fontSize: "12px",
  lineHeight: 1.45,
  padding: "8px 10px",
  borderRadius: "5px",
  margin: 0,
  whiteSpace: "pre-wrap",
};
