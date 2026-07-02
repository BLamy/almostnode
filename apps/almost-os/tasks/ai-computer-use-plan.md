# AlmostOS AI Computer-Use — Architecture & Phased Plan

## Context

We want almost-os to host an AI that has **full understanding of and control over the whole computer**: it can drive individual apps, modify them, screenshot the desktop, debug itself with session-replay, connect to external services through authenticated "code mode," author brand-new apps that appear in the dock instantly, and do all of this behind a Codex-style 3-tier approval model. The current OpenCode chat (the popover off the menu-bar clock) is a **fake stub** (`src/chat/opencode-adapter.ts` regex-matches "list files"), so the AI today can't actually do anything.

The central finding of the research phase: **almost every primitive already exists in this monorepo or in an off-the-shelf package we can vendor.** This is an integration effort, not a from-scratch build:

| Capability | Already exists | Gap to close |
|---|---|---|
| Generic OAuth2 / OIDC / **DCR (RFC 7591)** / PKCE / device-code / refresh / passkey vault | `@agent-wasm/keychain/oauth` (discovery, `registration.ts`, `pkce.ts`, `orchestrator.ts`, `token-store.ts`, `proxy-fetch.ts`) + `codex-auth.ts` device-code | A generic `getAccessToken(serviceId)` bridge + an executor `keychain://` secret provider bound to our vault |
| **Code mode** (LLM writes TS against typed tools, secrets never enter sandbox) | `RhysSullivan/executor` — `@executor-js/sdk`, `runtime-quickjs`, `plugin-openapi`, `plugin-mcp`, **`plugin-keychain`** | Embed executor in the browser runtime; wire our keychain as its secret provider |
| MCP + OpenAPI → typed TS API (~1k tokens regardless of size) | executor's `json-schema-to-typescript` pipeline + `tools.search`/`tools.describe` | Generate the OpenAPI specs to feed it (from captured traffic) |
| App **snapshot / act by ref** (accessibility tree, React-aware fill) | `packages/almostnode/src/shims/playwright-command.ts` (`buildSnapshotTree`, `refMap`, `onPlaywrightCommand` seam) | Re-target from the single `webidePreview` iframe to the window store; add `listApps()` |
| Full-fidelity **network capture** (method/url/headers/body, per-app) | `ServerBridge.registerMiddleware` (`server-bridge.ts`) + `getServerMetadata(port)` + `NetworkController` for outbound | A recording middleware + an **OpenAPI serializer** (greenfield) |
| Real **streaming agent runtime** with tools | `@agent-wasm/sdk` `createOpenCodeAgentAdapter`, `workspace.agents.{register,mount}`, `BrowserAgent.sendMessage` (shipped, **unused**) | Wire it behind the `OpenCodeAdapter.respond` seam |
| Electron apps installed/launched **at runtime** into `/Applications/<id>` | App Store (`appstore-store.ts`) + `electron <dir>` + host bridge (Tasks 1–6 of the Electron plan, now done) | A runtime app **registry the dock reads** (Electron Tasks 7 & 9) |
| Self-debug data model | rrweb (view) + Replay.io MCP (deterministic execution: `Evaluate`/`DescribePoint`/`ReactException`); `RECORD_REPLAY_API_KEY` is already a keychain slot | rrweb instrumentation of app iframes + Replay MCP wiring |
| 3-tier approval semantics | Codex's `sandbox_mode × approval_policy` model, mapped below | Our policy gate + UI |

**Status of the prerequisite Electron work** (from the earlier "implement this" pass): Tasks 1–6 are **done and tested** (menu seam, MenuBar dropdowns, native menus, window options + quit lifecycle, screen viewport, dialog seam). Tasks **7 (app manager/packaging)** and **9 (dock integration)** remain and are hard prerequisites for AI-authored-apps-in-the-dock; Tasks 8 (native surface) and 10 (npm-install-on-launch) are independent and optional here.

---

## Architecture — the layers

