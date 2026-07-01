import { useEffect } from "react";
import { useOsRuntime } from "../runtime/OsRuntimeProvider";
import { useSystem } from "../os/system";
import { finderStore } from "../apps/finder/finder-store";
import { ensureSkinsDir } from "../fs/real-folder";
import { DOWNLOADS_DIR } from "../media/virtual-mp3";

// Desktop folder icons. Double-clicking opens them in Finder:
//  • "Winamp Skins"     → a REAL host folder (File System Access API) of .wsz
//  • "Napster Downloads" → the VFS folder Napster saves virtual mp3s into

function FolderIcon() {
  return (
    <svg viewBox="0 0 48 48" width="46" height="46" aria-hidden="true">
      <path
        d="M6 13a3 3 0 0 1 3-3h10l4 4h16a3 3 0 0 1 3 3v17a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V13z"
        fill="#63b8ff"
      />
      <path d="M6 17h36v17a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V17z" fill="#3f97f0" />
    </svg>
  );
}

export function DesktopIcons() {
  const { workspace, ready } = useOsRuntime();
  const system = useSystem();

  // Make sure the downloads folder exists so it's browsable even before the
  // first Napster download.
  useEffect(() => {
    if (!ready) return;
    try {
      if (!workspace.vfs.existsSync(DOWNLOADS_DIR)) {
        workspace.vfs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
      }
    } catch {
      /* ignore */
    }
  }, [ready, workspace]);

  const openSkins = async () => {
    // Resolve the directory handle inside this click gesture (the FSA picker
    // needs transient activation), then hand it to Finder to list.
    const handle = await ensureSkinsDir().catch(() => null);
    finderStore.request({ kind: "winamp-skins", handle });
    system.openApp("finder");
  };

  const openDownloads = () => {
    finderStore.request({ kind: "vfs", path: DOWNLOADS_DIR });
    system.openApp("finder");
  };

  return (
    <div className="desktop-icons">
      <button type="button" className="desktop-icon" onDoubleClick={() => void openSkins()}>
        <FolderIcon />
        <span className="desktop-icon__label">Winamp Skins</span>
      </button>
      <button type="button" className="desktop-icon" onDoubleClick={openDownloads}>
        <FolderIcon />
        <span className="desktop-icon__label">Napster Downloads</span>
      </button>
    </div>
  );
}
