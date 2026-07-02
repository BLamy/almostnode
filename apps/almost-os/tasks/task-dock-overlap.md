# Task: Fix dock overlapping window content

**Priority:** P0 · **Area:** almost-os · **Deps:** none

## Problem

The dock (z-index 9000, absolute bottom strip: bottom 10px + height 70px + padding → occupies roughly the bottom 90px of the viewport) always paints above every app window (windows get z 2..N). Nothing reserves that strip, so window bottoms — and any content scrolled to the bottom of a window — are occluded by the dock, and the dock intercepts clicks over that area.

## Root cause

- `DOCK_RESERVE = 96` (`src/windows/window-store.ts:4`) is only used in two places:
  - `clampPosition` maxY (limits where a window's *top* can be dragged), and
  - `toggleMaximize`, whose height formula has a `+ 28` fudge (`window-store.ts:235`): `height = viewport.height - MENUBAR_HEIGHT - DOCK_RESERVE + 28`, leaving even maximized windows ~12px under the dock (dock top edge = viewport − 80).
- `Window.tsx` drag (`startDrag`, :26-55) and resize handlers only clamp against `MENUBAR_HEIGHT`; no bottom clamp at all.
- New-window placement (cascade in `window-store.ts:106-115` / :141-149) doesn't clamp window bottom either.

## Changes

1. `src/windows/window-store.ts`
   - Remove the `+ 28` fudge in `toggleMaximize` so a maximized window is exactly `MENUBAR_HEIGHT .. viewport.height - DOCK_RESERVE`.
   - Verify `DOCK_RESERVE` actually clears the dock strip (dock occupies bottom 80px; 96 gives a 16px gap — fine).
   - In the `open`/`openWindow` placement, clamp height/y so `y + height <= viewport.height - DOCK_RESERVE` when the viewport is known (shrink height rather than reject).
2. `src/windows/Window.tsx`
   - Resize handlers (s/se/sw + corners): clamp `height` so the bottom edge stays above `viewport.height - DOCK_RESERVE`.
   - Drag: optionally allow dragging a window partially below (macOS allows it) BUT ensure the titlebar can always be reached; minimum change is keeping the current top clamp. Decide during implementation; the must-fix is maximize + resize + initial placement.

Keep `DOCK_RESERVE` as the single source of truth for the reserved strip.

## Verification

- `pnpm nx dev almost-os`, then: maximize Finder → bottom edge fully visible above the dock (no occlusion, traffic-light row + bottom content clickable).
- Resize a window toward the bottom → it stops above the dock.
- Open several windows (cascade) → none spawn under the dock.
- `pnpm --filter almost-os type-check`.
