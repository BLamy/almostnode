# Task: Winamp transparent background + click-through

**Priority:** P0 · **Area:** almost-os · **Deps:** none

## Problem

Winamp's frameless full-work-area window paints a dark sheet over the whole desktop, and clicks on "empty" regions don't reach underlying windows/desktop.

## Root causes (verified)

1. **Dark sheet**: NOT `.webamp-host { background:#232323 }` (its frameless override wins on specificity). The culprit is `:root[data-appearance="dark"] .os-window__body { background:#1e1e22 }` (`src/styles/os.css:2925-2927`) — same specificity (0,3,0) as the frameless transparent rule (`os.css:744-748`) but later in source order, so in dark mode it wins and paints the full-work-area frameless body dark.
2. **Click shield**: `.os-window.is-frameless .webamp-host > * { pointer-events:auto }` (`os.css:2298-2300`) re-enables pointers on `#webamp` (Webamp's root, a direct child of `.webamp-host`). `#webamp` is normally 0×0, but webamp's resize-measurement hack (`App.tsx:87-93` — sets `right:0; bottom:0` then restores) makes it full-size on every browser resize, and permanently if that handler throws. When full-size + pointer-events:auto, it's an invisible full-area click shield.

## Changes (all in `src/styles/os.css`)

1. `:2286` — delete `background: #232323;` from `.webamp-host` (Winamp only ever opens frameless; the dark fill is dead weight). The now-redundant `background: transparent` in the `:2293` frameless override can go too (keep `overflow: visible; pointer-events: none`).
2. `:2925` — scope the dark-mode rule away from frameless windows:
   ```css
   :root[data-appearance="dark"] .os-window:not(.is-frameless) .os-window__body { background: #1e1e22; }
   ```
3. `:2298-2300` — invert the pointer-events scheme; never let webamp's root capture:
   ```css
   .os-window.is-frameless .webamp-host #webamp { pointer-events: none; }
   .os-window.is-frameless .webamp-host #webamp #main-window,
   .os-window.is-frameless .webamp-host #webamp #equalizer-window,
   .os-window.is-frameless .webamp-host #webamp #playlist-window,
   .os-window.is-frameless .webamp-host #webamp .gen-window {
     pointer-events: auto;
   }
   ```
   (`pointer-events` inherits, so window contents stay interactive; drag handlers on webamp's wrapper divs still fire via bubbling. `#webamp-context-menu` portals to `document.body`, outside this chain — unaffected.)
4. After editing, re-grep `data-appearance` rules in os.css for any other `(0,3,0)+` rule that could hit frameless subtrees.

## Verification

- Dark AND light appearance: open Winamp → desktop fully visible behind/between the Webamp windows.
- Click desktop icons / another window between Winamp windows → they respond. In devtools: `document.elementFromPoint(x,y)` over empty space returns a desktop element, never `#webamp` — including **after resizing the browser window** (triggers webamp's measurement hack).
- Main/EQ/playlist windows still draggable + all controls clickable; right-click context menu still works.
