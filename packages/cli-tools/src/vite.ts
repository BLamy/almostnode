import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

/**
 * Vite plugins that serve the wasm runtimes for `@agent-wasm/cli-tools` as
 * static assets, in dev (`configureServer`) and in the build (`generateBundle`)
 * — mirroring the app's existing `codexWasmAssets()` pattern. Keeps the large
 * binaries out of git and `public/`.
 *
 * The apps resolve the package source paths (they own `vim-wasm` / `@ffmpeg/core`
 * as deps) and pass them in; these plugins only handle serving.
 */

// --- vim.wasm -------------------------------------------------------------

const VIM_PREFIX = "/vim-wasm/";

// Relative to the `vim-wasm` package root. `small/*` is the reduced build.
const VIM_FILES: ReadonlyArray<readonly [string, string]> = [
  ["vim.js", "text/javascript"],
  ["vim.wasm", "application/wasm"],
  ["vim.data", "application/octet-stream"],
  ["small/vim.js", "text/javascript"],
  ["small/vim.wasm", "application/wasm"],
  ["small/vim.data", "application/octet-stream"],
];

export interface VimWasmAssetsOptions {
  /** Absolute path to the `vim-wasm` package root (contains vim.js/.wasm/.data). */
  packageRoot: string;
}

export function vimWasmAssets(options: VimWasmAssetsOptions): Plugin {
  const assets = new Map(
    VIM_FILES.map(([rel, contentType]) => [
      `${VIM_PREFIX}${rel}`,
      {
        fileName: `vim-wasm/${rel}`,
        sourcePath: resolve(options.packageRoot, rel),
        contentType,
      },
    ]),
  );
  return serveAssets("vim-wasm-assets", assets);
}

// --- ffmpeg.wasm core -----------------------------------------------------

const FFMPEG_PREFIX = "/ffmpeg-core/";

export interface FfmpegCoreAssetsOptions {
  /** Absolute path to `@ffmpeg/core/dist/esm/ffmpeg-core.js`. */
  coreJsPath: string;
  /** Absolute path to `@ffmpeg/core/dist/esm/ffmpeg-core.wasm`. */
  coreWasmPath: string;
}

export function ffmpegCoreAssets(options: FfmpegCoreAssetsOptions): Plugin {
  const assets = new Map([
    [
      `${FFMPEG_PREFIX}ffmpeg-core.js`,
      {
        fileName: "ffmpeg-core/ffmpeg-core.js",
        sourcePath: options.coreJsPath,
        contentType: "text/javascript",
      },
    ],
    [
      `${FFMPEG_PREFIX}ffmpeg-core.wasm`,
      {
        fileName: "ffmpeg-core/ffmpeg-core.wasm",
        sourcePath: options.coreWasmPath,
        contentType: "application/wasm",
      },
    ],
  ]);
  return serveAssets("ffmpeg-core-assets", assets);
}

// --- shared serving logic -------------------------------------------------

interface Asset {
  fileName: string;
  sourcePath: string;
  contentType: string;
}

function serveAssets(name: string, assets: Map<string, Asset>): Plugin {
  return {
    name,
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
