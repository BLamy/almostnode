# Task: Napster download button becomes Play after download

**Priority:** P1 · **Area:** almost-os · **Deps:** none (better with webamp-custom-media)

## Problem

After downloading a track in Napster, the row button becomes an inert "✓ Downloaded". The user wants it to become a **Play** button that adds the track to Winamp and plays it. Today that affordance exists only as a double-click in My Library (`playFromLibrary`, `src/apps/napster/NapsterApp.tsx:157-163` → `playVirtualMp3(entry.payload)` + `system.openApp("winamp")`).

## Changes (`src/apps/napster/NapsterApp.tsx`)

1. `TrackCard` (:315-345): when `downloaded`, render a "▶ Play" primary button instead of "✓ Downloaded"; keep a small "✓" badge so downloaded state stays visible. onClick → play action (below), not re-download.
2. Top-10 compact variant (`napster__dl--sm`, :413-419): same — "▶" when downloaded.
3. Play action: reuse `playFromLibrary` logic — look up the library entry by `permalinkUrl` (the `library` memo already maps downloads); if found, `playVirtualMp3(entry.payload)` + `system.openApp("winamp")`. Fallback: construct the `VirtualMp3` payload directly from the track metadata (identical fields to what `download()` wrote — see `src/media/virtual-mp3.ts`).
4. CSS: add a `.is-play` style for the button in the Napster stylesheet section of `os.css` (match existing `napster__dl`/`is-done` styling).

## Verification

- Search a track → Download → button flips to "▶ Play" (with ✓ badge) → click → Winamp opens/raises and the track plays (seek bar advancing if webamp-custom-media landed).
- Top-10 list behaves the same. My Library double-click still works.
- Re-render after VFS change still marks downloads correctly (the `downloadedUrls` set drives the state).
