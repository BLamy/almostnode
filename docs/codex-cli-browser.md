# Codex CLI In Browser

This follows the same shape as the OpenCode/OpenTUI browser integration:

1. Vendor the upstream source and build the browser artifact with
   `pnpm vendor:install:codex`.
2. Build the browser-compatible CLI package under `packages/codex-cli-wasm`.
3. Load that package in a module Worker.
4. Route filesystem and command access back through almostnode instead of native
   OS APIs.

`packages/codex-cli-wasm` is intentionally split into explicit build and check
targets:

- `pnpm vendor:install:codex` clones or updates `vendor/codex` and then runs the
  Codex CLI WASM adapter build.
- `pnpm nx build-adapter codex-cli-wasm` builds the current wasm-bindgen CLI
  module and emits browser-importable JS/WASM under
  `packages/codex-cli-wasm/dist/pkg`. This is generated build output and can be
  recreated locally with the target.
- `pnpm nx smoke-adapter codex-cli-wasm` imports the generated package, loads
  the WASM, and verifies `codex --help`, `codex login status`, the wasm
  ratatui frame renderer, and native-only subcommand reporting.
- `pnpm nx check-codex-cli-wasm codex-cli-wasm` checks upstream
  `codex-rs/tui` and `codex-rs/cli` for `wasm32-unknown-unknown`
  compatibility.

The vendored fork adds a browser-safe `codex-rs/cli/src/browser_cli.rs` module
and gates the native CLI dependency graph out of `wasm32` builds. The
wasm-bindgen adapter imports that forked browser CLI source for its
`real-codex` build, so the generated browser module uses the Codex fork's
argv-shaped command surface rather than a separate app-only parser.

For the browser terminal surface, the fork adds a wasm-only
`codex-rs/tui/src/browser.rs` renderer and a thin
`codex-rs/cli/src/browser_tui.rs` argv adapter. The `codex-tui` wasm target
uses `ratatui` with default terminal backend features disabled, renders a
Codex frame into `ratatui::backend::TestBackend`, and serializes the styled
buffer to ANSI for the Web IDE terminal.

The Web IDE wrapper lives in
`apps/web-ide/src/features/codex-cli-browser-session.ts`. It creates the Worker
from `apps/web-ide/src/features/codex-cli.worker.ts` and exposes a `codex` shell
command factory that can be registered on an almostnode container. Web IDE
startup registers that command on the workbench container, so browser terminal
commands and direct container calls such as `container.run("codex --help")`
route through the WASM worker.

The Web IDE Vite config serves and emits the generated files at:

- `/codex-cli-wasm/codex_cli_wasm.js`
- `/codex-cli-wasm/codex_cli_wasm_bg.wasm`

`createWebIdeCodexCliBrowserSession` and
`createWebIdeCodexCliShellCommand` use that module URL by default.

## Browser CLI status

The browser module currently provides an argv-shaped Codex command surface that
loads in a real browser and returns normal CLI-style results:

- `codex --help`
- `codex --version`
- `codex login status`
- `codex login --with-api-key`
- `codex login --with-access-token`
- `codex logout`
- `codex` in an interactive Web IDE terminal, using a wasm ratatui-rendered
  browser frame loop that forwards submitted prompts through hosted
  `codex exec`
- `!command` inside that interactive browser terminal, routed through
  almostnode shell execution and rendered back into the TUI transcript
- `codex [PROMPT]` in non-interactive browser shell/container calls, routed to
  hosted `codex exec`
- `codex exec [OPTIONS] [PROMPT]` in the hosted Web Worker shell command
- `codex doctor`
- `codex features list`

Direct raw WASM calls still report `codex exec` as native-only because the
compiled Rust adapter is synchronous and has no browser host bridge. The hosted
Web Worker path adds the first runnable browser agent slice:

- Parses one-shot `codex exec [OPTIONS] [PROMPT]` invocations.
- Uses `OPENAI_API_KEY` or `CODEX_API_KEY` with the OpenAI Responses API from
  the Worker.
- Advertises the upstream `shell_command` Responses tool when the almostnode
  host bridge is attached.
- Executes `shell_command` and `local_shell_call` requests through the
  almostnode `command/exec` host bridge, then feeds Codex-style
  `function_call_output` strings back to the model.
- Supports `-m/--model`, `-c model=...`, `CODEX_MODEL`, `OPENAI_MODEL`,
  `--json`, and `--output-last-message`.
- Writes `--output-last-message` through the almostnode host filesystem bridge.
- Keeps native-only exec modes such as `resume`, `review`, and
  `--output-schema` explicit with exit code `78`.

