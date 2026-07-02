import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useKeychain } from "../../keychain/keychain-store";
import {
  getOAuthOrchestrator,
  getOAuthRegistry,
} from "../../keychain/oauth-runtime";
import { useOsRuntime } from "../../runtime/OsRuntimeProvider";
import { useSystem } from "../../os/system";
import { useApprovalMode } from "../../os/approval-store";
import {
  connectWithDeviceCode,
  connectWithPopup,
  discoverService,
  type ExtendedDiscovery,
  type PopupAuthMethod,
} from "./executor-auth";
import type { DeviceCodePrompt } from "./device-code";
import { writeApiKeySecret, apiKeySlotName, apiKeySecretPath } from "./executor-secrets";
import {
  getExecutorStore,
  useExecutorState,
  type ApprovalRequest,
} from "./executor-store";
import type {
  ExecutorAuthMethod,
  ExecutorConnection,
  ExecutorSource,
  ExecutorToolDef,
} from "./executor-types";

type Panel = "catalog" | "codemode" | "runs";

const AUTH_METHODS: Array<{ id: ExecutorAuthMethod; label: string; blurb: string }> = [
  { id: "none", label: "No auth", blurb: "Public endpoint — no credentials." },
  { id: "api-key", label: "API key", blurb: "A static key sent in a header, sealed in the vault." },
  { id: "oauth-dcr", label: "OAuth · DCR", blurb: "Dynamic Client Registration (RFC 7591), then PKCE." },
  { id: "oauth-cimd", label: "OAuth · CIMD", blurb: "Client ID Metadata Document — no registration call." },
  { id: "oauth-client", label: "OAuth · client", blurb: "Paste a client_id (+ optional secret), PKCE." },
  { id: "oidc", label: "OIDC", blurb: "OpenID Connect — identity from the id_token." },
  { id: "oauth-device", label: "Device (CLI)", blurb: "RFC 8628 device grant — a code you approve." },
];

const SAMPLE_CODE = `// Code mode: write TypeScript against tools.<source>.<tool>().
// Secrets never enter this sandbox — auth is attached host-side.
const sources = await tools.executor.sources.list();
console.log("connected sources", sources);

// Discover, then call:
// const hits = await tools.search({ query: "issues" });
// const info = await tools.describe.tool({ path: hits[0].address });
// const res = await tools.<source>.<tool>({ /* args */ });
return sources;
`;

