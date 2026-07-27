# Codex CLI in the Browser

Almost Node runs a browser port of OpenAI Codex in WebAssembly. The current
port tracks OpenAI Codex `0.145.0` (`rust-v0.145.0`) and exposes both a CLI
worker and an app-server worker to the Web IDE.

## Upstream pin

`pnpm vendor:install:codex` installs a reproducible browser fork rather than an
intermediate build:

- Official OpenAI release: `rust-v0.145.0`
- Official release commit:
  `25af12f7e61572b0bc18ddb1008be543b91519b0`
- Browser-port commit:
  `f734cacd239155ace2c304f8e8ae108a0e6ea869`

The browser-port commit is one commit whose direct parent is the official
release commit. `scripts/vendor-install-codex.js` verifies the exact default
commit, workspace version, official-release ancestry, direct parent, and clean
vendor checkout before building. Set `CODEX_SOURCE_DIR` to check or build a
different checkout without replacing `vendor/codex`.

## Runtime shape

The implementation has three cooperating layers:

1. The forked `codex-rs` crates compile for `wasm32-unknown-unknown`. The
   browser CLI keeps an argv-shaped command surface, and the browser TUI uses a
   wasm-compatible `ratatui` renderer.
2. `packages/codex-wasm/rust` links the upstream Codex crates into a
   `wasm-bindgen` adapter. It exports CLI and app-server constructors and is
   built to `packages/codex-wasm/dist/pkg`.
3. The TypeScript workers and host bridge connect WASM to an Almost Node
   container. The bridge handles auth, virtual-filesystem access, streamed
   HTTP, command execution, and interactive process operations.

The host bridge currently provides:

- `auth/env` and `auth/refresh`
- virtual filesystem reads, writes, patch application, directory creation and
  listing, and metadata
- buffered and streamed network fetch, including stream cancellation
- one-off and streaming command execution
- process spawn, stdin, terminal resize, and termination

These operations use the container's VFS, network controller, and terminal
sessions. The Rust WASM module does not reach through to the host operating
system.

The Web IDE registers `codex` as a first-class Almost Node shell command in
`apps/web-ide/src/features/codex-cli-browser-session.ts`. Vite serves the
generated browser artifacts at:

- `/codex-wasm/codex_wasm.js`
- `/codex-wasm/codex_wasm_bg.wasm`

## What runs today

### CLI and one-shot exec

The browser CLI supports:

- `codex --help` and `codex --version`
- browser-hosted login status, API-key/access-token login, device-login
  requests, and logout
- `codex doctor` and `codex features`
- `codex exec [OPTIONS] [PROMPT]`
- prompt-shaped non-interactive calls such as
  `container.run("codex summarize this project")`
- `--model`, `-c model=...`, `--json`, and `--output-last-message` for the
  supported one-shot exec slice

One-shot `codex exec` is still a browser-hosted Responses API/tool-call bridge.
It can call `shell_command`, `apply_patch`, and the browser Playwright shim
through the Almost Node host bridge, but it is not a persisted upstream core
thread.

### Interactive TUI and upstream core session

Running `codex` in an interactive Web IDE terminal uses the forked
`codex-tui` wasm renderer for its frame loop, input handling, slash-command
surfaces, Markdown, plan updates, and streamed transcript.

Submitted prompts now use a real Rust app-server/core session where the Web IDE
provides the app-server worker:

1. The shell wrapper initializes the browser app-server.
2. The adapter creates the upstream Codex `ThreadManager` and `CodexThread`.
3. Each prompt is submitted with `turn/start`.
4. Upstream Codex performs the streamed Responses request and tool loop.
5. Filesystem, network, command, process, and auth effects cross the Almost Node
   host bridge.
6. App-server item and turn notifications are fed back into the wasm TUI
   renderer.

This means the interactive model turn is no longer the old JS-only
`codex exec` fallback. Shell escapes such as `!pwd` still execute directly
through the Almost Node terminal session and are rendered into the same TUI.

### App-server worker

`createCodexBrowserSession` starts the app-server WASM worker over a
`MessageChannel`. The implemented protocol slice includes:

- initialization and runtime status
- thread start, list, search, loaded-list, read, unsubscribe, and in-memory
  turn/item reads
- turn start using the upstream core thread
- item injection
- filesystem requests
- one-off and interactive command/process requests

