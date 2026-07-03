# @agent-wasm/native-wasm

CI-built **`wasm32-wasi` (emnapi) substitutes for native N-API npm modules**, plus
the browser registration that wires them into `@agent-wasm/core`'s `require()`.

Native `.node` addons can't run in the browser runtime. This package compiles them
to WebAssembly (emscripten + [emnapi](https://github.com/toyobayashi/emnapi)) so
`@agent-wasm/core` can substitute a WASM build when an app `require`s the addon —
loaded by the shared `loadNapiWasm` harness (`napi-wasm/load-napi-wasm.ts`).

## Layout

- `modules/<name>.mjs` — per-module build recipe (emcc flags, defines, emnapi
  linkage) + optional smoke. `better-sqlite3` is the first target.
- `patches/<name>@<version>.patch` — per-module source overlays (created by the
  reproduce→fix loop as builds need them).
- `scripts/build-module.mjs` — orchestrator: fetch tarball → apply patch → emcc →
  verify → emit `dist/<name>@<version>.wasm` + `.manifest.json`. Emits
  `@@PHASE:<name>@@` markers and, on failure, `dist/failures/<name>@<version>.json`.
- `scripts/verify-module.mjs` — Node-side instantiate smoke under
  `@napi-rs/wasm-runtime`.
- `src/index.ts` — `registerNativeWasmArtifacts(register, resolveArtifactUrl)`:
  registers each built artifact into core's `nativeWasmModules` table (DI — no
  static wasm import, no core-internals import).

## Building (CI)

Compilation needs `emcc` (emsdk) which isn't part of a normal checkout, so it runs
in the dedicated **`.github/workflows/native-wasm.yml`** workflow (manual dispatch
or when a recipe changes). On failure it files a `native-wasm-compile` issue with
the structured failure artifact — the input to the autonomous fix loop.

```
# locally, with emsdk on PATH:
node scripts/build-module.mjs better-sqlite3
node scripts/verify-module.mjs better-sqlite3
```

## Status

The runtime substitution machinery and the failure→issue signal are in place and
tested. The `better-sqlite3` emcc recipe in `modules/better-sqlite3.mjs` is a
**first draft** — the exact flag set is tuned against real CI build errors
(C++ exceptions, `bindings`, on-disk fs → start with `:memory:`).