export function ExecutorApp() {
  const { workspace } = useOsRuntime();
  const { keychain, state: keychainState, refresh: refreshKeychain } = useKeychain();
  const system = useSystem();
  const approvalMode = useApprovalMode();
  const store = useMemo(() => getExecutorStore(), []);
  const state = useExecutorState();

  const [panel, setPanel] = useState<Panel>("catalog");
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [addingSource, setAddingSource] = useState(false);
  const [connectingSourceId, setConnectingSourceId] = useState<string | null>(null);
  const [pendingApproval, setPendingApproval] = useState<{
    request: ApprovalRequest;
    resolve: (ok: boolean) => void;
  } | null>(null);

  // Route policy-gated tool calls to an in-app approval sheet.
  useEffect(() => {
    store.setApprovalHandler(
      (request) =>
        new Promise<boolean>((resolve) => {
          setPendingApproval({ request, resolve });
        }),
    );
    return () => store.setApprovalHandler(null);
  }, [store]);

  const selectedSource = state.sources.find((source) => source.id === selectedSourceId) ?? null;
  const connectingSource = state.sources.find((source) => source.id === connectingSourceId) ?? null;

  return (
    <div className="executor">
      <aside className="executor__sidebar">
        <div className="executor__brand">
          <span className="executor__brand-mark">›_</span>
          <div>
            <div className="executor__brand-name">executor.sh</div>
            <div className="executor__brand-sub">connect the AI to everything</div>
          </div>
        </div>

        <nav className="executor__nav">
          <button
            type="button"
            className={`executor__nav-item${panel === "catalog" ? " is-active" : ""}`}
            onClick={() => setPanel("catalog")}
          >
            Sources & tools
          </button>
          <button
            type="button"
            className={`executor__nav-item${panel === "codemode" ? " is-active" : ""}`}
            onClick={() => setPanel("codemode")}
          >
            Code mode
          </button>
          <button
            type="button"
            className={`executor__nav-item${panel === "runs" ? " is-active" : ""}`}
            onClick={() => setPanel("runs")}
          >
            Run log{state.runs.length > 0 ? ` (${state.runs.length})` : ""}
          </button>
        </nav>

        <div className="executor__sources">
          <div className="executor__sources-head">
            <span>Sources</span>
            <button
              type="button"
              className="executor__icon-btn"
              onClick={() => setAddingSource(true)}
              title="Add source"
            >
              +
            </button>
          </div>
          {state.sources.length === 0 && (
            <p className="executor__empty">No sources yet. Add an OpenAPI spec or MCP server.</p>
          )}
          {state.sources.map((source) => {
            const connection = store.connectionForSource(source.id);
            const connected = connection
              ? store.connectionStatus(connection) === "connected"
              : false;
            return (
              <button
                type="button"
                key={source.id}
                className={`executor__source${
                  selectedSourceId === source.id && panel === "catalog" ? " is-active" : ""
                }`}
                onClick={() => {
                  setSelectedSourceId(source.id);
                  setPanel("catalog");
                }}
              >
                <span className={`executor__dot executor__dot--${source.kind}`} />
                <span className="executor__source-label">{source.label}</span>
                <span
                  className={`executor__conn-dot${connected ? " is-on" : ""}`}
                  title={connected ? "connected" : "no connection"}
                />
              </button>
            );
          })}
        </div>

        <div className="executor__vault">
          <span className={`executor__vault-dot${keychainState.hasUnlockedKey ? " is-on" : ""}`} />
          {keychainState.hasUnlockedKey
            ? "Vault unlocked"
            : keychainState.bannerMode === "unlock"
              ? "Vault locked"
              : "Vault"}
          <button
            type="button"
            className="executor__link"
            onClick={() => system.openApp("keychain")}
          >
            Keychain
          </button>
        </div>
      </aside>

      <main className="executor__main">
        {panel === "catalog" && (
          <CatalogPanel
            source={selectedSource}
            tools={selectedSource ? state.toolsBySource[selectedSource.id] ?? [] : []}
            syncing={selectedSource ? state.syncing[selectedSource.id] === true : false}
            connection={selectedSource ? store.connectionForSource(selectedSource.id) ?? null : null}
            connectionStatus={(conn) => store.connectionStatus(conn)}
            onSync={() => selectedSource && void store.syncSource(selectedSource.id)}
            onConnect={() => selectedSource && setConnectingSourceId(selectedSource.id)}
            onRemoveSource={() => {
              if (selectedSource) {
                store.removeSource(selectedSource.id);
                setSelectedSourceId(null);
              }
            }}
            onDisconnect={(conn) => {
              store.removeConnection(conn.id);
              refreshKeychain();
            }}
            onSetPolicy={(policy) =>
              selectedSource && store.setSourcePolicy(selectedSource.id, policy)
            }
            onAddSource={() => setAddingSource(true)}
          />
        )}
        {panel === "codemode" && (
          <CodeModePanel approvalMode={approvalMode} />
        )}
        {panel === "runs" && <RunsPanel />}
      </main>

      {addingSource && (
        <AddSourceModal
          onClose={() => setAddingSource(false)}
          onAdd={(params) => {
            const source = store.addSource(params);
            setSelectedSourceId(source.id);
            setPanel("catalog");
            setAddingSource(false);
          }}
        />
      )}

      {connectingSource && (
        <ConnectModal
          source={connectingSource}
          vfs={workspace.vfs}
          keychain={keychain}
          onClose={() => setConnectingSourceId(null)}
          onConnected={() => {
            setConnectingSourceId(null);
            refreshKeychain();
            void store.syncSource(connectingSource.id);
          }}
        />
      )}

      {pendingApproval && (
        <ApprovalSheet
          request={pendingApproval.request}
          onDecide={(ok) => {
            pendingApproval.resolve(ok);
            setPendingApproval(null);
          }}
        />
      )}
    </div>
  );
}

