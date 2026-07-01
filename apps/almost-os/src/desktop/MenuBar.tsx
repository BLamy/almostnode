import { useEffect, useState } from "react";
import { TailscaleMenu } from "../apps/tailscale/TailscaleMenu";
import { useNetwork } from "../apps/tailscale/use-network";
import { TailscaleGlyph } from "../os/icons";
import { useSystem } from "../os/system";
import { WifiMenu } from "./WifiMenu";

function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 15_000);
    return () => window.clearInterval(id);
  }, []);
  return now.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

interface MenuBarProps {
  activeApp: string;
  chatOpen: boolean;
  onToggleChat: () => void;
}

const APP_MENUS = ["File", "Edit", "View", "Window", "Help"];

export function MenuBar({ activeApp, chatOpen, onToggleChat }: MenuBarProps) {
  const clock = useClock();
  const system = useSystem();
  const net = useNetwork();
  const [tsOpen, setTsOpen] = useState(false);
  const [wifiOpen, setWifiOpen] = useState(false);
  return (
    <div className="os-menubar">
      <div className="os-menubar__left">
        <button type="button" className="os-menubar__apple" aria-label="Apple menu">
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path
              fill="currentColor"
              d="M16.3 12.6c0-2 1.6-3 1.7-3-1-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.2 2-1.4 2.4-.4 6 1 8 .6 1 1.4 2.1 2.4 2 1-.1 1.3-.6 2.5-.6s1.5.6 2.6.6c1.1 0 1.8-1 2.4-2 .8-1.1 1.1-2.2 1.1-2.3 0 0-2-.8-2-3.1zM14.6 6.3c.5-.7.9-1.6.8-2.5-.8 0-1.7.5-2.3 1.2-.5.6-.9 1.5-.8 2.4.9.1 1.8-.4 2.3-1.1z"
            />
          </svg>
        </button>
        <span className="os-menubar__app">{activeApp}</span>
        {APP_MENUS.map((m) => (
          <button key={m} type="button" className="os-menubar__menu">
            {m}
          </button>
        ))}
      </div>
      <div className="os-menubar__right">
        <button
          type="button"
          className={`os-menubar__status os-menubar__ts${tsOpen ? " is-active" : ""}`}
          onClick={() => setTsOpen((o) => !o)}
          aria-label={net.connected ? "Tailscale connected" : "Tailscale not connected"}
          title={net.connected ? "Tailscale connected" : "Tailscale not connected"}
        >
          <TailscaleGlyph />
          <span
            className={`os-menubar__ts-dot${net.connected ? " is-on" : " is-off"}`}
            aria-hidden="true"
          />
        </button>
        <span className="os-menubar__status" aria-label="Battery">
          <svg viewBox="0 0 28 14" width="24" height="12" aria-hidden="true">
            <rect x="1" y="2" width="22" height="10" rx="3" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.7" />
            <rect x="3" y="4" width="16" height="6" rx="1.5" fill="currentColor" />
            <rect x="24" y="5" width="2" height="4" rx="1" fill="currentColor" opacity="0.7" />
          </svg>
        </span>
        <button
          type="button"
          className={`os-menubar__status os-menubar__wifi${wifiOpen ? " is-active" : ""}`}
          onClick={() => setWifiOpen((o) => !o)}
          aria-label="Wi-Fi"
        >
          <svg viewBox="0 0 18 14" width="16" height="12" aria-hidden="true">
            <path d="M9 11.5l2.2-2.7a3.4 3.4 0 0 0-4.4 0L9 11.5z" fill="currentColor" />
            <path d="M3.4 5.6a8.6 8.6 0 0 1 11.2 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
            <path d="M5.6 8.1a5.2 5.2 0 0 1 6.8 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.85" />
          </svg>
        </button>
        <button
          type="button"
          className={`os-menubar__clock${chatOpen ? " is-active" : ""}`}
          onClick={onToggleChat}
          title="Open OpenCode"
        >
          {clock}
        </button>
      </div>
      {wifiOpen && (
        <WifiMenu
          onClose={() => setWifiOpen(false)}
          onOpenSettings={() => system.openApp("settings")}
        />
      )}
      {tsOpen && (
        <TailscaleMenu
          onClose={() => setTsOpen(false)}
          onOpenApp={() => {
            system.openApp("tailscale");
            setTsOpen(false);
          }}
        />
      )}
    </div>
  );
}
