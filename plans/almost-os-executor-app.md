# Plan: an Executor app in almost-os (browser-run, keychain-backed)

## Context

[RhysSullivan/executor](https://github.com/RhysSullivan/executor) is a **secure integration runtime + policy layer** — *not* an AI agent. You register a tool/integration once (from an OpenAPI/GraphQL spec, an MCP server, or Google Discovery), give it credentials once, set a policy once (allow / approval-gated / blocked), and it exposes every tool to any agent **over MCP**. It ships as `@executor-js/*` packages (Bun/Turborepo monorepo):

- `core` — contracts, plugin API, SDK (`createExecutor`), tool catalog/invocation
- `kernel` — execution runtimes: **QuickJS (WASM)**, Deno subprocess, dynamic workers
- `plugins` — `openapi`, `graphql`, `mcp`, `google`, …
- `react` + `app` — the web UI (catalog, connection cards, add-source, policy editor)
- `hosts` — the MCP server surface (+ Cloudflare adapter)

Goal: run Executor **entirely client-side inside almost-os**, back its credentials with our `@agent-wasm/keychain` vault, surface its React UI as an almost-os app, and use it to **replace web-ide's hand-rolled integrations/credentials sidebar** — so codex/opencode (and any agent) get a shared, policy-gated tool catalog over MCP instead of bespoke per-tool wiring.

This is feasible because Executor's hard dependencies on a host machine (CLI daemon, Deno subprocess, native keychain, `localhost:4788` HTTP server) are all swappable: it's designed around pluggable kernels + secret providers + hosts, and the QuickJS kernel is WASM.

## What runs where (the mental model)

| Executor piece | In almost-os |
| --- | --- |
| Web UI (`@executor-js/react` / `app`) | The **Executor window** (a normal almost-os app), pure client React |
| SDK runtime (`createExecutor`) | A **client singleton** (like `getWorkspace`/`getKeychain`), in the page |
| Kernel | **QuickJS-emscripten only** (browser WASM). Disable Deno/worker-subprocess kernels |
| Secret provider | **Custom provider over `@agent-wasm/keychain`** (VFS-backed, WebAuthn-PRF encrypted) |
| Plugin fetches (specs + API calls) | Browser `fetch`, routed through the **CORS proxy** for cross-origin |
| MCP host (`127.0.0.1:4788/mcp`) | An almostnode **virtual server** behind the service worker (`/__virtual__/{port}/mcp`) |
| CLI / background daemon | **Dropped** — use the SDK directly |

Net: Executor's *engine* runs as ordinary browser JS + WASM (no Node runtime needed); only its outbound network and its MCP endpoint need almost-os's existing plumbing.

## Browser-viability constraints + how almost-os solves each

1. **Kernel** — configure `createExecutor` to use the QuickJS kernel (`quickjs-emscripten`, WASM). Never select the Deno/subprocess/worker-spawn kernels (no `child_process`/`Deno` in-browser). If a plugin needs to evaluate JS transforms, QuickJS sandboxes them safely.
2. **Secrets** — implement Executor's `SecretProvider` contract (in `@executor-js/core`) against the keychain. See next section.
3. **CORS** — Executor fetches remote OpenAPI/GraphQL/Google specs and then calls those APIs. Reuse web-ide's `vite-plugin-cors-proxy` (port it into `apps/almost-os/src/plugins/`) and/or the almostnode network layer; give the Executor runtime a `fetch` wrapper that proxies cross-origin requests. Flag CORS as the main reliability variable.
4. **MCP host** — instead of a `localhost` HTTP server, register Executor's MCP surface as a fetch virtual server via `createFetchVirtualServer` / `registerFetchVirtualServer` (exported from `@agent-wasm/core`) on `workspace.container.serverBridge`. Agents then reach it at the SW-intercepted `/__virtual__/{port}/mcp` URL — the same interception path the dev servers use.
5. **Node builtins** — the browser-safe subset (core SDK + QuickJS kernel + fetch plugins + react) may still import a few node builtins; resolve them to the almostnode shims exactly as we did for codex (vite alias / `optimizeDeps`). Expect to vendor + prebuild a browser bundle (see Packaging).

## Keychain integration (the core ask)

Executor supports pluggable secret providers; we add one backed by `@agent-wasm/keychain`:

- **New module** `apps/almost-os/src/apps/executor/keychain-secret-provider.ts` implementing Executor's `SecretProvider` interface (read/write/list/delete a secret by connection id). Back it with `workspace.vfs`: write each connection's secrets as JSON under an executor namespace in the VFS, e.g. `/home/user/.executor/connections/<id>.json` (or one `secrets.json`).
- **Register an executor credential slot** so the vault seals these at rest: add to `@agent-wasm/sdk/auth` `agentWasmCredentialPaths` + `defaultCredentialSlots` an `executor` slot (category `system`) covering `/home/user/.executor/**`. almost-os's `getKeychain()` already registers every default slot, so this slot is encrypted/restored by the existing WebAuthn-PRF vault automatically. (`registerSlot` takes explicit paths; a glob may need a small enhancement, otherwise enumerate known files.)
- On secret write, call `keychain.notifyExternalStateChanged()` so the vault UI/state updates; on agent launch, the existing `keychain.prepareForCommand` / `restoreIntoVfs` path already rehydrates these files into the VFS before a command runs.
- Result: **one vault** for Claude/Codex/OpenCode *and* Executor connections; the almost-os Keychain app shows Executor connections as just another credential slot.

## almost-os wiring (mirrors how codex/chrome were added)

- **Runtime singleton** `src/apps/executor/executor-runtime.ts`: `getExecutor()` → `createExecutor({ kernel: quickjs, secrets: keychainSecretProvider(getWorkspace()), plugins: [openApiPlugin(), graphqlPlugin(), mcpPlugin(), googlePlugin()], fetch: corsProxiedFetch })`, created once (browser-only, like `getWorkspace`).
- **Executor app** `src/apps/executor/ExecutorApp.tsx`: render `@executor-js/react`'s catalog/connections/policy UI, wired to `getExecutor()`. This is the surface that **replaces the hand-rolled sidebar**.
- **Register the app**: add `"executor"` to `AppId` (`src/os/types.ts`); add an `executor` entry to `APPS` + `APP_ICONS` + `DOCK_APP_ORDER` (`src/os/apps.tsx`); add an icon to `src/os/icons.tsx`.
- **MCP virtual host** `src/apps/executor/register-executor.ts`: on boot (lazy import in `OsRuntimeProvider`, like `register-codex`/`register-chrome`), mount Executor's MCP host onto a `createFetchVirtualServer` registered with `container.serverBridge`; expose the resulting virtual URL. Optionally register a `executor` shell command (`executor call <path> '{}'`, `executor mcp`) so the terminal/agents can invoke tools directly.
- **Agent consumption**: point codex/opencode at the virtual MCP URL. OpenCode reads `mcp-auth.json`/config under `/opencode/config/...`; write an MCP server entry there pointing to the virtual URL. Codex MCP config similarly. (This is the payoff: agents get Executor's whole catalog with one config line.)
- **Styling**: bespoke `.executor-*` classes in `src/styles/os.css` to match the macOS chrome (and/or adopt `@executor-js/react`'s own styles if themeable).

## Replacing web-ide's hand-rolled sidebar

Map the old sidebar's responsibilities onto Executor + the existing Keychain app:

- *"add an integration / API / MCP server"* → Executor **Add Source** UI (paste OpenAPI/GraphQL/MCP URL, auto-detected).
- *"store its key"* → Executor connection auth → **keychain secret provider** (one vault).
- *"decide what the agent may call"* → Executor **policy** (allow / approval-gated / blocked) — a capability the hand-rolled sidebar likely lacked.
- *"expose it to the agent"* → Executor **MCP host** on the virtual server; agents auto-discover the catalog.

So the bespoke sidebar's logic collapses into: Executor app (catalog + policy) + Keychain app (vault) + one MCP config entry per agent. In web-ide you can later delete the hand-rolled sidebar surface and embed the same `@executor-js/react` UI.

## Packaging decision (verify first)

Check whether `@executor-js/*` is published to npm and browser-consumable.
- **If published + browser-safe**: `pnpm --filter almost-os add @executor-js/sdk @executor-js/plugin-* @executor-js/react quickjs-emscripten`, add vite aliases/shims as needed.
- **If unpublished or Node-coupled** (likely, given it's early + Bun-based): **vendor it** (`vendor/executor`, git submodule) and build a browser-targeted bundle consumed as a prebuilt dist — exactly the `opencode-mobile-runtime` / codex-wasm pattern, which is the proven way to get a Vite-coupled-runtime into almost-os. This sidesteps recompiling its whole source under our Vite config.

## Phased implementation

1. **Spike** — `createExecutor({ kernel: quickjs })` + one `openApiPlugin` in a throwaway client page; load a public OpenAPI spec, list tools, invoke one (in-memory secrets). Confirms the SDK + QuickJS kernel run in-browser. *Highest-risk, do first.*
2. **Keychain secret provider** + `executor` credential slot; persist a connection's auth, lock/unlock the vault, confirm rehydrate.
3. **Executor app window** rendering `@executor-js/react`, wired to the runtime singleton; add to dock/registry.
4. **CORS** — route plugin fetches through the proxy; test a real authenticated API call.
5. **MCP virtual host** on `serverBridge`; verify the endpoint responds at the virtual URL.
6. **Agent wiring** — add the MCP server entry to opencode/codex config; confirm an agent lists + calls an Executor tool.
7. **Retire** web-ide's hand-rolled sidebar (embed the same Executor UI there if still wanted).

## Verification

- Spike page logs a successful tool list + invocation from a public OpenAPI spec.
- Keychain app shows an `executor` slot; saving a connection key, locking, reloading, unlocking restores it (no plaintext in localStorage).
- `curl`-equivalent fetch to the virtual MCP URL returns the tool catalog.
- In Terminal, `opencode`/`codex` (once wired) can enumerate an Executor tool.
- `pnpm --filter almost-os type-check` clean for new app code; dev server boots with no console errors.

## Risks / open questions

- **Maturity**: Executor is early; APIs (`SecretProvider`, kernel selection, host mounting) may differ from the README — read `packages/core` contracts before coding.
- **Node coupling**: parts may assume Bun/Node; only the core SDK + QuickJS kernel + fetch plugins + react are browser-targets. Budget for almostnode shims, and prefer the vendor-and-prebuild path.
- **CORS**: cross-origin spec fetches + API calls are the top reliability risk; the proxy must cover them.
- **MCP-over-virtual-server**: agents must accept a non-`localhost` MCP URL (the `/__virtual__/{port}/` path); confirm each agent's MCP client allows arbitrary HTTP transport URLs.
- **Out of scope here**: Executor Cloud/desktop/Cloudflare hosts; Deno/worker kernels.
