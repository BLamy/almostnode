# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Bumped the default browser-sandboxed Claude Code package** (`DEFAULT_BROWSER_CLAUDE_CODE_PACKAGE`,
  `@agent-wasm/core`) from `@anthropic-ai/claude-code@2.1.52` to `@anthropic-ai/claude-code@2.1.112`.
  Newer releases (2.1.113+, including the previous latest 2.1.198) ship `bin/claude.exe` as a
  platform-native compiled binary (a Bun `--compile` Mach-O/ELF/PE executable) instead of a JS
  `cli.js` entrypoint — that can't execute in this WASM sandbox regardless of shimming, since
  there's no JS source to run and the package's own `--ignore-scripts` fallback still just spawns
  the native binary. 2.1.112 is the newest version confirmed to still ship a JS entrypoint; the
  `shadcn-claude-code.spec.ts` e2e suite verifies `npx @anthropic-ai/claude-code --version` boots.
  Override via `ALMOSTNODE_CLAUDE_CODE_PACKAGE` if you need a different pin.

### Added
- **`npm create` / `npm init <initializer>` in the bash shim (`@agent-wasm/core`).**
  `npm create @quick-start/electron -- --template react-ts` (and `npm init vite`, etc.)
  now resolve the initializer to its `create-*` package by npm's own rules
  (`foo`→`create-foo`, `@scope/foo`→`@scope/create-foo`, `@scope`→`@scope/create`,
  version/tag preserved) and run it through the existing `npx` machinery; args after
  `--` are forwarded to the scaffolder. Bare `npm init`/`npm init -y` writes a minimal
  `package.json` instead of erroring. Previously both returned `Unknown command`.
- **Run electron-vite apps from source (`@agent-wasm/core`).** `electron <dir>` can
  now launch a stock electron-vite / vite-plugin-electron project cloned straight
  from GitHub, via four lowest-layer additions (no library-specific shims):
  - **Source main-entry resolution** — when `pkg.main` points at an unbuilt output
    (`out/main/index.js`, `dist-electron/main/index.js`), the runtime falls back to
    the conventional source entry (`src/main/index.ts`, `electron/main/index.ts`, …)
    and runs it directly (`resolveMainEntry`).
  - **vite/webpack asset imports** in the ESM module graph — `import x from './a.png?asset'`
    / `?url` / `?inline` yields the file path, `?raw` yields the file text, and a bare
    import of an asset-extension file (`.png/.svg/.woff/.mp3/…`) is treated as an asset.
    Resolved at `ModuleResolver` so every consumer sees a real module.
  - **TypeScript/TSX/JSX transpilation** of first-party ESM source in the module graph
    loader (esbuild), so an app's own `src/main/index.ts` runs without a prior build.
    Fixes the key blocker: module-format detection acorn-parses source to classify
    ESM/CJS, but acorn can't parse TS type syntax — so a *typed* `.ts` main was
    misclassified as CJS and run as raw eval (never transpiled). `detectFormat` now
    falls back to a TS-tolerant ESM check on parse failure, routing typed `.ts`/`.tsx`
    to the transpiling ESM loader (`.mts`→ESM, `.cts`→CJS by extension). esbuild is
    pre-warmed on the main thread before a TS main runs. A stock electron-vite
    TypeScript app (TS main + preload + renderer) now launches and renders.
  - `electron <dir>` stays **foreground** until the app quits/aborts even without an
    external abort signal, so a bare-terminal `electron .` keeps its runtime alive
    long enough for the deferred `ready` to fire and the window to open.
  - **Preload bundling** — a preload that imports npm helpers (e.g.
    `@electron-toolkit/preload`) is bundled with its dependencies inlined, keeping
    `electron` external so it binds to the renderer bridge; falls back to the
    single-file transform when there's nothing to bundle.
  - **Shim fidelity for the `@electron-toolkit` surface** — `app` now emits the
    standard `browser-window-created` event when a `BrowserWindow` is created (so
    `optimizer.watchWindowShortcuts` and similar per-window hooks run), and the
    renderer bridge gained `webFrame.insertCSS`/`insertText` and a `webUtils`
    namespace (`getPathForFile` best-effort → the file name, since browsers can't
    expose a real path).

