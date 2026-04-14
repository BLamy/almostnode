import type { CSSProperties } from "react";
import type { SurfaceModel } from "../../framework/model";
import { useSurfaceModel } from "../../framework/hooks";
import type {
  KeychainSidebarActions,
  KeychainSidebarSlotStatus,
  KeychainSidebarState,
} from "../../surface-model-types";

const ICON_GITHUB = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;
const ICON_REPLAY = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zM6.5 4.5l5 3.5-5 3.5v-7z"/></svg>`;
const ICON_CLAUDE = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM7 5a1 1 0 112 0 1 1 0 01-2 0zm-.25 2.5h2.5v4.25h-2.5V7.5z"/></svg>`;
const ICON_KEY = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 1a4.5 4.5 0 00-3.83 6.84L2 13.5V16h2.5l.5-.5v-1.5H6.5l.5-.5v-1.5H8.5l1.17-1.17A4.5 4.5 0 1011.5 1zm1 3a1 1 0 110-2 1 1 0 010 2z"/></svg>`;

function getSlotIcon(name: string): string {
  switch (name) {
    case "github":
      return ICON_GITHUB;
    case "replay":
      return ICON_REPLAY;
    case "claude":
      return ICON_CLAUDE;
    default:
      return ICON_KEY;
  }
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
        dangerouslySetInnerHTML={{ __html: getSlotIcon(slot.name) }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "28px",
          height: "28px",
          borderRadius: "6px",
          flexShrink: 0,
          background: slot.active
            ? "color-mix(in srgb, var(--almostnode-success) 18%, transparent)"
            : "var(--almostnode-button-bg)",
          color: slot.active
            ? "var(--almostnode-success)"
            : "var(--almostnode-quiet)",
        }}
      />
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
        {slot.selectOptions?.length && slot.selectActionPrefix ? (
          <div
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
              Exit Node
            </span>
            <select
              value={slot.selectValue ?? ""}
              onChange={(event) => {
                if (!event.currentTarget.value) {
                  return;
                }
                actions.dispatch(
                  `${slot.selectActionPrefix}:${event.currentTarget.value}`,
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
              {slot.selectValue ? null : (
                <option value="" disabled>
                  Choose…
                </option>
              )}
              {slot.selectOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
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
            flexShrink: 0,
            opacity: isDisabled ? 0.7 : 1,
          }}
        >
          {slot.authLabel ?? (isLogout ? "Logout" : "Login")}
        </button>
      ) : null}
    </div>
  );
}

export default function KeychainSidebarView(props: {
  model: SurfaceModel<KeychainSidebarState, KeychainSidebarActions>;
}) {
  const [state, actions] = useSurfaceModel(props.model);

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
        <span
          dangerouslySetInnerHTML={{ __html: ICON_KEY }}
          style={{
            color: "var(--accent)",
            display: "flex",
            alignItems: "center",
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
        }}
      >
        {state.slots.map((slot) => (
          <ServiceCard key={slot.name} slot={slot} actions={actions} />
        ))}
      </div>

      <div
        style={{
          display: "flex",
          gap: "6px",
          paddingTop: "12px",
          marginTop: "8px",
          borderTop: "1px solid var(--almostnode-toolbar-border)",
        }}
      >
        {!state.supported ? (
          <span
            style={{ fontSize: "11px", color: "var(--almostnode-quiet)" }}
          >
            Passkey not supported in this browser
          </span>
        ) : state.hasStoredVault ? (
          <>
            <button
              type="button"
              onClick={() => actions.dispatch("unlock")}
              style={footerButtonStyles(true)}
            >
              Unlock Vault
            </button>
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
