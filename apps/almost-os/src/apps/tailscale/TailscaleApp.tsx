import { setBackend, setControlUrl, useTailscaleConfig } from "./tailscale-config";
import { useNetwork } from "./use-network";

export function TailscaleApp() {
  const { status, connected, busy, connect, disconnect, setExitNode } = useNetwork();
  const config = useTailscaleConfig();
  const account = status?.tailnetName ?? "Not signed in";
  const initial = (account[0] ?? "?").toUpperCase();
  const device = status?.selfName ?? "this device";
  const exitNodes = status?.exitNodes ?? [];

  return (
    <div className="ts-app">
      <header className="ts-app__header">
        <span className="ts-avatar ts-avatar--lg">{initial}</span>
        <div className="ts-app__id">
          <div className="ts-app__account">{account}</div>
          <div className="ts-app__sub">{device}</div>
        </div>
        <div className="ts-app__conn">
          <span className={`ts-app__dot${connected ? " is-on" : ""}`} />
          <span>{connected ? "Connected" : "Not Connected"}</span>
          <button
            type="button"
            className={`ts-switch${connected ? " is-on" : ""}`}
            disabled={busy}
            onClick={() => (connected ? disconnect() : connect())}
            aria-label={connected ? "Disconnect" : "Connect"}
          >
            <span className="ts-switch__knob" />
          </button>
        </div>
      </header>

      <section className="ts-app__section">
        <h3>Connection</h3>
        <div className="ts-app__modes">
          <button
            type="button"
            className={`ts-app__mode${config.backend === "official" ? " is-active" : ""}`}
            onClick={() => setBackend("official")}
          >
            Official Tailscale
          </button>
          <button
            type="button"
            className={`ts-app__mode${config.backend === "wireguard" ? " is-active" : ""}`}
            onClick={() => setBackend("wireguard")}
          >
            WireGuard
          </button>
        </div>
        {config.backend === "wireguard" && (
          <input
            className="ts-app__control-url"
            value={config.controlUrl}
            onChange={(e) => setControlUrl(e.target.value)}
            placeholder="https://headscale.example.com (control server)"
            spellCheck={false}
          />
        )}
        <p className="ts-muted ts-app__hint">
          {config.backend === "official"
            ? "Signs in to your Tailscale account at login.tailscale.com."
            : "Connects to your own WireGuard / Headscale control server."}{" "}
          When off, traffic routes through the CORS proxy.
        </p>
      </section>

      <section className="ts-app__section">
        <h3>This device</h3>
        <div className="ts-app__card">
          <strong>{device}</strong>
          <span className="ts-muted">
            {connected ? "Online" : "Offline"}
            {status?.state ? ` · ${status.state}` : ""}
          </span>
        </div>
      </section>

      <section className="ts-app__section">
        <h3>Exit nodes</h3>
        <div className="ts-app__list">
          <button
            type="button"
            className={`ts-app__listrow${!status?.selectedExitNodeId ? " is-selected" : ""}`}
            onClick={() => setExitNode(null)}
          >
            None
          </button>
          {exitNodes.length === 0 && (
            <div className="ts-app__empty ts-muted">
              No exit nodes available{connected ? "" : " — connect first"}.
            </div>
          )}
          {exitNodes.map((node) => (
            <button
              key={node.id}
              type="button"
              className={`ts-app__listrow${node.selected ? " is-selected" : ""}`}
              onClick={() => setExitNode(node.id)}
            >
              {node.name}
              <span className="ts-muted">{node.online ? "online" : "offline"}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="ts-app__section">
        <h3>Status</h3>
        <p className="ts-muted ts-app__status">
          {status?.detail ??
            (connected
              ? "Tailscale is running on this tailnet."
              : "Use the toggle to connect. In-browser connect needs a configured control server (Headscale/Tailscale auth) — the menu-bar toggle calls the runtime's network controller.")}
        </p>
      </section>
    </div>
  );
}
