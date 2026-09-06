import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useOsRuntime } from "../../runtime/OsRuntimeProvider";
import { useSystem } from "../../os/system";
import { playVirtualMp3 } from "../../media/player-store";
import {
  DOWNLOADS_DIR,
  readVirtualMp3,
  type VirtualMp3,
} from "../../media/virtual-mp3";

// Napster retains the local downloads library; online discovery is disabled.

interface LinkMenu {
  x: number;
  y: number;
  url: string;
  title: string;
}

type ContextLinkHandler = (e: ReactMouseEvent, url: string, title: string) => void;

function fmtDur(ms: number): string {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

interface LibraryEntry {
  path: string;
  name: string;
  payload: VirtualMp3;
}

export function NapsterApp() {
  const { workspace, ready } = useOsRuntime();
  const system = useSystem();
  const [tick, setTick] = useState(0);
  const [linkMenu, setLinkMenu] = useState<LinkMenu | null>(null);

  // Right-click a saved track to copy or open its SoundCloud link.
  const openLinkMenu = useCallback((e: ReactMouseEvent, url: string, title: string) => {
    if (!url) return;
    e.preventDefault();
    setLinkMenu({ x: e.clientX, y: e.clientY, url, title });
  }, []);
  useEffect(() => {
    if (!linkMenu) return;
    const close = () => setLinkMenu(null);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [linkMenu]);

  // ── My Library: the virtual mp3s in the downloads folder (live) ──
  const library = useMemo<LibraryEntry[]>(() => {
    if (!ready) return [];
    void tick;
    try {
      if (!workspace.vfs.existsSync(DOWNLOADS_DIR)) return [];
      const names = workspace.vfs.readdirSync(DOWNLOADS_DIR) as string[];
      return names
        .filter((n) => n.toLowerCase().endsWith(".mp3"))
        .map((name) => {
          const path = `${DOWNLOADS_DIR}/${name}`;
          return { path, name, payload: readVirtualMp3(path) };
        })
        .filter((e): e is LibraryEntry => e.payload !== null)
        .sort((a, b) => (b.payload.downloadedAt ?? 0) - (a.payload.downloadedAt ?? 0));
    } catch {
      return [];
    }
  }, [workspace, ready, tick]);

  useEffect(() => {
    if (!ready) return;
    const fs = workspace.vfs;
    const refresh = () => setTick((t) => t + 1);
    fs.on("change", refresh);
    fs.on("delete", refresh);
    return () => {
      fs.off("change", refresh);
      fs.off("delete", refresh);
    };
  }, [workspace, ready]);

  const playFromLibrary = useCallback(
    (entry: LibraryEntry) => {
      playVirtualMp3(entry.payload);
      system.openApp("winamp");
    },
    [system],
  );

  return (
    <div className="napster">
      {/* ── top bar ── */}
      <div className="napster__topbar">
        <div className="napster__brand">
          <span className="napster__cat" aria-hidden="true">🐱</span>
          <span className="napster__wordmark">napster.</span>
        </div>
        <div className="napster__account">
          <span>Local Library</span>
        </div>
      </div>

      <div className="napster__searchbar">
        <input className="napster__search-input" placeholder="Online search disabled" aria-label="Search Napster" disabled />
        <button type="button" className="napster__search-btn" disabled>🔍 Search</button>
      </div>

      <div className="napster__body">
        {/* ── sidebar ── */}
        <aside className="napster__sidebar">
          <div className="napster__panel">
            <div className="napster__panel-head">My Library</div>
            <span className="napster__link">All Tracks</span>
          </div>
          <div className="napster__panel">
            <div className="napster__panel-head napster__panel-head--blue">Explore Napster</div>
            <p className="napster__empty">Online discovery is disabled.</p>
          </div>
        </aside>

        {/* ── content ── */}
        <main className="napster__content">
          <div className="napster__content-head">
            <span className="napster__content-title">MY LIBRARY</span>
          </div>

          <p className="napster__empty">Online search, discovery, and downloads are disabled. Your saved tracks can still play in Winamp.</p>
          <div className="napster__scroll">
            <LibraryList library={library} onPlay={playFromLibrary} onContextLink={openLinkMenu} />
          </div>
        </main>
      </div>

      {linkMenu && (
        <div
          className="napster__ctx"
          style={{ left: linkMenu.x, top: linkMenu.y }}
          onPointerDown={(e) => e.stopPropagation()}
          role="menu"
        >
          <button
            type="button"
            className="napster__ctx-item"
            onClick={() => {
              void navigator.clipboard?.writeText(linkMenu.url);
              setLinkMenu(null);
            }}
          >
            Copy Link
          </button>
          <button
            type="button"
            className="napster__ctx-item"
            onClick={() => {
              window.open(linkMenu.url, "_blank", "noopener,noreferrer");
              setLinkMenu(null);
            }}
          >
            Open in SoundCloud
          </button>
        </div>
      )}
    </div>
  );
}

function LibraryList({
  library,
  onPlay,
  onContextLink,
}: {
  library: LibraryEntry[];
  onPlay: (e: LibraryEntry) => void;
  onContextLink?: ContextLinkHandler;
}) {
  if (library.length === 0) {
    return (
      <div className="napster__empty">
        No saved tracks in ~/Desktop/Napster Downloads. Local music files can still be opened in Winamp.
      </div>
    );
  }
  return (
    <table className="napster__library">
      <thead>
        <tr>
          <th>Title</th>
          <th>Artist</th>
          <th>Time</th>
        </tr>
      </thead>
      <tbody>
        {library.map((e) => (
          <tr
            key={e.path}
            onDoubleClick={() => onPlay(e)}
            onContextMenu={(ev) => onContextLink?.(ev, e.payload.url, e.payload.title)}
            title="Double-click to play in Winamp · right-click to copy link"
          >
            <td>{e.payload.title}</td>
            <td>{e.payload.artist}</td>
            <td>{fmtDur(e.payload.duration ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
