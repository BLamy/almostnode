import { useMemo, useState } from "react";
import {
  agentWasmCredentialPaths,
  defaultAuthProviders,
  defaultCredentialSlots,
} from "@agent-wasm/sdk/auth";
import { useKeychain } from "../../keychain/keychain-store";
import { useOsRuntime } from "../../runtime/OsRuntimeProvider";
import { useSystem } from "../../os/system";

export function KeychainApp() {
  const { keychain, state, refresh } = useKeychain();
  const { workspace } = useOsRuntime();
  const system = useSystem();
  const [authDraft, setAuthDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);

  const providerBySlot = useMemo(() => {
    const map = new Map<string, (typeof defaultAuthProviders)[number]>();
    for (const provider of defaultAuthProviders) map.set(provider.slotId, provider);
    return map;
  }, []);

  const primaryLabel =
    state.bannerMode === "save"
      ? "Save to Keychain"
      : state.bannerMode === "unlock"
        ? "Unlock"
        : state.hasUnlockedKey
          ? "Vault unlocked"
          : "No action needed";

  const storeOpenCodeAuth = () => {
    const value = authDraft.trim();
    if (!value) return;
    const path = agentWasmCredentialPaths.opencodeAuth;
    const dir = path.slice(0, path.lastIndexOf("/"));
    try {
      if (!workspace.vfs.existsSync(dir)) {
        workspace.vfs.mkdirSync(dir, { recursive: true });
      }
      workspace.vfs.writeFileSync(path, value);
      setNotice("Stored OpenCode auth into the workspace. Save the vault to encrypt it.");
      setAuthDraft("");
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="keychain">
      <header className="keychain__header">
        <span className="keychain__lock" aria-hidden="true">
          🔐
        </span>
        <div>
          <h1>Keychain</h1>
          <p>Passkey-encrypted vault for your agent credentials.</p>
        </div>
      </header>

      <section className="keychain__card">
        <div className="keychain__card-title">Vault</div>
        <div className="keychain__rows">
          <Row label="Passkey support" value={state.supported ? "Available" : "Unavailable"} ok={state.supported} />
          <Row label="Stored vault" value={state.hasStoredVault ? "Yes" : "None"} ok={state.hasStoredVault} />
          <Row label="Unlocked" value={state.hasUnlockedKey ? "Yes" : "Locked"} ok={state.hasUnlockedKey} />
          <Row label="Live credentials" value={state.hasLiveCredentials ? "Present" : "None"} ok={state.hasLiveCredentials} />
        </div>
        <div className="keychain__actions">
          <button
            type="button"
            className="keychain__btn keychain__btn--primary"
            disabled={!state.supported || state.busy || !state.bannerMode}
            onClick={() => void keychain.handlePrimaryAction()}
          >
            {primaryLabel}
          </button>
          {state.hasStoredVault && (
            <button
              type="button"
              className="keychain__btn"
              onClick={() => {
                keychain.forgetSavedVault();
                refresh();
              }}
            >
              Forget vault
            </button>
          )}
        </div>
        {!state.supported && (
          <p className="keychain__hint">
            This browser can't create a passkey vault (WebAuthn PRF). Credentials still live in the
            workspace for this session.
          </p>
        )}
      </section>

      <section className="keychain__card">
        <div className="keychain__card-title">Credentials</div>
        <div className="keychain__slots">
          {defaultCredentialSlots.map((slot) => {
            const connected = keychain.hasSlotData(slot.id);
            const provider = providerBySlot.get(slot.id);
            const loginCmd = provider?.commands?.login;
            const logoutCmd = provider?.commands?.logout;
            return (
              <div
                key={slot.id}
                className={`keychain__slot${slot.id === "opencode" ? " is-highlight" : ""}`}
              >
                <span className="keychain__slot-name">{slot.label}</span>
                <span className="keychain__slot-cat">{slot.category}</span>
                <span className={`keychain__badge${connected ? " is-on" : ""}`}>
                  {connected ? "Connected" : "Not connected"}
                </span>
                <span className="keychain__slot-actions">
                  {loginCmd && (
                    <button
                      type="button"
                      className="keychain__btn keychain__btn--small"
                      onClick={() => system.runInTerminal(loginCmd)}
                      title={loginCmd}
                    >
                      Log in
                    </button>
                  )}
                  {logoutCmd && connected && (
                    <button
                      type="button"
                      className="keychain__btn keychain__btn--small"
                      onClick={() => system.runInTerminal(logoutCmd)}
                      title={logoutCmd}
                    >
                      Log out
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      <section className="keychain__card">
        <div className="keychain__card-title">OpenCode auth</div>
        <p className="keychain__hint">
          Paste your OpenCode <code>auth.json</code> (or run <code>opencode login</code> in the
          Terminal). It's written to <code>{agentWasmCredentialPaths.opencodeAuth}</code> and can be
          sealed into the passkey vault.
        </p>
        <textarea
          className="keychain__textarea"
          value={authDraft}
          onChange={(e) => setAuthDraft(e.target.value)}
          placeholder='{ "type": "oauth", "access": "…", "refresh": "…" }'
          spellCheck={false}
        />
        <div className="keychain__actions">
          <button
            type="button"
            className="keychain__btn keychain__btn--primary"
            disabled={!authDraft.trim()}
            onClick={storeOpenCodeAuth}
          >
            Store OpenCode auth
          </button>
        </div>
        {notice && <p className="keychain__notice">{notice}</p>}
      </section>
    </div>
  );
}

function Row({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="keychain__row">
      <span className="keychain__row-label">{label}</span>
      <span className={`keychain__row-value${ok ? " is-ok" : ""}`}>{value}</span>
    </div>
  );
}
