import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/**
 * Serves the `vim-wasm` runtime assets (the Emscripten worker script + its
 * `.wasm`/`.data` payloads) as static files under `/vim-wasm/`, for both the
 * "normal" and "small" feature builds. Mirrors {@link codexWasmAssets} /
 * `opentuiWasmAsset` in vite.config.ts: serve from `node_modules` in dev,
 * `emitFile` into the bundle for production — so the ~9 MB of binaries never
 * live in git or `public/`.
 *
 * vim.wasm's worker (`vim.js`) is a classic Emscripten script that fetches
 * `vim.wasm`/`vim.data` relative to its own URL, so all three files for a
 * variant must be served from the same directory. `VimWasm` is pointed at the
 * worker via `workerScriptPath` (see the `__VIM_WASM_BASE__` define).
 */

const PUBLIC_PREFIX = "/vim-wasm/";

// Relative to the `vim-wasm` package root. `small/*` is the reduced feature
// build (~13 KB data) backing the `vi` command; the top-level files are the
// full "normal" build backing `vim`.
const ASSET_FILES: ReadonlyArray<readonly [string, string]> = [
  ["vim.js", "application/javascript"],
  ["vim.wasm", "application/wasm"],
  ["vim.data", "application/octet-stream"],
  ["small/vim.js", "application/javascript"],
  ["small/vim.wasm", "application/wasm"],
  ["small/vim.data", "application/octet-stream"],
];

interface VimWasmAsset {
  fileName: string;
  sourcePath: string;
  contentType: string;
}

function resolveVimWasmRoot(): string {
  const require = createRequire(import.meta.url);
  return dirname(require.resolve("vim-wasm/package.json"));
}

export function vimWasmAssets(): Plugin {
  const packageRoot = resolveVimWasmRoot();
  const assets = new Map<string, VimWasmAsset>(
    ASSET_FILES.map(([relative, contentType]) => [
      `${PUBLIC_PREFIX}${relative}`,
      {
        fileName: `vim-wasm/${relative}`,
        sourcePath: resolve(packageRoot, relative),
        contentType,
      },
    ]),
  );

  return {
    name: "vim-wasm-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestUrl = req.url;
        if (!requestUrl) {
          next();
          return;
        }

        const pathname = new URL(requestUrl, "http://127.0.0.1").pathname;
        const asset = assets.get(pathname);
        if (!asset) {
          next();
          return;
        }

        res.setHeader("Content-Type", asset.contentType);
        res.end(readFileSync(asset.sourcePath));
      });
    },
    generateBundle() {
      for (const asset of assets.values()) {
        this.emitFile({
          type: "asset",
          fileName: asset.fileName,
          source: readFileSync(asset.sourcePath),
        });
      }
    },
  };
}
