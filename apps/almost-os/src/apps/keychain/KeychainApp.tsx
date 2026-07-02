import { useMemo, useState } from "react";
import {
  agentWasmCredentialPaths,
  defaultAuthProviders,
  defaultCredentialSlots,
} from "@agent-wasm/sdk/auth";
import { useKeychain } from "../../keychain/keychain-store";
import { useOsRuntime } from "../../runtime/OsRuntimeProvider";
import { useSystem } from "../../os/system";

// Placeholder hint per credential category — agents want an auth.json/API key,
// everything else a token.
function placeholderFor(category: string): string {
  if (category === "agent") return '{ "type": "oauth", "access": "…", "refresh": "…" }  — or an API key';
  return "Paste an API key or token…";
}

export function KeychainApp() {
  const { keychain, state, refresh } = useKeychain();
  const { workspace } = useOsRuntime();
  const system = useSystem();
  const [openSlot, setOpenSlot] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
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

  // Write the pasted credential to the slot's first credential path — the same
  // mechanism that already works for OpenCode — which flips
  // keychain.hasSlotData(slot.id) to "Connected" and lets the vault seal it.
  const saveCredential = (slotId: string, path: string) => {
    const value = draft.trim();
    if (!value || !path) return;
    const dir = path.slice(0, path.lastIndexOf("/"));
    try {
      if (dir && !workspace.vfs.existsSync(dir)) {
        workspace.vfs.mkdirSync(dir, { recursive: true });
      }
      workspace.vfs.writeFileSync(path, value);
      setNotice(`Stored ${slotId} credential. Save the vault (above) to encrypt it.`);
      setDraft("");
      setOpenSlot(null);
      refresh();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error));
    }
  };

  // Log out = remove the slot's credential files from the workspace.
  const clearCredential = (slotId: string, paths: readonly string[]) => {
    let removed = false;
    for (const path of paths) {
      try {
        if (workspace.vfs.existsSync(path)) {
          workspace.vfs.unlinkSync(path);
          removed = true;
        }
      } catch {
        /* best effort */
      }
    }
    if (removed) setNotice(`Signed out of ${slotId}.`);
    refresh();
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
        <p className="keychain__hint">
          Click <strong>Log In</strong> and paste the credential (an <code>auth.json</code>, OAuth
          token, or API key). It's written to the workspace and sealed into the passkey vault when
          you save above.
        </p>
        <div className="keychain__slots">
          {defaultCredentialSlots.map((slot) => {
            const connected = keychain.hasSlotData(slot.id);
            const provider = providerBySlot.get(slot.id);
            const loginCmd = provider?.commands?.login;
            const credentialPath = slot.paths[0];
            const canEnter = !slot.synthetic && !!credentialPath;
            const isOpen = openSlot === slot.id;
            return (
              <div key={slot.id} className="keychain__slot-wrap">
                <div className="keychain__slot">
                  <span className="keychain__slot-name">{slot.label}</span>
                  <span className="keychain__slot-cat">{slot.category}</span>
                  <span className={`keychain__badge${connected ? " is-on" : ""}`}>
                    {connected ? "Connected" : "Not connected"}
                  </span>
                  <span className="keychain__slot-actions">
                    {canEnter && (
                      <button
                        type="button"
                        className="keychain__btn keychain__btn--small"
                        onClick={() => {
                          setDraft("");
                          setOpenSlot(isOpen ? null : slot.id);
                        }}
                      >
                        {isOpen ? "Cancel" : connected ? "Update" : "Log In"}
                      </button>
                    )}
                    {connected && (
                      <button
                        type="button"
                        className="keychain__btn keychain__btn--small"
                        onClick={() => clearCredential(slot.id, slot.paths)}
                      >
                        Log Out
                      </button>
                    )}
                  </span>
                </div>
                {isOpen && canEnter && (
                  <div className="keychain__slot-entry">
                    <textarea
                      className="keychain__textarea"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      placeholder={placeholderFor(slot.category)}
                      spellCheck={false}
                      autoFocus
                    />
                    <div className="keychain__actions">
                      <button
                        type="button"
                        className="keychain__btn keychain__btn--primary keychain__btn--small"
                        disabled={!draft.trim()}
                        onClick={() => saveCredential(slot.id, credentialPath)}
                      >
                        Save credential
                      </button>
                      {loginCmd && (
                        <button
                          type="button"
                          className="keychain__btn keychain__btn--small"
                          onClick={() => system.runInTerminal(loginCmd)}
                          title={`Run ${loginCmd} in the Terminal`}
                        >
                          Log in via CLI
                        </button>
                      )}
                      <span className="keychain__slot-path">→ {credentialPath}</span>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {notice && <p className="keychain__notice">{notice}</p>}
        <p className="keychain__hint">
          OpenCode is stored at <code>{agentWasmCredentialPaths.opencodeAuth}</code>; log in above to
          enable the sidebar chat.
        </p>
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