### Changed
- **Monorepo split into publishable `@agent-wasm/*` packages.** The runtime and the
  reusable IDE layers are now scoped packages, re-consumed by the `web-ide` demo:
  - `almostnode` → **`@agent-wasm/core`** (the browser Node runtime; `./internal`,
    `./vite`, `./next` subpaths unchanged).
  - `almostnode-sdk` → **`@agent-wasm/sdk`** (workspace/agent lifecycle + `./auth`
    credential manifest).
  - `almostnode-react` → **`@agent-wasm/react`** (expanded): the agent chat surface
    (`ChatScreen` now takes injected `startAgentSession` + `createAdapter` instead of
    the workbench host), Radix UI primitives, and the Editor/Preview/Terminal panes —
    `@agent-wasm/react/chat` and `@agent-wasm/react/ui` subpaths.
  - `codex-wasm` → **`@agent-wasm/codex`**; the redundant `codex-cli-wasm` and
    `codex-app-server-wasm` packages were removed (consolidated into it).
  - New **`@agent-wasm/chat-core`** — dependency-free chat domain (conversation types,
    tool-call encoders, agent-session registry, chat preferences).
  - New **`@agent-wasm/keychain`** — the headless credential/OAuth/vault engine
    (`@agent-wasm/keychain/oauth` subpath). The CLI-launch heuristic it used for
    auto-restore is now an injected `isAgentLaunchCommand` callback, so the engine
    carries no terminal-routing coupling.
  - New **`@agent-wasm/code`** — the Claude Code transcript parser + conversation
    adapter, plus the reusable half of the IDE bridge: the MCP-over-SSE JSON-RPC
    server (`ClaudeIdeVirtualServer`), protocol DTOs, and `buildClaudeIdeMcpConfig`.
    The server takes injected handlers (an editor-state provider), so only the
    Monaco editor-state reads stay in the demo's `ClaudeIdeBridge`.
  - OpenCode stays vendored (`vendor/opencode`), consumed via the existing bun shims.

### Added
- **Run Electron apps from source (`@agent-wasm/core` 0.4.0).** A new `electron`
  module shim emulates the Electron **main process** in the runtime — `app`,
  `BrowserWindow`, `webContents`, `ipcMain`, plus partial `Menu`/`dialog`/`shell`/
  `nativeImage`/`clipboard`/`screen` (and visible no-op stubs for the rest). A
  `BrowserWindow` renders as an iframe supplied by an embedder-registered host
  (`setElectronHost`); IPC (`ipcRenderer.invoke`/`ipcMain.handle` + `send`/`on`)
  travels over postMessage, and a preload/`contextBridge` bootstrap is injected into
  the renderer before app code runs. `electron .` launches an app in dev mode: the
  renderer is served by `ViteDevServer` (new generic `injectHead` option) and
  `loadURL(devServerUrl)` is wired up automatically. **almost-os** registers a host so
  each `BrowserWindow` becomes a real desktop window, and ships an **App Store** app
  (dock icon) that lazily installs open-source Electron apps into the VFS and launches
  each in its own isolated runtime — Pomodoro (main→renderer ticks), Markdownify
  (fs over ipcMain.handle), and System Info (app/shell APIs), reconstructed from real
  GitHub projects. See `examples/electron-demo.*`.
  Scope (MVP): modern secure apps (`contextIsolation` + preload); no `nodeIntegration`
  renderers, no `loadFile`/packaged/`asar` apps, and `contextBridge` exposes on the
  page's own world rather than a separate isolated world.
- **Docs are now a page in the web-ide demo** (`/docs` route) rendering the shared
  docs content; the standalone `apps/docs` app stays as a thin host over the same
  module.

## [0.3.0] - 2026-06-10

