import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useOsRuntime } from "../../runtime/OsRuntimeProvider";
import { useSystem } from "../../os/system";
import { useAuthSession } from "../../auth/use-auth-session";
import { logout } from "../../auth/auth0";
import { searchGenre, searchTracks, sectionTracks, type SCTrack } from "../../media/soundcloud-api";
import { playVirtualMp3 } from "../../media/player-store";
import {
  DOWNLOADS_DIR,
  downloadVirtualMp3,
  readVirtualMp3,
  type VirtualMp3,
} from "../../media/virtual-mp3";

// Napster 4.0 — a period-accurate Napster desktop client that sits on the
// SoundCloud API. Like the original it's a DOWNLOAD client, not a player: every
// track button downloads a *virtual* mp3 into ~/Desktop/Napster Downloads/.
// Winamp plays them (double-click in Finder, or here in My Library).

type SearchCategory = "Artist" | "Track" | "Album";
type HomeTab = "main" | "new-releases" | "staff-picks" | "playlists" | "podcast";
type View = "home" | "search" | "library";

const HOME_TABS: Array<{ id: HomeTab; label: string }> = [
  { id: "main", label: "Main" },
  { id: "new-releases", label: "New Releases" },
  { id: "staff-picks", label: "Staff Picks" },
  { id: "playlists", label: "Napster Playlists" },
  { id: "podcast", label: "Podcasts" },
];

interface LinkMenu {
  x: number;
  y: number;
  url: string;
  title: string;
}

type ContextLinkHandler = (e: ReactMouseEvent, url: string, title: string) => void;

