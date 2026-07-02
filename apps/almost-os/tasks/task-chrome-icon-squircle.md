# Task: Squircle the Chrome dock icon

**Priority:** P0 · **Area:** almost-os · **Deps:** none

## Problem

Every dock icon except Chrome is an SVG that bakes in a macOS-style rounded square via the shared `IconFrame` helper (`<rect x=2 y=2 width=60 height=60 rx=14 …>`, `src/os/icons.tsx:12-24`). `ChromeIcon` (`src/os/icons.tsx:109-119`) renders a raw `<img src=chrome-icon.png>` (1.15MB PNG in `public/`) with `objectFit: contain` and no mask — so it shows square/circular, visibly inconsistent with the rest of the dock.

## Changes

`src/os/icons.tsx` — `ChromeIcon`:
- Wrap/style the `<img>` with the same geometry as `IconFrame`: the SVG rect is inset 2/64 with radius 14/60 → apply `borderRadius: "22%"`, `overflow: "hidden"` and a ~3% inset (or just border-radius on the img itself with `objectFit: "cover"`) so the visible shape matches the SVG icons.
- Keep `display: block` and the drop-shadow parity (shadow comes from `.os-dock__icon { filter: drop-shadow(...) }` — note drop-shadow follows the alpha channel, so after rounding it follows the squircle automatically only if the rounding is real transparency; `border-radius + overflow:hidden` on a wrapper div achieves that for the filter on the parent).

Optional (nice-to-have, don't block): downscale `public/chrome-icon.png` (1.15MB is heavy for a 54px icon).

## Verification

- Dock: Chrome icon corners match Terminal/Finder/etc.
- Hover magnification still smooth (transform is on the parent button; no layout shift).
