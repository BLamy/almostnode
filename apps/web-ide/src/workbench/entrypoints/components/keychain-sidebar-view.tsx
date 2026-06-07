import { useEffect, useState, type CSSProperties } from "react";
import type { SurfaceModel } from "../../framework/model";
import { useSurfaceModel } from "../../framework/hooks";
import type {
  KeychainSidebarActions,
  KeychainSidebarSlotStatus,
  KeychainSidebarState,
  KeychainSlotPicker,
  KeychainVaultEnvVar,
  KeychainVaultSyncState,
} from "../../surface-model-types";
import { AddOAuthServiceModal } from "./add-oauth-service-modal";

const LOGO_APP_BUILDING = new URL(
  "../../../../readme-assets/logos/app-building.svg",
  import.meta.url,
).href;
const LOGO_AWS = new URL(
  "../../../../readme-assets/logos/aws.svg",
  import.meta.url,
).href;
const LOGO_CLAUDE = new URL(
  "../../../../readme-assets/logos/claude.svg",
  import.meta.url,
).href;
const LOGO_CLOUDFLARE = new URL(
  "../../../../readme-assets/logos/cloudflare.svg",
  import.meta.url,
).href;
const LOGO_CODEX = new URL(
  "../../../../readme-assets/logos/codex.svg",
  import.meta.url,
).href;
const LOGO_FLY = new URL(
  "../../../../readme-assets/logos/fly.svg",
  import.meta.url,
).href;
const LOGO_GITHUB = new URL(
  "../../../../readme-assets/logos/github.svg",
  import.meta.url,
).href;
const LOGO_INFISICAL = new URL(
  "../../../../readme-assets/logos/infisical.svg",
  import.meta.url,
).href;
const LOGO_KEYCHAIN = new URL(
  "../../../../readme-assets/logos/keychain.svg",
  import.meta.url,
).href;
const LOGO_NEON = new URL(
  "../../../../readme-assets/logos/neon.svg",
  import.meta.url,
).href;
const LOGO_NETLIFY = new URL(
  "../../../../readme-assets/logos/netlify.svg",
  import.meta.url,
).href;
const LOGO_OAUTH = new URL(
  "../../../../readme-assets/logos/oauth.svg",
  import.meta.url,
).href;
const LOGO_OPENCODE = new URL(
  "../../../../readme-assets/logos/opencode.svg",
  import.meta.url,
).href;
const LOGO_REPLAY = new URL(
  "../../../../readme-assets/logos/replay.svg",
  import.meta.url,
).href;
const LOGO_TAILSCALE = new URL(
  "../../../../readme-assets/logos/tailscale.svg",
  import.meta.url,
).href;

interface SlotLogo {
  src: string;
  alt: string;
}

const SLOT_LOGOS: Record<string, SlotLogo> = {
  "app-building": { src: LOGO_APP_BUILDING, alt: "App Building" },
  aws: { src: LOGO_AWS, alt: "AWS" },
  claude: { src: LOGO_CLAUDE, alt: "Claude Code" },
  cloudflare: { src: LOGO_CLOUDFLARE, alt: "Cloudflare" },
  codex: { src: LOGO_CODEX, alt: "Codex" },
  fly: { src: LOGO_FLY, alt: "Fly.io" },
  github: { src: LOGO_GITHUB, alt: "GitHub" },
  infisical: { src: LOGO_INFISICAL, alt: "Infisical" },
  neon: { src: LOGO_NEON, alt: "Neon" },
  netlify: { src: LOGO_NETLIFY, alt: "Netlify" },
  opencode: { src: LOGO_OPENCODE, alt: "OpenCode" },
  oauth: { src: LOGO_OAUTH, alt: "OAuth service" },
  replay: { src: LOGO_REPLAY, alt: "Replay.io" },
  tailscale: { src: LOGO_TAILSCALE, alt: "Tailscale" },
};

function getSlotLogo(name: string): SlotLogo {
  if (name.startsWith("oauth:")) {
    return SLOT_LOGOS.oauth;
  }
  return SLOT_LOGOS[name] ?? SLOT_LOGOS.oauth;
}

