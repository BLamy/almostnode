# agent-wasm Web IDE

`apps/web-ide` is the browser IDE application for agent-wasm. It is a private
Nx/Vite app that combines a React route shell, Monaco's VS Code-compatible
workbench services, the internal almostnode browser runtime, project
persistence, and browser-hosted agent sessions.

## Technology Used

These are the browser-facing technologies that anchor the Web IDE runtime,
agent stack, networking, transforms, and compression path.

| [PGlite](https://pglite.dev/) | [OpenCode](https://opencode.ai/) | [Codex](https://openai.com/codex/) | [OXC](https://oxc.rs/) |
| --- | --- | --- | --- |
| [![PGlite](./readme-assets/logos/pglite.svg)](https://pglite.dev/) | [![OpenCode](./readme-assets/logos/opencode.svg)](https://opencode.ai/) | [![Codex by OpenAI](./readme-assets/logos/codex-openai.svg)](https://openai.com/codex/) | [![OXC](./readme-assets/logos/oxc.svg)](https://oxc.rs/) |
| Browser Postgres | AI terminal sessions | OpenAI coding agent | Fast JS tooling |

| [Tailscale](https://tailscale.com/) | [esbuild](https://esbuild.github.io/) | [Brotli](https://www.brotli.org/) |
| --- | --- | --- |
| [![Tailscale](./readme-assets/logos/tailscale.svg)](https://tailscale.com/) | [![esbuild](./readme-assets/logos/esbuild.svg)](https://esbuild.github.io/) | [![Brotli](./readme-assets/logos/brotli.svg)](https://www.brotli.org/) |
| Network bridge | Browser transforms | Compression |

## Keychain Integrations

The keychain stores provider auth files in the browser VFS, encrypts them into a
passkey-backed vault, and restores them before terminal or agent sessions run.
Built-in slots cover the services below; users can also add arbitrary OAuth
providers through the OAuth service flow.

| [Tailscale](https://tailscale.com/) | [Claude Code](https://www.anthropic.com/claude-code) | [Codex](https://openai.com/codex/) | [GitHub](https://github.com/) |
| --- | --- | --- | --- |
| [![Tailscale](./readme-assets/logos/tailscale.svg)](https://tailscale.com/) | [![Claude](./readme-assets/logos/claude.svg)](https://www.anthropic.com/claude-code) | [![Codex](./readme-assets/logos/codex.svg)](https://openai.com/codex/) | [![GitHub](./readme-assets/logos/github.svg)](https://github.com/) |
| Network session | Claude credentials | Codex auth | `gh` hosts token |

| [AWS](https://aws.amazon.com/) | [Infisical](https://infisical.com/) | [Fly.io](https://fly.io/) | [Netlify](https://www.netlify.com/) |
| --- | --- | --- | --- |
| [![AWS](./readme-assets/logos/aws.svg)](https://aws.amazon.com/) | [![Infisical](./readme-assets/logos/infisical.svg)](https://infisical.com/) | [![Fly.io](./readme-assets/logos/fly.svg)](https://fly.io/) | [![Netlify](./readme-assets/logos/netlify.svg)](https://www.netlify.com/) |
| SSO config and auth | Secrets session and UA | Fly access token | Netlify account token |

| [Cloudflare](https://www.cloudflare.com/) | [Neon](https://neon.com/) | App Building | [OpenCode](https://opencode.ai/) |
| --- | --- | --- | --- |
| [![Cloudflare](./readme-assets/logos/cloudflare.svg)](https://www.cloudflare.com/) | [![Neon](./readme-assets/logos/neon.svg)](https://neon.com/) | ![App Building](./readme-assets/logos/app-building.svg) | [![OpenCode](./readme-assets/logos/opencode.svg)](https://opencode.ai/) |
| Wrangler OAuth | Neon OAuth/API key | Remote job config | OpenCode auth and MCP auth |

| [Replay.io](https://www.replay.io/) | [OAuth Services](https://oauth.net/) |
| --- | --- |
| [![Replay.io](./readme-assets/logos/replay.svg)](https://www.replay.io/) | [![OAuth](./readme-assets/logos/oauth.svg)](https://oauth.net/) |
| Replay CLI auth | User-added OAuth providers |

The important mental model is that the IDE is not a thin editor wrapped around a
server. The workspace, terminal, package installs, preview server, credentials,
database, and agent harnesses all run through the browser-safe almostnode
runtime unless the desktop host explicitly provides a bridge.

## Top-level Flow

```text
TanStack route (/ide)
  -> LazyWorkbenchScreen
  -> WorkbenchScreen
  -> WebIDEHost.bootstrap()
  -> almostnode createContainer()
  -> Monaco/VS Code workbench services
  -> custom workbench surfaces
```

The browser route setup lives in `src/routes`. The `/ide` route validates query
params such as `template`, `project`, `debug`, `marketplace`, and `corsProxy`,
then lazy-loads the workbench bundle from `src/desktop/workbench-screen-lazy.tsx`.

`WorkbenchScreen` owns the React shell around the workbench:

- creates one `ProjectManager`
- decides whether to seed a template, restore a project, or start empty
- stores debug and CORS proxy state in browser storage
- constructs `WebIDEHost`
- wires the project sidebar to the host API
- exposes setup dialogs for AWS and app-building configuration

`WebIDEHost` in `src/workbench/workbench-host.ts` is the main integration point.
It owns the almostnode container, file surfaces, terminals, preview iframe,
database surfaces, keychain, agent tabs, command routing, and workbench service
registration.

## Runtime Boundaries

### Browser runtime

`WebIDEHost` creates an almostnode container with:

- `cwd` set to `/project`
- VFS-backed Node and shell behavior
- optional persisted network session state
- optional `CORS_PROXY_URL`
- the keychain and workspace search provider attached after initialization

The web IDE should prefer this container path for workspace commands. Terminal
commands are not host shell commands by default; they are almostnode shell
sessions running against the virtual workspace.

### Desktop host mode

When `window.desktopBridge` exists, the IDE switches agent launch behavior into
host mode. Host mode uses:

- `DesktopBridge` from `src/desktop/bridge.ts`
- `HostTerminalSession` for real host terminal IO
- `ProjectMirrorService` for debounced VFS-to-disk and disk-to-VFS file sync

This is an explicit integration path for the desktop shell. Browser mode remains
the normal path for the hosted web IDE.

## Workbench Architecture

The workbench uses `@codingame/monaco-vscode-*` services to run a VS
Code-compatible workbench inside the page. `initWorkbench()` registers service
overrides for configuration, keybindings, languages, search, themes, TextMate,
extensions, and workbench layout.

The VFS is mounted into the workbench through
`src/features/vfs-file-system-provider.ts`. That provider translates Monaco file
operations into almostnode VFS reads, writes, deletes, stats, and recursive
watch events. It also coalesces update bursts so package installs do not flood
the UI with `node_modules` file events.

Custom workbench views and editors are defined in
`src/workbench/workbench-surfaces.ts`:

- file tree sidebar
- AI/OpenCode sidebar
- terminal panel
- live preview editor
- app-building preview editor
- PGlite database sidebar
- SQL database browser editor
- keychain sidebar
- tests sidebar
- rendered Markdown and JSON editors

The surface entrypoints live under `src/workbench/entrypoints`. The Vite plugin
`src/plugins/vite-plugin-workbench-entrypoints.ts` discovers
`*.entrypoint.ts` files and emits a virtual module consumed by the workbench
surface registry.

## Workspace and Templates

The active project root inside the runtime is always `/project`.

Templates are stored as real files under `src/templates/content` and loaded at
build time through `virtual:workspace-templates`, generated by
`src/plugins/vite-plugin-workspace-templates.ts`. Shared template files under
`_shared` are merged into every template.

Supported template IDs are:

- `vite`
- `nextjs`
- `tanstack`
- `app-building`

`src/features/workspace-seed.ts` converts a template into directories and files
under `/project`, writes the default files, and seeds demo Playwright metadata
for the Vite template. It can also seed reference apps and convert
`database.xml` into Drizzle schema and migration files.

## Project Persistence

Project persistence is browser-local and lives in IndexedDB through
`src/features/project-db.ts`.

The `almostnode-webide` database stores:

- projects
- project file snapshots
- agent state snapshots
- resumable thread metadata
- app-building configuration summaries
- app-building job records

`ProjectManager` coordinates this database with `WebIDEHost`. It creates,
switches, renames, deletes, imports, and autosaves projects. On project switch it
restores files into the VFS, attaches the project database namespace, syncs Git
metadata, restores agent state, and refreshes resumable Claude/OpenCode thread
records.

The project sidebar in `src/sidebar` is the React UI over `ProjectManager`.

## Terminal and Command Routing

The IDE has two terminal surfaces:

- the bottom terminal panel for regular shell sessions and preview output
- the AI sidebar terminal area for OpenCode, Codex, Claude Code, and plain
  terminal tabs

Regular terminal sessions come from `container.createTerminalSession()`.
Commands run in the almostnode shell with `/project` as the default cwd.

`src/features/terminal-command-routing.ts` identifies commands that need
interactive handling:

- OpenCode launch commands
- Claude Code launch commands
- Codex launch commands
- shadcn launch commands

`WebIDEHost.registerWorkbenchShellCommands()` also registers IDE-specific
commands in the runtime:

- `webide-open` opens a VFS file in the workbench editor
- `app-building` manages remote app-building jobs
- `codex` is registered through the browser Codex CLI shell command

Preview runs use a dedicated terminal tab and call
`ensureWorkspaceDependenciesInstalled()` before running the template's
`runCommand`, usually `npm run dev`.

## Preview and Browser Feedback

The preview surface embeds the active dev server in an iframe. The dev server is
served by the almostnode framework runtime and service-worker routing, not by a
separate backend process.

Supported preview behavior includes:

- run and refresh controls
- automatic dependency install from `/project/package.json`
- console mirroring into the IDE console tab
- source selection from the preview back to workspace files
- optional external preview window
- app-building worker preview surface

Preview console traffic is bridged through `installHostConsoleBridge()` for host
logs and `postMessage` from the preview iframe for app logs.

## Agents

The web IDE supports multiple agent harnesses, with different runtime paths.

OpenCode in browser mode uses vendored OpenCode browser code:

- `src/features/opencode-browser-session.ts`
- workspace bridge over almostnode VFS
- process bridge over almostnode terminal sessions
- browser DB snapshot/restore for agent state
- OpenTUI wasm asset emitted by the Vite build

Codex uses the local wasm packages:

- `codex-cli-wasm` for the CLI shell command
- `codex-app-server-wasm` for the app-server session
- workers in `src/features/codex-cli.worker.ts` and
  `src/features/codex-app-server.worker.ts`
- browser login handling in `src/features/codex-auth.ts`

Claude Code is launched through the terminal path when available. The IDE also
builds an MCP-style IDE bridge in `src/features/claude-ide-bridge.ts`, exposing
editor operations such as open file, diagnostics, diff tab cleanup, selection
changes, and file update notifications.

In desktop host mode, agent launches go through `HostTerminalSession` instead of
the browser agent runtime.

## Browser-shipped WASM Assets

The Web IDE ships several WASM binaries because core runtime services are
browser-native instead of server-backed. These assets fall into three buckets:
fixed public files, Vite-emitted app assets, and lazy runtime dependencies.

This inventory is for browser-loaded assets. Rust `target/` outputs and package
intermediate build artifacts are not part of the browser contract unless
`vite.config.ts` emits or imports them.

### Fixed public files

| Browser URL | Source | Loaded by | Purpose |
| --- | --- | --- | --- |
| `${base}pglite.wasm` | `apps/web-ide/public/pglite.wasm`, copied from `node_modules/@electric-sql/pglite/dist/postgres.wasm` by `npm run copy-pglite-assets` | `packages/almostnode/src/pglite/pglite-database.ts` | PGlite's Postgres engine for project-scoped browser databases. |
| `${base}pglite.data` | `apps/web-ide/public/pglite.data`, copied from `node_modules/@electric-sql/pglite/dist/postgres.data` by `npm run copy-pglite-assets` | `packages/almostnode/src/pglite/pglite-database.ts` | PGlite's Emscripten filesystem bundle paired with `pglite.wasm`. |

`pglite.data` is not a WASM module, but it must be documented with
`pglite.wasm`: the database loader fetches both together and passes them to
`new PGlite(...)`.

### Vite-emitted app assets

`apps/web-ide/vite.config.ts` is the source of truth for these browser URLs in
both dev and production builds.

| Browser URL | Source | Loader | Purpose |
| --- | --- | --- | --- |
| `${base}opentui/opentui.wasm` | First existing file from `vendor/opentui/packages/core/src/zig/lib/wasm32-freestanding/libopentui.wasm` or `opentui.wasm` | `opentuiWasmAsset()` middleware and Rollup asset emission; URL injected as `__OPENTUI_WASM_URL__` | OpenTUI core runtime used by browser OpenCode TUI surfaces. |
| `${base}codex-cli-wasm/codex_cli_wasm.js` | `packages/codex-cli-wasm/dist/pkg/codex_cli_wasm.js` | `codexCliWasmAssets()`; URL injected as `__CODEX_CLI_WASM_MODULE_URL__` | wasm-bindgen JS loader for the Codex CLI browser worker. |
| `${base}codex-cli-wasm/codex_cli_wasm_bg.wasm` | `packages/codex-cli-wasm/dist/pkg/codex_cli_wasm_bg.wasm` | Fetched by the `codex_cli_wasm.js` loader | Rust Codex CLI adapter that runs in the browser worker and bridges shell/app-server effects back to almostnode. |
| `${base}codex-app-server-wasm/codex_app_server_wasm.js` | `packages/codex-app-server-wasm/dist/pkg/codex_app_server_wasm.js` | `codexAppServerWasmAssets()`; URL injected as `__CODEX_APP_SERVER_WASM_MODULE_URL__` | wasm-bindgen JS loader for the Codex app-server browser worker. |
| `${base}codex-app-server-wasm/codex_app_server_wasm_bg.wasm` | `packages/codex-app-server-wasm/dist/pkg/codex_app_server_wasm_bg.wasm` | Fetched by the `codex_app_server_wasm.js` loader | Rust Codex app-server adapter for browser-hosted thread/session state. |

### Bundled or lazy runtime assets

These are imported by almostnode runtime modules and emitted by Vite's asset
pipeline when those runtime paths are bundled.

| Asset | Source | Loaded by | Purpose |
| --- | --- | --- | --- |
| `playground.wasm32-wasi.wasm` | `packages/almostnode/src/oxc/vendor/playground.wasm32-wasi.wasm` | `packages/almostnode/src/oxc/browser-binding.ts` through `?url` | OXC parser/linter/formatter runtime used by the Monaco OXC worker and shell command paths. |
| `main.wasm` | `packages/tailscale-connect/main.wasm`, exposed as `@tailscale/connect/main.wasm?url` | `packages/almostnode/src/network/tailscale-connect-worker.ts` | Tailscale Connect Go WASM runtime for browser network sessions. |
| `brotli_wasm_bg.wasm` | `apps/web-ide/node_modules/brotli-wasm/pkg.web/brotli_wasm_bg.wasm` | `packages/almostnode/src/shims/zlib.ts` via lazy `import("brotli-wasm")` | Brotli compression/decompression for the browser `zlib` shim. |
| `esbuild.wasm` | CDN URL from `packages/almostnode/src/config/cdn.ts` (`https://unpkg.com/esbuild-wasm@.../esbuild.wasm`) | `packages/almostnode/src/transform.ts`, framework dev servers, and `packages/almostnode/src/shims/esbuild.ts` | Browser TypeScript/JSX transform and npm module bundling support. |

### Explicit non-assets

- OpenCode's `web-tree-sitter/tree-sitter.wasm` and
  `tree-sitter-bash/tree-sitter-bash.wasm` imports are redirected to
  `vendor/opencode/packages/browser/src/shims/wasm-asset.browser.ts`, which
  exports an empty URL. We do not currently ship those parser WASM files for the
  Web IDE.
- `tsgo-wasm` is a template dependency installed into generated projects, not a
  Web IDE app asset. It may load its own browser/runtime files inside the
  workspace, but it is owned by the seeded project dependency graph.

## Credentials, OAuth, and Network

Credentials are stored as files in the VFS and managed by the keychain in
`src/features/keychain.ts`. The host registers keychain slots for:

- Tailscale
- Claude
- Codex
- GitHub
- AWS
- Infisical
- Fly.io
- Netlify
- Cloudflare/Wrangler
- Neon
- app-building
- OpenCode
- Replay
- user-added OAuth services

`CredentialMirror` watches the configured credential paths so browser storage
and VFS state stay aligned. The keychain sidebar lets users log in, log out,
unlock, forget saved credentials, select provider-specific resources, and add
OAuth services.

The OAuth callback route is `/oauth/callback`. It relays the popup result to the
IDE using both `window.opener.postMessage` and `BroadcastChannel`, because some
providers sever the opener relationship during cross-origin redirects.

Network session state is stored through `src/features/network-session.ts` and is
used by almostnode's network integration, including Tailscale session restore.

## Database Support

The IDE includes PGlite support with project-scoped database namespaces.

`initPGliteIfNeeded()` wires the PGlite middleware into the preview path and
mounts database controls in the workbench. The database sidebar can list,
create, switch, and delete databases. The database browser editor can inspect
tables and run SQL against the active database.

Workspace templates can include Drizzle config and helpers. Reference app
seeding can convert `database.xml` into Drizzle schema and an initial migration.

## App-building Control Plane

There are two related app-building paths:

- `/app-builder` is a standalone onboarding/control-plane screen under
  `src/app-builder`
- the `app-building` shell command and preview surface run from the web IDE
  workbench

The standalone screen collects service readiness for GitHub, Replay, Infisical,
Fly.io, Netlify, and Neon. The workbench command path can create remote Fly
machines, track app-building jobs in `ProjectDB`, stream logs, send follow-up
messages, stop jobs, and open app-building previews.

## Extensions and Marketplace

Extension support is implemented in `src/extensions` using the Monaco VS Code
extension service overrides.

The marketplace mode can be:

- `open-vsx`, backed by `OpenVSXClient`
- `fixtures`, backed by `FixtureMarketplaceClient` for tests and deterministic
  local behavior

Extensions are unpacked into the VFS under `/.almostnode-vscode/extensions`.
Compatibility checks reject unsupported contribution points such as terminal
providers in the current version.

## Testing and QA Features

The web IDE includes browser-side test recording and running:

- Playwright command recording from almostnode's Playwright shim
- generated specs under `/project/tests/e2e`
- metadata in `/project/tests/.almostnode-tests.json`
- test CodeLens registration
- test status in the tests sidebar
- test run output in terminal custom tabs
- cursor overlay during recorded preview interactions

The main verification commands are:

```bash
pnpm nx dev web-ide
pnpm nx build web-ide
pnpm nx test web-ide
pnpm nx e2e web-ide
```

Use `playwright-cli` for UI verification when testing behavior through the
almostnode terminal/runtime path.

## Build-time Pieces

`vite.config.ts` does substantial browser compatibility work:

- TanStack React Start integration
- Tailwind and React plugins
- wasm support
- Node/polyfill aliases for Monaco, OpenCode, OpenTUI, Codex, PGlite, and
  almostnode shims
- generated workspace template virtual module
- generated workbench entrypoint virtual module
- local CORS proxy and WebSocket relay
- browser WASM asset serving documented in "Browser-shipped WASM Assets"
- PGlite Emscripten environment fix during production build

Keep changes here narrow. Most package/runtime compatibility fixes should live
in the generic almostnode shims or command surface rather than in package-specific
web-ide workarounds.

## Supported Feature Summary

The current web IDE supports:

- browser-native VS Code-like workbench
- VFS-backed file tree and editor operations
- workspace templates for Vite, Next.js, TanStack Router, and app-building
- local project creation, switching, autosave, and deletion
- GitHub-backed project creation and import when credentials are available
- almostnode terminal sessions with npm/package-manager support
- live preview servers through the almostnode service-worker path
- preview console capture and source selection
- OpenCode browser sessions
- Codex browser CLI and app-server wasm integration
- Claude Code terminal launch and IDE bridge support
- host terminal/agent mode through the desktop bridge
- keychain-backed credential restore for supported services
- user-added OAuth service registration and refresh
- PGlite database browsing and SQL execution
- app-building remote worker orchestration
- browser-side Playwright test recording and execution
- Open VSX extension install/enable/disable support

## When Changing This App

- Read the relevant template, feature module, and test before changing behavior.
- Prefer the existing almostnode runtime, shell command, and shim layers over
  one-off frontend adapters.
- If a CLI exists in the runtime, validate through that command path.
- Keep browser mode and desktop host mode distinct.
- Run at least `pnpm nx test web-ide` after meaningful source changes, and add
  `pnpm nx e2e web-ide` for user-visible workbench behavior.
