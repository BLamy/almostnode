import { useEffect, useRef } from "react";
import Webamp from "webamp";
import type { Track } from "webamp";
import {
  getPlayerSnapshot,
  playerSubscribe,
  playUrl,
  type PlayerState,
} from "../../media/player-store";
import { resolveTrack } from "../../media/soundcloud-api";
import { useWinampSkin } from "./winamp-store";

// The real Webamp (Winamp 2 in HTML5) is the skinnable player shell. Actual
// audio comes from the shared SoundCloud widget (media/player-store) — Webamp is
// muted so we never double up. Webamp gives us: authentic .wsz skins (applied
// from the desktop "Winamp Skins" folder), the Add-URL button (rewired to accept
// SoundCloud URLs), and the visual now-playing. Transport truth lives in the
// player store, which Napster downloads, Finder double-clicks, the `sc` CLI and
// the OpenCode agent all drive.

function webampTrack(url: string, title: string, artist?: string): Track {
  return { url, metaData: { artist: artist ?? "", title } };
}

export function WinampApp() {
  const hostRef = useRef<HTMLDivElement>(null);
  const webampRef = useRef<Webamp | null>(null);
  const skin = useWinampSkin();
  // Suppress the Webamp→widget bridge while we programmatically drive Webamp,
  // so player-store→Webamp reflection doesn't loop back.
  const suppressRef = useRef(false);
  const lastReflectedUrl = useRef<string | null>(null);

  // Mount Webamp once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || webampRef.current) return;
    let disposed = false;

    // The Add-URL button: prompt for a SoundCloud link, play it through the
    // shared widget, and hand Webamp a display row for it.
    const handleAddUrlEvent = async (): Promise<Track[] | null> => {
      const input = window.prompt("Add a SoundCloud track URL:");
      const url = input?.trim();
      if (!url) return null;
      let title = url.replace(/^https?:\/\//, "");
      let artist = "SoundCloud";
      try {
        const t = await resolveTrack(url);
        title = t.title;
        artist = t.artist;
      } catch {
        /* not signed in / unresolvable — still playable by the keyless widget */
      }
      playUrl(url, { title, artist });
      lastReflectedUrl.current = url;
      return [webampTrack(url, title, artist)];
    };

    const webamp = new Webamp({
      handleAddUrlEvent,
      ...(skin.skinUrl ? { initialSkin: { url: skin.skinUrl } } : {}),
    });
    webampRef.current = webamp;

    // renderInto keeps Webamp contained within the app window (renderWhenReady
    // would overlay the whole desktop).
    void webamp.renderInto(host).then(() => {
      if (disposed) return;
      // Mute Webamp's own <audio>; the shared widget is the real sound.
      webamp.setVolume(0);
      // When the user drives Webamp (clicks a playlist row / next / prev),
      // point the widget at that track. Guarded against our own reflection.
      webamp.onTrackDidChange((info) => {
        if (suppressRef.current || !info?.url) return;
        if (info.url === lastReflectedUrl.current) return;
        lastReflectedUrl.current = info.url;
        playUrl(info.url, {
          title: info.metaData?.title ?? info.url,
          artist: info.metaData?.artist ?? undefined,
        });
      });
    });

    return () => {
      disposed = true;
      try {
        webamp.dispose();
      } catch {
        /* ignore */
      }
      webampRef.current = null;
    };
    // Mount once; skin changes handled in a separate effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Apply skins as the winamp-store changes (Finder → .wsz double-click).
  useEffect(() => {
    if (skin.skinUrl && webampRef.current) {
      webampRef.current.setSkinFromUrl(skin.skinUrl);
    }
  }, [skin.skinUrl]);

  // Reflect the shared player's current track into Webamp's display so the
  // marquee shows what the widget is actually playing (from Finder/CLI/Napster).
  useEffect(() => {
    const reflect = (s: PlayerState) => {
      const track = s.queue[s.index];
      const webamp = webampRef.current;
      if (!webamp || !track || track.url === lastReflectedUrl.current) return;
      lastReflectedUrl.current = track.url;
      suppressRef.current = true;
      try {
        webamp.setTracksToPlay([webampTrack(track.url, track.title, track.artist)]);
      } catch {
        /* webamp not ready yet */
      }
      // Release the guard after Webamp's async track-change has settled.
      window.setTimeout(() => {
        suppressRef.current = false;
      }, 300);
    };
    const unsub = playerSubscribe(() => reflect(getPlayerSnapshot()));
    reflect(getPlayerSnapshot());
    return unsub;
  }, []);

  return <div ref={hostRef} className="webamp-host" />;
}