```
┌──────────────────────────────────────────────────────────────────────┐
│  AI Drawer (right-side, Notification-Center slide)                     │
│   • streaming chat  • 3-mode approval selector  • approval prompts     │
└───────────────┬──────────────────────────────────────────────────────┘
                │ real agent runtime (SDK createOpenCodeAgentAdapter)
┌───────────────▼──────────────────────────────────────────────────────┐
│  Approval / Policy gate  (Ask for approval | Approve for me | Full)    │
└───────┬───────────────────────┬───────────────────────┬──────────────┘
        │ OS control            │ code mode             │ self-debug
┌───────▼────────┐   ┌──────────▼───────────┐   ┌───────▼──────────────┐
│ os-driver      │   │ executor (code mode) │   │ rrweb + Replay MCP   │
│ listApps       │   │  QuickJS sandbox     │   │  record app iframe   │
│ snapshot(app)  │   │  tools.<svc>.<op>()  │   │  Evaluate/DescribePt │
│ screenshot(app)│   │  fetch DISABLED      │   │  ReactException      │
│ act(ref,...)   │   └──────────┬───────────┘   └──────────────────────┘
└───────┬────────┘              │ secretRef (keychain://) resolved host-side
        │ window store          │ typed API from OpenAPI/MCP specs
┌───────▼────────┐   ┌──────────▼───────────┐   ┌──────────────────────┐
│ WindowManager  │   │ Network capture →    │   │ Keychain vault       │
│ per-app iframe │   │  OpenAPI serializer  │◄──┤ @agent-wasm/keychain │
│ ErrorBoundary  │   │  ServerBridge mw     │   │ DCR/OIDC/PKCE/device │
└────────────────┘   └──────────────────────┘   └──────────────────────┘
```

Everything the AI can *do* is a capability behind the **policy gate**; everything it *knows* comes from the **os-driver snapshot** + **captured network/console** + **Replay/rrweb** recordings.

---

## The 3-mode approval model (maps Codex → our UI)

Codex separates the **boundary** (`sandbox_mode`) from **when it asks** (`approval_policy`). We collapse them into the three presets from the reference screenshot. "Approve for me" requires a classifier/guardian we won't build yet, so it ships **disabled with a "Coming soon" tooltip** (matching the mockup).

| Our label | Boundary | Auto-runs | Prompts on |
|---|---|---|---|
| **Ask for approval** | read-only | reads/snapshots only | every app mutation, file write, network egress, codemode `execute` |
| **Approve for me** *(disabled — "Coming soon")* | workspace-write | edits/commands inside workspace | only actions a guardian flags unsafe (out-of-scope writes, network, destructive tools) |
| **Full access** *(default while others mature)* | unrestricted | everything | nothing |

Approval prompts should offer the richer Codex vocabulary, not just yes/no: **Approve · Approve for session · Approve & remember (this tool/host) · Deny (continue) · Stop**. This maps cleanly onto executor's own policy outcomes (`allow` / `require_approval` → pause+`executionId` / `block`), so a codemode tool call and an OS action flow through the same prompt UI.

---

## Phases

Each phase is independently shippable and verifiable. Files are concrete; seams reuse existing patterns.

### Phase 0 — Finish Electron prerequisites (Tasks 7 & 9)
> **Status:** Task 7 **done** — `electron-app-manager.ts` ships the reusable install/launch/stop lifecycle with `ALMOST_ELECTRON_APP_ID` tagging + reactive `useRunning`; App Store is a thin wrapper (7 unit tests). The `import.meta.glob('?raw')` source reorg is deferred (maintainability only). Task 9 (dock registry) is pending — its first-party `ELECTRON_APPS` entries need the app conversions (napster/tailscale/winamp) which are separate priority-3 tasks; a non-speculative slice (running Electron apps get transient dock presence via `useRunning` + `frame.appId`) can land independently.

