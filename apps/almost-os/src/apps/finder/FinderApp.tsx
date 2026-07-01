import { useEffect, useMemo, useRef, useState } from "react";
import { useOsRuntime } from "../../runtime/OsRuntimeProvider";
import { useSystem } from "../../os/system";
import { playVirtualMp3 } from "../../media/player-store";
import { DOWNLOADS_DIR, isVirtualMp3Path, readVirtualMp3 } from "../../media/virtual-mp3";
import { winampStore } from "../winamp/winamp-store";
import { ensureSkinsDir, listWsz, readWszBytes, type RealFile } from "../../fs/real-folder";
import { finderStore, useFinderRequest } from "./finder-store";

interface Entry {
  name: string;
  path: string;
  isDir: boolean;
  /** A real-folder .wsz skin (browsed off disk), vs a normal VFS entry. */
  wsz?: RealFile;
}

const FAVORITES: Array<{ label: string; path: string }> = [
  { label: "project", path: "/project" },
  { label: "Desktop", path: "/home/user/Desktop" },
  { label: "Napster Downloads", path: DOWNLOADS_DIR },
  { label: "Computer", path: "/" },
];

function join(dir: string, name: string): string {
  return dir === "/" ? `/${name}` : `${dir}/${name}`;
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
  const [view, setView] = useState<"icon" | "list">("icon");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<null | "file" | "folder">(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  // Real-folder ("Winamp Skins") browsing state — non-null replaces the VFS view.
  const [skins, setSkins] = useState<RealFile[] | null>(null);
  const [skinsError, setSkinsError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cwd = stack[index];
  const finderReq = useFinderRequest();

  // React to open requests from desktop icons / other surfaces.
  useEffect(() => {
    const target = finderStore.consume();
    if (!target) return;
    if (target.kind === "vfs") {
      setSkins(null);
      navigate(target.path);
    } else if (target.kind === "winamp-skins") {
      void showSkins(target.handle);
    }
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

  async function showSkins(handle: FileSystemDirectoryHandle | null): Promise<void> {
    const dir = handle ?? (await ensureSkinsDir().catch(() => null));
    if (!dir) {
      setSkins([]);
      setSkinsError("Couldn't open a real folder (needs Chrome + permission).");
      return;
    }
    try {
      setSkinsError(null);
      setSkins(await listWsz(dir));
    } catch (e) {
      setSkins([]);
      setSkinsError(e instanceof Error ? e.message : "Failed to read folder.");
    }
  }

  const entries = useMemo<Entry[]>(() => {
    if (skins) {
      return skins.map((f) => ({ name: f.name, path: `skin:${f.name}`, isDir: false, wsz: f }));
    }
    if (!ready) return [];
    void tick;
    try {
      const names = workspace.vfs.readdirSync(cwd) as string[];
      return names
        .map((name) => {
          const path = join(cwd, name);
          let isDir = false;
          try {
            isDir = workspace.vfs.statSync(path).isDirectory();
          } catch {
            /* ignore */
          }
          return { name, path, isDir };
        })
        .sort((a, b) =>
          a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1,
        );
    } catch {
      return [];
    }
  }, [workspace, cwd, tick, ready, skins]);

  const navigate = (path: string) => {
    setSkins(null);
    const next = stack.slice(0, index + 1);
    next.push(path);
    setStack(next);
    setIndex(next.length - 1);
    setSelected(null);
  };

  const open = (entry: Entry) => {
    // Real-folder skin → apply to Webamp (open Winamp if needed).
    if (entry.wsz) {
      void readWszBytes(entry.wsz.handle).then((bytes) => {
        winampStore.setSkinFromBytes(bytes, entry.wsz?.name);
        system.openApp("winamp");
      });
      return;
    }
    if (entry.isDir) {
      navigate(entry.path);
      return;
    }
    // A Napster "virtual mp3" → play it in Winamp instead of the code editor.
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
        /* name already exists */
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
        /* target exists */
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

  const pathLabel = skins ? "Winamp Skins — real folder" : cwd;
  const editingDisabled = skins !== null;

  return (
    <div className="finder">
      <aside className="finder__sidebar">
        <div className="finder__sidebar-title">Favorites</div>
        {FAVORITES.map((fav) => (
          <button
            key={fav.path}
            type="button"
            className={`finder__fav${!skins && cwd === fav.path ? " is-active" : ""}`}
            onClick={() => navigate(fav.path)}
          >
            <span className="finder__fav-dot" />
            {fav.label}
          </button>
        ))}
        <button
          type="button"
          className={`finder__fav${skins ? " is-active" : ""}`}
          onClick={() => void showSkins(null)}
          title="Browse a real folder of .wsz Winamp skins"
        >
          <span className="finder__fav-dot" />
          Winamp Skins
        </button>
      </aside>
      <div className="finder__main">
        <div className="finder__toolbar">
          <div className="finder__nav">
            <button
              type="button"
              className="finder__btn"
              disabled={index === 0 && !skins}
              onClick={() => {
                if (skins) {
                  setSkins(null);
                  return;
                }
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
              disabled={index >= stack.length - 1 || !!skins}
              onClick={() => {
                setIndex((i) => Math.min(stack.length - 1, i + 1));
                setSelected(null);
              }}
              aria-label="Forward"
            >
              ›
            </button>
          </div>
          <div className="finder__path">{pathLabel}</div>
          <div className="finder__tools">
            <button
              type="button"
              className={`finder__btn${view === "icon" ? " is-active" : ""}`}
              onClick={() => setView("icon")}
              aria-label="Icon view"
            >
              ▦
            </button>
            <button
              type="button"
              className={`finder__btn${view === "list" ? " is-active" : ""}`}
              onClick={() => setView("list")}
              aria-label="List view"
            >
              ☰
            </button>
            <span className="finder__divider" />
            <button type="button" className="finder__btn" onClick={() => setCreating("folder")} disabled={editingDisabled} title="New Folder">
              ⊕▸
            </button>
            <button type="button" className="finder__btn" onClick={() => setCreating("file")} disabled={editingDisabled} title="New File">
              ⊕
            </button>
            <button type="button" className="finder__btn" onClick={beginRename} disabled={!selected || editingDisabled} title="Rename">
              ✎
            </button>
            <button type="button" className="finder__btn" onClick={remove} disabled={!selected || editingDisabled} title="Delete">
              🗑
            </button>
          </div>
        </div>

        <div className={`finder__view finder__view--${view}`}>
          {creating && !skins && (
            <div className={view === "icon" ? "finder__item" : "finder__row"}>
              <span className={view === "icon" ? "finder__icon" : "finder__row-icon"}>
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

          {entries.map((entry) => {
            const isRenaming = renaming === entry.path;
            const selectedClass = selected === entry.path ? " is-selected" : "";
            const label = isRenaming ? (
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
            ) : (
              <span className="finder__name">{entry.name}</span>
            );

            if (view === "icon") {
              return (
                <button
                  key={entry.path}
                  type="button"
                  className={`finder__item${selectedClass}`}
                  onClick={() => setSelected(entry.path)}
                  onDoubleClick={() => open(entry)}
                >
                  <span className="finder__icon">
                    {entry.isDir ? <FolderGlyph /> : <FileGlyph />}
                  </span>
                  {label}
                </button>
              );
            }
            return (
              <button
                key={entry.path}
                type="button"
                className={`finder__row${selectedClass}`}
                onClick={() => setSelected(entry.path)}
                onDoubleClick={() => open(entry)}
              >
                <span className="finder__row-icon">
                  {entry.isDir ? <FolderGlyph /> : <FileGlyph />}
                </span>
                {label}
                <span className="finder__row-kind">
                  {entry.wsz ? "Winamp Skin" : entry.isDir ? "Folder" : "File"}
                </span>
              </button>
            );
          })}

          {entries.length === 0 && !creating && (
            <div className="finder__empty">
              {skins ? skinsError ?? "No .wsz skins in this folder" : "This folder is empty"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
