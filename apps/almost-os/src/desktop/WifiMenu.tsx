import {
  NETWORK_OPTIONS,
  useNetworkSummary,
  type NetworkKind,
} from "../os/network-summary";

interface WifiMenuProps {
  onClose: () => void;
  onOpenSettings: () => void;
}

export function WifiMenu({ onClose, onOpenSettings }: WifiMenuProps) {
  const { activeKind, activeLabel, connecting, net, select } = useNetworkSummary();

  return (
    <>
      <div className="ts-scrim" onClick={onClose} />
      <div className="wifi-menu" role="menu">
        <div className="wifi-menu__head">Network</div>
        <div className="wifi-menu__current">
          <span className={`settings__dot${connecting ? " is-warn" : " is-on"}`} />
          <div>
            <div className="wifi-menu__label">
              {connecting ? "Connecting…" : `Connected: ${activeLabel}`}
            </div>
            <div className="wifi-menu__sub">
              {net.status?.detail ??
                (activeKind === "proxy"
                  ? "Routing through the CORS proxy"
                  : "Routing over your tailnet")}
            </div>
          </div>
        </div>

        <div className="ts-menu__divider" />

        {NETWORK_OPTIONS.map((opt) => (
          <button
            key={opt.kind}
            type="button"
            className={`wifi-menu__row${activeKind === opt.kind ? " is-active" : ""}`}
            disabled={net.busy}
            onClick={() => void select(opt.kind as NetworkKind)}
          >
            <span className="wifi-menu__check">{activeKind === opt.kind ? "✓" : ""}</span>
            {opt.label}
          </button>
        ))}

        <div className="ts-menu__divider" />

        <button
          type="button"
          className="ts-menu__row"
          onClick={() => {
            onOpenSettings();
            onClose();
          }}
        >
          Network Settings…
        </button>
      </div>
    </>
  );
}
