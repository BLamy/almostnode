import type { VirtualMp3 } from "./virtual-mp3";

export const WEBAMP_SKINS_DIR = "/home/user/Desktop/Winamp Skins";
export const SOUNDCLOUD_LINKS_DIR = "/home/user/Desktop/SoundCloud Links";
export const VIRTUAL_MEDIA_MAP_PATH = "/home/user/.winamp/virtual-url-map.json";

const WEBAMP_SKIN_SCHEME = "webamp+skins://";
const SOUNDCLOUD_SCHEME = "soundcloud://";
const VIRTUAL_LINK_MAGIC = "AGENT-WASM-VIRTUAL-LINK/1";

export const VIRTUAL_MEDIA_URL_MAP: Record<string, string> = {
  // Classic + iconic skins from the Winamp Skin Museum (r2.webampskins.org,
  // content-addressed by md5). Double-click any of these link files in the
  // "Winamp Skins" desktop folder to apply the skin to Webamp.
  "webamp+skins://Winamp-Classic.wsz":
    "https://r2.webampskins.org/skins/5e4f10275dcb1fb211d4a8b4f1bda236.wsz",
  "webamp+skins://Green-Dimension.wsz":
    "https://r2.webampskins.org/skins/4308a2fc648033bf5fe7c4d56a5c8823.wsz",
  "webamp+skins://Nucleo-NLog.wsz":
    "https://r2.webampskins.org/skins/9e7f6c996d0873bae502e8749fb1cd48.wsz",
  "webamp+skins://Mac-AMP.wsz":
    "https://r2.webampskins.org/skins/82388fb1b715a1ae176f92e9773ecb4b.wsz",
  "webamp+skins://WAC.wsz":
    "https://r2.webampskins.org/skins/ad0f79d2048db2bbbd264834ccd573bd.wsz",
  "webamp+skins://Garfield.wsz":
    "https://r2.webampskins.org/skins/18882f853828f1aafaddb033160edb9a.wsz",
  "webamp+skins://Garfield-2001.wsz":
    "https://r2.webampskins.org/skins/16798344073a6a6b130960943bfd260f.wsz",
  "webamp+skins://Garfield-Amp.wsz":
    "https://r2.webampskins.org/skins/198cce79f359972fbb735237ed0a7331.wsz",
  "webamp+skins://Lazy-Garfield-Amp.wsz":
    "https://r2.webampskins.org/skins/1b7ddafff0f7e03210d534ed7584300a.wsz",
  "soundcloud://Winamp-Llama.mp3":
    "https://soundcloud.com/avishay-bassa/winamp-it-really-whips-the",
};

const VIRTUAL_MEDIA_METADATA: Record<
  string,
  Partial<Pick<VirtualMediaTarget, "title" | "artist" | "artwork">>
> = {
  "soundcloud://Winamp-Llama.mp3": {
    title: "It Really Whips the Llama's Ass",
    artist: "Winamp",
  },
};

export type VirtualMediaKind = "webamp-skin" | "soundcloud-track";

export interface VirtualMediaTarget {
  kind: VirtualMediaKind;
  uri: string;
  url: string;
  name: string;
  title?: string;
  artist?: string;
  artwork?: string | null;
}

interface VfsLike {
  existsSync(path: string): boolean;
  mkdirSync(path: string, options?: { recursive?: boolean }): unknown;
  writeFileSync(path: string, data: string): unknown;
  readFileSync(path: string, encoding?: string): string | Uint8Array;
}

