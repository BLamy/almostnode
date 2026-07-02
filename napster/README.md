# napster

A tiny [Hono](https://hono.dev) app on **Cloudflare Workers** that gateways the SoundCloud API for almost-os.

There is no login flow of its own. The whole almost-os desktop already requires an Auth0 login to use at all, so this worker just **verifies that same Auth0 ID token directly** (via `jose`, against Auth0's own JWKS) and, if valid, proxies `/sc/*` → `api.soundcloud.com` using a cached SoundCloud `client_credentials` app token. The SoundCloud secret lives only in the worker; the worker never issues or manages a token of its own — one less credential, one less thing that can drift out of sync.

```
napster CLI  ──Bearer: <almost-os Auth0 ID token>──▶  /sc/tracks?q=…  ──(verify against Auth0's JWKS)──▶  api.soundcloud.com (client_credentials)
```

## Endpoints

| Endpoint | Purpose |
| --- | --- |
| `GET /sc/*` | Auth0-gated proxy to `api.soundcloud.com/*` |

## Deployed

Live at **`https://napster.brett-lamy.workers.dev`** — baked into both the CLI (`packages/almostnode/src/shims/soundcloud-command.ts`) and the browser client (`apps/almost-os/src/media/soundcloud-api.ts`) as `GATEWAY_URL`.

To redeploy after editing `src/index.ts`:

```bash
cd napster
npm install
CLOUDFLARE_ACCOUNT_ID=<your account id> npx wrangler deploy
```

To stand up your own instance from scratch instead:

```bash
cd napster
npm install
npx wrangler login                          # once, authenticates wrangler with your CF account

# 1. Create the KV namespace (caches the SoundCloud app token) and paste its id
#    into wrangler.toml → [[kv_namespaces]].id
npx wrangler kv namespace create KV

# 2. Fill in wrangler.toml [vars]: AUTH0_DOMAIN + AUTH0_AUDIENCE (your almost-os
#    Auth0 tenant domain + client_id — public identifiers, safe to commit).

# 3. Set secrets
npx wrangler secret put SC_CLIENT_ID        # your SoundCloud app client_id
npx wrangler secret put SC_CLIENT_SECRET    # your SoundCloud app client_secret

# 4. Deploy
npm run deploy
# → https://napster.<your-subdomain>.workers.dev
```

Then point the CLI/browser client at it (update `GATEWAY_URL` in both files above).

## Using it

No sign-in step — in the almost-os Terminal:

```bash
napster whoami
napster search daft punk
napster download <url>
```

`napster whoami` just decodes the current Auth0 ID token's claims (email/name) for display — the token itself is never persisted anywhere; the CLI asks the OS for whatever's currently active.

## Notes

- The `/sc/*` proxy is **read-only GET**, gated on a valid, unexpired, correctly-audienced Auth0 ID token — so it isn't an open SoundCloud proxy, but it's also not *this worker's* problem to manage sessions or logins.
- Local dev: `npm run dev` (needs `SC_CLIENT_ID`/`SC_CLIENT_SECRET` in a `.dev.vars` file).
