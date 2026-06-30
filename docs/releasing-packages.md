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

## Release checks

Run releases from a clean working tree on the branch being released.

```bash
pnpm install --frozen-lockfile
pnpm nx run-many -t build --projects=almostnode,chat-core,almostnode-sdk,keychain,code,codex-wasm,almostnode-react,vscode
pnpm --dir packages/codex-wasm run build:adapter
pnpm nx run-many -t test --projects=chat-core,keychain,code,almostnode-sdk,codex-wasm,almostnode-react,vscode
pnpm package:preflight
```

Review the preflight output before publishing. It checks packed manifests,
entrypoints, workspace dependency rewrites, tarball contents, and size drivers.

The full `almostnode` runtime test target should be run before promoting
runtime behavior changes, but it is not part of the publish gate while the
current branch has unrelated runtime test failures.

## Manual release flow

Publish dependency-first with the checked-in release helper:

```bash
NPM_TAG=latest pnpm package:publish
```

Do not publish from a package directory with a stale `dist/`. The package
publish helper packs each package with pnpm and publishes those tarballs with
npm, which preserves pnpm's workspace dependency rewriting. The GitHub Actions
workflow enables npm provenance for hosted releases.

For a local dry run:

```bash
PUBLISH_DRY_RUN=true pnpm package:publish
```

## GitHub Actions release flow

`.github/workflows/publish-packages.yml` validates package releases on pull
requests and pushes to `main` when package/release files change. It runs:

1. install dependencies and vendored OpenCode/OpenTUI dependencies
2. build all publishable packages
3. clone/build the vendored Codex WASM adapter
4. run the package test set
5. run `pnpm package:preflight` and upload the markdown report

Publishing is manual through `workflow_dispatch`. Set `publish` to `true`,
choose the npm dist-tag, and leave `dry_run` enabled until the release output
looks correct. The workflow expects an `NPM_TOKEN` repository secret with
permission to publish the `@agent-wasm/*` packages.

## Size review

The two intentional large payloads are:

- `@agent-wasm/tailscale-connect`: `main.wasm`, the forked Tailscale client.
- `@agent-wasm/codex`: `dist/pkg/codex_wasm_bg.wasm`, the forked Codex WASM
  adapter.

`@agent-wasm/core` can also be large because it bundles runtime workers,
Tailscale worker glue, TypeScript, OXC/native-browser bindings, and source maps.
Use `pnpm package:preflight` to identify the current top contributors before
cutting a release.
