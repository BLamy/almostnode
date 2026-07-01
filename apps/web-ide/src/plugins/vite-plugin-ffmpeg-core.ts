import { readFileSync } from "node:fs";
import type { Plugin } from "vite";

/**
 * Serves the `@ffmpeg/core` runtime (the Emscripten ESM glue + its `.wasm`) as
 * static files under `/ffmpeg-core/`. Mirrors `codexWasmAssets()` /
 * {@link vimWasmAssets}: serve from `node_modules` in dev, `emitFile` into the
 * bundle for production — keeping the ~31 MB wasm out of git and `public/`.
 *
 * The `@ffmpeg/ffmpeg` wrapper spawns its own bundled worker (handled by Vite's
 * `new Worker(new URL(...), import.meta.url)` support); that worker then
 * dynamically `import()`s the ESM core from the URL we serve here and fetches
 * the sibling `.wasm`. Both URLs are handed to `FFmpeg.load()` via the
 * `__FFMPEG_CORE_URL__` / `__FFMPEG_WASM_URL__` defines.
 */

const PUBLIC_PREFIX = "/ffmpeg-core/";

export interface FfmpegCoreAssetsOptions {
  /** Absolute path to `@ffmpeg/core/dist/esm/ffmpeg-core.js`. */
  coreJsPath: string;
  /** Absolute path to `@ffmpeg/core/dist/esm/ffmpeg-core.wasm`. */
  coreWasmPath: string;
}

interface FfmpegAsset {
  fileName: string;
  sourcePath: string;
  contentType: string;
}

export function ffmpegCoreAssets(options: FfmpegCoreAssetsOptions): Plugin {
  const assets = new Map<string, FfmpegAsset>([
    [
      `${PUBLIC_PREFIX}ffmpeg-core.js`,
      {
        fileName: "ffmpeg-core/ffmpeg-core.js",
        sourcePath: options.coreJsPath,
        contentType: "text/javascript",
      },
    ],
    [
      `${PUBLIC_PREFIX}ffmpeg-core.wasm`,
      {
        fileName: "ffmpeg-core/ffmpeg-core.wasm",
        sourcePath: options.coreWasmPath,
        contentType: "application/wasm",
      },
    ],
  ]);

  return {
    name: "ffmpeg-core-assets",
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