### Added
- **Multi-container support**: each `NodeContainer` gets a stable id and a `dispose()` lifecycle; HTTP servers are owned per container, so a second container binding an in-use port gets a real `EADDRINUSE` (while a restart in the same container keeps the silent-replace semantics); dev servers auto-increment to the next free port; npm bundles are cached per VFS with port-prefixed `/_npm/` URLs and a service-worker guard against cross-container ambiguity
- **`gh` CLI pull-request commands**: `gh pr create`, `gh pr view`, `gh pr list`, and `gh pr status` against the GitHub API
- **`git merge` subcommand** in the git CLI shim: fast-forward and true merges via isomorphic-git (working tree + index refreshed after the merge); conflicting merges abort atomically with a `CONFLICT` report, and `git merge --abort` is accepted for script compatibility
- **Repo > Sandbox > Chats sidebar in the Web IDE**: imported repos expand into sandboxes (isolated containers on their own `sandbox/<name>` branches) which expand into their chat threads
- **Background agent sessions**: sandboxes keep running when you switch away — terminals keep their scrollback and served ports stay live — with running-agent spinners on sidebar rows backed by a bounded session pool
- **Read-only main with fork-on-edit**: the attached repo base is read-only; edits and agent launches on main fork a fresh sandbox automatically instead of mutating the base checkout
- **Sandbox PR/merge actions in the Web IDE**: "Create PR" on sandboxes of GitHub-backed repos (commit-if-dirty → `git push -u` → `gh pr create`, PR badge on the sandbox row, lazy state refresh via `gh pr view` on row expansion) and "Merge to main" on local-only repos (merge inside the sandbox container, promote the merged tree to the repo base snapshot)
- **OpenCode host-level database**: OpenCode session storage moved to a host-level DB shared across sandbox containers, so chats survive container disposal

