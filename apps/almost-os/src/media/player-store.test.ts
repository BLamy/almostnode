import { describe, expect, it } from "vitest";
import { isSoundCloudUrl } from "./player-store";

// Engine routing: SoundCloud URLs → widget engine, everything else → <audio>.
describe("isSoundCloudUrl", () => {
  it("routes soundcloud.com permalinks to the widget engine", () => {
    expect(isSoundCloudUrl("https://soundcloud.com/artist/track")).toBe(true);
    expect(isSoundCloudUrl("http://soundcloud.com/artist/track")).toBe(true);
    expect(isSoundCloudUrl("https://api.soundcloud.com/tracks/123")).toBe(true);
    expect(isSoundCloudUrl("https://on.soundcloud.com/abc")).toBe(true);
    expect(isSoundCloudUrl("https://snd.sc/abc")).toBe(true);
  });

  it("routes local and generic http media to the file engine", () => {
    expect(isSoundCloudUrl("/media/llama.mp3")).toBe(false);
    expect(isSoundCloudUrl("media/llama.mp3")).toBe(false);
    expect(isSoundCloudUrl("https://example.com/song.mp3")).toBe(false);
    expect(isSoundCloudUrl("blob:https://example.com/uuid")).toBe(false);
  });

  it("does not treat lookalike hosts as SoundCloud", () => {
    expect(isSoundCloudUrl("https://notsoundcloud.com/x")).toBe(false);
    expect(isSoundCloudUrl("https://soundcloud.com.evil.com/x")).toBe(false);
  });
});
