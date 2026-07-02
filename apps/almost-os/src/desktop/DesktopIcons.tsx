import { useEffect } from "react";
import { useOsRuntime } from "../runtime/OsRuntimeProvider";
import { useSystem } from "../os/system";
import { finderStore } from "../apps/finder/finder-store";
import { DOWNLOADS_DIR } from "../media/virtual-mp3";
import { SOUNDCLOUD_LINKS_DIR, WEBAMP_SKINS_DIR } from "../media/virtual-url-map";

// Desktop folder icons. Double-clicking opens them in Finder:
//  • "Winamp Skins"      → VFS link files backed by the webamp+skins:// map
//  • "SoundCloud Links"  → VFS link files backed by the soundcloud:// map
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

  const openDownloads = () => {
    finderStore.request({ kind: "vfs", path: DOWNLOADS_DIR });
    system.openApp("finder");
  };

  const openVfsFolder = (path: string) => {
    finderStore.request({ kind: "vfs", path });
    system.openApp("finder");
  };

  return (
    <div className="desktop-icons">
      <button
        type="button"
        className="desktop-icon"
        onDoubleClick={() => openVfsFolder(WEBAMP_SKINS_DIR)}
      >
        <FolderIcon />
        <span className="desktop-icon__label">Winamp Skins</span>
      </button>
      <button
        type="button"
        className="desktop-icon"
        onDoubleClick={() => openVfsFolder(SOUNDCLOUD_LINKS_DIR)}
      >
        <FolderIcon />
        <span className="desktop-icon__label">SoundCloud Links</span>
      </button>
      <button type="button" className="desktop-icon" onDoubleClick={openDownloads}>
        <FolderIcon />
        <span className="desktop-icon__label">Napster Downloads</span>
      </button>
    </div>
  );
}
