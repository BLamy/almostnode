import { useEffect, useMemo, useState } from "react";
import {
  ACCENTS,
  WALLPAPERS,
  setAccent,
  setMode,
  setVolume,
  setWallpaper,
  useAppearance,
  type AppearanceMode,
} from "../../os/appearance";
import {
  NETWORK_OPTIONS,
  useNetworkSummary,
  type NetworkKind,
} from "../../os/network-summary";

interface SidebarItem {
  id: string;
  name: string;
  emoji: string;
  bg: string;
}

const SECTIONS: SidebarItem[][] = [
  [
    { id: "wifi", name: "Wi-Fi", emoji: "📶", bg: "#2f7bff" },
    { id: "network", name: "Network", emoji: "🌐", bg: "#2f7bff" },
    { id: "vpn", name: "VPN", emoji: "🔑", bg: "#2f7bff" },
    { id: "battery", name: "Battery", emoji: "🔋", bg: "#34c759" },
  ],
  [
    { id: "general", name: "General", emoji: "⚙️", bg: "#8e8e93" },
    { id: "appearance", name: "Appearance", emoji: "🌗", bg: "#1c1c1e" },
    { id: "displays", name: "Displays", emoji: "🖥️", bg: "#2f7bff" },
    { id: "menubar", name: "Menu Bar", emoji: "▤", bg: "#1c1c1e" },
    { id: "wallpaper", name: "Wallpaper", emoji: "🖼️", bg: "#30c8c8" },
  ],
  [
    { id: "sound", name: "Sound", emoji: "🔊", bg: "#ff2d55" },
    { id: "notifications", name: "Notifications", emoji: "🔔", bg: "#ff3b30" },
  ],
];

const ALL_ITEMS = SECTIONS.flat();

export function SystemSettingsApp() {
  const [pane, setPane] = useState("wifi");
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.map((s) => s.filter((i) => i.name.toLowerCase().includes(q))).filter(
      (s) => s.length,
    );
  }, [query]);

  const active = ALL_ITEMS.find((i) => i.id === pane);

  return (
    <div className="settings">
      <aside className="settings__sidebar">
        <div className="settings__search">
          <span className="settings__search-icon">🔍</span>
          <input
            className="settings__search-input"
            placeholder="Search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {filtered.map((section, i) => (
          <div className="settings__group" key={i}>
            {section.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`settings__nav${pane === item.id ? " is-active" : ""}`}
                onClick={() => setPane(item.id)}
              >
                <span className="settings__nav-icon" style={{ background: item.bg }}>
                  {item.emoji}
                </span>
                {item.name}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <main className="settings__main">
        <div className="settings__toolbar">
          <button type="button" className="settings__back" aria-label="Back" disabled>
            ‹
          </button>
          <button type="button" className="settings__back" aria-label="Forward" disabled>
            ›
          </button>
          <h1 className="settings__title">{active?.name ?? "Settings"}</h1>
        </div>
        <div className="settings__content">
          {pane === "wifi" || pane === "network" ? (
            <WifiPane />
          ) : pane === "general" ? (
            <GeneralPane />
          ) : pane === "appearance" ? (
            <AppearancePane />
          ) : pane === "wallpaper" ? (
            <WallpaperPane />
          ) : pane === "displays" ? (
            <DisplaysPane />
          ) : pane === "sound" ? (
            <SoundPane />
          ) : (
            <PlaceholderPane title={active?.name ?? ""} />
          )}
        </div>
      </main>
    </div>
  );
}

function WifiPane() {
  const summary = useNetworkSummary();
  const { activeKind, activeLabel, connecting, net, controlUrl, setControlUrl, select } = summary;

  return (
    <>
      <div className="settings__card settings__wifi-head">
        <span className="settings__wifi-icon">📶</span>
        <div className="settings__wifi-text">
          <div className="settings__row-title">Network</div>
          <p>
            AlmostOS routes traffic through the built-in CORS proxy by default, or over your
            tailnet when Tailscale is connected.
          </p>
        </div>
        <button
          type="button"
          className={`ts-switch${activeKind !== "proxy" ? " is-on" : ""}`}
          disabled={net.busy}
          aria-label={activeKind === "proxy" ? "Turn Tailscale on" : "Turn Tailscale off"}
          onClick={() => void select(activeKind === "proxy" ? "official" : "proxy")}
        >
          <span className="ts-switch__knob" />
        </button>
      </div>

      <div className="settings__card">
        <div className="settings__wifi-current">
          <div>
            <div className="settings__row-title">{activeLabel}</div>
            <div className="settings__row-status">
              <span className={`settings__dot${connecting ? " is-warn" : " is-on"}`} />
              {connecting ? "Connecting…" : "Connected"}
            </div>
          </div>
          <span className="settings__wifi-glyphs">🔒 📶</span>
        </div>
      </div>

      <div className="settings__section-title">Networks</div>
      <div className="settings__card settings__list">
        {NETWORK_OPTIONS.map((opt) => (
          <button
            key={opt.kind}
            type="button"
            className="settings__net-row"
            onClick={() => void select(opt.kind as NetworkKind)}
            disabled={net.busy}
          >
            <span className="settings__net-check">{activeKind === opt.kind ? "✓" : ""}</span>
            <span className="settings__net-text">
              <span className="settings__row-title">{opt.label}</span>
              <span className="settings__net-desc">{opt.description}</span>
            </span>
            <span className="settings__wifi-glyphs">
              {opt.kind === "proxy" ? "🛡" : "🔒"} 📶
            </span>
          </button>
        ))}
      </div>

      {(activeKind === "headscale" || summary.net.status?.provider === "tailscale") && (
        <>
          <div className="settings__section-title">Headscale control server</div>
          <div className="settings__card">
            <input
              className="settings__control-url"
              value={controlUrl}
              onChange={(e) => setControlUrl(e.target.value)}
              placeholder="https://headscale.example.com"
              spellCheck={false}
            />
          </div>
        </>
      )}

      <p className="settings__hint">
        Selecting Official Tailscale or Headscale opens a sign-in window and establishes a
        WireGuard tunnel; CORS Proxy is the default off state.
      </p>
    </>
  );
}