function ServiceCard(props: {
  slot: KeychainSidebarSlotStatus;
  actions: KeychainSidebarActions;
}) {
  const { slot, actions } = props;
  const action =
    slot.authAction ??
    (slot.active ? `logout:${slot.name}` : `login:${slot.name}`);
  const isLogout = action.startsWith("logout:");
  const isDisabled = Boolean(slot.authDisabled);
  const logo = getSlotLogo(slot.name);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "10px",
        padding: "8px 10px",
        borderRadius: "6px",
        background: "var(--almostnode-card-bg)",
        border: "1px solid var(--almostnode-border-subtle)",
      }}
    >
      <span
        title={logo.alt}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "28px",
          height: "28px",
          borderRadius: "6px",
          flexShrink: 0,
          background: "rgba(255, 255, 255, 0.94)",
          border: slot.active
            ? "1px solid color-mix(in srgb, var(--almostnode-success) 35%, rgba(255, 255, 255, 0.7))"
            : "1px solid rgba(255, 255, 255, 0.12)",
          boxShadow: slot.active
            ? "0 0 0 2px color-mix(in srgb, var(--almostnode-success) 14%, transparent)"
            : "none",
        }}
      >
        <img
          src={logo.src}
          alt=""
          aria-hidden="true"
          style={{
            display: "block",
            width: "20px",
            height: "20px",
            objectFit: "contain",
            opacity: slot.active ? 1 : 0.7,
            filter: slot.active ? "none" : "grayscale(0.35) saturate(0.8)",
          }}
        />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: "13px",
            fontWeight: 500,
            color: "var(--text)",
            lineHeight: 1.3,
          }}
        >
          {slot.label}
        </div>
        <div
          style={{
            fontSize: "11px",
            lineHeight: 1.3,
            color: slot.active
              ? "var(--almostnode-success)"
              : "var(--almostnode-quiet)",
          }}
        >
          {slot.statusText ?? (slot.active ? "Connected" : "Not connected")}
        </div>
        {slot.statusDetail ? (
          <div
            style={{
              fontSize: "10px",
              color: "var(--almostnode-quiet)",
              lineHeight: 1.35,
              marginTop: "2px",
            }}
          >
            {slot.statusDetail}
          </div>
        ) : null}
        {(() => {
          const pickers: KeychainSlotPicker[] = slot.pickers
            ? slot.pickers
            : slot.selectOptions?.length && slot.selectActionPrefix
              ? [{
                  actionPrefix: slot.selectActionPrefix,
                  label: slot.selectLabel ?? "Exit Node",
                  options: slot.selectOptions,
                  value: slot.selectValue,
                }]
              : [];
          if (pickers.length === 0) return null;
          return pickers.map((picker, index) => (
            <div
              key={`${picker.actionPrefix}-${index}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                marginTop: "6px",
              }}
            >
              <span
                style={{
                  fontSize: "10px",
                  color: "var(--almostnode-quiet)",
                  textTransform: "uppercase",
                  letterSpacing: "0.4px",
                }}
              >
                {picker.label}
              </span>
              <select
                value={picker.value ?? ""}
                onChange={(event) => {
                  if (!event.currentTarget.value) {
                    return;
                  }
                  actions.dispatch(
                    `${picker.actionPrefix}:${event.currentTarget.value}`,
                  );
                }}
                style={{
                  minWidth: 0,
                  maxWidth: "160px",
                  background: "var(--almostnode-button-bg)",
                  color: "var(--text)",
                  border: "1px solid var(--almostnode-border-subtle)",
                  borderRadius: "4px",
                  padding: "3px 6px",
                  fontSize: "11px",
                }}
              >
                {picker.value ? null : (
                  <option value="" disabled>
                    {picker.placeholder ?? "Choose…"}
                  </option>
                )}
                {picker.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          ));
        })()}
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "4px",
          flexShrink: 0,
        }}
      >
        {slot.refreshAction ? (
          <button
            type="button"
            disabled={Boolean(slot.refreshing)}
            onClick={() => actions.dispatch(slot.refreshAction!)}
            title="Refresh access token now"
            style={iconButtonStyles(Boolean(slot.refreshing))}
          >
            {slot.refreshing ? "…" : "↻"}
          </button>
        ) : null}
        {slot.removeAction ? (
          <button
            type="button"
            onClick={() => actions.dispatch(slot.removeAction!)}
            title="Remove this OAuth service"
            style={iconButtonStyles(false)}
          >
            ×
          </button>
        ) : null}
        {slot.canAuth ? (
          <button
            type="button"
            disabled={isDisabled}
            onClick={() => actions.dispatch(action)}
            style={{
              background: isDisabled
                ? "var(--almostnode-button-bg)"
                : isLogout
                  ? "var(--almostnode-button-bg)"
                  : "color-mix(in srgb, var(--almostnode-success) 18%, transparent)",
              color: isDisabled
                ? "var(--almostnode-quiet)"
                : isLogout
                  ? "var(--muted)"
                  : "var(--almostnode-success)",
              border: `1px solid ${
                isDisabled
                  ? "var(--almostnode-border-subtle)"
                  : isLogout
                    ? "var(--almostnode-border-subtle)"
                    : "color-mix(in srgb, var(--almostnode-success) 35%, transparent)"
              }`,
              padding: "3px 10px",
              borderRadius: "4px",
              cursor: isDisabled ? "not-allowed" : "pointer",
              fontSize: "11px",
              fontWeight: 500,
              opacity: isDisabled ? 0.7 : 1,
            }}
          >
            {slot.authLabel ?? (isLogout ? "Logout" : "Login")}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function iconButtonStyles(disabled: boolean): CSSProperties {
  return {
    background: "var(--almostnode-button-bg)",
    color: disabled ? "var(--almostnode-quiet)" : "var(--muted)",
    border: "1px solid var(--almostnode-border-subtle)",
    width: "22px",
    height: "22px",
    padding: 0,
    borderRadius: "4px",
    cursor: disabled ? "not-allowed" : "pointer",
    fontSize: "13px",
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "inherit",
  };
}

function buildEnvFileText(envVars: KeychainVaultEnvVar[]): string {
  return envVars
    .filter((entry) => entry.value)
    .map((entry) => `${entry.name}=${entry.value}`)
    .join("\n");
}

async function copyToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through
  }
  return false;
}

function VaultEnvPanel(props: {
  envVars: KeychainVaultEnvVar[];
  vaultSync: KeychainVaultSyncState;
  onSync: () => void;
}) {
  const { envVars, vaultSync, onSync } = props;
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const populated = envVars.filter((entry) => entry.value);
  const syncTargetLabel = vaultSync.targetLabel ?? "target";
  const syncDisabled = !vaultSync.target || vaultSync.busy || populated.length === 0;
  const syncTitle = !vaultSync.target
    ? "Pick an Infisical project from the slot above to enable sync."
    : populated.length === 0
      ? "No populated env vars to sync."
      : `Push these env vars to ${syncTargetLabel}.`;
  const syncMessageColor = vaultSync.messageKind === "error"
    ? "var(--almostnode-danger, #f87171)"
    : vaultSync.messageKind === "success"
      ? "var(--almostnode-success)"
      : "var(--almostnode-quiet)";

  const flashCopied = (key: string) => {
    setCopiedKey(key);
    window.setTimeout(() => {
      setCopiedKey((current) => (current === key ? null : current));
    }, 1200);
  };

  return (
    <div
      style={{
        marginTop: "10px",
        padding: "10px",
        borderRadius: "6px",
        border: "1px solid var(--almostnode-border-subtle)",
        background: "var(--almostnode-card-bg)",
        display: "flex",
        flexDirection: "column",
        gap: "8px",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "8px",
        }}
      >
        <span
          style={{
            fontSize: "10px",
            textTransform: "uppercase",
            letterSpacing: "0.4px",
            color: "var(--almostnode-quiet)",
          }}
        >
          Vault env vars
        </span>
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <button
            type="button"
            disabled={populated.length === 0}
            onClick={() => {
              const text = buildEnvFileText(envVars);
              if (!text) return;
              void copyToClipboard(text).then((ok) => {
                if (ok) flashCopied("__all__");
              });
            }}
            style={{
              background: "var(--almostnode-button-bg)",
              color: "var(--muted)",
              border: "1px solid var(--almostnode-border-subtle)",
              padding: "3px 8px",
              borderRadius: "4px",
              cursor: populated.length === 0 ? "not-allowed" : "pointer",
              fontSize: "10px",
              fontWeight: 500,
              opacity: populated.length === 0 ? 0.6 : 1,
            }}
          >
            {copiedKey === "__all__" ? "Copied" : "Copy as .env"}
          </button>
          <button
            type="button"
            disabled={syncDisabled}
            onClick={onSync}
            title={syncTitle}
            style={{
              background: "var(--almostnode-button-bg)",
              color: "var(--muted)",
              border: "1px solid var(--almostnode-border-subtle)",
              padding: "3px 8px",
              borderRadius: "4px",
              cursor: syncDisabled ? "not-allowed" : "pointer",
              fontSize: "10px",
              fontWeight: 500,
              opacity: syncDisabled ? 0.6 : 1,
            }}
          >
            {vaultSync.busy ? "Syncing…" : "Sync to Infisical"}
          </button>
        </div>
      </div>
      {vaultSync.message ? (
        <div
          style={{
            fontSize: "10px",
            color: syncMessageColor,
            lineHeight: 1.4,
          }}
        >
          {vaultSync.message}
        </div>
      ) : null}
      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {envVars.map((entry) => {
          const hasValue = Boolean(entry.value);
          const masked = entry.value
            ? entry.value.length <= 10
              ? "•".repeat(entry.value.length)
              : `${entry.value.slice(0, 4)}…${entry.value.slice(-4)}`
            : "—";

          return (
            <div
              key={entry.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 6px",
                borderRadius: "4px",
                background: "var(--almostnode-button-bg)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: "11px",
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    color: "var(--text)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {entry.name}
                </div>
                <div
                  style={{
                    fontSize: "10px",
                    color: hasValue
                      ? "var(--almostnode-quiet)"
                      : "var(--almostnode-quiet)",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    fontStyle: hasValue ? "normal" : "italic",
                  }}
                  title={entry.note ?? entry.source}
                >
                  {hasValue ? masked : entry.note ?? "Not available"}
                </div>
              </div>
              <button
                type="button"
                disabled={!hasValue}
                onClick={() => {
                  if (!entry.value) return;
                  void copyToClipboard(entry.value).then((ok) => {
                    if (ok) flashCopied(entry.name);
                  });
                }}
                style={{
                  background: "var(--almostnode-button-bg)",
                  color: "var(--muted)",
                  border: "1px solid var(--almostnode-border-subtle)",
                  padding: "2px 6px",
                  borderRadius: "3px",
                  cursor: hasValue ? "pointer" : "not-allowed",
                  fontSize: "10px",
                  fontWeight: 500,
                  flexShrink: 0,
                  opacity: hasValue ? 1 : 0.5,
                }}
              >
                {copiedKey === entry.name ? "Copied" : "Copy"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function KeychainSidebarView(props: {
  model: SurfaceModel<KeychainSidebarState, KeychainSidebarActions>;
}) {
  const [state, actions] = useSurfaceModel(props.model);
  const [vaultExpanded, setVaultExpanded] = useState(false);

  // The OAuth modal references the `almostnode-oauth-spin` keyframes for its
  // loading spinner. Inject them once on mount so the rule is available even
  // when the modal mounts on its own (no other component owns the spinner).
  useEffect(() => {
    if (typeof document === "undefined") return;
    const styleId = "almostnode-oauth-spin-keyframes";
    if (document.getElementById(styleId)) return;
    const style = document.createElement("style");
    style.id = styleId;
    style.textContent =
      "@keyframes almostnode-oauth-spin { to { transform: rotate(360deg); } }";
    document.head.appendChild(style);
  }, []);

  // Split the slot list into built-in vs. user-added OAuth services so we can
  // render a thin separator between them.
  const builtInSlots = state.slots.filter((slot) => !slot.userOAuthServiceId);
  const userOAuthSlots = state.slots.filter((slot) => Boolean(slot.userOAuthServiceId));
  const addFlow = state.addServiceFlow;
  const modalOpen = Boolean(addFlow && addFlow.status !== "idle");

  return (
    <div
      className="almostnode-keychain-sidebar"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "12px",
        gap: 0,
        color: "var(--text)",
        fontSize: "13px",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
        background: "var(--almostnode-surface-alt-bg)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          marginBottom: "16px",
          paddingBottom: "10px",
          borderBottom: "1px solid var(--almostnode-toolbar-border)",
        }}
      >
        <img
          src={LOGO_KEYCHAIN}
          alt=""
          aria-hidden="true"
          style={{
            display: "block",
            width: "18px",
            height: "18px",
            objectFit: "contain",
          }}
        />
        <span
          style={{
            fontWeight: 600,
            fontSize: "12px",
            textTransform: "uppercase",
            letterSpacing: "0.5px",
            color: "var(--muted)",
          }}
        >
          Credentials
        </span>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          gap: "6px",
          overflowY: "auto",
          minHeight: 0,
        }}
      >
        {builtInSlots.map((slot) => (
          <ServiceCard key={slot.name} slot={slot} actions={actions} />
        ))}

        {userOAuthSlots.length > 0 ? (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              marginTop: "10px",
              marginBottom: "2px",
            }}
          >
            <span
              style={{
                fontSize: "10px",
                textTransform: "uppercase",
                letterSpacing: "0.4px",
                color: "var(--almostnode-quiet)",
                fontWeight: 600,
              }}
            >
              Your OAuth services
            </span>
            <span
              style={{
                flex: 1,
                height: "1px",
                background: "var(--almostnode-border-subtle)",
              }}
            />
          </div>
        ) : null}

        {userOAuthSlots.map((slot) => (
          <ServiceCard key={slot.name} slot={slot} actions={actions} />
        ))}

        <button
          type="button"
          onClick={() => actions.dispatch("oauth:add-start")}
          style={addServiceButtonStyles}
          title="Connect any OAuth-compatible service via .well-known discovery"
        >
          + Add OAuth service
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          paddingTop: "12px",
          marginTop: "8px",
          borderTop: "1px solid var(--almostnode-toolbar-border)",
        }}
      >
        <div style={{ display: "flex", gap: "6px" }}>
          {!state.supported ? (
            <span
              style={{ fontSize: "11px", color: "var(--almostnode-quiet)" }}
            >
              Passkey not supported in this browser
            </span>
          ) : state.hasStoredVault ? (
            <>
              {state.hasUnlockedKey ? (
                <button
                  type="button"
                  onClick={() => setVaultExpanded((value) => !value)}
                  style={footerButtonStyles(true)}
                >
                  {vaultExpanded ? "Hide Vault" : "View Vault"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => actions.dispatch("unlock")}
                  style={footerButtonStyles(true)}
                >
                  Unlock Vault
                </button>
              )}
              <button
                type="button"
                onClick={() => actions.dispatch("forget")}
                style={footerButtonStyles(false)}
              >
                Forget
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => actions.dispatch("save")}
              style={footerButtonStyles(true)}
            >
              Save with Passkey
            </button>
          )}
        </div>
        {state.hasUnlockedKey && vaultExpanded ? (
          <VaultEnvPanel
            envVars={state.vaultEnvVars}
            vaultSync={state.vaultSync}
            onSync={() => actions.dispatch("sync-vault-env:infisical")}
          />
        ) : null}
      </div>

      {modalOpen && addFlow ? (
        <AddOAuthServiceModal
          flow={addFlow}
          callbackUrl={state.oauthCallbackUrl ?? ""}
          actions={actions}
        />
      ) : null}
    </div>
  );
}

function footerButtonStyles(primary: boolean): CSSProperties {
  return {
    background: primary
      ? "var(--almostnode-primary-button-bg)"
      : "var(--almostnode-button-bg)",
    color: primary
      ? "var(--almostnode-primary-button-fg)"
      : "var(--muted)",
    border: primary
      ? "1px solid transparent"
      : "1px solid var(--almostnode-border-subtle)",
    padding: "5px 12px",
    borderRadius: "4px",
    cursor: "pointer",
    fontSize: "12px",
    fontWeight: 500,
  };
}

const addServiceButtonStyles: CSSProperties = {
  marginTop: "8px",
  background: "transparent",
  color: "var(--almostnode-quiet)",
  border: "1px dashed var(--almostnode-border-subtle)",
  padding: "8px 10px",
  borderRadius: "6px",
  cursor: "pointer",
  fontSize: "12px",
  fontWeight: 500,
  textAlign: "center",
  fontFamily: "inherit",
};