const GENRES = [
  "Alternative",
  "Hip-Hop",
  "Electronic",
  "Rock",
  "Pop",
  "Classical",
  "Jazz",
  "Country",
];

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
  const session = useAuthSession();

  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SearchCategory>("Artist");
  const [view, setView] = useState<View>("home");
  const [tab, setTab] = useState<HomeTab>("main");

  const [results, setResults] = useState<SCTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newReleases, setNewReleases] = useState<SCTrack[]>([]);
  const [topTracks, setTopTracks] = useState<SCTrack[]>([]);

  const [tick, setTick] = useState(0);
  const [linkMenu, setLinkMenu] = useState<LinkMenu | null>(null);

  // Right-click a downloaded/searchable track → copy or open its SoundCloud link.
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

  const downloadedUrls = useMemo(
    () => new Set(library.map((e) => e.payload.url)),
    [library],
  );

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

  // ── home sections ──
  const loadHome = useCallback(async () => {
    try {
      const [nr, tt] = await Promise.all([
        sectionTracks("new-releases", 8),
        sectionTracks("top-tracks", 10),
      ]);
      setNewReleases(nr);
      setTopTracks(tt);
    } catch {
      /* transient — the sidebar/search path will surface a real error */
    }
  }, []);

  useEffect(() => {
    void loadHome();
  }, [loadHome]);

  // ── search ──
  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setView("search");
    setLoading(true);
    setError(null);
    try {
      setResults(await searchTracks(q, { limit: 30 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const download = useCallback((track: SCTrack) => {
    downloadVirtualMp3({
      url: track.permalinkUrl,
      title: track.title,
      artist: track.artist,
      artwork: track.artwork,
      duration: track.duration,
      downloadedAt: Date.now(),
    });
  }, []);

  const playFromLibrary = useCallback(
    (entry: LibraryEntry) => {
      playVirtualMp3(entry.payload);
      system.openApp("winamp");
    },
    [system],
  );

  // Play a downloaded search/home result in Winamp. Prefer the library entry
  // (it's exactly what download() wrote); fall back to the track metadata,
  // which carries the same fields.
  const playDownloaded = useCallback(
    (track: SCTrack) => {
      const entry = library.find((e) => e.payload.url === track.permalinkUrl);
      playVirtualMp3(
        entry?.payload ?? {
          url: track.permalinkUrl,
          title: track.title,
          artist: track.artist,
          artwork: track.artwork,
          duration: track.duration,
        },
      );
      system.openApp("winamp");
    },
    [library, system],
  );

  const contentTitle =
    view === "search" ? "SEARCH RESULTS" : view === "library" ? "MY LIBRARY" : "NAPSTER HOME";

  return (
    <div className="napster">
      {/* ── top bar ── */}
      <div className="napster__topbar">
        <div className="napster__brand">
          <span className="napster__cat" aria-hidden="true">🐱</span>
          <span className="napster__wordmark">napster.</span>
        </div>
        <div className="napster__account">
          <span>Welcome{session?.profile.email ? `, ${session.profile.email}` : ""}</span>
          <a role="button" tabIndex={0}>My Account</a>
          <a role="button" tabIndex={0}>Help</a>
          <a role="button" tabIndex={0} onClick={() => logout()}>Sign Out</a>
          <a role="button" tabIndex={0}>Download Napster Software</a>
        </div>
      </div>

      <div className="napster__searchbar">
        <select
          className="napster__cat-select"
          value={category}
          onChange={(e) => setCategory(e.target.value as SearchCategory)}
        >
          <option>Artist</option>
          <option>Track</option>
          <option>Album</option>
        </select>
        <input
          className="napster__search-input"
          placeholder="Search Napster"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void runSearch();
          }}
        />
        <button type="button" className="napster__search-btn" onClick={() => void runSearch()}>
          🔍 Search
        </button>
      </div>

      <div className="napster__body">
        {/* ── sidebar ── */}
        <aside className="napster__sidebar">
          <div className="napster__panel">
            <div className="napster__panel-head">My Library</div>
            <button className="napster__link" onClick={() => setView("library")}>All Tracks</button>
            <button className="napster__link" onClick={() => setView("library")}>My Downloads</button>
            <button className="napster__link" onClick={() => setView("library")}>Recently Added</button>
          </div>
          <div className="napster__panel">
            <div className="napster__panel-head napster__panel-head--blue">Explore Napster</div>
            <button className="napster__link" onClick={() => setView("home")}>Napster Home</button>
            <div className="napster__subhead">Genres</div>
            {GENRES.map((g) => (
              <button
                key={g}
                className="napster__link napster__link--indent"
                onClick={() => {
                  setQuery(g);
                  setCategory("Track");
                  void searchByGenre(g);
                }}
              >
                {g}
              </button>
            ))}
          </div>
          <div className="napster__panel">
            <div className="napster__panel-head napster__panel-head--collapsed">Napster Playlists ▾</div>
          </div>
          <div className="napster__panel">
            <div className="napster__panel-head napster__panel-head--collapsed">Podcasts ▾</div>
          </div>
          <div className="napster__panel">
            <div className="napster__panel-head napster__panel-head--collapsed">Devices and More ▾</div>
          </div>
        </aside>

        {/* ── content ── */}
        <main className="napster__content">
          <div className="napster__content-head">
            <span className="napster__content-title">{contentTitle}</span>
          </div>

          <div className="napster__tabs">
            {HOME_TABS.map((t) => (
              <button
                key={t.id}
                className={`napster__tab${view === "home" && tab === t.id ? " is-active" : ""}`}
                onClick={() => {
                  setView("home");
                  setTab(t.id);
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="napster__scroll">
            {view === "search" && (
              <SearchResults
                loading={loading}
                error={error}
                results={results}
                downloadedUrls={downloadedUrls}
                onDownload={download}
                onPlay={playDownloaded}
                onContextLink={openLinkMenu}
              />
            )}

            {view === "library" && (
              <LibraryList
                library={library}
                onPlay={playFromLibrary}
                onContextLink={openLinkMenu}
              />
            )}

            {view === "home" && (
              <HomeView
                newReleases={newReleases}
                topTracks={topTracks}
                downloadedUrls={downloadedUrls}
                onDownload={download}
                onPlay={playDownloaded}
                onContextLink={openLinkMenu}
              />
            )}
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

  // Browse a genre via its curated artist roster (cached), not a keyword search.
  async function searchByGenre(genre: string) {
    setView("search");
    setLoading(true);
    setError(null);
    try {
      setResults(await searchGenre(genre, { limit: 30 }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
      setResults([]);
    } finally {
      setLoading(false);
    }
  }
}

// ── track card (album art + download) ──

function TrackCard({
  track,
  downloaded,
  onDownload,
  onPlay,
  onContextLink,
}: {
  track: SCTrack;
  downloaded: boolean;
  onDownload: (t: SCTrack) => void;
  onPlay: (t: SCTrack) => void;
  onContextLink?: ContextLinkHandler;
}) {
  return (
    <div
      className="napster__card"
      onContextMenu={(e) => onContextLink?.(e, track.permalinkUrl, track.title)}
    >
      <div className="napster__art">
        {track.artwork ? (
          <img src={track.artwork} alt="" />
        ) : (
          <div className="napster__art-fallback">♪</div>
        )}
        {downloaded && (
          <span className="napster__owned" title="Downloaded">
            ✓
          </span>
        )}
      </div>
      <div className="napster__card-title" title={track.title}>{track.title}</div>
      <div className="napster__card-artist" title={track.artist}>{track.artist}</div>
      <button
        type="button"
        className={`napster__dl${downloaded ? " is-play" : ""}`}
        onClick={() => (downloaded ? onPlay(track) : onDownload(track))}
        title={downloaded ? "Play in Winamp" : "Download"}
      >
        {downloaded ? "▶ Play" : "⬇ Download"}
      </button>
    </div>
  );
}

function SearchResults({
  loading,
  error,
  results,
  downloadedUrls,
  onDownload,
  onPlay,
  onContextLink,
}: {
  loading: boolean;
  error: string | null;
  results: SCTrack[];
  downloadedUrls: Set<string>;
  onDownload: (t: SCTrack) => void;
  onPlay: (t: SCTrack) => void;
  onContextLink?: ContextLinkHandler;
}) {
  if (loading) return <div className="napster__empty">Searching…</div>;
  if (error) return <div className="napster__empty">{error}</div>;
  if (results.length === 0) return <div className="napster__empty">No results.</div>;
  return (
    <div className="napster__grid">
      {results.map((t) => (
        <TrackCard
          key={t.id}
          track={t}
          downloaded={downloadedUrls.has(t.permalinkUrl)}
          onDownload={onDownload}
          onPlay={onPlay}
          onContextLink={onContextLink}
        />
      ))}
    </div>
  );
}

function HomeView({
  newReleases,
  topTracks,
  downloadedUrls,
  onDownload,
  onPlay,
  onContextLink,
}: {
  newReleases: SCTrack[];
  topTracks: SCTrack[];
  downloadedUrls: Set<string>;
  onDownload: (t: SCTrack) => void;
  onPlay: (t: SCTrack) => void;
  onContextLink?: ContextLinkHandler;
}) {
  return (
    <>
      <div className="napster__section-head">New Releases</div>
      {newReleases.length === 0 ? (
        <div className="napster__empty">Nothing to show yet.</div>
      ) : (
        <div className="napster__grid">
          {newReleases.map((t) => (
            <TrackCard
              key={t.id}
              track={t}
              downloaded={downloadedUrls.has(t.permalinkUrl)}
              onDownload={onDownload}
              onPlay={onPlay}
              onContextLink={onContextLink}
            />
          ))}
        </div>
      )}

      <div className="napster__section-head">Top 10s — Tracks</div>
      <ol className="napster__top10">
        {topTracks.map((t, i) => {
          const downloaded = downloadedUrls.has(t.permalinkUrl);
          return (
            <li
              key={t.id}
              className="napster__top10-row"
              onContextMenu={(e) => onContextLink?.(e, t.permalinkUrl, t.title)}
            >
              <span className="napster__top10-rank">{i + 1}</span>
              <span className="napster__top10-title">{t.title}</span>
              <span className="napster__top10-artist">{t.artist}</span>
              <button
                type="button"
                className={`napster__dl napster__dl--sm${downloaded ? " is-play" : ""}`}
                onClick={() => (downloaded ? onPlay(t) : onDownload(t))}
                title={downloaded ? "Play in Winamp" : "Download"}
              >
                {downloaded ? "▶" : "⬇"}
              </button>
            </li>
          );
        })}
        {topTracks.length === 0 && <div className="napster__empty">Nothing to show yet.</div>}
      </ol>
    </>
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
        No downloads yet. Search for a track and hit Download — it lands in
        ~/Desktop/Napster Downloads. Double-click to play in Winamp.
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
