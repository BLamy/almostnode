# TanStack AI Almostnode Sandbox Provider Plan

## Summary

Make almostnode a TanStack AI sandbox provider instead of a parallel agent
orchestration framework.

TanStack AI should own the chat loop, harness adapters, AG-UI stream chunks,
workspace projection, policy mapping, and `withSandbox(...)` middleware.
Almostnode should provide a browser-native sandbox implementation that TanStack
can select the same way it selects Docker, local process, Cloudflare, Daytona,
or Vercel providers.

Durable Streams and Infisical Agent Vault should be configurable backing
services around that provider:

- Durable Streams provides durable sandbox records, locks, run logs, optional
  file event persistence, and the branch-native filesystem backing defined in
  `plans/isomorphic-agents.md`.
- Infisical Agent Vault provides brokered outbound credentials through redacted
  proxy env, server-side OpenAI-compatible proxy routes, and browser-safe
  almostnode network shims.

## Inputs Reviewed

- TanStack AI sandbox blog and docs:
  - `https://tanstack.com/blog/run-coding-agents-in-a-sandbox`
  - `https://tanstack.com/ai/latest/docs/sandbox/workspace`
  - `@tanstack/ai-sandbox@0.2.0` provider, store, run-log, policy, workspace,
    and tool-bridge type surfaces.
- This repo:
  - `packages/almostnode/src/container.ts`
  - `packages/almostnode/src/virtual-fs.ts`
  - `packages/almostnode/src/server-bridge.ts`
  - `plans/isomorphic-agents.md`
  - `plans/almostnode-staged-visual-source-editor.md`
- Adjacent repos:
  - `/Users/brettlamy/Dev/agent-orchestrator-console`
  - `/Users/brettlamy/Dev/notes-demo`
  - `/Users/brettlamy/Dev/replay/agent-vault-effect-playground`
  - `/Users/brettlamy/Dev/replay/effect-platform-sprites`
  - `/Users/brettlamy/Dev/replay/effect-platform-sprites-example`

## Boundary Decisions

- Do not fork or replace TanStack AI. Use its public sandbox provider seams.
- Do not make Durable Streams mandatory for the basic almostnode provider.
- Do not inject raw AI provider, GitHub, Stripe, or other service credentials
  into browser-visible sandboxes.
- Do not move visual editor branch semantics into TanStack. The visual editor
  remains a VFS write producer.
- Do not make `isomorphic-agents` depend on TanStack. Its branch, PGlite, and
  durable file/log protocol remains provider-neutral.
- Do not import Effect into `@agent-wasm/core`. Reuse the Agent Vault and
  sandbox-layer ideas from `effect-platform-sprites`, but keep the TanStack
  adapter Promise/type based unless a later package explicitly opts into Effect.

## Target API Shape

Create one package first:

- `packages/tanstack-ai-sandbox`
- package name: `@agent-wasm/tanstack-ai-sandbox`
- subpath exports:
  - `@agent-wasm/tanstack-ai-sandbox/almostnode`
  - `@agent-wasm/tanstack-ai-sandbox/durable-streams`
  - `@agent-wasm/tanstack-ai-sandbox/auth-proxy`
  - `@agent-wasm/tanstack-ai-sandbox/tool-bridge`

Example consumer shape:

```ts
import { chat } from "@tanstack/ai";
import {
  createSecrets,
  defineSandbox,
  defineSandboxPolicy,
  defineWorkspace,
  githubRepo,
  withSandbox,
} from "@tanstack/ai-sandbox";
import { codexText } from "@tanstack/ai-codex";
import { almostnodeSandbox } from "@agent-wasm/tanstack-ai-sandbox/almostnode";
import {
  durableStreamsRunLog,
  durableStreamsSandboxStore,
  durableStreamsLockStore,
} from "@agent-wasm/tanstack-ai-sandbox/durable-streams";
import {
  infisicalAgentVaultAuthProxy,
} from "@agent-wasm/tanstack-ai-sandbox/auth-proxy";

const authProxy = infisicalAgentVaultAuthProxy({
  sessionEndpoint: "/api/agent-vault/session",
  openAIBaseUrl: "/api/agent-vault/openai/v1",
  credentialKeys: ["OPENAI_API_KEY", "GITHUB_TOKEN"],
});

const sandbox = defineSandbox({
  id: "almostnode-web",
  provider: almostnodeSandbox({
    authProxy,
    persistence: {
      filesystem: "memory",
    },
  }),
  workspace: defineWorkspace({
    source: githubRepo({ repo: "replayio/notes-demo", depth: 1 }),
    packageManager: "pnpm",
    setup: ["pnpm install"],
    scripts: {
      dev: "pnpm dev",
      test: "pnpm test:unit",
    },
    secrets: createSecrets({
      OPENAI_API_KEY: "agent-vault:OPENAI_API_KEY",
    }),
    instructions: "Use the project AGENTS.md and keep changes scoped.",
  }),
  policy: defineSandboxPolicy({
    commands: {
      allow: ["pnpm *", "git *", "rg *", "node *"],
      ask: ["curl *", "gh *"],
      deny: ["sudo *"],
    },
    default: "ask",
  }),
  lifecycle: {
    reuse: "thread",
    snapshot: "after-setup",
  },
});

const stream = chat({
  adapter: codexText("gpt-5.5"),
  messages,
  middleware: [withSandbox(sandbox)],
  modelOptions: {
    sessionId,
  },
  runtime: {
    sandboxStore: durableStreamsSandboxStore({ baseUrl, token }),
    sandboxLocks: durableStreamsLockStore({ namespace }),
    runLog: durableStreamsRunLog({ baseUrl, token }),
  },
});
```

The exact `chat(...)` runtime shape may change as TanStack AI's sandbox package
settles. The invariant is that almostnode plugs in as `SandboxProvider`, while
Durable Streams implements the store/log/lock seams and Agent Vault implements
auth provisioning.

## Almostnode Provider Mapping

Build the provider over `createContainer()` rather than lower-level runtime
classes. That keeps shell command shims, git auth, scoped network controllers,
terminal sessions, package manager mutation handling, and service-worker-backed
ports inside the existing almostnode boundary.

| TanStack contract | Almostnode implementation |
| --- | --- |
| `SandboxProvider.create` | Create a container, hydrate/provision workspace, apply auth proxy env, run setup. |
| `SandboxProvider.resume` | Look up an in-process or durable provider id, reattach/hydrate a container, return `null` if gone. |
| `SandboxHandle.id` | Stable provider id, not the raw container id when durable backing is configured. |
| `SandboxHandle.workspaceRoot` | Usually `/workspace`; harness cwd uses this literal virtual path. |
| `SandboxFs.read/readBytes/write/list/mkdir/remove/rename/exists` | Async wrappers around `VirtualFS` methods. |
| `SandboxFs.watch` | Wrap `VirtualFS.watch` and normalize to TanStack file events. |
| `SandboxProcess.exec` | `container.run(command, { cwd, env, signal })`. |
| `SandboxProcess.spawn` | `container.createTerminalSession()` with stdout/stderr async queues and writable stdin. |
| `SandboxGit` | Use almostnode `git` shim through `container.run("git ...")` first. Add direct helpers only if needed. |
| `SandboxPorts.connect` | Use `ServerBridge` and `getServerUrl(port)`, waiting for matching `server-ready` when possible. |
| `SandboxEnv.set` | Maintain provider env overlay and merge it into every run/spawn; mirror to runtime process env when needed. |
| `snapshot` | Serialize `VirtualFS` plus provider metadata into an opaque snapshot store. |
| `fork` | Create a new container and hydrate it from the current snapshot. |
| `destroy` | Abort active runs, dispose terminal sessions, close servers, and unregister bridge ports. |

Initial capabilities:

```ts
{
  fs: true,
  exec: true,
  env: true,
  ports: true,
  backgroundProcesses: true,
  writableStdin: true,
  snapshots: true,
  networkPolicy: false,
  durableFilesystem: false,
  fork: true,
}
```