// ── catalog ──────────────────────────────────────────────────────────────────

function CatalogPanel({
  source,
  tools,
  syncing,
  connection,
  connectionStatus,
  onSync,
  onConnect,
  onRemoveSource,
  onDisconnect,
  onSetPolicy,
  onAddSource,
}: {
  source: ExecutorSource | null;
  tools: ExecutorToolDef[];
  syncing: boolean;
  connection: ExecutorConnection | null;
  connectionStatus: (conn: ExecutorConnection) => string;
  onSync: () => void;
  onConnect: () => void;
  onRemoveSource: () => void;
  onDisconnect: (conn: ExecutorConnection) => void;
  onSetPolicy: (policy: ExecutorSource["policy"]) => void;
  onAddSource: () => void;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  if (!source) {
    return (
      <div className="executor__placeholder">
        <h2>Sources & tools</h2>
        <p>
          Add an <strong>OpenAPI</strong> spec or an <strong>MCP</strong> server, connect it with the
          right auth, and every operation becomes a typed tool the AI can call in code mode.
        </p>
        <button type="button" className="executor__btn executor__btn--primary" onClick={onAddSource}>
          Add a source
        </button>
      </div>
    );
  }

  return (
    <div className="executor__catalog">
      <header className="executor__catalog-head">
        <div>
          <h2>{source.label}</h2>
          <p className="executor__mono">{source.url}</p>
        </div>
        <div className="executor__catalog-actions">
          <button type="button" className="executor__btn" onClick={onSync} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync"}
          </button>
          {connection && connectionStatus(connection) === "connected" ? (
            <button
              type="button"
              className="executor__btn"
              onClick={() => onDisconnect(connection)}
            >
              Disconnect
            </button>
          ) : (
            <button type="button" className="executor__btn executor__btn--primary" onClick={onConnect}>
              Connect
            </button>
          )}
          <button type="button" className="executor__btn executor__btn--danger" onClick={onRemoveSource}>
            Remove
          </button>
        </div>
      </header>

      <div className="executor__meta-row">
        <span className={`executor__tag executor__tag--${source.kind}`}>{source.kind.toUpperCase()}</span>
        {connection && (
          <span className="executor__tag">
            {connection.method} · {connectionStatus(connection)}
          </span>
        )}
        <label className="executor__policy">
          Policy
          <select
            value={source.policy}
            onChange={(event) => onSetPolicy(event.target.value as ExecutorSource["policy"])}
          >
            <option value="allow">Allow</option>
            <option value="require_approval">Require approval</option>
            <option value="block">Block</option>
          </select>
        </label>
        <span className="executor__count">{tools.length} tools</span>
      </div>

      {source.syncError && <p className="executor__error">{source.syncError}</p>}

      <div className="executor__tools">
        {tools.length === 0 && !syncing && (
          <p className="executor__empty">
            No tools yet. {source.kind === "mcp" ? "Connect, then Sync." : "Sync to load the spec."}
          </p>
        )}
        {tools.map((tool) => (
          <div key={tool.address} className="executor__tool">
            <button
              type="button"
              className="executor__tool-head"
              onClick={() => setExpanded(expanded === tool.address ? null : tool.address)}
            >
              <code className="executor__tool-name">{tool.name}</code>
              {tool.http && (
                <span className="executor__method">{tool.http.method}</span>
              )}
              <span className="executor__tool-desc">
                {tool.description?.split("\n")[0] ?? ""}
              </span>
            </button>
            {expanded === tool.address && (
              <pre className="executor__tool-sig">{describeText(tool.address)}</pre>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function describeText(address: string): string {
  const described = getExecutorStore().describeTool(address);
  return "typescript" in described ? described.typescript : described.error;
}

// ── code mode ────────────────────────────────────────────────────────────────

function CodeModePanel({ approvalMode }: { approvalMode: string }) {
  const store = getExecutorStore();
  const state = useExecutorState();
  const [code, setCode] = useState(SAMPLE_CODE);
  const lastRun = state.runs[0] ?? null;

  return (
    <div className="executor__codemode">
      <header className="executor__catalog-head">
        <div>
          <h2>Code mode</h2>
          <p>
            The model writes TypeScript against <code>tools.*</code> in a QuickJS sandbox —{" "}
            <code>fetch</code> is disabled, secrets stay host-side.
          </p>
        </div>
        <div className="executor__catalog-actions">
          <span className="executor__tag">approval: {approvalMode}</span>
          <button
            type="button"
            className="executor__btn executor__btn--primary"
            disabled={state.executing}
            onClick={() => void store.execute(code)}
          >
            {state.executing ? "Running…" : "Run ▶"}
          </button>
        </div>
      </header>

      <textarea
        className="executor__editor"
        value={code}
        spellCheck={false}
        onChange={(event) => setCode(event.target.value)}
      />

      {lastRun && (
        <div className="executor__result">
          <div className={`executor__result-head is-${lastRun.status}`}>
            {lastRun.status === "ok" ? "✓ returned" : "✗ error"} · {lastRun.durationMs}ms ·{" "}
            {lastRun.toolCalls.length} tool call(s)
          </div>
          {lastRun.logs.map((entry, index) => (
            <div key={index} className={`executor__log executor__log--${entry.level}`}>
              {entry.text}
            </div>
          ))}
          {lastRun.errorMessage && <pre className="executor__log executor__log--error">{lastRun.errorMessage}</pre>}
          {lastRun.status === "ok" && <pre className="executor__json">{lastRun.resultPreview}</pre>}
        </div>
      )}
    </div>
  );
}

function RunsPanel() {
  const state = useExecutorState();
  if (state.runs.length === 0) {
    return (
      <div className="executor__placeholder">
        <h2>Run log</h2>
        <p>Every code-mode execution is recorded here with its tool calls and result.</p>
      </div>
    );
  }
  return (
    <div className="executor__runs">
      <h2>Run log</h2>
      {state.runs.map((run) => (
        <details key={run.id} className="executor__run">
          <summary>
            <span className={`executor__run-status is-${run.status}`}>
              {run.status === "ok" ? "✓" : "✗"}
            </span>
            <span className="executor__run-time">{new Date(run.startedAt).toLocaleTimeString()}</span>
            <span>{run.durationMs}ms</span>
            <span>{run.toolCalls.length} calls</span>
          </summary>
          <pre className="executor__json">{run.code}</pre>
          {run.toolCalls.map((call, index) => (
            <div key={index} className={`executor__call${call.ok ? "" : " is-error"}`}>
              <code>{call.path}</code> · {call.durationMs}ms {call.error ? `· ${call.error}` : ""}
            </div>
          ))}
          {run.errorMessage && <pre className="executor__log executor__log--error">{run.errorMessage}</pre>}
          {run.status === "ok" && <pre className="executor__json">{run.resultPreview}</pre>}
        </details>
      ))}
    </div>
  );
}

// ── add source ───────────────────────────────────────────────────────────────

function AddSourceModal({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd: (params: { kind: ExecutorSource["kind"]; label: string; url: string; serverUrl?: string }) => void;
}) {
  const [kind, setKind] = useState<ExecutorSource["kind"]>("openapi");
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [serverUrl, setServerUrl] = useState("");

  return (
    <ModalShell title="Add source" onClose={onClose}>
      <div className="executor__field">
        <span>Type</span>
        <div className="executor__seg">
          <button
            type="button"
            className={kind === "openapi" ? "is-active" : ""}
            onClick={() => setKind("openapi")}
          >
            OpenAPI
          </button>
          <button
            type="button"
            className={kind === "mcp" ? "is-active" : ""}
            onClick={() => setKind("mcp")}
          >
            MCP server
          </button>
        </div>
      </div>
      <label className="executor__field">
        <span>Name</span>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="GitHub" />
      </label>
      <label className="executor__field">
        <span>{kind === "openapi" ? "OpenAPI document URL" : "MCP endpoint URL"}</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={
            kind === "openapi"
              ? "https://api.example.com/openapi.json"
              : "https://mcp.example.com/mcp"
          }
        />
      </label>
      {kind === "openapi" && (
        <label className="executor__field">
          <span>Base URL (optional — overrides servers[0])</span>
          <input
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            placeholder="https://api.example.com"
          />
        </label>
      )}
      <div className="executor__modal-actions">
        <button type="button" className="executor__btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="executor__btn executor__btn--primary"
          disabled={!url.trim()}
          onClick={() =>
            onAdd({
              kind,
              label: label.trim() || url.trim(),
              url: url.trim(),
              serverUrl: serverUrl.trim() || undefined,
            })
          }
        >
          Add & sync
        </button>
      </div>
    </ModalShell>
  );
}

// ── connect ──────────────────────────────────────────────────────────────────

function ConnectModal({
  source,
  vfs,
  keychain,
  onClose,
  onConnected,
}: {
  source: ExecutorSource;
  vfs: ReturnType<typeof useOsRuntime>["workspace"]["vfs"];
  keychain: ReturnType<typeof useKeychain>["keychain"];
  onClose: () => void;
  onConnected: () => void;
}) {
  const store = getExecutorStore();
  const [method, setMethod] = useState<ExecutorAuthMethod>(
    source.kind === "mcp" ? "oauth-dcr" : "api-key",
  );
  const [discoveryUrl, setDiscoveryUrl] = useState(source.url);
  const [discovery, setDiscovery] = useState<ExtendedDiscovery | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [devicePrompt, setDevicePrompt] = useState<DeviceCodePrompt | null>(null);

  const [scopes, setScopes] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [displayName, setDisplayName] = useState(source.label);

  // api-key
  const [headerName, setHeaderName] = useState("Authorization");
  const [prefix, setPrefix] = useState("Bearer ");
  const [apiKey, setApiKey] = useState("");

  const isOAuth = method.startsWith("oauth") || method === "oidc";
  const popupRef = useRef<Window | null>(null);

  const keychainSeam = useMemo(
    () => ({
      registerSlot: (name: string, paths: string[]) => keychain.registerSlot(name, paths),
      hasSlotData: (name: string) => keychain.hasSlotData(name),
      notifyExternalStateChanged: () => keychain.notifyExternalStateChanged(),
    }),
    [keychain],
  );

  const runDiscovery = useCallback(async () => {
    setDiscovering(true);
    setError(null);
    try {
      setDiscovery(await discoverService(discoveryUrl));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setDiscovery(null);
    } finally {
      setDiscovering(false);
    }
  }, [discoveryUrl]);

  const scopeList = () =>
    scopes
      .split(/[\s,]+/)
      .map((scope) => scope.trim())
      .filter(Boolean);

  const finishOAuth = (serviceId: string, identity?: ExecutorConnection["identity"]) => {
    const connection: ExecutorConnection = {
      id: `conn_${source.id}_${Date.now().toString(36)}`,
      sourceId: source.id,
      name: "default",
      method,
      oauthServiceId: serviceId,
      identity,
      addedAt: new Date().toISOString(),
    };
    store.addConnection(connection);
    // Keep the OS-wide orchestrator's refresh loop aware of the new service.
    getOAuthOrchestrator();
    onConnected();
  };

  const handleConnect = () => {
    setError(null);

    if (method === "none") {
      store.addConnection({
        id: `conn_${source.id}_${Date.now().toString(36)}`,
        sourceId: source.id,
        name: "default",
        method: "none",
        addedAt: new Date().toISOString(),
      });
      onConnected();
      return;
    }

    if (method === "api-key") {
      if (!apiKey.trim()) {
        setError("Enter the API key.");
        return;
      }
      const connectionId = `conn_${source.id}_${Date.now().toString(36)}`;
      // Register the slot BEFORE the write so the keychain watcher accepts it.
      keychain.registerSlot(apiKeySlotName(connectionId), [apiKeySecretPath(connectionId)]);
      writeApiKeySecret(vfs, {
        version: 1,
        connectionId,
        headerName: headerName.trim() || "Authorization",
        prefix: prefix || undefined,
        key: apiKey.trim(),
      });
      keychain.notifyExternalStateChanged();
      store.addConnection({
        id: connectionId,
        sourceId: source.id,
        name: "default",
        method: "api-key",
        apiKey: { headerName: headerName.trim() || "Authorization", prefix: prefix || undefined },
        addedAt: new Date().toISOString(),
      });
      onConnected();
      return;
    }

    if (!discovery) {
      setError("Run discovery first.");
      return;
    }

    // OAuth popup methods must open the window synchronously, here.
    if (method === "oauth-dcr" || method === "oauth-cimd" || method === "oauth-client" || method === "oidc") {
      const placeholder =
        typeof window !== "undefined"
          ? window.open(
              "about:blank",
              "almostos-oauth",
              "popup=yes,width=520,height=720,resizable=yes,scrollbars=yes",
            )
          : null;
      popupRef.current = placeholder;
      setBusy(true);
      void connectWithPopup({
        vfs,
        registry: getOAuthRegistry(),
        keychain: keychainSeam,
        discovery,
        method: method as PopupAuthMethod,
        displayName,
        scopes: scopeList(),
        clientId: clientId.trim() || undefined,
        clientSecret: clientSecret.trim() || undefined,
        openPopup: (targetUrl) => {
          if (placeholder && !placeholder.closed) {
            placeholder.location.href = targetUrl;
            return placeholder;
          }
          return typeof window !== "undefined"
            ? window.open(targetUrl, "almostos-oauth", "popup=yes,width=520,height=720")
            : null;
        },
      })
        .then((result) => finishOAuth(result.service.id, result.identity))
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
          try {
            placeholder?.close();
          } catch {
            /* ignore */
          }
        })
        .finally(() => setBusy(false));
      return;
    }

    if (method === "oauth-device") {
      setBusy(true);
      void connectWithDeviceCode({
        vfs,
        registry: getOAuthRegistry(),
        keychain: keychainSeam,
        discovery,
        displayName,
        scopes: scopeList(),
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim() || undefined,
        onPrompt: (prompt) => setDevicePrompt(prompt),
      })
        .then((result) => finishOAuth(result.service.id))
        .catch((err) => setError(err instanceof Error ? err.message : String(err)))
        .finally(() => {
          setBusy(false);
          setDevicePrompt(null);
        });
    }
  };

  return (
    <ModalShell title={`Connect ${source.label}`} onClose={onClose}>
      <div className="executor__field">
        <span>Auth method</span>
        <div className="executor__methods">
          {AUTH_METHODS.map((entry) => (
            <button
              type="button"
              key={entry.id}
              className={`executor__method-card${method === entry.id ? " is-active" : ""}`}
              onClick={() => setMethod(entry.id)}
            >
              <strong>{entry.label}</strong>
              <span>{entry.blurb}</span>
            </button>
          ))}
        </div>
      </div>

      {method === "api-key" && (
        <>
          <label className="executor__field">
            <span>Header name</span>
            <input value={headerName} onChange={(e) => setHeaderName(e.target.value)} />
          </label>
          <label className="executor__field">
            <span>Value prefix</span>
            <input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder="Bearer " />
          </label>
          <label className="executor__field">
            <span>API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="sk-…"
            />
          </label>
          <p className="executor__hint">
            Stored at <code>{apiKeySecretPath("<id>")}</code> and sealed into the passkey vault.
          </p>
        </>
      )}

      {isOAuth && (
        <>
          <label className="executor__field">
            <span>Discovery URL (resource or issuer)</span>
            <div className="executor__inline">
              <input value={discoveryUrl} onChange={(e) => setDiscoveryUrl(e.target.value)} />
              <button
                type="button"
                className="executor__btn"
                onClick={() => void runDiscovery()}
                disabled={discovering}
              >
                {discovering ? "…" : "Discover"}
              </button>
            </div>
          </label>

          {discovery && (
            <div className="executor__discovery">
              <div>
                issuer <code>{discovery.preview.issuer}</code>
              </div>
              <div className="executor__caps">
                {discovery.preview.supportsDynamicRegistration && <span className="executor__tag">DCR</span>}
                {discovery.deviceAuthorizationEndpoint && <span className="executor__tag">device</span>}
                {discovery.supportsCimd && <span className="executor__tag">CIMD</span>}
              </div>
            </div>
          )}

          <label className="executor__field">
            <span>Scopes (space-separated)</span>
            <input value={scopes} onChange={(e) => setScopes(e.target.value)} placeholder="read write" />
          </label>

          {(method === "oauth-client"
            || method === "oidc"
            || method === "oauth-device") && (
            <>
              <label className="executor__field">
                <span>
                  client_id{method === "oidc" ? " (optional — DCR if blank)" : ""}
                </span>
                <input value={clientId} onChange={(e) => setClientId(e.target.value)} />
              </label>
              <label className="executor__field">
                <span>client_secret (optional)</span>
                <input
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                />
              </label>
            </>
          )}

          {devicePrompt && (
            <div className="executor__device">
              <div>
                Go to{" "}
                <a href={devicePrompt.verificationUri} target="_blank" rel="noreferrer">
                  {devicePrompt.verificationUri}
                </a>{" "}
                and enter:
              </div>
              <div className="executor__usercode">{devicePrompt.userCode}</div>
              <div className="executor__hint">Waiting for approval…</div>
            </div>
          )}
        </>
      )}

      {error && <p className="executor__error">{error}</p>}

      <div className="executor__modal-actions">
        <button type="button" className="executor__btn" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="executor__btn executor__btn--primary"
          disabled={busy || (isOAuth && !discovery && method !== "api-key")}
          onClick={handleConnect}
        >
          {busy ? "Connecting…" : "Connect"}
        </button>
      </div>
    </ModalShell>
  );
}

// ── approval sheet ───────────────────────────────────────────────────────────

function ApprovalSheet({
  request,
  onDecide,
}: {
  request: ApprovalRequest;
  onDecide: (ok: boolean) => void;
}) {
  return (
    <div className="executor__approval-backdrop">
      <div className="executor__approval">
        <h3>Approve tool call?</h3>
        <p>
          The sandbox wants to call <code>{request.path}</code>.
        </p>
        <pre className="executor__json">{request.argsPreview}</pre>
        <div className="executor__modal-actions">
          <button type="button" className="executor__btn executor__btn--danger" onClick={() => onDecide(false)}>
            Deny
          </button>
          <button type="button" className="executor__btn executor__btn--primary" onClick={() => onDecide(true)}>
            Approve
          </button>
        </div>
      </div>
    </div>
  );
}

// ── shared modal shell ───────────────────────────────────────────────────────

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="executor__backdrop" onClick={onClose}>
      <div className="executor__modal" onClick={(event) => event.stopPropagation()}>
        <header className="executor__modal-head">
          <h2>{title}</h2>
          <button type="button" className="executor__icon-btn" onClick={onClose}>
            ✕
          </button>
        </header>
        <div className="executor__modal-body">{children}</div>
      </div>
    </div>
  );
}
