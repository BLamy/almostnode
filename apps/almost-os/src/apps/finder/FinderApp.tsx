import { useEffect, useMemo, useRef, useState } from "react";
import { useOsRuntime } from "../../runtime/OsRuntimeProvider";
import { useSystem } from "../../os/system";
import { playVirtualMp3 } from "../../media/player-store";
import { DOWNLOADS_DIR, isVirtualMp3Path, readVirtualMp3 } from "../../media/virtual-mp3";
import { SOUNDCLOUD_LINKS_DIR, WEBAMP_SKINS_DIR } from "../../media/virtual-url-map";
import { finderStore, useFinderRequest } from "./finder-store";

interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  mtime: number;
}

type IconName =
  | "folder"
  | "applications"
  | "desktop"
  | "documents"
  | "downloads"
  | "home"
  | "computer"
  | "airdrop"
  | "trash"
  | "shared"
  | "cloud";

interface SidebarItem {
  label: string;
  path: string;
  icon: IconName;
  cloud?: boolean;
}
interface SidebarSection {
  title?: string;
  items: SidebarItem[];
}

const SIDEBAR: SidebarSection[] = [
  { items: [{ label: "Shared", path: "/", icon: "shared" }] },
  {
    title: "Favorites",
    items: [
      { label: "Applications", path: "/Applications", icon: "applications" },
      { label: "Desktop", path: "/home/user/Desktop", icon: "desktop", cloud: true },
      { label: "project", path: "/project", icon: "folder" },
      { label: "Documents", path: "/home/user/Documents", icon: "documents", cloud: true },
      { label: "Downloads", path: "/home/user/Downloads", icon: "downloads" },
      { label: "Napster Downloads", path: DOWNLOADS_DIR, icon: "downloads" },
      { label: "Winamp Skins", path: WEBAMP_SKINS_DIR, icon: "folder" },
      { label: "SoundCloud Links", path: SOUNDCLOUD_LINKS_DIR, icon: "folder" },
    ],
  },
  {
    title: "Locations",
    items: [
      { label: "iCloud Drive", path: "/home/user", icon: "cloud" },
      { label: "brettlamy", path: "/home/user", icon: "home" },
      { label: "Computer", path: "/", icon: "computer" },
      { label: "Trash", path: "/tmp", icon: "trash" },
    ],
  },
];

function join(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
}

function formatSize(size: number, isDir: boolean): string {
  if (isDir) return "--";
  if (size < 1000) return `${size} bytes`;
  if (size < 1000 * 1000) return `${Math.round(size / 1000)} KB`;
  if (size < 1000 * 1000 * 1000) return `${(size / (1000 * 1000)).toFixed(1)} MB`;
  return `${(size / (1000 * 1000 * 1000)).toFixed(1)} GB`;
}