AI-authored apps and the Executor app both need runtime app installation + dock presence.
- **Task 7** `src/apps/electron/electron-app-manager.ts` (generalize `appstore-store.ts`): `ensureInstalled/launch/launchOrFocus/stop/useRunning`; app sources move to `src/electron-apps/<id>/` real files via `import.meta.glob('?raw')`.
- **Task 9** `src/os/electron-apps.ts` runtime registry; `Dock.tsx` reads `[...DOCK_APP_ORDER, ...runtimeApps]`; window→app association via `ALMOST_ELECTRON_APP_ID` → `FrameWindow.appId` (already threaded).
- **Verify:** an app installed to `/Applications/<id>` at runtime shows a dock icon + running dot; click launches/focuses.

### Phase 1 — Crash isolation + uninstall/reinstall (contained, high-certainty)
> **Status: DONE.** `AppErrorBoundary` wraps every window's app body (5 tests); the manager's `uninstall` clears the VFS subtree + `app:<id>:*` localStorage + a registered `reset()` callback, and `reinstall` restores pristine seed files (surfaced as a "Reinstall" button in the App Store). App-data ownership convention documented in `electron-app-manager.ts`.

- **`src/windows/AppErrorBoundary.tsx`** (new): a class ErrorBoundary with fallback UI ("<App> crashed — Reload"). Wrap `<app.component />` **and** `<ElectronWindow>` at `src/windows/Window.tsx:164-167`. Reset = `wm.close(id)` then re-open. Add `react-error-boundary` or hand-roll (no dep needed).
- **App-data ownership convention** (so uninstall is clean): namespace all app-owned data under `/Applications/<id>/…` (VFS) and `localStorage["app:<id>:*"]`, plus an optional `AppDefinition.reset?()` for module-singleton stores (`chrome-store`, `winamp-store`, etc. gain a `reset()`).
- **`src/os/app-lifecycle.ts`** (new): `uninstallApp(id)` = stop → clear VFS subtree (`workspace.remove`) → clear `localStorage` namespace → call `reset()`; `reinstallApp(id)` = uninstall then reinstall seed. Surface "Uninstall / Reinstall" in the App Store + a right-click dock menu.
- **Verify:** throw inside an app → only that window shows the fallback, desktop survives; uninstall a modified app → its settings/AI edits are gone; reinstall → pristine.

### Phase 2 — Chat drawer + real agent runtime + approval UI
> **Status: UI done, agent pending.** `.os-chat` is now a full-height right rail sliding in from the edge; the header carries the `ApprovalModeMenu` (Codex 3-tier picker — "Approve for me" disabled with a "Coming soon" tooltip) backed by `src/os/approval-store.ts` (tested). Apple menu gained Enter/Exit Full Screen. **Remaining:** swap the fake `opencode-adapter` for the real streaming `createOpenCodeAgentAdapter` + `workspace.agents.mount` — needs your review + the `opencode` keychain credential, so it's the next checkpoint.

- **Drawer:** rework `.os-chat` (`src/styles/os.css:1231-1339`) to a full-height right rail — `top: var(--menubar-h); right:0; height: calc(100vh - var(--menubar-h)); transform: translateX(100%)` closed → `translateX(0)` open (Notification-Center feel; reduced-motion guard already exists). Markup stays in `src/chat/ChatPopover.tsx` (rename to `AiDrawer`).
- **Real agent:** replace the stub in `src/chat/opencode-adapter.ts` with `@agent-wasm/sdk` `createOpenCodeAgentAdapter` + `workspace.agents.mount(...)`, streaming via `BrowserAgent.sendMessage`, keyed by the `opencode` keychain slot. Preserve the `respond()` seam but make it stream (async iterator / `onToken`).
- **Approval selector** in the drawer header: the 3-mode control, "Approve for me" disabled with a "Coming soon" tooltip, default **Full access**. Selection stored in a new `src/os/approval-store.ts` and read by the policy gate.
- **Verify:** open drawer from the clock; ask the agent to list/read files and it streams a real model response; switching modes changes what requires a prompt.