The hosted exec bridge is still not the full native Codex runtime. It does not
yet run the Rust app-server/TUI session loop, persist native thread state, or
route approvals and resumable exec sessions through Codex core. It is the
browser-compatible Responses/tool-call bridge needed for one-shot browser
`codex exec` to inspect and modify the almostnode workspace.

The registered shell command also provides a first browser interactive entrypoint
for `codex` in the Web IDE terminal. It keeps the terminal session attached,
renders the Codex header, model/directory card, tip row, composer row, and
transcript area through the wasm ratatui frame renderer, accepts typed input,
sends each submitted prompt through the hosted `codex exec` bridge, and exits
on `/exit`, `exit`, `quit`, Ctrl-C, or Ctrl-D.

For non-interactive browser calls, prompt-shaped top-level invocations such as
`container.run("codex summarize this project")` are routed to hosted
`codex exec "summarize this project"` instead of falling into the raw WASM
native-TUI-unavailable path. Native subcommands continue to use their explicit
argv-shaped implementations.

The browser frame renderer now lives in the forked `codex-tui` crate and
`codex-tui` checks successfully for `wasm32-unknown-unknown`, but it is still
not the full native app-server session loop. Upstream Codex ties that loop to
`crossterm`, Tokio process/signal/net features, app-server clients, state
storage, realtime audio, and clipboard integrations. almostnode and Tailscale
can provide browser-side filesystem, process, stdio, and network behavior, but
not through the native Rust syscall APIs those crates use. The fork must route
those calls through browser host bridges or browser-compatible backend shims.
The current fork keeps the native services out of the browser build and gives
the Web IDE terminal a wasm ratatui surface first. The remaining work is to feed
that surface from Codex session state and route filesystem, process execution,
auth, networking, approvals, and app-server transport through almostnode host
bridges.

Native subcommands such as `codex app-server`, `codex mcp`, and interactive TUI
mode are recognized but return exit code `78` with a clear browser-runtime
message until their filesystem, process, auth, networking, and app-server/TUI
dependencies are routed through almostnode host bridges.

## Fork status

The forked upstream TUI and CLI crates are `codex-rs/tui` and `codex-rs/cli`.
They now check successfully for the browser target:

```bash
pnpm vendor:install:codex
pnpm nx check-codex-cli-wasm codex-cli-wasm
```

The native `codex-tui` session/runtime paths still pull OS-only surfaces through
several paths, including app-server clients, Tokio net/process/signal, exec
resume and review, state, SQLite-backed storage, realtime audio, and clipboard.
The fork now compiles the Codex TUI browser module and CLI browser surface for
`wasm32-unknown-unknown`; the native session/runtime paths remain excluded from
the browser module until almostnode host bridges exist for them.

Remaining browser CLI work:

- Route filesystem, process execution, keychain/auth, and network access through
  the almostnode host bridge.
- Add browser session state, approvals, and resumable `codex exec` execution.
- Feed the wasm ratatui frame renderer from the real Codex session loop instead
  of the current browser transcript state.
- Replace the remaining native Tokio/crossterm boundaries with browser host
  bridge implementations: almostnode for filesystem/process/stdin/stdout and
  Tailscale/browser fetch/WebSocket paths for network transport.
- Keep the CLI invocation contract argv-shaped so `codex` can be registered as
  a first-class almostnode shell command.

## Verification

Current focused checks:

```bash
pnpm nx check-codex-cli-wasm codex-cli-wasm
pnpm nx smoke-adapter codex-cli-wasm
pnpm nx type-check codex-cli-wasm --skip-nx-cache
pnpm nx test codex-cli-wasm --skip-nx-cache
pnpm --dir apps/web-ide exec vitest run tests/webide-command-routing.test.ts tests/codex-cli-shell-command.test.ts tests/webide-vite-config.test.ts
CODEX_CLI_WASM_BASE_URL=http://127.0.0.1:5177 pnpm --dir apps/web-ide exec node tests/codex-cli-wasm-browser-smoke.mjs
pnpm --dir apps/web-ide run build
```

The browser smoke imports the served WASM module and also verifies
`createContainer().run("codex --help")`, `codex login status`, hosted
`codex exec --output-last-message ...`, and hosted `codex exec --json ...` in
Chromium. It also verifies that `codex` in an interactive terminal renders the
wasm ratatui Codex frame. The raw WASM smoke still verifies direct
`cli.run(["exec", ...])` returns the native-only exit-code path.
