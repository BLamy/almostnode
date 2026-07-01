import { useState } from "react";
import { useNetwork } from "./use-network";

interface TailscaleMenuProps {
  onClose: () => void;
  onOpenApp: () => void;
}

export function TailscaleMenu({ onClose, onOpenApp }: TailscaleMenuProps) {
  const { status, connected, busy, connect, disconnect, setExitNode } = useNetwork();
  const [showExitNodes, setShowExitNodes] = useState(false);
  const [showDevices, setShowDevices] = useState(false);

  const account = status?.tailnetName ?? "Not signed in";
  const initial = (account[0] ?? "?").toUpperCase();
  const device = status?.selfName ?? "this device";
  const exitNodes = status?.exitNodes ?? [];

  return (
    <>
      <div className="ts-scrim" onClick={onClose} />
      <div className="ts-menu" role="menu">
        <div className="ts-menu__head">
          <div>
            <div className="ts-menu__title">Tailscale</div>
            <div className="ts-menu__state">{connected ? "Connected" : "Not Connected"}</div>
          </div>
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

        <div className="ts-menu__divider" />

        <button type="button" className="ts-menu__account">
          <span className="ts-avatar">{initial}</span>
          <span className="ts-menu__account-text">
            <span className="ts-menu__account-name">{account}</span>
            <span className="ts-menu__account-sub">{account}</span>
          </span>
          <span className="ts-chevron">›</span>
        </button>

        <div className="ts-menu__divider" />

        <div className="ts-menu__device">
          This Device: <strong>{device}</strong>
        </div>

        <button type="button" className="ts-menu__row" onClick={() => setShowDevices((v) => !v)}>
          Network Devices
          <span className={`ts-chevron${showDevices ? " is-open" : ""}`}>›</span>
        </button>
        {showDevices && (
          <div className="ts-menu__sublist">
            <div className="ts-menu__subempty">
              {connected ? "No other devices on this tailnet." : "Connect to view devices."}
            </div>
          </div>
        )}

        <button type="button" className="ts-menu__row" onClick={() => setShowExitNodes((v) => !v)}>
          Exit Nodes
          <span className={`ts-chevron${showExitNodes ? " is-open" : ""}`}>›</span>
        </button>
        {showExitNodes && (
          <div className="ts-menu__sublist">
            <button
              type="button"
              className={`ts-menu__subrow${!status?.selectedExitNodeId ? " is-selected" : ""}`}
              onClick={() => setExitNode(null)}
            >
              None
            </button>
            {exitNodes.length === 0 && (
              <div className="ts-menu__subempty">No exit nodes available.</div>
            )}
            {exitNodes.map((node) => (
              <button
                key={node.id}
                type="button"
                className={`ts-menu__subrow${node.selected ? " is-selected" : ""}`}
                onClick={() => setExitNode(node.id)}
              >
                {node.name}
                {!node.online && <span className="ts-menu__offline">offline</span>}
              </button>
            ))}
          </div>
        )}

        <div className="ts-menu__divider" />

        <button type="button" className="ts-menu__row" onClick={onOpenApp}>
          Settings…
          <span className="ts-menu__shortcut">⌘,</span>
        </button>
        <button
          type="button"
          className="ts-menu__row"
          onClick={() => {
            onOpenApp();
            onClose();
          }}
        >
          Open Tailscale
        </button>

        <div className="ts-menu__divider" />

        <button type="button" className="ts-menu__row" onClick={onClose}>
          Quit
          <span className="ts-menu__shortcut">⌘Q</span>
        </button>
      </div>
    </>
  );
}
