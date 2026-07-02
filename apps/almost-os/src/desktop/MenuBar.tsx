import { useEffect, useRef, useState } from "react";
import type { SerializedMenuItem } from "@agent-wasm/core";
import { TailscaleMenu } from "../apps/tailscale/TailscaleMenu";
import { useNetwork } from "../apps/tailscale/use-network";
import { logout } from "../auth/auth0";
import { useAuthSession } from "../auth/use-auth-session";
import { showContextMenu } from "../apps/electron/context-menu-store";
import { useTrays } from "../apps/electron/tray-store";
import { TailscaleGlyph } from "../os/icons";
import { useSystem } from "../os/system";
import type { ResolvedMenu } from "./menu-store";
import { WifiMenu } from "./WifiMenu";

interface FullscreenDoc extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
}
interface FullscreenEl extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

/** Toggle the whole page in/out of the browser Fullscreen API (cross-vendor). */
function useFullscreen(): { isFullscreen: boolean; toggle: () => void } {
  const isActive = (): boolean => {
    if (typeof document === "undefined") return false;
    const doc = document as FullscreenDoc;
    return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
  };
  const [isFullscreen, setIsFullscreen] = useState(isActive);
  useEffect(() => {
    const onChange = () => setIsFullscreen(isActive());
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, []);
  const toggle = (): void => {
    const doc = document as FullscreenDoc;
    if (doc.fullscreenElement ?? doc.webkitFullscreenElement) {
      void (doc.exitFullscreen ?? doc.webkitExitFullscreen)?.call(doc);
    } else {
      const el = document.documentElement as FullscreenEl;
      void (el.requestFullscreen ?? el.webkitRequestFullscreen)?.call(el);
    }
  };
  return { isFullscreen, toggle };
}

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
  /** The focused app's resolved menu (Electron seam, native, or default). */
  menu: ResolvedMenu;
  chatOpen: boolean;
  onToggleChat: () => void;
}

/** 'Shift+CmdOrCtrl+Z' → '⇧⌘Z' (display only; dispatch is out of scope). */
function formatAccelerator(accelerator?: string): string | null {
  if (!accelerator) return null;
  let mods = "";
  let key = "";
  for (const part of accelerator.split("+")) {
    switch (part) {
      case "CmdOrCtrl":
      case "CommandOrControl":
      case "Cmd":
      case "Command":
      case "Super":
      case "Meta":
        mods += "⌘";
        break;
      case "Ctrl":
      case "Control":
        mods += "⌃";
        break;
      case "Shift":
        mods += "⇧";
        break;
      case "Alt":
      case "Option":
        mods += "⌥";
        break;
      case "Plus":
        key = "+";
        break;
      default:
        key = part.length === 1 ? part.toUpperCase() : part;
        break;
    }
  }
  return mods + key;
}

function MenuDropdown({
  items,
  submenu,
  onCommand,
}: {
  items: SerializedMenuItem[];
  submenu?: boolean;
  onCommand: (commandId: string) => void;
}) {
  return (
    <div
      className={`os-menubar__dropdown${submenu ? " os-menubar__submenu" : ""}`}
      role="menu"
    >
      {items
        .filter((item) => item.visible !== false)
        .map((item) =>
          item.type === "separator" ? (
            <div key={item.commandId} className="os-menubar__menu-sep" />
          ) : (
            <MenuEntry key={item.commandId} item={item} onCommand={onCommand} />
          ),
        )}
    </div>
  );
}

