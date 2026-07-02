# Task: Dual-engine player-store + classic llama default track

**Priority:** P1 · **Area:** almost-os · **Deps:** none

## Problem

Winamp should default to the classic "DJ Mike Llama — Llama Whippin' Intro" (DEMO.mp3, ~5.32s). Today the seed (`SEED_TRACK`, `src/media/player-store.ts:37-41`) is a SoundCloud re-upload, because the only audio engine is the hidden SoundCloud widget iframe — which can ONLY load soundcloud.com URLs. A local mp3 cannot play at all.

## Design

Keep `player-store.ts` as the single source of truth and add a second minimal engine: a module-owned `HTMLAudioElement` for non-SoundCloud URLs. (Rejected alternative: Webamp `initialTracks` + unmuting — invisible to the store queue, breaks the CLI/agent bridge, requires Winamp open for the track to exist.)

## Changes

1. **Asset**: copy `vendor/webamp/packages/webamp-demo/mp3/llama-2.91.mp3` → `apps/almost-os/public/media/llama.mp3` (38,789 bytes).
2. **`src/media/player-store.ts`**:
   - `isSoundCloudUrl(url)`: hosts `soundcloud.com` / `snd.sc` / `api.soundcloud.com` → widget engine; everything else (relative paths, http(s) mp3, blob:) → file engine.
   - Lazy `getAudioEl()` singleton with bindings: `timeupdate → commit({posMs})`, `loadedmetadata`/`durationchange → commit({durMs}, true)`, `ended → next()`, `play`/`pause → commit({playing}, true)`, `error → console.warn`. Initialize volume from `state.volume`.
   - Route by current track's engine in `loadCurrent` (:152-157 — remove the `!widget` early-return for file tracks; pause the inactive engine when switching), and in `play/pause/toggle/stop/seek/setVolume` (:202-238). `refreshNow` stays widget-only; file tracks set `now`/`durMs` from metadata + the audio element.
   - `setVolume` equality guard: `if (volume === state.volume) return;` (needed by the webamp-custom-media task to prevent ping-pong).
   - Optional `durationMs?: number` on `PlayerTrack`; seed llama with `5322`.
   - New seed:
     ```ts
     const SEED_TRACK: PlayerTrack = {
       url: `${import.meta.env.BASE_URL}media/llama.mp3`,
       title: "Llama Whippin' Intro",
       artist: "DJ Mike Llama",
     };
     ```
     (BASE_URL pattern precedent: `src/os/icons.tsx:112`.)
   - Check `virtual-url-map.ts:33-45` + `PlayerHost.tsx:8` (`SEED_URL`) — the widget iframe still needs a SoundCloud URL for its initial embed; keep SEED_URL as-is (it's just the widget bootstrap, not the queue).
3. **Test**: vitest for engine routing (`isSoundCloudUrl`, loadCurrent dispatch) — precedent: `src/media/virtual-url-map.test.ts`.

## Risks

- Autoplay policy: `audioEl.play()` without a user gesture can reject — catch + log (same exposure as the widget today).
- `seedQueue()` runs before widget readiness (`attachIframe`) — file engine makes the seed playable even if SC embeds are blocked (bonus robustness).

## Verification

- Fresh load → Winamp playlist shows "DJ Mike Llama - Llama Whippin' Intro"; press play → ~5.3s of audio; track end doesn't crash (advances via `ended → next()`).
- SoundCloud tracks (Napster download, `napster play <query>` CLI, Finder vmp3 double-click) still play through the widget.
- `pnpm --filter almost-os test` (new vitest passes), `pnpm --filter almost-os type-check`.