### Fixed
- **Silent same-port server replacement across containers**: a server started in one container could previously be replaced without error by a server on the same port in another container; cross-container binds now fail with `EADDRINUSE`
- **OpenCode agent file/shell operations crossing sandboxes**: the in-browser OpenCode server resolved its workspace and process bridges through an AsyncLocalStorage shim that is a plain stack — with requests from two sandboxes in flight, an agent's operations could resolve the *other* sandbox's bridge and edit the wrong VFS. Bridges are now registered per namespace root (`/sandboxes/{id}`) and resolved by path/cwd prefix, immune to interleaving
- **Background HMR updates hitting the foreground preview**: detaching a session now clears its dev server's HMR target (the preview iframe's `contentWindow` survives navigation), and Vite/Next HMR messages carry the originating port which the injected client checks against its own
- **Session pool never evicting (and evicting too eagerly)**: agent "running" now means actually processing — OpenCode sessions poll the server's per-directory `/session/status`, terminal agent CLIs use recent TUI output — instead of "tab exists"/"TUI open", which pinned every sandbox with an open chat forever; eviction also re-checks pins after the awaited pre-eviction snapshot so an agent that picks up work mid-snapshot isn't disposed
- **Every sandbox sharing the foreground sandbox's database**: the PGlite bridge middleware ignored the request's port and the page-global namespace; it now resolves the owning sandbox's namespace per request, and PGlite instances are keyed per namespace (every sandbox names its database "default")
- **Server owner attribution races**: raw `http.listen` servers got their owner from a last-write-wins `__almostnodeActiveProcess` global (wrong for any `listen()` after another container's process became active — spurious `EADDRINUSE`, server-ready events adopted by the wrong container's preview, dispose killing the wrong servers). Runtimes now hand out per-runtime `http`/`https` modules that bake the owning container id into servers at construction, and raw-server bridge registrations carry that owner
- **Port poisoning after container dispose**: raw `node server.js` servers (which deliberately outlive their terminal command) were never closed on `dispose()`, leaving dead-but-listening entries in the page-global registry that `EADDRINUSE`d every other container until reload; dispose now closes and unregisters them by owner
- **Watcher/bundler VFS bound to the last-booted container**: `chokidar`, `readdirp`, and `esbuild` resolved their VFS through module-level `setVFS()` bindings (last-write-wins), so watchers armed or builds started after another sandbox booted read the wrong tree; runtimes now hand out per-runtime modules bound to their own VFS
- **`ws` BroadcastChannel cross-talk**: the page-wide `vite-ws-channel` let any container's WebSocket server claim any container's client connect (including across browser tabs); the transport is now scoped per container, and each endpoint opens its own channel instance (a `BroadcastChannel` never delivers to itself, so the shared singleton could never connect same-page endpoints at all)
- **`execSync`/`exec` leaking the host cwd/env**: synchronous exec defaults read `globalThis.process` (the page polyfill — or the literal host process under vitest) instead of the calling runtime's process; runtime `child_process` modules now bind cwd/env/controller to their runtime
- **Codex threads missing from the sidebar**: the WASM app-server announces a thread's id only in the `thread/start` request result and its item notifications carry no `threadId`, but the sidebar's thread recorder only inspected notifications with a `params.threadId` — so it recorded nothing while chat worked fine. The recorder now learns ids from `thread/start` results (like the chat adapter) and attributes threadId-less notifications to the last-started thread
- **Keychain blind to background sandboxes**: credential watchers, slot indicators, vault snapshots, and unlock-time restores all operated on the foreground sandbox's VFS only — a login performed in a background sandbox never reached the vault (and a stale foreground copy could overwrite it), sandboxes created while the vault was locked never received credentials on a later unlock, and slot status lied. The keychain now tracks every live session VFS: watchers on all of them, restore-on-unlock into all of them, and newest-file-wins snapshot merging across them
- **Chat clicks could land in the wrong sandbox**: resuming a chat (and "+ new chat") guarded the sandbox switch with the sidebar's render-captured active-sandbox id; when that copy lagged the manager's truth, the chat resumed into whichever sandbox was actually foreground — which then kept showing that sandbox's code. The guards now compare against the manager's live state, and failed sandbox switches/resumes surface as error toasts instead of silent console lines
- **Concurrent eviction runs**: pool eviction is fired from every switch and now awaits busy probes and snapshots; two interleaved runs could pick candidates from stale views. Eviction is now serialized
- New e2e coverage: sandbox switching restores each sandbox's own files (editor + session layers) across repeated switches, through pool eviction, and across a page reload
- **Codex threads never reached the sidebar**: the `ProjectManagerHost` adapter forwarded `discoverSandboxOpenCodeThreads` but not `discoverSandboxCodexThreads`, so the manager's optional-chained discovery silently resolved to `[]` on every refresh — the host recorded threads correctly and they were dropped one seam later. The forward now exists, with an e2e test covering the full pipeline (host store → adapter → discovery → IndexedDB → sidebar render) that fails when the forward is removed
- **Codex threads now survive a page reload**: the WASM Codex build keeps no rollout files, so a Codex conversation existed only in the app-server JSON-RPC tee — invisible to the sidebar recorder (it ignored `thread/start` request results, the only place the thread id appears) and gone forever on refresh. The recorder now captures each thread's bus events; transcripts ride along in sandbox agent-state snapshots (bounded at 600 events per thread); restored sandboxes list their Codex threads again; and clicking a dead thread replays its transcript into the chat (sending a new message starts a fresh Codex session — true resume is impossible without rollouts) instead of running `codex resume`, which always failed in the browser

## [0.2.15] - 2026-06-09

### Added
- **Chat-first Web IDE layout**: the `/ide` screen is now a chat surface over the in-browser CLI coding agents; the full VS Code workbench moved into a resizable right-side drawer (`⌘⇧.` to toggle) that never unmounts Monaco
- **Bidirectional conversation sync** (no backend): a single shared agent session backs both chat and terminal — Claude via transcript tailing + bracketed-paste stdin injection, Codex via an app-server JSON-RPC tee, OpenCode via the shared in-browser server's `/event` stream and TUI prompt routes
- **Tool-call visualization in chat**: Edit/Write/MultiEdit render as syntax-highlighted unified diffs via `@pierre/diffs`; Bash shows the command with collapsible output and run/done/failed status; Codex `commandExecution`/`fileChange` items and OpenCode tool parts render the same cards
- **GitHub-focused sidebar**: groups imported GitHub projects separately from "No source control" local projects; repositories are imported from the New Project dialog
- **Claude Code pre-warm**: the CLI package downloads in the background when a project attaches, removing the cold-install delay from first launch (`DEFAULT_BROWSER_CLAUDE_CODE_PACKAGE` now exported from almostnode internals)
- **OpenCode browser SDK shim**: added missing `session.messages`, `tui.appendPrompt`, and `tui.submitPrompt` routes
- **Chat header**: hamburger toggling the project sidebar, the active thread title, and a workbench toggle icon button in the top right (replaces the floating drawer chevron)
- **Composer launch controls**: searchable Claude model picker, thinking-effort picker, plan-mode toggle (`--permission-mode plan`), and a context-window occupancy marker fed by transcript usage
- **New thread button** on sidebar projects (replaces the kebab menu); Rename/Delete moved to a right-click context menu