### Phase 3 — OS automation layer (`os-driver`), modeled on playwright-cli
> **Status: DONE.** `src/os/os-driver.ts` ships `listApps/snapshot/screenshot/act` (own per-app refMap, own snapshot builder), resolving targets from the live DOM (`.os-window[data-app-id]`, added in `Window.tsx`) rather than the WM store — store-independent and realm-safe. Snapshots reach into Electron apps' same-origin `contentDocument`; `act` builds events with the target realm's `Event`/`MouseEvent` constructors and uses the native value-setter for React inputs. Exposed via `window.almostOS.os.*` + a `desktop` bash command (`register-osdriver.ts`, wired in `OsRuntimeProvider`). `html2canvas` screenshots write PNGs to the VFS. 12 unit tests; browser-verified (snapshot native + cross-realm iframe, real PNG, createApp round-trip).
- **`src/os/os-driver.ts`** (new): port `buildSnapshotTree`/`refMap`/action dispatch from `packages/almostnode/src/shims/playwright-command.ts`, but resolve the target iframe from the **window store** (`WMState.windows` → `FrameWindow`), not the hard-coded `webidePreview` id. Keep the per-realm event-constructor trick (each app iframe is its own realm). API: `listApps()`, `snapshot(appId)`, `screenshot(appId)`, `act(appId, ref, action)`.
- **Screenshots:** `html2canvas` on the target app's `contentDocument.body` (inject into the same-origin virtual iframe) for app internals; on `.os-desktop` for the whole desktop. (Caveat: cross-origin iframe content — e.g. real Chrome tabs — is opaque to DOM capture; note this limit.)
- **Expose to AI two ways:** (a) `window.almostOS.os.*` bridge (extends the existing `almostOS` merge pattern from `soundcloud-bridge`/`chrome-store`/`player-store`); (b) a `desktop` bash command mirroring `playwright-cli` for terminal/agent use, registered like the other shims.
- **Verify:** from the drawer/terminal, `desktop snapshot <app>` returns a ref tree; `desktop click <app> e5` actuates the app; `desktop screenshot` writes a PNG to VFS.

### Phase 4 — Network capture → OpenAPI
- **`src/os/net-capture.ts`** (new): a recording `RequestMiddleware` registered via `ServerBridge.registerMiddleware` (Layer A — full method/url/headers/request+response body), keyed by `port` → `getServerMetadata(port)` for per-app attribution; plus an optional `NetworkController` tap for outbound external calls (Layer C). Ring-buffer per app.
- **`src/os/openapi-gen.ts`** (new, greenfield): fold captured requests into an OpenAPI 3.1 doc (paths × methods, infer param/body/response JSON Schemas by sampling). Write to `/Applications/<id>/captured.openapi.json` or a per-service path.
- **Verify:** exercise an app that makes HTTP calls; a valid OpenAPI spec is produced that round-trips through executor's `plugin-openapi` `parse()`.

### Phase 5 — Code-mode runtime (executor)
> **Status: DONE (built in-house, not vendored).** `apps/almost-os/src/apps/executor/` is the **executor.sh** app: OpenAPI/MCP sources → typed tools (`openapi-tools.ts`, `mcp-client.ts`, `schema-ts.ts`), a QuickJS code-mode sandbox (`codemode-sandbox.ts` — SYNC context + VM promises + job pump; asyncify corrupts on await, and `optimizeDeps.exclude` the quickjs wasm packages), host-side auth attach so secrets never enter the sandbox, policy gate wired to `approval-store`, run log. `execute`/`search`/`describe.tool` exposed via `window.almostOS.executor` + an `executor` bash command. Connections cover DCR/CIMD/generic-OAuth/OIDC/device/api-key over the shared keychain (`executor-auth.ts`, `oauth-runtime.ts`, `oauth.callback.tsx`). 31 unit tests; browser-verified against the live Swagger Petstore (19 tools, real invocation).
- **Vendor/embed executor**: `@executor-js/sdk` + `runtime-quickjs` (WASM, browser-safe) + `plugin-openapi` + `plugin-mcp` + **`plugin-keychain`**. `createExecutor({ plugins, onElicitation })`. **Risk to validate first:** executor's core is Bun/Effect-shaped — confirm the SDK bundles for the browser or run its control-plane on the host page while only the QuickJS sandbox executes model code (the sandbox is already WASM). Spike this before committing the phase.
- **Feed sources:** load generated OpenAPI specs (Phase 4) and any configured MCP servers as executor sources → typed `tools.<service>.<op>()` surface.
- **Bind credentials:** implement the keychain `SecretRef` provider against our vault so `keychain://` refs resolve host-side; **secrets never enter the QuickJS sandbox** (fetch is disabled there; executor attaches auth server-side).
- **Generic token bridge:** add `getAccessToken(serviceId)` over `@agent-wasm/keychain/oauth`'s `OAuthTokenFile` + refresh orchestrator (the one documented gap in the auth layer).
- **Expose to the agent** as a single `execute(ts)` codemode tool + `search`/`describe` (progressive disclosure), gated by the policy layer.
- **Verify:** the agent writes TS calling a captured/MCP tool, executor runs it in QuickJS, an authenticated request succeeds, and no secret is ever visible to model-authored code.