`networkPolicy` becomes `true` only after the adapter maps TanStack policy
decisions onto almostnode's `NetworkController` generically. `durableFilesystem`
becomes `true` only when a Durable Streams VFS backing is attached.

## Workspace Provisioning

Implement TanStack `WorkspaceDefinition` projection in the provider, not in Web
IDE UI code.

- `source: { type: "none" }`: create the root directory and run setup.
- `source: { type: "git" }`: use the almostnode git shim for shallow/full clone,
  including GitHub token handling through the provider env/auth-proxy layer.
- `source: { type: "local" }`: unsupported in pure browser runtime unless the
  caller provides a host-side file loader. Server/desktop hosts can add a local
  importer later.
- `setup`: execute commands serially/parallel according to TanStack setup-plan
  semantics.
- `scripts`: keep on the workspace definition for TanStack policy aliases and
  harness projection. Do not invent an almostnode-specific script registry.
- `instructions`, `skills`, `plugins`: let TanStack harness adapters project
  these into AGENTS.md, CLAUDE.md, MCP configs, or harness-native plugin files.

## Durable Streams Backing

Use Durable Streams in two layers:

1. TanStack persistence seams:
   - `SandboxStore` for compound sandbox key to provider sandbox id.
   - `LockStore` for distributed `ensure(...)` exclusion.
   - `RunEventLog` for gap-free, resumable AG-UI stream chunks.
   - Optional `ToolBridgeProvisioner` transport for serverless/edge MCP bridge
     endpoints.

2. Almostnode durable branch/file backing from `plans/isomorphic-agents.md`:
   - `DurableVirtualFsBridge` hydrates and mirrors `VirtualFS`.
   - Branch-local metadata/content/session streams stay the source of truth.
   - PGlite branch metadata and dump/load lineage stay outside TanStack store.

Suggested stream ids:

- Sandbox records: `tanstack/{tenant}/sandboxes/{key}`
- Run records: `tanstack/{tenant}/threads/{threadId}/runs/{runId}/record`
- Run events: `tanstack/{tenant}/threads/{threadId}/runs/{runId}/events`
- Tool bridge events: `tanstack/{tenant}/threads/{threadId}/runs/{runId}/tools`
- Branch manifests: keep the existing `workspaces/{workspaceId}/branches/{branchId}/...`
  topology from `plans/isomorphic-agents.md`.

Locking should use a Durable Object or equivalent compare-and-set lease. Do not
pretend an append-only stream alone is enough to prevent duplicate sandbox
creation under concurrent `withSandbox(...)` calls.

`notes-demo` is the precedent for same-origin Durable Streams proxies and
server-held stream secrets. Browser clients should talk to local app routes,
and those routes should attach Durable Streams service secrets server-side.

## Infisical And Agent Vault Auth Proxy

Use Agent Vault as the default credential boundary for sandboxes that need
provider, GitHub, Stripe, Replay, or similar API access.

Server-side responsibilities:

- Hold `AGENT_VAULT_TOKEN`, management tokens, Infisical credentials, and
  Durable Streams service tokens.
- Mint short-lived Agent Vault sessions for each sandbox/thread/run.
- Return only sanitized metadata to the browser or sandbox orchestration layer.
- Provide an OpenAI-compatible route such as `/api/agent-vault/openai/v1` when
  transparent proxying is not viable.

Sandbox-side responsibilities:

- Receive redacted proxy env only:
  - `HTTPS_PROXY`
  - `HTTP_PROXY`
  - `NO_PROXY`
  - `SSL_CERT_FILE`
  - `NODE_EXTRA_CA_CERTS`
  - provider-specific base URLs
  - sentinel API keys such as `sk-agent-vault-...`
- Write CA certificates into the VFS only when the runtime can actually use
  them.
- Never log, serialize, snapshot, or Durable-Streams-persist raw credential
  values.

Browser almostnode has an extra constraint: browser `fetch` does not honor
`HTTPS_PROXY`. Use one of these paths:

- Preferred for model providers: configure harnesses to call a normal HTTPS
  route, for example `/api/agent-vault/openai/v1`, and let the server route
  call Agent Vault.
