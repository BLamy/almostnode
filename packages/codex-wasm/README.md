# @agent-wasm/codex

The Codex agent for agent-wasm, compiled to WebAssembly and run in the browser.
Provides app-server and CLI browser sessions over a `MessageChannel` + worker,
a JSON-RPC peer, and a host bridge that routes the agent's fs / network / command
/ process effects to a [`@agent-wasm/core`](https://www.npmjs.com/package/@agent-wasm/core)
container.

```bash
npm install @agent-wasm/codex
```

## API

- **`createCodexBrowserSession` / `CodexBrowserSession`** — app-server session.
- **`createCodexCliBrowserSession` / `CodexCliBrowserSession`** — CLI session.
- **`createBrowserCodexCliShellCommand`** — a shell command factory.
- **`CodexHostBridge` / `CodexHostContainer` / `CodexHostAuthController`** — wire
  the WASM agent to a host container + auth.

## Subpaths

| Import | Purpose |
| --- | --- |
| `@agent-wasm/codex` | the session/bridge API above |
| `@agent-wasm/codex/cli-browser-worker` | the CLI worker entrypoint |
| `@agent-wasm/codex/app-server-browser-worker` | the app-server worker entrypoint |

> **Note:** the Rust → WASM artifacts are built from the vendored Codex crates via
> `wasm-pack`; published builds ship the prebuilt `.wasm` under `dist/pkg`.

The browser port currently tracks OpenAI Codex `0.145.0` (`rust-v0.145.0`).
Install the reproducibly pinned browser fork and build the adapter with:

```bash
pnpm vendor:install:codex
```

To validate or build a separate Codex checkout without replacing
`vendor/codex`, set `CODEX_SOURCE_DIR`:

```bash
CODEX_SOURCE_DIR=/path/to/codex pnpm nx check-codex-wasm codex-wasm
CODEX_SOURCE_DIR=/path/to/codex pnpm nx build-adapter codex-wasm
```

## License

MIT
