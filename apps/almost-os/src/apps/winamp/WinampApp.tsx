import { useCallback, useEffect, useRef } from "react";
import Webamp from "webamp";
import type { Track } from "webamp";
import {
  getPlayerSnapshot,
  playerSubscribe,
  playUrl,
  type PlayerState,
} from "../../media/player-store";
import { resolveTrack } from "../../media/soundcloud-api";
import { useMaybeWindow } from "../../windows/WindowContext";
import { PlayerStoreMedia, withSuppressedReflection } from "./webamp-media";
import { useWinampSkin } from "./winamp-store";

// The real Webamp (Winamp 2 in HTML5) is the skinnable player shell. Its media
// backend is PlayerStoreMedia (`__customMediaClass`) — an adapter over the
// shared player store, whose engines (SoundCloud widget / <audio> file engine)
// make the actual sound. That means Webamp's transport buttons, seekbar, time
// display and volume are all live against the real playback. The store is the
// transport truth, driven equally by Napster downloads, Finder double-clicks,
// the `sc` CLI and the OpenCode agent; this component mirrors its queue into
// Webamp's playlist.

function webampTrack(url: string, title: string, artist?: string, durationMs?: number): Track {
  return {
    url,
    metaData: { artist: artist ?? "", title },
    // Known duration skips Webamp's own metadata fetch (which can't resolve
    // SoundCloud permalink pages).
    ...(durationMs && durationMs > 0 ? { duration: durationMs / 1000 } : {}),
  };
}

function toWebampTracks(queue: PlayerState["queue"]): Track[] {
  return queue.map((t) => webampTrack(t.url, t.title, t.artist, t.durationMs));
}

export function WinampApp() {
  const hostRef = useRef<HTMLDivElement>(null);
  const webampRef = useRef<Webamp | null>(null);
  const win = useMaybeWindow();
  const skin = useWinampSkin();
  const lastReflectedUrl = useRef<string | null>(null);
  // How many player-queue entries we've mirrored into Webamp's playlist.
  const syncedLen = useRef(0);
  // Keep a live ref to the close callback so the (once-bound) Webamp onClose
  // handler always calls the current one.
  const closeRef = useRef<(() => void) | undefined>(win?.close);
  closeRef.current = win?.close;

  // Converge Webamp's play/pause status onto the store's. Webamp's play()/
  // pause() dispatch through mediaMiddleware back into the store — idempotent
  // when already in the target state, so this settles instead of looping.
  const convergePlayState = useCallback((s: PlayerState) => {
    const webamp = webampRef.current;
    if (!webamp) return;
    try {
      const status = webamp.getMediaStatus();
      if (s.playing && status !== "PLAYING") webamp.play();
      else if (!s.playing && status === "PLAYING") webamp.pause();
    } catch {
      /* webamp not ready */
    }
  }, []);

  // Mirror the player-store queue into Webamp's own playlist so the classic demo
  // track (and anything queued from Finder/CLI/Napster) actually shows up in the
  // Winamp playlist window, and highlight the current track.
  const syncPlaylist = useCallback(
    (s: PlayerState) => {
      const webamp = webampRef.current;
      if (!webamp) return;
      const queue = s.queue;
      withSuppressedReflection(() => {
        try {
          if (syncedLen.current === 0 || queue.length < syncedLen.current) {
            // First fill, or the queue shrank/was replaced → rebuild from scratch.
            if (queue.length > 0) {
              webamp.setTracksToPlay(toWebampTracks(queue));
            }
            syncedLen.current = queue.length;
          } else if (queue.length > syncedLen.current) {
            // Queue grew → append only the new tail, preserving the existing list.
            webamp.appendTracks(toWebampTracks(queue.slice(syncedLen.current)));
            syncedLen.current = queue.length;
          }
          const current = queue[s.index];
          if (current && s.index >= 0) {
            webamp.setCurrentTrack(s.index);
            lastReflectedUrl.current = current.url;
          }
        } catch {
          /* webamp not ready / transient */
        }
      });
      // setTracksToPlay/setCurrentTrack leave Webamp thinking it's playing;
      // settle its status onto the store's truth.
      convergePlayState(s);
    },
    [convergePlayState],
  );

  // Mount Webamp once.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || webampRef.current) return;
    let disposed = false;

    // The Add-URL button: prompt for a SoundCloud link and play it through the
    // store. Return null — the store enqueue reflects back into the playlist,
    // so also returning the track here would duplicate the row.
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
      return null;
    };

    const webamp = new Webamp({
      handleAddUrlEvent,
      __customMediaClass: PlayerStoreMedia,
      ...(skin.skinUrl ? { initialSkin: { url: skin.skinUrl } } : {}),
    });
    webampRef.current = webamp;

    // renderInto keeps Webamp contained within the app window (renderWhenReady
    // would overlay the whole desktop).
    void webamp.renderInto(host).then(() => {
      if (disposed) return;
      // Align Webamp's volume slider with the store (its default is 50).
      webamp.setVolume(getPlayerSnapshot().volume);
      // Seed Webamp's playlist from whatever the player already has queued.
      syncPlaylist(getPlayerSnapshot());
    });

    // Webamp's own close button is the only close affordance (the OS window is
    // frameless), so route it to closing the OS window.
    const unsubClose = webamp.onClose(() => {
      closeRef.current?.();
    });

    return () => {
      disposed = true;
      try {
        unsubClose();
      } catch {
        /* ignore */
      }
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

  // Reflect the shared player's queue/current track/play state into Webamp so
  // the playlist, marquee and transport lights match the real playback
  // (Finder/CLI/Napster all drive the store directly).
  useEffect(() => {
    const reflect = (s: PlayerState) => {
      const webamp = webampRef.current;
      if (!webamp) return;
      // Queue changed size → (re)sync the whole playlist.
      if (s.queue.length !== syncedLen.current) {
        syncPlaylist(s);
        return;
      }
      // Same queue, different current track (e.g. next/prev from the CLI).
      const current = s.queue[s.index];
      if (current && current.url !== lastReflectedUrl.current) {
        lastReflectedUrl.current = current.url;
        withSuppressedReflection(() => {
          try {
            webamp.setCurrentTrack(s.index);
          } catch {
            /* webamp not ready yet */
          }
        });
      }
      convergePlayState(s);
    };
    const unsub = playerSubscribe(() => reflect(getPlayerSnapshot()));
    reflect(getPlayerSnapshot());
    return unsub;
  }, [syncPlaylist, convergePlayState]);

  return <div ref={hostRef} className="webamp-host" />;
}