### Phase 6 — Generic auth UI + the Executor app
- Surface the existing web-ide OAuth flow in almost-os: port `add-oauth-service-modal` UX into the Keychain app so a user can paste a service URL → discovery → DCR → PKCE popup → token stored+encrypted (all existing machinery). Supports DCR, OIDC, generic OAuth, device-code.
- **Executor as an Electron app** (`src/electron-apps/executor/…`): package executor's control-plane UI (connections, sources, policies, run log) as a first-party app — this is the user-facing "how the AI connects to external services." Uses Phase 0's app manager to appear in the dock.
- **Verify:** connect a real DCR-capable service through the Keychain app; it shows up as an executor connection; the agent can call it in codemode.

### Phase 7 — Self-debugging (rrweb + Replay MCP)
- Instrument app iframes with **rrweb** (record `FullSnapshot` + incremental mutations) into a per-app buffer; expose "summarize what happened" to the agent.
- Wire the **Replay MCP** server (auth via the existing `RECORD_REPLAY_API_KEY` slot) as an executor MCP source so the agent gets `Evaluate`/`DescribePoint`/`GetStack`/`ReactException`/`NetworkRequest` tools to debug a crashing app (pairs with Phase 1's ErrorBoundary — a caught crash can trigger a debug session).
- **Verify:** crash an app, ask the AI to debug it; it inspects the rrweb timeline and/or Replay recording and identifies the failing render/exception.

### Phase 8 — AI-authored apps, end-to-end
> **Status: DONE.** `src/os/app-authoring.ts` `createApp(spec)` scaffolds a complete Electron app (package.json/main/preload/renderer) via the Phase-0 `electron-app-manager` and launches it; the Dock's `useRunning()` merge gives it an instant dock icon (Task 9's non-speculative slice). Reachable from the agent via `window.almostOS.os.createApp`, the `desktop create-app` command, and the AI-drawer ("make an app called X"). 3 unit tests; browser-verified: "make an app called Notes" → files written → real Electron window renders → dock icon appears → `uninstall` (Phase 1) wipes it cleanly.
- Give the agent a `create_app(spec)` codemode capability: it scaffolds an Electron app under `/Applications/<id>` (package.json/main/preload/renderer), registers it in the Phase-0 runtime registry, and it appears in the dock immediately with the full Electron API.
- **Verify:** "make me a stopwatch app" → files written → dock icon appears → launches as a real Electron window; uninstall (Phase 1) removes it cleanly.

---

## Cross-cutting risks / open decisions

