# Task: Upstream pointer-events CSS to the webamp fork (optional)

**Priority:** P4 (optional, non-blocking) · **Area:** vendor/webamp · **Deps:** winamp-css-clickthrough

## Context

The cleaner long-term default for webamp is `#webamp { pointer-events: none }` + per-window `pointer-events: auto` in `vendor/webamp/packages/webamp/css/webamp.css` — matching upstream's own stated intent (App.tsx comment about "not interfering with click events outside our windows"). almost-os ships the app-level CSS (task-winamp-css-clickthrough) because:

- almost-os consumes **npm webamp@2.3.1**, not the vendor/webamp fork (verified: pnpm-lock, workspace globs exclude vendor/).
- The fork cannot publish to npm — its publish CI is gated `if: github.repository == 'captbaritone/webamp'` (`.github/workflows/ci.yml:51`).

## Work

1. Commit the CSS change to the BLamy fork (`vendor/webamp` submodule) on a branch.
2. Open a PR upstream to captbaritone/webamp.
3. If ever the app switches to consuming the fork (workspace-link `vendor/webamp/packages/webamp` + run its rollup build), the app-level CSS in os.css can be dropped.

Keep the app-level CSS until an upstream release ships.
