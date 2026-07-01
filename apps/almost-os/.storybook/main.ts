import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { StorybookConfig } from "@storybook/react-vite";
import { mergeConfig, type Plugin } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";
import { corsProxyPlugin } from "../src/plugins/vite-plugin-cors-proxy";

const storybookDir = fileURLToPath(new URL(".", import.meta.url));
const appDir = resolve(storybookDir, "..");
const repoRoot = resolve(appDir, "..", "..");
const corePkg = resolve(repoRoot, "packages/almostnode");
const appBase = "/";

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
  };
}

const config: StorybookConfig = {
  framework: { name: "@storybook/react-vite", options: {} },
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  staticDirs: ["../public"],
  async viteFinal(base) {
    return mergeConfig(base, {
      plugins: [
        tailwindcss(),
        wasm(),
        topLevelAwait(),
        codexWasmAssets(),
        corsProxyPlugin(),
        nodePolyfills({
          include: ["buffer", "string_decoder", "zlib"],
          globals: { Buffer: true, global: true, process: true },
        }),
      ],
      define: {
        "process.env": {},
        "process.env.NODE_ENV": JSON.stringify("development"),
        global: "globalThis",
        __CODEX_WASM_MODULE_URL__: JSON.stringify(`${appBase}codex-wasm/codex_wasm.js`),
      },
      resolve: {
        dedupe: ["react", "react-dom"],
        alias: [
          { find: /^@agent-wasm\/core\/internal$/, replacement: resolve(corePkg, "src/internal.ts") },
          { find: /^@agent-wasm\/core$/, replacement: resolve(corePkg, "src/browser.ts") },
        ],
      },
      optimizeDeps: { exclude: ["@bokuweb/zstd-wasm", "@agent-wasm/codex"] },
      worker: { format: "es" },
      server: {
        headers: {
          "Cross-Origin-Embedder-Policy": "credentialless",
          "Cross-Origin-Opener-Policy": "same-origin",
        },
      },
      build: { target: "esnext" },
    });
  },
};

export default config;