### Changed
- **Workbench starts offscreen**: the drawer opens closed by default, the inner VS Code sidebar starts collapsed, and chat-initiated agent launches mount the TUI without revealing or focusing it (the keychain panel still summons the drawer when credentials are needed)

### Fixed
- **First chat message no longer lost**: input injection now waits for Claude's MCP client to connect to the IDE bridge (raw-mode init used to flush queued stdin)
- **Agent launch failures surface in chat** (missing network/keychain credentials) instead of hanging silently
- **Chat page scrolling**: the timeline scrolls internally with a pinned composer instead of growing the page
- **Thread switches no longer leak messages to the previous thread**: switching detaches the chat from the old session immediately, queued sends resolve their target session at execution time, and chat sends during a resume wait for the new session instead of launching a duplicate

## [0.2.14] - 2026-02-14

### Added
- **Agent Workbench demo**: AI coding agent that builds Next.js pages live with file editing, bash execution, and HMR preview. Added to homepage demos grid.
- **Vercel AI SDK demo**: Streaming AI chatbot with Next.js, OpenAI, and real-time token streaming via Pages Router API route
- **Express demo E2E tests**: New Playwright tests for the Express server demo
- **`vfs-require` module** (`src/frameworks/vfs-require.ts`): Shared require system extracted for reuse across entry points
- **`npm-serve` module** (`src/frameworks/npm-serve.ts`): Shared `/_npm/` package bundling endpoint with nested exports support
- **CI E2E pipeline**: GitHub Actions now runs Playwright E2E tests after unit tests with Chromium
- **CLAUDE.md**: Project instructions file for AI-assisted development

### Fixed
- **Route group client-side navigation**: Pages inside route groups (e.g. `(marketing)/about`) now render correctly during client-side navigation. Replaced local path construction with server-based `resolveRoute()` using extended `/_next/route-info` endpoint that returns actual `page` and `layouts` paths.
- **`convertToModelMessages` import**: Vercel AI SDK demo now imports from `ai` package instead of non-existent `@ai-sdk/ui-utils`
- **npm-serve nested exports**: Packages with nested `exports` field entries (e.g. `ai/react`, `@ai-sdk/openai`) now resolve correctly
- **TypeScript type errors**: Fixed duplicate `setEnv` method, `executeApiHandler` return type, `cpExec` callback types

### Changed
- **Agent Workbench guardrails removed**: AI agent can now modify any project file including root page (`/app/page.tsx`), `package.json`, and `tsconfig.json`. Only `/pages/api/chat.ts` remains protected.
- **E2E tests hardened**: Removed try/catch fallbacks across all E2E tests for strict assertions; collect page errors for better debugging
- **Convex and Vite demos refactored**: Use platform's `vfs-require` and `npm-serve` modules instead of inline implementations

## [0.2.13] - 2026-02-12

### Added
- **Centralized CDN configuration** (`src/config/cdn.ts`): Single source of truth for esm.sh, unpkg, and other CDN URLs used across the codebase
- **esm.sh version resolution**: `redirectNpmImports` now reads `package.json` dependencies and includes the major version in esm.sh URLs (e.g. `ai@4/react`), fixing 404s on subpath imports
- **Setup overlay dialogs**: Convex and Vercel AI SDK demos now show an API key setup dialog on load with privacy notice ("your key stays in your browser")
- **New tests**: `tests/cdn-config.test.ts` (12 tests) and `tests/code-transforms.test.ts` (11 tests)

### Changed
- Renamed AI chatbot demo files: `demo-ai-chatbot.html` → `demo-vercel-ai-sdk.html`, `ai-chatbot-demo.ts` → `vercel-ai-sdk-demo.ts`
- Replaced hardcoded CDN URLs throughout codebase with imports from `src/config/cdn.ts`

