# Releasing packages

This repository publishes the browser workspace libraries as scoped packages
under `@agent-wasm/*`. The root workspace remains private.

## Packages

Publishable packages live under `packages/*` and have `private: false`:

1. `@agent-wasm/tailscale-connect`
2. `@agent-wasm/core`
3. `@agent-wasm/chat-core`
4. `@agent-wasm/sdk`
5. `@agent-wasm/keychain`
6. `@agent-wasm/code`
7. `@agent-wasm/codex`
8. `@agent-wasm/react`
9. `@agent-wasm/vscode`

`@agent-wasm/tailscale-connect` is the local fork of Tailscale Connect used by
the runtime. `@agent-wasm/codex` is the local forked browser Codex package and
ships its prebuilt WASM adapter under `dist/pkg`.

## Manual release flow

Run releases from a clean working tree on the branch being released.

```bash
pnpm install --frozen-lockfile
pnpm nx run-many -t build --projects=almostnode,chat-core,almostnode-sdk,keychain,code,codex-wasm,almostnode-react,vscode
pnpm --dir packages/codex-wasm run build:adapter
pnpm nx run-many -t test --projects=almostnode,chat-core,almostnode-sdk,keychain,code,codex-wasm,almostnode-react,vscode
pnpm package:preflight
```

Review the preflight output before publishing. It checks packed manifests,
entrypoints, workspace dependency rewrites, tarball contents, and size drivers.

Publish dependency-first:

```bash
pnpm --dir packages/tailscale-connect publish --access public
pnpm --dir packages/almostnode publish --access public
pnpm --dir packages/chat-core publish --access public
pnpm --dir packages/almostnode-sdk publish --access public
pnpm --dir packages/keychain publish --access public
pnpm --dir packages/code publish --access public
pnpm --dir packages/codex-wasm publish --access public
pnpm --dir packages/almostnode-react publish --access public
pnpm --dir packages/vscode publish --access public
```

Do not publish from a package directory with a stale `dist/`. The package
prepublish hooks build the package, but running the build and preflight first
makes the release reviewable before anything reaches npm.

## Size review

The two intentional large payloads are:

- `@agent-wasm/tailscale-connect`: `main.wasm`, the forked Tailscale client.
- `@agent-wasm/codex`: `dist/pkg/codex_wasm_bg.wasm`, the forked Codex WASM
  adapter.

`@agent-wasm/core` can also be large because it bundles runtime workers,
Tailscale worker glue, TypeScript, OXC/native-browser bindings, and source maps.
Use `pnpm package:preflight` to identify the current top contributors before
cutting a release.
