# Codex App-Server In Browser

almostnode should run Codex app-server as browser code, not as a local OS process
or a tunneled localhost server. The integration is split into two parts:

1. `packages/codex-wasm` owns the browser bridge:
   - JSON-RPC peer for Codex app-server messages.
   - `MessagePort` transport for Worker/WASM communication.
   - host bridge for filesystem and command execution through almostnode VFS and
     `TerminalSession`.
2. `apps/web-ide/src/features/codex-browser-session.ts` creates the Web IDE
   Worker/session wrapper and passes almostnode host services into the bridge.

The Rust crate under `packages/codex-wasm/rust` is an adapter
scaffold. It now links the forked `codex-app-server` wasm surface behind the
`real-codex` feature and builds a browser-importable wasm-pack package under
`packages/codex-wasm/dist/pkg`. The adapter can run a browser
`MessagePort` JSON-RPC loop, deserialize generated Codex app-server protocol
requests, return protocol-shaped startup/read responses, and route the first
in-memory thread lifecycle, filesystem, buffered or streamed command execution,
and `process/spawn` protocol requests through the almostnode host bridge. It
still does not claim to run a real Codex session loop until the in-process
message processor is wired.

## Upstream status

The right upstream entry point is `codex-rs/app-server/src/in_process.rs`.
`InProcessClientHandle` already has the shape we need: requests,
notifications, server requests, and event polling without binding to stdio or
WebSocket.

Current status:

```bash
pnpm vendor:install:codex
pnpm nx check-codex-wasm codex-wasm
```

The forked `codex-app-server` library now checks for
`wasm32-unknown-unknown`. The wasm build uses a browser-specific crate root and
keeps native app-server binaries, socket/listener transports, WebSocket
servers, native image decoding, and other OS-only dependencies behind
`not(target_arch = "wasm32")`.

The adapter build follows the same generated-artifact shape as the CLI browser
surface in `packages/codex-wasm`:

```bash
pnpm nx build-adapter codex-wasm
pnpm nx smoke-adapter codex-wasm
```

The smoke test imports `codex_wasm.js`, loads the generated `.wasm`,
starts the adapter on a `MessageChannel`, and verifies:

- `initialize` returns browser app-server metadata.
- `appServer/status` reports a running browser WASM adapter linked with
  `real-codex`, protocol-backed read support, and no leaked host bridge
  requests.
- `thread/list` returns the official empty `ThreadListResponse` page shape.
- `thread/start` creates a browser in-memory thread with the official
  `ThreadStartResponse` shape, marks it ephemeral, and emits `thread/started`.
- `thread/loaded/list`, `thread/read`, and subsequent `thread/list` calls
  reflect browser-created threads using official response shapes.
- `fs/createDirectory`, `fs/writeFile`, `fs/readFile`, `fs/getMetadata`, and
  `fs/readDirectory` round-trip through `codex/host/request` and return the
  official Codex app-server response shapes.
- buffered non-tty `command/exec` round-trips through the almostnode terminal
  session bridge and returns the official `CommandExecResponse` shape.
- streamed `command/exec` maps host output events to official
  `command/exec/outputDelta` notifications, keeps streamed stdout/stderr out of
  the final response, and routes `command/exec/write`,
  `command/exec/resize`, and `command/exec/terminate` through the active
  terminal session.
- `process/spawn` returns the official empty response, streams
  `process/outputDelta`, emits the final `process/exited` notification, and
  routes `process/writeStdin`, `process/resizePty`, and `process/kill` through
  the active terminal session.
- valid but unimplemented native methods fail with a clear JSON-RPC
  method-not-found error.
- invalid request payloads fail with a JSON-RPC invalid-params error instead of
  hanging or emitting an uncorrelated notification.

Remaining work:

- Replace the temporary `WasmAppServer` status/handshake loop with the real
  in-process app server loop from `codex-rs/app-server/src/in_process.rs`.
- Replace in-memory browser thread lifecycle with native app-server session
  state, then route turn execution through `MessageProcessor`.
- Extend the host bridge beyond filesystem, command execution, and process
  execution to auth/keychain, network, persistence, and native session state.
- Keep app-server JSON-RPC schemas unchanged so rich clients can share the same
  protocol model.