1. **executor in the browser.** Its kernel is Effect/Bun-oriented; `runtime-quickjs` is WASM (fine). Spike whether the SDK bundles client-side or whether we run its control-plane on the host page and only sandbox model code. *Gate Phase 5 on this spike.*
2. **Screenshots of app internals.** `html2canvas` works on same-origin virtual app iframes but **cannot** capture cross-origin iframe content (real Chrome tabs). Desktop-chrome screenshots are fine; document the limit and prefer the structured snapshot for such apps.
3. **Replay recording provenance.** Replay's deterministic recording normally needs the Replay browser; in-browser we lean on rrweb for view-state + our own network/console capture for runtime state, using Replay MCP only where real recordings exist. Confirm what we can produce before promising full time-travel.
4. **"Approve for me" guardian.** The classifier that flags "potentially unsafe" actions is the hard part; ship the mode disabled ("Coming soon") until we build it, exactly as the mockup shows.
5. **Secret containment is load-bearing.** The whole security story depends on QuickJS `fetch` being disabled and auth attached host-side (executor's model). Do not add an escape hatch; keep `SecretRef` out of every tool I/O schema.

## Verification (end-to-end, once phases land)
Drive it in the real app (`pnpm nx dev web-ide` / almost-os dev server): open the drawer, switch to Full access, ask the AI to (a) snapshot + click a running app, (b) screenshot the desktop, (c) exercise an app's API and generate an OpenAPI spec, (d) connect a DCR service via Keychain and call it in codemode with a keychain-held token (never exposed), (e) crash an app and debug it via Replay/rrweb, (f) author a new app that lands in the dock, then uninstall it clean. Unit tests per new module (`os-driver`, `net-capture`, `openapi-gen`, `approval-store`, `app-lifecycle`) plus the existing electron/menu suites.

## Type II definitive validation — clone + run a real Electron app (2026-07-02)

Goal: `git clone` a real open-source Electron app in the almost-os terminal and `electron .` end-to-end — the plan's outstanding proof that the Type II keystone works on code we didn't write.

**Pre-flight (source-verified, browser-independent):**
- `git clone` works in the terminal: `git-command.ts` implements clone/fetch/pull via isomorphic-git through a CORS proxy (`almostnode-cors-proxy.langtail.workers.dev`).
- `electron <dir>` keystone confirmed in `electron-app.ts`: `installAppDependencies` runs `PackageManager.installFromPackageJson` when `node_modules` is absent and deps are declared; renderer served via `ViteDevServer` rooted at the first `index.html` under `src/renderer`/`src`/`dist`/`build`/`out`.
- **Gap found + fixed:** the pipeline ran `pkg.main` directly, but electron-vite apps set `"main": "./out/main/index.js"` (and vite-plugin-electron `"dist-electron/main/index.js"`) — an *unbuilt* output — so a fresh clone failed with `main entry not found`. Added `resolveMainEntry()` (exported, unit-tested — `tests/electron-main-resolution.test.ts`, 6 tests) that falls back to the conventional source entry (`src/main/index.ts`, `electron/main/index.ts`, …) when `pkg.main` is missing, and logs the substitution. This makes the most common modern boilerplate shape runnable from source without a separate main-process build.

**Second gap found (source-verified, NOT yet fixed):** the stock **electron-vite default-template main** has vite-build-time dependencies beyond just the `main` path. Its first line is `import icon from '../../resources/icon.png?asset'`, and the runtime's `resolveModule` (`runtime.ts:1013`) has **no handling for vite query-suffixed imports** (`?asset`/`?raw`/`?url`) — that top-level import throws before the window opens. The rest of the template is fine for us: `app.isPackaged:false` (so `is.dev` → true → takes the `loadURL(ELECTRON_RENDERER_URL)` dev path we set), and `setAppUserModelId`/`setWindowOpenHandler` are safe noops in the shim. So `resolveMainEntry` is necessary but **not sufficient** for a stock electron-vite app; full support needs generic vite-query-import handling in the runtime module loader (a legitimate platform feature: `?raw`→contents, `?asset`/`?url`→served path — bounded + unit-testable, but should be built alongside a live run, not blind).

**Revised live-run plan (pick a winnable first probe):**
  1. Baseline (fast, no deps): `git clone https://github.com/electron/electron-quick-start && cd electron-quick-start && electron .` → asserts clone→run→window-render works live through the real terminal (Type 0 regression).
  2. Type II probe — choose an app whose **main is plain runnable JS/TS** (no vite/webpack main transform) with **npm deps used in the renderer** (proves the install keystone + `/_npm` renderer bundling + render, which is the actual Type II claim) rather than the electron-vite default template, whose *main* needs the vite-query work above. Good shape: plain `electron` + a simple renderer `index.html` importing a real npm package.
  3. Only after (2) passes, tackle electron-vite-main support (vite query imports) as its own task, verified live.
  4. Record any remaining blocker (e.g. a native module) as a concrete Type III entry rather than a hand-wave.

**Status:** `resolveMainEntry` landed + unit-tested; the live run and the vite-query-import feature remain, both genuinely needing a connected browser session.

### Platform features implemented for electron-vite (2026-07-02, lowest-layer)

Validated against the real React template (`npm create @quick-start/electron -- --template react-ts`): `pkg.main = ./out/main/index.js`, deps `@electron-toolkit/{preload,utils}`, main `src/main/index.ts` importing `../../resources/icon.png?asset`, renderer `src/renderer/` React+TSX. Found the pipeline had **never** run a TS/ESM main with npm+asset imports (catalog apps are plain `main.js` CJS). Added four lowest-layer capabilities in `@agent-wasm/core` (no library-specific shims):

1. **Source main-entry resolution** — `resolveMainEntry` (electron-app.ts): `pkg.main`→unbuilt-`out/` falls back to `src/main/index.ts` etc. *(6 unit tests)*
2. **vite asset imports** — `module-resolution.ts` (`resolveAssetRequest`, formats `asset`/`raw`, `ASSET_EXTENSIONS`) + `module-graph-loader.ts` (`buildAssetModuleSource`/`buildRawModuleSource`, id round-trip in `resolveDescriptorById`, asset-safe hashing). `?asset`/`?url`/`?inline`→path, `?raw`→text, bare asset-ext→path. *(6 unit tests)*
3. **TS/TSX/JSX transpile** of first-party ESM source — `module-graph-loader.ts` (`maybeTranspileTypeScript`, esbuild, guarded by extension so no `.js`/`.mjs` flow changes). Browser-only-effective (esbuild is browser-only); safe-by-construction for existing tests.
4. **Preload bundling with deps** — `bundlePreload` (electron-app.ts): esbuild `build` bundles npm helpers (`@electron-toolkit/preload`) inline, `electron` external → binds to the renderer bridge; graceful fallback to single-file transform so catalog preloads never regress.

All 69 electron+module unit tests green; the two failing runtime TLA tests are pre-existing (verified by stashing). CHANGELOG updated (Unreleased → Added). **Still pending (needs a connected browser):** the end-to-end live run — clone the react-ts template in the almost-os terminal, `electron .`, confirm install→transpile→render.

### API-compatibility pre-verification (2026-07-02) — installed the real toolkit packages and audited them vs the shim

Installed `@electron-toolkit/utils@4` + `@electron-toolkit/preload@3` and audited their electron API usage against `shims/electron.ts`/`electron-preload.ts`:
- **utils**: the only *top-level* electron access is `!electron.app.isPackaged` (→ `is.dev`), which the shim provides (`false`). `electronApp.setAppUserModelId` is a noop off-win32 (our platform is `browser`). `optimizer.watchWindowShortcuts` runs inside an `app.on('browser-window-created', …)` handler — the shim **didn't emit that event**, so the hook was dead. **Fixed:** `BrowserWindow` construction now emits `browser-window-created` (standard electron event; `WebContents extends EventEmitter` so its `before-input-event` registration + noop devtools methods are safe). *(+1 shim test.)*
- **preload**: `@electron-toolkit/preload` is a static object; `electron.webUtils.getPathForFile`/`webFrame.insertCSS` are only touched **lazily** inside methods the template never calls — so it loads fine. But those are part of the standard `window.electron` surface, and the renderer bridge lacked them. **Fixed:** added `webFrame.insertCSS`/`insertText` (insertCSS actually injects a `<style>`) and a `webUtils.getPathForFile` (best-effort → file name). *(+1 preload test.)*
- **Verdict:** the react-ts template is fully shim-compatible for its actual usage; these two additions harden the broader `@electron-toolkit` surface. Total session: 6 new test files, all electron/module suites green. The live `electron .` run is the last step, blocked only on the Chrome extension reconnecting.