function MenuEntry({
  item,
  onCommand,
}: {
  item: SerializedMenuItem;
  onCommand: (commandId: string) => void;
}) {
  const [subOpen, setSubOpen] = useState(false);
  const disabled = item.enabled === false;
  const hasSubmenu = !!item.submenu?.length;
  const accelerator = formatAccelerator(item.accelerator);
  const checked = (item.type === "checkbox" || item.type === "radio") && item.checked;
  return (
    <div
      className={[
        "os-menubar__menu-item",
        disabled ? "is-disabled" : "",
        subOpen ? "is-open" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      role="menuitem"
      aria-disabled={disabled || undefined}
      onPointerEnter={() => hasSubmenu && setSubOpen(true)}
      onPointerLeave={() => hasSubmenu && setSubOpen(false)}
      onClick={() => {
        if (disabled || hasSubmenu) return;
        onCommand(item.commandId);
      }}
    >
      <span className="os-menubar__menu-check" aria-hidden="true">
        {checked ? "✓" : ""}
      </span>
      <span className="os-menubar__menu-label">{item.label}</span>
      {hasSubmenu ? (
        <span className="os-menubar__menu-arrow" aria-hidden="true">
          ▸
        </span>
      ) : accelerator ? (
        <span className="os-menubar__menu-accel">{accelerator}</span>
      ) : null}
      {subOpen && hasSubmenu && (
        <MenuDropdown items={item.submenu!} submenu onCommand={onCommand} />
      )}
    </div>
  );
}

function AppMenus({ menu }: { menu: ResolvedMenu }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close when focus moves to another app (menu switches identity).
  useEffect(() => {
    setOpenIndex(null);
  }, [menu.appName]);

  useEffect(() => {
    if (openIndex === null) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpenIndex(null);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIndex(null);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [openIndex]);

  const items = menu.items.filter((item) => item.visible !== false);
  return (
    <div className="os-menubar__menus" ref={containerRef}>
      {items.map((item, i) => {
        const hasSubmenu = !!item.submenu;
        return (
          <span key={item.commandId} className="os-menubar__menu-wrap">
            <button
              type="button"
              className={[
                "os-menubar__menu",
                openIndex === i ? "is-active" : "",
                item.enabled === false ? "is-disabled" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              onPointerDown={(e) => {
                // Keep focus on the app window; menus never take focus.
                e.preventDefault();
                if (hasSubmenu) {
                  setOpenIndex(openIndex === i ? null : i);
                } else if (item.enabled !== false) {
                  menu.onCommand(item.commandId);
                  setOpenIndex(null);
                }
              }}
              onPointerEnter={() => {
                if (openIndex !== null && openIndex !== i && hasSubmenu) {
                  setOpenIndex(i);
                }
              }}
            >
              {item.label}
            </button>
            {openIndex === i && hasSubmenu && (
              <MenuDropdown
                items={item.submenu!}
                onCommand={(commandId) => {
                  menu.onCommand(commandId);
                  setOpenIndex(null);
                }}
              />
            )}
          </span>
        );
      })}
    </div>
  );
}

export function MenuBar({ menu, chatOpen, onToggleChat }: MenuBarProps) {
  const clock = useClock();
  const system = useSystem();
  const net = useNetwork();
  const [tsOpen, setTsOpen] = useState(false);
  const [wifiOpen, setWifiOpen] = useState(false);
  const [appleOpen, setAppleOpen] = useState(false);
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();
  const session = useAuthSession();
  const trays = useTrays();

  // Dismiss the Apple menu on outside click / Escape.
  useEffect(() => {
    if (!appleOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest(".os-menubar__apple") || target.closest(".os-menubar__apple-menu")) {
        return;
      }
      setAppleOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAppleOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [appleOpen]);
  return (
    <div className="os-menubar">
      <div className="os-menubar__left">
        <button
          type="button"
          className={`os-menubar__apple${appleOpen ? " is-active" : ""}`}
          aria-label="Apple menu"
          onClick={() => setAppleOpen((o) => !o)}
        >
          <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path
              fill="currentColor"
              d="M16.3 12.6c0-2 1.6-3 1.7-3-1-1.4-2.4-1.6-2.9-1.6-1.2-.1-2.4.7-3 .7-.6 0-1.6-.7-2.6-.7-1.3 0-2.6.8-3.2 2-1.4 2.4-.4 6 1 8 .6 1 1.4 2.1 2.4 2 1-.1 1.3-.6 2.5-.6s1.5.6 2.6.6c1.1 0 1.8-1 2.4-2 .8-1.1 1.1-2.2 1.1-2.3 0 0-2-.8-2-3.1zM14.6 6.3c.5-.7.9-1.6.8-2.5-.8 0-1.7.5-2.3 1.2-.5.6-.9 1.5-.8 2.4.9.1 1.8-.4 2.3-1.1z"
            />
          </svg>
        </button>
        {appleOpen && (
          <div className="os-menubar__apple-menu">
            {session?.profile.email && (
              <div className="os-menubar__apple-user">{session.profile.email}</div>
            )}
            <button
              type="button"
              className="os-menubar__apple-item"
              onClick={() => {
                setAppleOpen(false);
                toggleFullscreen();
              }}
            >
              {isFullscreen ? "Exit Full Screen" : "Enter Full Screen"}
            </button>
            <div className="os-menubar__apple-sep" />
            <button
              type="button"
              className="os-menubar__apple-item"
              onClick={() => {
                setAppleOpen(false);
                logout();
              }}
            >
              Log Out…
            </button>
          </div>
        )}
        <span className="os-menubar__app">{menu.appName}</span>
        <AppMenus menu={menu} />
      </div>
      <div className="os-menubar__right">
        {trays.map((tray) => (
          <button
            key={tray.trayId}
            type="button"
            className="os-menubar__status os-menubar__tray"
            title={tray.tooltip || tray.title}
            aria-label={tray.tooltip || tray.title || "Menu bar extra"}
            onClick={(e) => {
              tray.onClick();
              if (tray.menu) {
                const rect = e.currentTarget.getBoundingClientRect();
                showContextMenu(tray.menu, { x: rect.left, y: rect.bottom + 4 });
              }
            }}
          >
            {tray.icon ? (
              <img className="os-menubar__tray-icon" src={tray.icon} alt="" />
            ) : null}
            {tray.title ? <span className="os-menubar__tray-title">{tray.title}</span> : null}
            {!tray.icon && !tray.title ? "▪" : null}
          </button>
        ))}
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
