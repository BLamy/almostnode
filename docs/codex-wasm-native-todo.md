# Codex WASM Future Platform TODOs

This is the deferred platform work for running the real forked Codex CLI/TUI/app-server in the browser. These are future TODOs, not active implementation shortcuts and not requests to add browser-specific Codex behavior. Each item should be handled by gating native-only dependencies or by adding a generic almostnode host shim that upstream Codex can call.

Rule of thumb: if a dependency assumes native sockets, native processes, OS keychains, local files, or native daemon lifecycles, keep that path native-only until there is a browser host shim with the same Codex-facing contract.

Do not solve these by adding parallel TypeScript Codex behavior. The browser host should supply missing OS/runtime contracts; the forked Codex crates should continue to own request construction, auth flow, command parsing, tool events, and TUI/app-server behavior.

## Native-Only Until A Host Shim Exists

- [ ] Amazon Bedrock's AWS SDK path needs to stay native-only until there is a browser AWS signing host shim.
- [ ] Bedrock browser support should use a host-backed SigV4 signing operation instead of compiling the AWS SDK network/runtime stack into `wasm32-unknown-unknown`.
- [ ] Other provider SDK paths that assume native TLS, sockets, credential chains, process-wide config, or background refresh should stay native-only until almostnode exposes a provider-agnostic signing/request host API.
- [ ] Provider-specific environment discovery, credential files, and token refresh daemons should stay native-only until there is a browser credential-provider host contract.
- [ ] Agent Identity JWT signing needs to stay native-only until there is a browser signing host shim for Codex identity keys.
- [ ] Agent Identity key material should never be reimplemented as Codex-specific browser storage; it needs a generic keychain/signing bridge.
- [ ] Sentry feedback upload needs to stay native-only until the browser has a host-backed attachment/file upload path.
- [ ] Sentry tracing/log upload should stay native-only unless the browser host can preserve the same privacy, redaction, and attachment semantics.
- [ ] Realtime/WebSocket transports need to stay native-only until there is a browser WebSocket host shim.
- [ ] WebRTC/realtime session setup should stay native-only until the browser app-server host can forward the same SDP/session events.
- [ ] MCP child-process, stdio, and local `axum` server transports need to stay native-only until there is a browser MCP transport.
- [ ] Network proxy daemon behavior needs to stay native-only; browser Codex should use almostnode fetch/Tailscale host networking instead of local TCP/Unix proxying.
- [ ] Native SQLite/sqlx state persistence needs to stay native-only until Codex state is backed by almostnode storage.
- [ ] Native terminal/PTY assumptions should stay native-only until crossterm/ratatui I/O is fully bridged through a browser terminal host.
- [ ] Local app-server daemon and remote-control socket behavior should stay native-only until there is a browser app-server host transport.
- [ ] Unix sockets, signal handling, process groups, and parent-death behavior should stay native-only until almostnode exposes equivalent host lifecycle APIs.

## Auth And Keychain

- [ ] ChatGPT Codex auth should use the native Codex login/auth flow, with browser storage/keychain only acting as the credential provider.
- [ ] API key auth should flow through native Codex auth/env lookup, backed by almostnode keychain/env shims.
- [ ] Browser Codex should not show custom browser-only login copy once native app-server auth events are wired.
- [ ] OAuth redirect/device-code handling should be driven by Codex auth events, with the browser host only opening URLs, receiving callbacks, and persisting credentials.
- [ ] Keyring-backed MCP auth needs a browser keychain shim before enabling native MCP auth flows in wasm.
- [ ] Token refresh, account selection, plan detection, and `account/updated` events should come from native Codex auth/account code.

## Network And Streaming

- [ ] Responses HTTP/SSE streaming should be native Codex Rust request construction plus a host-backed browser fetch stream.
- [ ] The host fetch shim must preserve status, headers, request IDs, SSE event names, SSE chunks, cancellation, and backpressure.
- [ ] CORS and Tailscale should be handled by the almostnode network host path, not Codex-specific request hacks.
- [ ] Codex should not manually craft browser-only Responses API request bodies in TypeScript.
- [ ] Browser fetch should expose Codex-compatible errors without translating them into browser-only error strings.
- [ ] Retry, timeout, cancellation, and upload/download progress should preserve native `codex-client` semantics.
- [ ] The browser service worker should act as a transport host, not as a second Codex protocol implementation.

## Filesystem And Persistence