### Removed
- **`sentry` shim** (`src/shims/sentry.ts`): Was a no-op stub for a non-existent Node.js built-in
- **Custom `convex` command** in `child_process.ts`: Convex now runs through the generic bin stub system like any other CLI tool
- **Convex-specific path remaps** in `fs.ts`: `path.resolve()` with correct `cwd` handles this generically
- **`vfs:` prefix stripping** in `fs.ts`: Moved to esbuild shim where the artifact originates

## [0.2.12] - 2026-02-12

### Added

- **Generic bin stubs:** `npm install` now reads each package's `bin` field and creates executable scripts in `/node_modules/.bin/`. CLI tools like `vitest`, `eslint`, `tsc`, etc. work automatically via the `node` command — no custom commands needed.
- **Streaming `container.run()` API:** Long-running commands support `onStdout`/`onStderr` callbacks and `AbortController` signal for cancellation.
- **`container.sendInput()`:** Send stdin data to running processes (emits both `data` and `keypress` events for readline compatibility).
- **Vitest demo with xterm.js:** New `examples/vitest-demo.html` showcasing real vitest execution in the browser with watch mode, syntax-highlighted terminal output, and file editing.
- **E2E tests for vitest demo:** 5 Playwright tests covering install, test execution, tab switching, failure detection, and watch mode restart.
- **`rollup` shim:** Stub module so vitest's dependency chain resolves without errors.
- **`fs.realpathSync.native`:** Added as alias for `realpathSync` (used by vitest internals).
- **`fs.createReadStream` / `fs.createWriteStream`:** Basic implementations using VirtualFS.
- **`path.delimiter` and `path.win32`:** Added missing path module properties.
- **`process.getuid()`, `process.getgid()`, `process.umask()`:** Added missing process methods used by npm packages.
- **`util.deprecate()`:** Returns the original function with a no-op deprecation warning.

### Changed