- Preferred for generic outbound requests: use an almostnode network shim or
  `/api/almostnode/outbound` route that forwards only approved hosts through
  Agent Vault.
- Use transparent MITM proxy env only for remote Linux-like sandboxes that can
  reach the Agent Vault proxy listener.

The `effect-platform-sprites` Agent Vault code is a strong reference for:

- session request/validation shape
- sanitized metadata
- CA certificate writing
- credential key/service policy separation
- Infisical-backed Agent Vault session creation

Port the protocol, not the full Effect layer, into the TanStack adapter.

## Tool Bridge

TanStack's tool bridge already has a transport-independent core and a
`ToolBridgeProvisioner` seam. Almostnode should not require a raw `node:http`
listener.

Implement:

- `durableObjectToolBridgeProvisioner(...)`
- `fetchToolBridgeProvisioner(...)` for Next, TanStack Start, Cloudflare, or
  other same-origin route handlers.

These provisioners should mount TanStack's JSON-RPC bridge core behind a bearer
token and return a sandbox-reachable URL. That supports browser/edge
orchestrators and keeps MCP tool calls out of the almostnode provider itself.

## Relationship To The Existing Plans

### Visual Source Editor Plan

`plans/almostnode-staged-visual-source-editor.md` remains a Web IDE editing
surface plan.

Alignment:

- Visual Apply writes through `VfsFileSystemProvider.writeFile()`.
- The TanStack almostnode provider observes normal VFS writes through the same
  VFS/watch surface.
- If Durable Streams is attached, the durable VFS bridge records those writes.
- The visual editor still does not create branches, merge branches, or call
  Durable Streams directly.

### Isomorphic Agents Plan

`plans/isomorphic-agents.md` remains the durable branch/source-control plan.

Alignment:

- The TanStack adapter can use `DurableVirtualFsBridge` as an optional
  filesystem backing.
- TanStack `SandboxStore` and `RunEventLog` are orchestration persistence, not
  the branch/file source of truth.
- Branch manifests, file/content streams, PGlite clone lineage, merge signals,
  and cloud handoff events stay in `isomorphic-agents`.
- TanStack gives us a standard harness/sandbox API; `isomorphic-agents` gives
  us branch-native continuity across browser and cloud runners.

### Effect Platform Sprites

`effect-platform-sprites` remains useful as a reference and possible separate
provider family.

Alignment:

- Its `Harness` layer maps conceptually to TanStack harness adapters.
- Its `RemoteSandbox` tags map conceptually to TanStack `SandboxHandle`.
- Its `AuthProxyLayer.agentVault(...)` maps to the auth-proxy subpath in this
  plan.
- Sprites can become a TanStack provider separately. Almostnode should not
  depend on Sprites.

## Implementation Phases

1. Contract spike
   - Add `packages/tanstack-ai-sandbox`.
   - Pin compatible `@tanstack/ai` and `@tanstack/ai-sandbox` versions.
   - Add type-only tests that `almostnodeSandbox(...)` satisfies
     `SandboxProvider`.

2. In-memory almostnode provider
   - Implement `create`, `destroy`, `fs`, `process.exec`, `process.spawn`,
     `ports.connect`, `env.set`, `snapshot`, and `fork`.
   - Add tests over `createContainer()` with a simple workspace.
   - Verify long-running process stdout/stderr and writable stdin.

3. Workspace and git provisioning
   - Implement `source: none` and `source: git`.
   - Run setup commands.
   - Respect workspace root, package manager, scripts, and instructions.
   - Keep `source: local` explicitly unsupported unless a host importer is
     provided.

4. TanStack harness smoke
   - Use TanStack's Codex/OpenCode/ACP-compatible harness path rather than
     custom orchestration.
   - Start with a minimal command harness test before full Codex TUI/ACP.
   - Confirm policy decisions route through TanStack's permission flow.

5. Durable Streams persistence
   - Implement `durableStreamsSandboxStore`.
   - Implement `durableStreamsRunLog`.
   - Implement a real distributed lock, preferably with a Durable Object.
   - Add same-origin API route examples based on `notes-demo`.