- [ ] `tokio::fs` must not be required for browser Codex unless it routes through a host-backed filesystem shim.
- [ ] Codex filesystem operations should route through the almostnode VFS/host filesystem shim.
- [ ] File upload support needs a host-backed VFS reader before enabling native Codex file uploads in wasm.
- [ ] Add host operations for remove, copy, metadata, canonicalization, and directory traversal with Codex-compatible errors.
- [ ] Path normalization must preserve Codex cwd semantics in `/project`, including `.`, `./`, and relative shell paths.
- [ ] Browser state can start in-memory, but thread metadata, goals, and job state should eventually persist through almostnode storage.
- [ ] Native SQLite behavior should remain unchanged on native Codex.
- [ ] Rollout/session archive reads and writes should route through the same Codex-facing storage boundary on native and browser targets.
- [ ] Memory files and skill/plugin discovery should use the host filesystem contract instead of browser-only discovery code.

## Process, Shell, And Terminal

- [ ] Native process spawning must route through a host-backed `ExecBackend`.
- [ ] `!` commands should go through the upstream Codex parser and tool execution, then into the host process shim.
- [ ] Streaming stdout/stderr must be incremental, not reconstructed only after command completion.
- [ ] Stdin, termination, exit status, retained output, and long-running dev servers need host-backed process semantics.
- [ ] TTY resize and terminal dimensions should be passed through to the real crossterm/ratatui frame loop.
- [ ] Browser command execution should use the same tool-call/event path that native Codex uses, not a parallel browser loop.
- [ ] Sandbox policy, approval prompts, and command lifecycle notifications should remain native Codex app-server events.
- [ ] Hook execution should stay native-only until almostnode can provide a host process/filesystem contract for Codex hooks.

## MCP And Plugins

- [ ] MCP public types should remain available so core/app-server can compile for wasm even while native transports are gated out.
- [ ] Browser MCP should be a host/runtime transport, not TypeScript-generated fake tool responses.
- [ ] Plugin execution should preserve native Codex app-server notifications so tool calls render in the real TUI.
- [ ] Unsupported MCP transports should fail explicitly in wasm instead of silently producing fake output.
- [ ] MCP OAuth and bearer-token storage should use the generic browser keychain/auth shim.
- [ ] MCP server discovery and process launch should stay native-only until almostnode exposes equivalent browser host operations.

## App-Server And TUI Wiring

- [ ] The browser app-server wasm package should compile the real app-server processor/thread/session path.
- [ ] The current wasm app-server stub should not handle normal turns once native app-server compiles.
- [ ] Browser TUI input should route to native app-server `turn/start`.
- [ ] Tool calls should render from native app-server notifications.
- [ ] Slash commands and `!` commands should be upstream Codex behavior, not browser-specific command handling.
- [ ] The BrowserCodex tab should use the forked Rust TUI/app-server path by default, not the legacy TypeScript `browser_exec` model loop.
- [ ] Browser resize, paste, keyboard, focus, and alternate-screen handling should be translated into native TUI input events.
- [ ] Any compatibility facades added for wasm should preserve upstream public types and return explicit unsupported errors until the matching host shim exists.

## Compile Gates

- [ ] `codex-api` must compile for `wasm32-unknown-unknown` without native websocket/TCP deps.
- [ ] `codex-state` must compile for `wasm32-unknown-unknown` without `sqlx`/native SQLite deps.
- [ ] `codex-rmcp-client` and `codex-mcp` must compile for wasm with native transports gated out.
- [ ] `codex-network-proxy` must compile for wasm with Rama/TCP/Unix proxy code gated out.
- [ ] `codex-core` must compile for wasm using host-backed exec, fs, and HTTP shims.
- [ ] `codex-app-server` must compile for wasm using the real app-server path, excluding only native daemon transports.
- [ ] `codex-tui` must compile for wasm with crossterm/ratatui input and frame output routed through the browser terminal host.
- [ ] CI should include focused `cargo check --target wasm32-unknown-unknown` gates for the wasm-supported Codex crates.

## Browser-Specific Behavior To Remove

- [ ] Browser-only Responses API body construction.
- [ ] Browser-only Codex model loop.
- [ ] `thread/inject_items` as the normal way to mirror browser exec results.
- [ ] Hardcoded browser tool-round limits such as `requested more than 8 browser tool rounds`.
- [ ] Browser-specific execution failures such as `codex exec failed in the browser`.
- [ ] Browser-specific login errors replacing native Codex login/auth UI.
- [ ] Browser-only fake tool-call rendering that bypasses native app-server item notifications.