function GeneralPane() {
  return (
    <>
      <div className="settings__section-title">About</div>
      <div className="settings__card settings__list">
        <Row label="Name" value="AlmostOS" />
        <Row label="Runtime" value="almostnode (Node.js in the browser)" />
        <Row label="Chip" value="WebAssembly" />
        <Row label="Version" value="0.1.0" />
      </div>
      <p className="settings__hint">A macOS-style desktop running entirely in your browser.</p>
    </>
  );
}

const MODES: { id: AppearanceMode; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "auto", label: "Auto" },
];

function AppearancePane() {
  const { accent, mode } = useAppearance();
  return (
    <>
      <div className="settings__section-title">Appearance</div>
      <div className="settings__card settings__appearance-modes">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`settings__mode${mode === m.id ? " is-active" : ""}`}
            onClick={() => setMode(m.id)}
          >
            <span className={`settings__mode-swatch settings__mode-swatch--${m.id}`} />
            {m.label}
          </button>
        ))}
      </div>

      <div className="settings__section-title">Accent color</div>
      <div className="settings__card settings__accent-row">
        {ACCENTS.map((a) => (
          <button
            key={a.id}
            type="button"
            className={`settings__accent${accent === a.id ? " is-active" : ""}`}
            style={{ background: a.color }}
            aria-label={a.name}
            title={a.name}
            onClick={() => setAccent(a.id)}
          >
            {accent === a.id ? "✓" : ""}
          </button>
        ))}
      </div>
      <p className="settings__hint">
        The accent color tints selections, toggles, and controls across AlmostOS. Auto follows
        your browser’s light/dark preference.
      </p>
    </>
  );
}

function WallpaperPane() {
  const { wallpaper } = useAppearance();
  const current = WALLPAPERS.find((w) => w.id === wallpaper) ?? WALLPAPERS[0];
  return (
    <>
      <div className="settings__card settings__wallpaper-hero">
        <span className="settings__wallpaper-preview" style={{ background: current.base }} />
        <div>
          <div className="settings__row-title">{current.name}</div>
          <div className="settings__net-desc">Dynamic gradient</div>
        </div>
      </div>

      <div className="settings__section-title">Wallpapers</div>
      <div className="settings__card settings__wallpaper-grid">
        {WALLPAPERS.map((w) => (
          <button
            key={w.id}
            type="button"
            className={`settings__wallpaper-thumb${wallpaper === w.id ? " is-active" : ""}`}
            onClick={() => setWallpaper(w.id)}
          >
            <span className="settings__wallpaper-swatch" style={{ background: w.base }} />
            <span className="settings__wallpaper-name">{w.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function DisplaysPane() {
  const [info, setInfo] = useState({ w: 0, h: 0, dpr: 1 });
  useEffect(() => {
    const read = () =>
      setInfo({
        w: window.innerWidth,
        h: window.innerHeight,
        dpr: window.devicePixelRatio || 1,
      });
    read();
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, []);
  return (
    <>
      <div className="settings__section-title">Built-in Display</div>
      <div className="settings__card settings__list">
        <Row label="Resolution" value={`${info.w} × ${info.h}`} />
        <Row label="Scale" value={`${info.dpr}×${info.dpr > 1 ? " (Retina)" : ""}`} />
        <Row label="Color" value="Millions of colors" />
      </div>
      <p className="settings__hint">
        AlmostOS renders into your browser viewport — resize the window to change the resolution.
      </p>
    </>
  );
}

function SoundPane() {
  const { volume } = useAppearance();
  return (
    <>
      <div className="settings__section-title">Output</div>
      <div className="settings__card">
        <div className="settings__slider-row">
          <span className="settings__slider-icon">🔈</span>
          <input
            type="range"
            min={0}
            max={100}
            value={volume}
            className="settings__slider"
            onChange={(e) => setVolume(Number(e.target.value))}
          />
          <span className="settings__slider-icon">🔊</span>
          <span className="settings__slider-value">{volume}</span>
        </div>
      </div>
      <p className="settings__hint">Output volume is remembered across sessions.</p>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="settings__kv">
      <span className="settings__kv-label">{label}</span>
      <span className="settings__kv-value">{value}</span>
    </div>
  );
}

function PlaceholderPane({ title }: { title: string }) {
  return (
    <div className="settings__placeholder">
      <p>{title}</p>
      <span>This settings pane isn't wired up yet.</span>
    </div>
  );
}