6. Durable filesystem backing
   - Reuse or implement `DurableVirtualFsBridge` from `isomorphic-agents`.
   - Hydrate VFS from branch streams during provider create/resume.
   - Mirror VFS mutations into branch streams.
   - Flip provider `durableFilesystem` capability only when this backing is
     active.

7. Infisical Agent Vault proxy
   - Add `infisicalAgentVaultAuthProxy(...)`.
   - Add server route examples:
     - `/api/agent-vault/session`
     - `/api/agent-vault/openai/v1`
     - `/api/almostnode/outbound`
   - Add redaction tests proving raw credentials never enter snapshots, logs,
     browser JSON, or Durable Streams events.

8. Web IDE integration
   - Add an experimental TanStack-backed agent run path beside current Web IDE
     agent/session code.
   - Feed existing VFS/project refs into `defineWorkspace(...)`.
   - Keep current UX until the provider and persistence pass smoke tests.

9. External demo
   - Build a small TanStack Start demo using almostnode as the selected
     sandbox provider.
   - Use Durable Streams for run resume.
   - Use Agent Vault for model access.
   - Verify refresh/reconnect and a preview port served from almostnode.

## Test Plan

- Unit test provider capability descriptors.
- Unit test VFS wrappers for text, bytes, directory listing, rename, remove,
  mkdir, exists, and watch.
- Unit test `exec` and `spawn`, including stdin, abort, stdout/stderr ordering,
  and terminal-session cleanup.
- Unit test snapshot/fork round trip with file and directory state.
- Unit test git clone/status/add/commit through the almostnode git shim.
- Unit test workspace setup command ordering and env overlay behavior.
- Unit test Durable Streams `SandboxStore`, `LockStore`, and `RunEventLog`
  against local `@durable-streams/server`.
- Unit test Agent Vault proxy redaction and browser-safe OpenAI route config.
- Integration test `withSandbox(defineSandbox({ provider: almostnodeSandbox() }))`
  with a simple TanStack harness.
- Browser smoke with `playwright-cli`: start a preview server inside almostnode,
  connect its port through TanStack, reload the app, and resume the run log.
- Existing repo checks:

```bash
pnpm nx test almostnode
pnpm nx type-check almostnode
pnpm nx test tanstack-ai-sandbox
pnpm nx type-check tanstack-ai-sandbox
```

Add `pnpm nx e2e web-ide` once Web IDE UI integration exists.

## Risks And Open Questions

- TanStack AI sandbox APIs are new and may move. Keep the adapter thin and pin
  versions during the spike.
- `source: local` does not naturally fit pure browser almostnode. It needs a
  desktop/server importer or should remain unsupported.
- Browser fetch cannot honor transparent proxy env. The OpenAI-compatible route
  and outbound network shim are required for browser-hosted almostnode.
- ACP harnesses may depend on process behavior that almostnode terminal
  sessions only partially emulate. Test Codex/OpenCode/Gemini one by one.
- Network policy should not be advertised until TanStack policy decisions map
  cleanly onto almostnode's network controller.
- Durable filesystem and TanStack run-log persistence are related but not the
  same thing. Keep their stream topologies separate to avoid conflating source
  control with chat/run replay.

## Acceptance Criteria

- A TanStack `defineSandbox(...)` can use `almostnodeSandbox(...)` as its
  provider.
- A simple TanStack AI chat run can create or resume an almostnode sandbox.
- Workspace files can be read, written, watched, snapshotted, and forked
  through TanStack's `SandboxHandle`.
- Commands and background processes run through existing almostnode command
  shims and terminal sessions.
- A dev server started inside almostnode exposes a reachable TanStack
  `SandboxChannel`.
- Durable Streams can back sandbox records, locks, and run event replay without
  changing the provider implementation.
- Agent Vault can broker model credentials without raw secrets entering the
  browser, VFS snapshots, Durable Streams logs, or TanStack sandbox records.
- The existing visual editor and isomorphic agents plans remain separate and
  align through the VFS write/watch seam.
