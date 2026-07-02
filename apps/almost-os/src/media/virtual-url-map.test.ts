import { describe, expect, it } from "vitest";
import {
  SOUNDCLOUD_LINKS_DIR,
  VIRTUAL_MEDIA_MAP_PATH,
  WEBAMP_SKINS_DIR,
  VIRTUAL_MEDIA_URL_MAP,
  resolveVirtualMediaTarget,
  seedVirtualMediaLinks,
} from "./virtual-url-map";

class MemoryVfs {
  private readonly files = new Map<string, string>();
  private readonly dirs = new Set<string>(["/"]);

  existsSync(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  mkdirSync(path: string): void {
    this.dirs.add(path);
  }

  writeFileSync(path: string, data: string): void {
    this.files.set(path, data);
  }

  readFileSync(path: string): string {
    const value = this.files.get(path);
    if (value == null) throw new Error(`ENOENT: ${path}`);
    return value;
  }
}

describe("virtual media URL map", () => {
  it("seeds the editable map and generated VFS link files", () => {
    const vfs = new MemoryVfs();

    seedVirtualMediaLinks(vfs);

    expect(JSON.parse(vfs.readFileSync(VIRTUAL_MEDIA_MAP_PATH))).toMatchObject(
      VIRTUAL_MEDIA_URL_MAP,
    );
    expect(resolveVirtualMediaTarget(`${WEBAMP_SKINS_DIR}/Garfield.wsz`, vfs)).toMatchObject({
      kind: "webamp-skin",
      uri: "webamp+skins://Garfield.wsz",
      url: VIRTUAL_MEDIA_URL_MAP["webamp+skins://Garfield.wsz"],
      name: "Garfield.wsz",
    });
    expect(resolveVirtualMediaTarget(`${SOUNDCLOUD_LINKS_DIR}/Winamp-Llama.mp3`, vfs)).toMatchObject({
      kind: "soundcloud-track",
      uri: "soundcloud://Winamp-Llama.mp3",
      url: VIRTUAL_MEDIA_URL_MAP["soundcloud://Winamp-Llama.mp3"],
      title: "It Really Whips the Llama's Ass",
      artist: "Winamp",
    });
  });

  it("resolves direct scheme URIs from the map", () => {
    expect(resolveVirtualMediaTarget("webamp+skins://Garfield.wsz")).toMatchObject({
      kind: "webamp-skin",
      url: VIRTUAL_MEDIA_URL_MAP["webamp+skins://Garfield.wsz"],
    });
    expect(resolveVirtualMediaTarget("soundcloud://Winamp-Llama.mp3")).toMatchObject({
      kind: "soundcloud-track",
      url: VIRTUAL_MEDIA_URL_MAP["soundcloud://Winamp-Llama.mp3"],
    });
  });

  it("keeps user-added map entries when seeding", () => {
    const vfs = new MemoryVfs();
    vfs.mkdirSync("/home/user/.winamp");
    vfs.writeFileSync(
      VIRTUAL_MEDIA_MAP_PATH,
      JSON.stringify({
        "webamp+skins://Custom.wsz": "https://example.test/custom.wsz",
      }),
    );

    seedVirtualMediaLinks(vfs);

    expect(resolveVirtualMediaTarget(`${WEBAMP_SKINS_DIR}/Custom.wsz`, vfs)).toMatchObject({
      kind: "webamp-skin",
      uri: "webamp+skins://Custom.wsz",
      url: "https://example.test/custom.wsz",
    });
    expect(JSON.parse(vfs.readFileSync(VIRTUAL_MEDIA_MAP_PATH))).toMatchObject({
      ...VIRTUAL_MEDIA_URL_MAP,
      "webamp+skins://Custom.wsz": "https://example.test/custom.wsz",
    });
  });
});
