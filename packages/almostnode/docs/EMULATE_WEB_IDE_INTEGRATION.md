# Emulate in the Browser Web IDE

This repo now vendors a fork of `vercel-labs/emulate` at `vendor/emulate`.

## What emulate provides

`emulate` has two separable layers:

- Service implementations: packages such as `@emulators/stripe`, `@emulators/github`, and `@emulators/google` register routes on `@emulators/core`.
- Node process startup: the `emulate` CLI and `createEmulator()` call `serve({ fetch: app.fetch, port })`, which binds a real Node HTTP server.

The service layer is the useful part for Web IDE. `@emulators/core.createServer(plugin, options)` returns an `app.fetch(Request)` handler plus `store`, `webhooks`, and `tokenMap`. The Node-only part is the listener.

## Browser equivalent

The browser equivalent should not run `npx emulate` as a subprocess. It should:

1. Load the emulator service plugins from the vendored fork or from published `@emulators/*` packages.
2. Create one fetch handler per service with `@emulators/core.createServer`.
3. Register each handler as an almostnode virtual server with `registerFetchVirtualServer`.
4. Project emulator URLs into the runtime env before running the user's app or agent.
5. Route server-side `fetch`, `http.request`, and SDK calls for those emulator URLs back into `ServerBridge`.

The new `registerFetchVirtualServer` helper bridges Fetch handlers to almostnode's `IVirtualServer` contract. That is the minimal platform adapter needed to host emulator services without real OS ports.

## Port strategy

Prefer per-service virtual ports first because this matches `emulate` defaults and works better with SDKs that only accept `host`, `port`, and `protocol`.

Recommended default map:

- Vercel: `4000`
- GitHub: `4001`
- Google: `4002`
- Slack: `4003`
- Apple: `4004`
- Microsoft: `4005`
- Okta: `4006`
- AWS: `4007`
- Resend: `4008`
- Stripe: `4009`
- MongoDB Atlas: `4010`
- Clerk: `4011`
- Linear: `4012`

An aggregate `/emulate/:service/*` server is still useful for inspector UIs and embedded app routes, but it should not be the only path. Stripe is the example: its SDK can point at `host`, `port`, and `protocol`, but not a subpath, so `@emulators/adapter-next` uses an app-local `/v1/*` proxy when it mounts Stripe under `/emulate/stripe`.

## Runtime routing still needed

`playwright-cli open http://localhost:4009/...` already rewrites localhost URLs to `/__virtual__/4009/...` for preview navigation.

The missing platform piece is runtime network routing:

- Browser/native `fetch`
- Node-style `http.request`
- SDKs such as Stripe that use the HTTP shim

Those calls currently flow through `networkFetch`. The next change should recognize registered emulator localhost targets, such as `http://localhost:4009/v1/...`, and dispatch them through the `ServerBridge` fetch handler instead of using the browser's native network path. This keeps the fix platform-level rather than adding Stripe-specific or auth-provider-specific patches.

## Web IDE startup flow

The Web IDE should start emulators when a project opts in, likely from one of:

- A workspace `emulate.config.yaml` / `.json`
- Template metadata
- A Playwright-agent setting for "emulated services"

Startup should:

1. Parse seed config from VFS.
2. Register selected service virtual servers.
3. Persist service stores to project storage or VFS snapshots after mutating requests.
4. Inject env vars into app commands:
   - `GITHUB_EMULATOR_URL=http://localhost:4001`
   - `GOOGLE_EMULATOR_URL=http://localhost:4002`
   - `VERCEL_EMULATOR_URL=http://localhost:4000`
   - `STRIPE_HOST=localhost`
   - `STRIPE_PORT=4009`
   - `STRIPE_PROTOCOL=http`
5. Surface registered emulator URLs as auxiliary servers so the preview and Playwright agent can navigate login, OAuth consent, inbox, and checkout pages.

## Verification path

First smoke should be browser-native and use existing commands:

1. Register a Stripe emulator virtual server on `4009`.
2. Start a Next or Vite template that points Stripe env to `localhost:4009`.
3. Run `playwright-cli open http://localhost:<app-port>/`.
4. Exercise checkout/login with `playwright-cli snapshot`, `click`, and `network`.
5. Confirm requests to `localhost:4009` are served by the emulator store, not by native browser networking.
