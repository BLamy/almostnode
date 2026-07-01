import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import { corsProxyPlugin } from "./src/plugins/vite-plugin-cors-proxy";
import { scOauthPlugin } from "./src/plugins/vite-plugin-sc-oauth";

const appDir = fileURLToPath(new URL(".", import.meta.url));
const repoRoot = resolve(appDir, "..", "..");
const corePkg = resolve(repoRoot, "packages/almostnode");
const appBase = process.env.GITHUB_PAGES ? "/almostnode/" : "/";

// Serve the prebuilt Codex (Rust→WASM) module + binary so the `codex` terminal
// command can fetch them at runtime, in dev and in the built site.
function codexWasmAssets(): Plugin {
  const pkgDir = resolve(repoRoot, "packages/codex-wasm/dist/pkg");
  const assets = new Map([
    [
      `${appBase}codex-wasm/codex_wasm.js`,
      { file: "codex-wasm/codex_wasm.js", src: resolve(pkgDir, "codex_wasm.js"), type: "application/javascript" },
    ],
    [
      `${appBase}codex-wasm/codex_wasm_bg.wasm`,
      { file: "codex-wasm/codex_wasm_bg.wasm", src: resolve(pkgDir, "codex_wasm_bg.wasm"), type: "application/wasm" },
    ],
  ]);
  return {
    name: "almostos-codex-wasm-assets",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const pathname = req.url ? new URL(req.url, "http://localhost").pathname : "";
        const asset = assets.get(pathname);
        if (!asset) {
          next();
          return;
        }
        res.setHeader("Content-Type", asset.type);
        res.end(readFileSync(asset.src));
      });
    },
    generateBundle() {
      for (const asset of assets.values()) {
        this.emitFile({ type: "asset", fileName: asset.file, source: readFileSync(asset.src) });
      }
    },
  };
}

export default defineConfig({
  base: appBase,
  test: {
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
  },
  plugins: [
    tanstackStart({ spa: { enabled: true } }),
    react(),
    tailwindcss(),
    wasm(),
    topLevelAwait(),
    codexWasmAssets(),
    corsProxyPlugin(),
    scOauthPlugin(),
    // almostnode's host code needs Node globals/builtins; polyfill them for the
    // browser exactly like apps/web-ide does.
    nodePolyfills({
      include: ["buffer", "string_decoder", "zlib"],
      globals: { Buffer: true, global: true, process: true },
    }),
  ],
  define: {
    "process.env": {},
    "process.env.NODE_ENV": JSON.stringify(
      process.env.NODE_ENV === "production" ? "production" : "development",
    ),
    global: "globalThis",
    __CODEX_WASM_MODULE_URL__: JSON.stringify(`${appBase}codex-wasm/codex_wasm.js`),
  },
  server: {
    port: 4000,
    // The almostnode runtime + wasm need cross-origin isolation.
    headers: {
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
  },
  resolve: {
    dedupe: ["react", "react-dom"],
    alias: [
      {
        find: /^@agent-wasm\/core\/internal$/,
        replacement: resolve(corePkg, "src/internal.ts"),
      },
      {
        find: /^@agent-wasm\/core$/,
        replacement: resolve(corePkg, "src/browser.ts"),
      },
    ],
  },
  build: {
    target: "esnext",
    assetsInlineLimit: 0,
    commonjsOptions: { transformMixedEsModules: true },
    outDir: "dist-site",
  },
  worker: { format: "es" },
  optimizeDeps: {
    // zstd-wasm resolves its wasm via `new URL('./zstd.wasm', import.meta.url)`;
    // esbuild pre-bundling breaks that and 404s, so let Vite process it as
    // source (Codex compresses app-server traffic with it). Same for the codex
    // workers' wasm-asset handling.
    exclude: ["@bokuweb/zstd-wasm", "@agent-wasm/codex"],
    esbuildOptions: { target: "esnext" },
  },
});