function formatDate(mtime: number): string {
  if (!mtime) return "--";
  const d = new Date(mtime);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `Today at ${time}`;
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${date} at ${time}`;
}

const KIND_BY_EXT: Record<string, string> = {
  css: "CSS",
  json: "JSON document",
  md: "Markdown Document",
  ts: "TypeScript file",
  tsx: "TypeScript file",
  js: "JavaScript file",
  jsx: "JavaScript file",
  html: "HTML document",
  txt: "Plain Text",
  png: "PNG image",
  jpg: "JPEG image",
  jpeg: "JPEG image",
  gif: "GIF image",
  svg: "SVG document",
  mp3: "MP3 audio",
  wsz: "Winamp skin",
};

function kindOf(name: string, isDir: boolean): string {
  if (isDir) return "Folder";
  const ext = name.includes(".") ? name.split(".").pop()!.toLowerCase() : "";
  return KIND_BY_EXT[ext] ?? (ext ? `${ext.toUpperCase()} file` : "Plain Text");
}

function SidebarIcon({ name }: { name: IconName }) {
  const p = {
    width: 17,
    height: 17,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "applications":
      return (
        <svg {...p}>
          <path d="M12 3l9 16H3l9-16z" />
        </svg>
      );
    case "desktop":
      return (
        <svg {...p}>
          <rect x="3" y="5" width="18" height="11" rx="1.5" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      );
    case "documents":
      return (
        <svg {...p}>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4" />
        </svg>
      );
    case "downloads":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v8m0 0l-3-3m3 3l3-3" />
        </svg>
      );
    case "home":
      return (
        <svg {...p}>
          <path d="M4 11l8-6 8 6v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8z" />
        </svg>
      );
    case "computer":
      return (
        <svg {...p}>
          <rect x="4" y="5" width="16" height="14" rx="2" />
          <path d="M9 21h6" />
        </svg>
      );
    case "airdrop":
      return (
        <svg {...p}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 13a5 5 0 0 1 8 0M10 16a2.5 2.5 0 0 1 4 0" />
        </svg>
      );
    case "trash":
      return (
        <svg {...p}>
          <path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13" />
        </svg>
      );
    case "shared":
      return (
        <svg {...p}>
          <rect x="3" y="6" width="18" height="13" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
        </svg>
      );
    case "cloud":
      return (
        <svg {...p}>
          <path d="M7 18a4 4 0 0 1 .5-8 5 5 0 0 1 9.5 1.5A3.5 3.5 0 0 1 16.5 18H7z" />
        </svg>
      );
    default:
      return (
        <svg {...p}>
          <path d="M4 7a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7z" />
        </svg>
      );
  }
}

function FolderGlyph() {
  return (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <path
        d="M6 13a3 3 0 0 1 3-3h10l4 4h16a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V13z"
        fill="#54b1ff"
      />
      <path d="M6 17h36v17a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V17z" fill="#3a93ee" />
    </svg>
  );
}

function FileGlyph() {
  return (
    <svg viewBox="0 0 48 48" width="100%" height="100%" aria-hidden="true">
      <path d="M12 6h16l8 8v28a2 2 0 0 1-2 2H12a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" fill="#fff" stroke="#c8c8cc" strokeWidth="1.5" />
      <path d="M28 6v8h8" fill="none" stroke="#c8c8cc" strokeWidth="1.5" />
      <path d="M16 24h16M16 29h16M16 34h11" stroke="#c0c0c6" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function FinderApp() {
  const { workspace, ready } = useOsRuntime();
  const system = useSystem();
  const [stack, setStack] = useState<string[]>(["/project"]);
  const [index, setIndex] = useState(0);
  const [tick, setTick] = useState(0);
  const [view, setView] = useState<"icon" | "list">("list");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<null | "file" | "folder">(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const cwd = stack[index];
  const finderReq = useFinderRequest();

  useEffect(() => {
    const target = finderStore.consume();
    if (!target) return;
    if (target.kind === "vfs") navigate(target.path);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finderReq]);

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

  useEffect(() => {
    if (creating || renaming) inputRef.current?.focus();
  }, [creating, renaming]);

  const entries = useMemo<Entry[]>(() => {
    if (!ready) return [];
    void tick;
    try {
      const names = workspace.vfs.readdirSync(cwd) as string[];
      return names
        .map((name) => {
          const path = join(cwd, name);
          let isDir = false;
          let size = 0;
          let mtime = 0;
          try {
            const stat = workspace.vfs.statSync(path);
            isDir = stat.isDirectory();
            size = stat.size ?? 0;
            mtime = stat.mtime ? new Date(stat.mtime).getTime() : (stat.mtimeMs ?? 0);
          } catch {
            /* ignore */
          }
          return { name, path, isDir, size, mtime };
        })
        .sort((a, b) =>
          a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
        );
    } catch {
      return [];
    }
  }, [workspace, cwd, tick, ready]);

  const navigate = (path: string) => {
    const next = stack.slice(0, index + 1);
    next.push(path);
    setStack(next);
    setIndex(next.length - 1);
    setSelected(null);
  };

  const open = (entry: Entry) => {
    if (entry.isDir) {
      navigate(entry.path);
      return;
    }
    if (isVirtualMp3Path(entry.path)) {
      const payload = readVirtualMp3(entry.path);
      if (payload) {
        playVirtualMp3(payload);
        system.openApp("winamp");
        return;
      }
    }
    system.openFile(entry.path);
  };

  const commitCreate = () => {
    const name = draft.trim();
    if (name) {
      try {
        if (creating === "folder") workspace.createDirectory(join(cwd, name));
        else workspace.createFile(join(cwd, name), "");
      } catch {
        /* exists */
      }
      setTick((t) => t + 1);
    }
    setCreating(null);
    setDraft("");
  };

  const commitRename = () => {
    const name = draft.trim();
    if (renaming && name && name !== renaming.split("/").pop()) {
      try {
        workspace.rename(renaming, join(cwd, name));
      } catch {
        /* exists */
      }
      setTick((t) => t + 1);
    }
    setRenaming(null);
    setDraft("");
  };

  const remove = () => {
    if (!selected) return;
    try {
      workspace.remove(selected);
    } catch {
      /* ignore */
    }
    setSelected(null);
    setTick((t) => t + 1);
  };

  const beginRename = () => {
    if (!selected) return;
    setRenaming(selected);
    setDraft(selected.split("/").pop() ?? "");
  };

  const title = cwd === "/" ? "Computer" : cwd.split("/").filter(Boolean).pop() ?? "Finder";

  const renameInput = (
    <input
      ref={inputRef}
      className="finder__rename-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commitRename();
        if (e.key === "Escape") {
          setRenaming(null);
          setDraft("");
        }
      }}
      onBlur={commitRename}
    />
  );

  return (
    <div className="finder">
      <aside className="finder__sidebar">
        {SIDEBAR.map((section, si) => (
          <div key={section.title ?? `s${si}`} className="finder__side-section">
            {section.title && <div className="finder__sidebar-title">{section.title}</div>}
            {section.items.map((item) => (
              <button
                key={item.label}
                type="button"
                className={`finder__fav${cwd === item.path ? " is-active" : ""}`}
                onClick={() => navigate(item.path)}
              >
                <span className="finder__fav-icon">
                  <SidebarIcon name={item.icon} />
                </span>
                <span className="finder__fav-label">{item.label}</span>
                {item.cloud && (
                  <span className="finder__fav-cloud" aria-hidden="true">
                    <SidebarIcon name="cloud" />
                  </span>
                )}
              </button>
            ))}
          </div>
        ))}
      </aside>

      <div className="finder__main">
        <div className="finder__toolbar">
          <div className="finder__nav finder__pill">
            <button
              type="button"
              className="finder__btn"
              disabled={index === 0}
              onClick={() => {
                setIndex((i) => Math.max(0, i - 1));
                setSelected(null);
              }}
              aria-label="Back"
            >
              ‹
            </button>
            <button
              type="button"
              className="finder__btn"
              disabled={index >= stack.length - 1}
              onClick={() => {
                setIndex((i) => Math.min(stack.length - 1, i + 1));
                setSelected(null);
              }}
              aria-label="Forward"
            >
              ›
            </button>
          </div>
          <div className="finder__title">{title}</div>
          <div className="finder__tools">
            <div className="finder__pill finder__segmented">
              <button
                type="button"
                className={`finder__btn${view === "list" ? " is-active" : ""}`}
                onClick={() => setView("list")}
                aria-label="List view"
              >
                ☰
              </button>
              <button
                type="button"
                className={`finder__btn${view === "icon" ? " is-active" : ""}`}
                onClick={() => setView("icon")}
                aria-label="Icon view"
              >
                ▦
              </button>
            </div>
            <button type="button" className="finder__pill finder__btn" onClick={() => setCreating("folder")} title="New Folder">
              ＋
            </button>
            <button type="button" className="finder__pill finder__btn" onClick={() => setCreating("file")} title="New File">
              ▤
            </button>
            <button type="button" className="finder__pill finder__btn" onClick={beginRename} disabled={!selected} title="Rename">
              ✎
            </button>
            <button type="button" className="finder__pill finder__btn" onClick={remove} disabled={!selected} title="Delete">
              🗑
            </button>
            <button type="button" className="finder__pill finder__btn" title="Search" aria-label="Search">
              ⌕
            </button>
          </div>
        </div>

        {view === "list" ? (
          <div className="finder__list">
            <div className="finder__list-head">
              <span className="finder__col finder__col--name">
                Name <span className="finder__sort" aria-hidden="true">⌃</span>
              </span>
              <span className="finder__col finder__col--date">Date Modified</span>
              <span className="finder__col finder__col--size">Size</span>
              <span className="finder__col finder__col--kind">Kind</span>
            </div>
            <div className="finder__list-body">
              {creating && (
                <div className="finder__lrow">
                  <span className="finder__col finder__col--name">
                    <span className="finder__lrow-icon">
                      {creating === "folder" ? <FolderGlyph /> : <FileGlyph />}
                    </span>
                    <input
                      ref={inputRef}
                      className="finder__rename-input"
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitCreate();
                        if (e.key === "Escape") {
                          setCreating(null);
                          setDraft("");
                        }
                      }}
                      onBlur={commitCreate}
                      placeholder={creating === "folder" ? "untitled folder" : "untitled"}
                    />
                  </span>
                </div>
              )}
              {entries.map((entry) => (
                <div
                  key={entry.path}
                  className={`finder__lrow${selected === entry.path ? " is-selected" : ""}`}
                  onClick={() => setSelected(entry.path)}
                  onDoubleClick={() => open(entry)}
                >
                  <span className="finder__col finder__col--name">
                    <span className="finder__disclose" aria-hidden="true">
                      {entry.isDir ? "›" : ""}
                    </span>
                    <span className="finder__lrow-icon">
                      {entry.isDir ? <FolderGlyph /> : <FileGlyph />}
                    </span>
                    {renaming === entry.path ? renameInput : (
                      <span className="finder__name">{entry.name}</span>
                    )}
                  </span>
                  <span className="finder__col finder__col--date">{formatDate(entry.mtime)}</span>
                  <span className="finder__col finder__col--size">{formatSize(entry.size, entry.isDir)}</span>
                  <span className="finder__col finder__col--kind">{kindOf(entry.name, entry.isDir)}</span>
                </div>
              ))}
              {entries.length === 0 && !creating && (
                <div className="finder__empty">This folder is empty</div>
              )}
            </div>
          </div>
        ) : (
          <div className="finder__view finder__view--icon">
            {creating && (
              <div className="finder__item">
                <span className="finder__icon">
                  {creating === "folder" ? <FolderGlyph /> : <FileGlyph />}
                </span>
                <input
                  ref={inputRef}
                  className="finder__rename-input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitCreate();
                    if (e.key === "Escape") {
                      setCreating(null);
                      setDraft("");
                    }
                  }}
                  onBlur={commitCreate}
                  placeholder={creating === "folder" ? "untitled folder" : "untitled"}
                />
              </div>
            )}
            {entries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className={`finder__item${selected === entry.path ? " is-selected" : ""}`}
                onClick={() => setSelected(entry.path)}
                onDoubleClick={() => open(entry)}
              >
                <span className="finder__icon">
                  {entry.isDir ? <FolderGlyph /> : <FileGlyph />}
                </span>
                {renaming === entry.path ? renameInput : (
                  <span className="finder__name">{entry.name}</span>
                )}
              </button>
            ))}
            {entries.length === 0 && !creating && (
              <div className="finder__empty">This folder is empty</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
