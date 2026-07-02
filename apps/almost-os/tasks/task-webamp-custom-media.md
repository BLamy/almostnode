# Task: Webamp custom media backend (live seek bar, time, transport)

**Priority:** P1 · **Area:** almost-os · **Deps:** player-store-file-engine

## Problem

Webamp's seek bar and time digits never advance, and its transport is bridged through fragile status-diffing. Audio plays through the SoundCloud widget; Webamp's `<audio>` is muted (`setVolume(0)`) and fed a SoundCloud **permalink page URL** (not media), so its Redux `timeElapsed`/duration never update. Widget `PLAY_PROGRESS`→`posMs` and `durMs` land in player-store but are never forwarded to Webamp (`WinampApp.tsx:189-216` ignores them).

## Design (verified)

webamp@2.3.1 ships a public seam for exactly this: `new Webamp({ __customMediaClass })` (typed in `built/types/js/webampLazy.d.ts:7-11`; maintained for winampify's Spotify backend, see fork `js/media/index.ts:91-93`). Implementing webamp's `IMedia` contract over player-store makes transport buttons, seekbar (both directions), time display, and volume all coherent through webamp's own `mediaMiddleware` — no Redux poking, no fork changes.

## Changes

1. **New `src/apps/winamp/webamp-media.ts`** — `PlayerStoreMedia` implementing `IMedia` (type via `InstanceType<typeof Webamp>["media"]`):
   - `play/pause/stop` → store `play()/pause()/stop()`.
   - `seekToPercentComplete(p)` → `seek(getPlayerSnapshot().durMs * p / 100)` (fixes seekbar dragging → audio).
   - `timeElapsed()` → `posMs/1000`; `duration()` → `durMs/1000`.
   - `loadFromUrl(url, autoPlay)`: if reflection-suppressed → no-op; if url === current track → resume if `autoPlay && !playing`; else find url in store queue → `playIndex(i, autoPlay)`; fallback `playUrl(url)`.
   - `setVolume(v)` → store `setVolume(v)` (requires the equality guard from the file-engine task).
   - `setBalance/setPreamp/setEqBand/disableEq/enableEq` → no-ops. `getAnalyser()` → lazy silent `AudioContext().createAnalyser()` (cross-origin iframe audio can't be analyzed; visualizer stays flat — documented limitation).
   - Events from ONE `playerSubscribe` subscription diffing snapshots: `posMs` change → emit `"timeupdate"`; `playing` false→true → `"playing"`; current-url or `durMs` change → `"fileLoaded"` (drives `SET_MEDIA length`). **Never emit `"ended"`** — mediaMiddleware would advance Webamp's own playlist and double-advance against store `FINISH → next()`.
   - `dispose()` → unsubscribe only (closing Winamp must NOT stop playback).
   - Export module-level `suppressReflection` flag (IMediaClass has a no-arg constructor, so coordination is module-scoped).
2. **`src/apps/winamp/WinampApp.tsx`**:
   - `new Webamp({ handleAddUrlEvent, __customMediaClass: PlayerStoreMedia, ...skin })`.
   - Delete `webamp.setVolume(0)`; set `webamp.setVolume(getPlayerSnapshot().volume)` and reflect store volume changes.
   - Delete the `__onStateChange` status-diff bridge (:145-153) — PLAY/PAUSE/STOP now flow through mediaMiddleware. In the reflect subscriber, converge play state: if `s.playing !== (webamp.getMediaStatus() === "PLAYING")` → `webamp.play()/pause()` (idempotent).
   - Delete the `onTrackDidChange` bridge (:130-138) — playlist double-click dispatches PLAY_TRACK → `loadFromUrl(url, true)` → store.
   - `handleAddUrlEvent` returns `null` after `playUrl(...)` (fixes latent duplicate playlist row).
   - `webampTrack()` gains `duration` (seconds) when known (store durMs for current; `VirtualMp3.duration` ms→s for downloads) — skips webamp's doomed `fetchMediaDuration(permalinkUrl)`.
   - Wrap all programmatic mirroring (`setTracksToPlay` etc.) in `suppressReflection` instead of the `suppressRef` timers.

## Risks

- Mirror-triggered autoplay: `setTracksToPlay` uses LOAD_STYLE.PLAY → PLAY_TRACK → `loadFromUrl(url, true)` — the suppression flag must wrap every mirror call or a queue rebuild starts playback. Test explicitly.
- `SET_MEDIA` needs webamp's current track id — emit `fileLoaded` only after the mirror set the current track (ordering already holds in `syncPlaylist`).
- Webamp shuffle/repeat don't influence store advance (pre-existing limitation; note it).

## Verification

- Time digits + seekbar advance during widget playback AND file (llama) playback.
- Dragging the seekbar jumps the audio. Playlist double-click switches tracks. Volume slider changes real volume.
- `napster` CLI `next/toggle/stop` reflect in Webamp's UI. Closing Winamp doesn't stop audio; reopening resyncs.
- `pnpm --filter almost-os type-check && pnpm --filter almost-os test`.