- **`Object.defineProperty` patch on `globalThis`:** Forces `configurable: true` for properties defined on `globalThis`, so libraries that define non-configurable globals (like vitest's `__vitest_index__`) can be re-run without errors.
- **VFS adapter executable mode:** Files in `/node_modules/.bin/` now return `0o755` mode so just-bash treats them as executable.
- **`Runtime.clearCache()` clears in-place:** Previously created a new empty object, leaving closures referencing the stale cache. Now deletes keys in-place.
- **Watch mode uses restart pattern:** Vitest caches modules internally (Vite's ModuleRunner), so file changes require a full vitest restart (abort + re-launch) rather than stdin-triggered re-runs.

### Removed

- **Custom vitest command:** Deleted `src/shims/vitest-command.ts` and removed vitest-specific handling from `child_process.ts`. Vitest now runs through the generic bin stub + `node` command like any other CLI tool.

## [0.2.11] - 2026-02-09

### Fixed

- **Firefox blank preview:** Fixed Vite dev server injecting `<script type="module">` (React Refresh preamble) before `<script type="importmap">` in served HTML. Firefox strictly requires import maps to appear before any module scripts. The preamble is now injected after the last import map when one is present. ([#3](https://github.com/macaly/almostnode/issues/3))

## [0.2.10] - 2026-02-09

### Changed

- **Next.js dev server refactoring:** Extracted route resolution and API handler logic into standalone modules, reducing `next-dev-server.ts` from ~2240 to ~1360 lines (39% reduction):
  - `next-route-resolver.ts` (~600 lines) — App Router/Pages Router route resolution, dynamic routes, route groups, catch-all segments
  - `next-api-handler.ts` (~350 lines) — mock request/response objects, cookie parsing, API handler execution, streaming support
- **115 new unit tests** for the extracted modules (63 route resolver + 52 API handler)

## [0.2.9] - 2026-02-08

### Added

- **`browser` field support in module resolution:** npm packages with a `browser` field in package.json now resolve to their browser-specific entry point. Supports both string form (`"browser": "lib/browser/index.js"`) and object form (`"browser": {"./lib/node.js": "./lib/browser.js"}`). This fixes compatibility with packages like `depd`, `debug`, and others that provide browser-optimized versions.

### Fixed

- **Safari Express crash:** Fixed `callSite.getFileName is not a function` error when running Express in Safari. The `depd` package (an Express dependency) uses V8-specific `Error.captureStackTrace` APIs that don't exist in WebKit. By respecting depd's `"browser"` field, the no-op browser version is now loaded instead.
- **`Error.captureStackTrace` polyfill improvements:** Added `Error.stackTraceLimit` default, `.stack` getter interception on `Error.prototype` for lazy `prepareStackTrace` evaluation, re-entrancy protection, and error logging instead of silent fallback.

## [0.2.8] - 2026-02-07

### Added

- **Convex CLI deployment:** Full in-browser Convex deployment via the CLI bundle with 4 runtime patches (Sentry stub, crash capture, size check skip, site URL derivation)
- **Next.js dev server refactoring:** Extracted ~1700 lines into standalone modules:
  - `next-shims.ts` — shim string constants (~1050 lines)
  - `next-html-generator.ts` — HTML template generation (~600 lines)
  - `next-config-parser.ts` — AST-based config parsing with regex fallback (~140 lines)
  - `binary-encoding.ts` — base64/uint8 encoding utilities
- **HTTP shim improvements:** `IncomingMessage` now supports readable stream interface (`on('data')`, `on('end')`), chunked transfer encoding, proper content-length tracking
- **WebSocket shim:** Real WebSocket connectivity for Convex real-time sync (connect to `wss://` endpoints, binary frame support, ping/pong handling)
- **Stream shim:** Added `PassThrough` stream implementation
- **Crypto shim:** Added `timingSafeEqual` implementation
- **Convex E2E tests:** 6 Playwright tests including HTTP API verification that proves modified mutations deploy and run on the Convex backend

### Fixed

- **`path.resolve()` must use `process.cwd()`:** Was prepending `/` for relative paths instead of the actual working directory — caused Convex CLI to resolve `'convex'` → `/convex` instead of `/project/convex`
- **esbuild `absWorkingDir` must use `process.cwd()`:** Was defaulting to `/`, causing metafile paths to be relative to root instead of the project directory, resulting in doubled paths like `/project/project/...`
- **Convex `_generated` directory:** No longer deletes `/convex/_generated/` during deployment — the live Next.js app imports from it while the CLI only needs `/project/convex/_generated/`
- **`path.join()` debug logging removed:** Cleaned up leftover `console.log` calls for `_generated` path joins

## [0.2.7] - 2026-02-05

### Added

- **AST-based code transforms:** Replaced fragile regex-based transforms with proper AST parsing using `acorn` and `css-tree`
  - CSS Modules: `css-tree` AST for reliable class extraction and scoping (handles pseudo-selectors, nested rules, media queries)
  - ESM→CJS: `acorn` AST for precise import/export conversion (handles class exports, re-exports, `export *`, namespace imports)
  - React Refresh: `acorn` AST component detection — no longer false-detects `const API_URL = "..."` as a component
  - npm import redirect: `acorn` AST targets import/export source strings precisely, avoiding false matches in comments/strings
  - All transforms gracefully fall back to regex if AST parsing fails
- **Shared code-transforms module:** Extracted ~350 lines of transform logic into `src/frameworks/code-transforms.ts`, deduplicating `addReactRefresh()` between NextDevServer and ViteDevServer
- **New features:** CSS Modules, App Router API Routes, `useParams`, Route Groups, `basePath`, `loading.tsx`/`error.tsx`/`not-found.tsx` convention files, `next/font/local`
- **E2E test harness:** Added `examples/next-features-test.html` and `e2e/next-features.spec.ts` with 25 Playwright tests covering all new features

### Fixed

- **App Router API query params:** Fixed query string not being passed to App Router route handlers (`handleAppRouteHandler` now receives `urlObj.search`)
- **E2E import paths:** Fixed `examples/vite-demo.html` and `examples/sandbox-next-demo.html` using wrong relative import path (`./src/` → `../src/`)
- **E2E test assertions:** Fixed dynamic route test checking for `[id].jsx` string that never appears in generated HTML; fixed vite-error-overlay blocking clicks in navigation tests
- **Convex demo logging:** Added key file path logging so e2e tests can verify project files

### Dependencies

- Added `acorn` (8.15.0), `acorn-jsx` (5.3.2), `css-tree` (3.1.0)

## [0.2.6] - 2026-02-02

### Added

- **Asset prefix support:** NextDevServer now supports `assetPrefix` option for serving static assets with URL prefixes (e.g., `/marketing/images/...` → `/public/images/...`)
- **Auto-detection:** Automatically detects `assetPrefix` from `next.config.ts/js/mjs` files
- **Binary file support:** Macaly demo now supports base64-encoded binary files (images, fonts, etc.) in the virtual file system
- **File extraction script:** Added `scripts/extract-macaly-files.ts` to load real-world Next.js projects including binary assets

### Fixed

- **Virtual server asset routing:** Service worker now forwards ALL requests from virtual contexts (images, scripts, CSS) to the virtual server, not just navigation requests. This fixes 404 errors for assets using absolute URLs.
- **Double-slash URLs:** Handle URLs like `/marketing//images/foo.png` that result from concatenating assetPrefix with paths

## [0.2.5] - 2025-02-01

### Added

- **Transform caching:** Dev servers now cache transformed JSX/TS files with content-based invalidation, improving reload performance
- **Module resolution caching:** Runtime caches resolved module paths for faster repeated imports
- **Package.json parsing cache:** Parsed package.json files are cached to avoid repeated file reads
- **Processed code caching:** ESM-to-CJS transformed code is cached across module cache clears

### Fixed

- **Service Worker navigation:** Plain `<a href="/path">` links within virtual server context now correctly redirect to include the virtual prefix
- **Virtual FS mtime:** File system nodes now track actual modification times instead of returning current time
- **Flaky zlib test:** Fixed non-deterministic test that used random bytes

## [0.2.4] - 2025-01-31

### Fixed

- **App Router navigation:** Extended client-side navigation fix to also support App Router (`/app` directory). Both Pages Router and App Router now use dynamic imports for smooth navigation.

## [0.2.3] - 2025-01-31

### Fixed

- **Next.js Link navigation:** Fixed clicking `<Link>` components causing full iframe reload instead of smooth client-side navigation. Now uses dynamic page imports for proper SPA-like navigation.

## [0.2.2] - 2025-01-31

### Fixed

- **Critical:** Fixed browser bundle importing Node.js `url` module, which broke the library completely in browsers. The `sandbox-helpers.ts` now uses dynamic requires that only run in Node.js.

## [0.2.1] - 2025-01-31

### Fixed

- CI now builds library before running tests (fixes failing tests for service worker helpers)

### Changed

- Added security warning to Quick Start section in README
- Clarified that `createContainer()` should not be used with untrusted code
- Added "Running Untrusted Code Securely" example using `createRuntime()` with sandbox
- Updated repository URLs to point to macaly/almostnode

## [0.2.0] - 2025-01-31

### Added

- **Vite plugin** (`almostnode/vite`) - Automatically serves the service worker file during development
  ```typescript
  import { almostnodePlugin } from 'almostnode/vite';
  export default defineConfig({ plugins: [almostnodePlugin()] });
  ```

- **Next.js helpers** (`almostnode/next`) - Utilities for serving the service worker in Next.js apps
  - `getServiceWorkerContent()` - Returns service worker file content
  - `getServiceWorkerPath()` - Returns path to service worker file

- **Configurable service worker URL** - `initServiceWorker()` now accepts options
  ```typescript
  await bridge.initServiceWorker({ swUrl: '/custom/__sw__.js' });
  ```

- **Service worker included in sandbox files** - `generateSandboxFiles()` now generates `__sw__.js` along with `index.html` and `vercel.json`, making cross-origin sandbox deployment self-contained

### Changed

- Updated README with comprehensive Service Worker Setup documentation covering all deployment options

## [0.1.0] - 2025-01-30

### Added

- Initial release
- Virtual file system with Node.js-compatible API
- 40+ shimmed Node.js modules
- npm package installation support
- Vite and Next.js dev servers
- Hot Module Replacement with React Refresh
- Cross-origin sandbox support for secure code execution
- Web Worker runtime option
