// "Virtual mp3" format. Napster 4.0 is a download client, not a player: each
// download writes a `.mp3` file into ~/Desktop/Napster Downloads/ whose bytes
// are NOT real audio — they carry the SoundCloud permalink + metadata. When you
// double-click one in Finder it opens in Winamp, which decodes the embedded URL
// and plays it through the shared SoundCloud widget engine (media/player-store).
//
// The wire format is intentionally trivial so the runtime-side `sc download`
// command (a different package) can emit the exact same thing:
//
//   NAPSTER-VMP3/1\n
//   { ...json payload... }
//
// The keep-it-boring marker guarantees a real mp3 is never mistaken for one of
// ours (and vice-versa).

import { getWorkspace } from "../runtime/runtime";

export const VMP3_MAGIC = "NAPSTER-VMP3/1";

/** VFS folder Napster downloads land in (a folder on the desktop). */
export const DOWNLOADS_DIR = "/home/user/Desktop/Napster Downloads";

export interface VirtualMp3 {
  /** SoundCloud permalink the widget engine can load. */
  url: string;
  title: string;
  artist: string;
  artwork?: string | null;
  /** Track length in ms, if known. */
  duration?: number;
  /** Epoch ms; stamped by the caller (the store forbids Date.now in some ctx). */
  downloadedAt?: number;
}

export function encodeVirtualMp3(track: VirtualMp3): string {
  return `${VMP3_MAGIC}\n${JSON.stringify(track, null, 2)}\n`;
}

/** Returns the payload, or null if `text` isn't one of our virtual mp3s. */
export function decodeVirtualMp3(text: string): VirtualMp3 | null {
  if (!text.startsWith(VMP3_MAGIC)) return null;
  try {
    const json = text.slice(text.indexOf("\n") + 1);
    const parsed = JSON.parse(json) as VirtualMp3;
    if (parsed && typeof parsed.url === "string") return parsed;
  } catch {
    /* corrupt payload */
  }
  return null;
}

/** Strip characters that are illegal / awkward in a filename. */
function sanitize(part: string): string {
  return part
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

export function filenameFor(track: VirtualMp3): string {
  const artist = sanitize(track.artist || "Unknown Artist");
  const title = sanitize(track.title || "Untitled");
  return `${artist} - ${title}.mp3`;
}

/**
 * Write a virtual mp3 into the Napster Downloads folder. Uses the raw VFS so it
 * both creates the folder (idempotent) and fires a "change" event that Finder /
 * Napster's library watch to refresh. Returns the file path.
 */
export function downloadVirtualMp3(track: VirtualMp3): string {
  const vfs = getWorkspace().vfs;
  if (!vfs.existsSync(DOWNLOADS_DIR)) {
    vfs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
  }
  const path = `${DOWNLOADS_DIR}/${filenameFor(track)}`;
  vfs.writeFileSync(path, encodeVirtualMp3(track));
  return path;
}

/** Read + decode a virtual mp3 at `path` (used by Finder double-click → Winamp). */
export function readVirtualMp3(path: string): VirtualMp3 | null {
  const vfs = getWorkspace().vfs;
  try {
    return decodeVirtualMp3(String(vfs.readFileSync(path, "utf8")));
  } catch {
    return null;
  }
}

export function isVirtualMp3Path(path: string): boolean {
  return path.toLowerCase().endsWith(".mp3");
}