The app-server adapter uses the upstream `codex-app-server-protocol` request
types and emits normal thread, turn, item, process, and command notifications.
The deterministic smoke test exercises a streamed model response, an upstream
tool call, a host-backed process, the follow-up tool result, and completed
thread/turn/item reads.

## Current limitations

This is a browser port of the supported session path, not a claim that every
native Codex surface now works:

- The adapter does not embed the native in-process app-server
  `MessageProcessor`; it implements the supported protocol boundary directly
  over `MessagePort`.
- Thread storage is currently in memory. Native rollout files, SQLite-backed
  state, restart persistence, resume, fork, archive, and unarchive are not
  available yet.
- App-server methods outside the implemented request slice return JSON-RPC
  `-32601`. Native configuration-manager operations, including permission
  profile selection on `turn/start`, are not yet host-shimmed.
- Browser command execution does not yet implement app-server output caps,
  command sandbox-policy overrides, or permission profiles. Browser
  `process/spawn` does not implement `outputBytesCap`.
- The browser TUI is a wasm-specific `ratatui` surface, not the native
  `crossterm` process. The Web IDE shell supplies its app-server session and
  browser login host.
- The raw CLI subcommand `codex app-server` remains unavailable because there
  is no native process/socket daemon in the browser. The app-server is exposed
  through the worker/session API instead.
- Native-only CLI workflows such as `review`, `mcp`, `mcp-server`, `plugin`,
  `remote-control`, `sandbox`, `execpolicy`, `apply`, `resume`, `fork`,
  `archive`, `cloud`, and update return exit code `78`.
- `codex exec resume`, `codex exec review`, `--output-schema`, and other
  unsupported native exec options remain unavailable.
- A usable session still requires a host container with the relevant VFS,
  network, terminal, and auth capabilities. Device login also requires the Web
  IDE/keychain login host.
- Browser sandboxing and network routing are provided by Almost Node and its
  selected network controller, not by native OS syscalls. Depending on the
  target, HTTP may use the configured CORS proxy or the browser Tailscale
  route.

## Build and verification

Install the pinned fork and build the generated WASM:

```bash
pnpm vendor:install:codex
```

For an already checked-out source tree, the equivalent explicit checks are:

```bash
CODEX_SOURCE_DIR=/path/to/codex pnpm --dir packages/codex-wasm check:codex-wasm
pnpm --dir packages/codex-wasm build
CODEX_SOURCE_DIR=/path/to/codex pnpm --dir packages/codex-wasm build:adapter
pnpm --dir packages/codex-wasm smoke:adapter
pnpm --dir packages/codex-wasm type-check
pnpm --dir packages/codex-wasm test
```

`check:codex-wasm` checks the complete locked adapter dependency graph for
`wasm32-unknown-unknown`. `smoke:adapter` then runs both deterministic generated
artifact tests:

- `tests/browser-wasm-smoke.mjs` verifies version `0.145.0`, CLI parsing,
  login behavior, the wasm TUI renderer, and its browser actions.
- `tests/app-server-browser-wasm-smoke.mjs` verifies the real upstream core
  thread/turn path with fake streamed Responses data and deterministic host
  filesystem, network, command, and process bridges.

To verify the served Web IDE integration, start the app and run the two
Playwright smoke scripts against it:

```bash
CODEX_SOURCE_DIR=/path/to/codex pnpm nx dev web-ide --skip-nx-cache

CODEX_CLI_WASM_BASE_URL=http://127.0.0.1:5173 \
  pnpm --dir apps/web-ide exec node tests/codex-cli-wasm-browser-smoke.mjs

CODEX_APP_SERVER_WASM_BASE_URL=http://127.0.0.1:5173 \
  pnpm --dir apps/web-ide exec node tests/codex-app-server-wasm-browser-smoke.mjs
```

The CLI browser smoke intercepts model traffic with deterministic SSE fixtures
and verifies `container.run("codex --version")`, one-shot exec/tool calls,
interactive `!command`, and an interactive upstream-core TUI turn. The
app-server browser smoke verifies the worker/session API plus VFS and
interactive command/process host bridges in Chromium.

The credentialed real-API smoke is separate from these deterministic gates and
should only be used when explicitly validating live provider credentials and
network routing.