function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function ensureDir(vfs: VfsLike, path: string): void {
  if (!vfs.existsSync(path)) {
    vfs.mkdirSync(path, { recursive: true });
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function labelFromUri(uri: string): string {
  if (uri.startsWith(WEBAMP_SKIN_SCHEME)) {
    return safeDecode(uri.slice(WEBAMP_SKIN_SCHEME.length));
  }
  if (uri.startsWith(SOUNDCLOUD_SCHEME)) {
    return safeDecode(uri.slice(SOUNDCLOUD_SCHEME.length));
  }
  return uri;
}

function kindFromUri(uri: string): VirtualMediaKind | null {
  if (uri.startsWith(WEBAMP_SKIN_SCHEME)) return "webamp-skin";
  if (uri.startsWith(SOUNDCLOUD_SCHEME)) return "soundcloud-track";
  return null;
}

function virtualUriToVfsPath(uri: string): string | null {
  const name = labelFromUri(uri).replace(/[\\/]/g, "-").trim();
  if (!name) return null;
  if (uri.startsWith(WEBAMP_SKIN_SCHEME)) return `${WEBAMP_SKINS_DIR}/${name}`;
  if (uri.startsWith(SOUNDCLOUD_SCHEME)) return `${SOUNDCLOUD_LINKS_DIR}/${name}`;
  return null;
}

function uriFromVfsPath(path: string): string | null {
  if (path.startsWith(`${WEBAMP_SKINS_DIR}/`)) {
    return `${WEBAMP_SKIN_SCHEME}${basename(path)}`;
  }
  if (path.startsWith(`${SOUNDCLOUD_LINKS_DIR}/`)) {
    return `${SOUNDCLOUD_SCHEME}${basename(path)}`;
  }
  return null;
}

function targetFromUri(uri: string, url: string): VirtualMediaTarget | null {
  const kind = kindFromUri(uri);
  if (!kind || !url) return null;
  const name = labelFromUri(uri);
  const metadata = VIRTUAL_MEDIA_METADATA[uri] ?? {};
  return {
    kind,
    uri,
    url,
    name,
    title: metadata.title ?? (kind === "soundcloud-track" ? name.replace(/\.mp3$/i, "") : name),
    artist: metadata.artist ?? (kind === "soundcloud-track" ? "SoundCloud" : undefined),
    artwork: metadata.artwork,
  };
}

function readMap(vfs?: VfsLike): Record<string, string> {
  if (!vfs || !vfs.existsSync(VIRTUAL_MEDIA_MAP_PATH)) return { ...VIRTUAL_MEDIA_URL_MAP };
  try {
    const parsed = JSON.parse(String(vfs.readFileSync(VIRTUAL_MEDIA_MAP_PATH, "utf8"))) as Record<
      string,
      unknown
    >;
    const userMap: Record<string, string> = {};
    for (const [uri, url] of Object.entries(parsed)) {
      if (typeof url === "string") userMap[uri] = url;
    }
    return { ...VIRTUAL_MEDIA_URL_MAP, ...userMap };
  } catch {
    return { ...VIRTUAL_MEDIA_URL_MAP };
  }
}

export function encodeVirtualMediaLink(target: VirtualMediaTarget): string {
  return `${VIRTUAL_LINK_MAGIC}\n${JSON.stringify(target, null, 2)}\n`;
}

export function decodeVirtualMediaLink(text: string): VirtualMediaTarget | null {
  if (!text.startsWith(VIRTUAL_LINK_MAGIC)) return null;
  try {
    const parsed = JSON.parse(text.slice(text.indexOf("\n") + 1)) as VirtualMediaTarget;
    if (parsed && kindFromUri(parsed.uri) === parsed.kind && typeof parsed.url === "string") {
      return parsed;
    }
  } catch {
    /* corrupt link */
  }
  return null;
}

export function resolveVirtualMediaTarget(pathOrUri: string, vfs?: VfsLike): VirtualMediaTarget | null {
  const map = readMap(vfs);
  const direct = map[pathOrUri];
  if (direct) return targetFromUri(pathOrUri, direct);

  if (vfs) {
    try {
      const raw = String(vfs.readFileSync(pathOrUri, "utf8"));
      const linked = decodeVirtualMediaLink(raw);
      if (linked) return linked;
      const url = raw.trim();
      const uri = uriFromVfsPath(pathOrUri);
      if (uri && /^https?:\/\//i.test(url)) {
        return targetFromUri(uri, url);
      }
    } catch {
      /* not a readable virtual link file */
    }
  }

  const uri = uriFromVfsPath(pathOrUri);
  if (uri && map[uri]) return targetFromUri(uri, map[uri]);

  return null;
}

export function seedVirtualMediaLinks(vfs: VfsLike): void {
  ensureDir(vfs, dirname(VIRTUAL_MEDIA_MAP_PATH));
  ensureDir(vfs, WEBAMP_SKINS_DIR);
  ensureDir(vfs, SOUNDCLOUD_LINKS_DIR);

  const map = readMap(vfs);
  vfs.writeFileSync(VIRTUAL_MEDIA_MAP_PATH, `${JSON.stringify(map, null, 2)}\n`);

  for (const [uri, url] of Object.entries(map)) {
    const path = virtualUriToVfsPath(uri);
    const target = targetFromUri(uri, url);
    if (!path || !target) continue;
    vfs.writeFileSync(path, encodeVirtualMediaLink(target));
  }
}

export function targetToVirtualMp3(target: VirtualMediaTarget): VirtualMp3 | null {
  if (target.kind !== "soundcloud-track") return null;
  return {
    url: target.url,
    title: target.title ?? target.name.replace(/\.mp3$/i, ""),
    artist: target.artist ?? "SoundCloud",
    artwork: target.artwork ?? null,
  };
}
