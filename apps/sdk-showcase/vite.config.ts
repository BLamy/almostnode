import { existsSync } from "node:fs"
import { readFile, readdir } from "node:fs/promises"
import { resolve } from "node:path"
import { transformAsync } from "@babel/core"
import ts from "@babel/preset-typescript"
import react from "@vitejs/plugin-react"
import solid from "babel-preset-solid"
import { defineConfig } from "vite"
import { nodePolyfills } from "vite-plugin-node-polyfills"
import wasm from "vite-plugin-wasm"

const __dirname = new URL(".", import.meta.url).pathname
const workspaceRoot = resolve(__dirname, "../..")
const almostnodeSrc = resolve(__dirname, "../../packages/almostnode/src")
const almostnodePublic = resolve(__dirname, "../../packages/almostnode/public/__sw__.js")
const opencodeRoot = resolve(workspaceRoot, "vendor/opencode")
const opentuiRoot = resolve(workspaceRoot, "vendor/opentui")

const opencodeSrc = resolve(opencodeRoot, "packages/opencode/src")
const opencodeTuiSrc = resolve(opencodeSrc, "cli/cmd/tui")
const opencodeBrowserSrc = resolve(opencodeRoot, "packages/browser/src")
const opencodeSdkSrc = resolve(opencodeRoot, "packages/sdk/js/src")
const opencodeUtilSrc = resolve(opencodeRoot, "packages/util/src")
const opencodePluginSrc = resolve(opencodeRoot, "packages/plugin/src")
const opencodeNodeModules = resolve(opencodeRoot, "node_modules")
const opentuiSpinnerSolidPath = resolve(opencodeNodeModules, "opentui-spinner/dist/solid.mjs")

const opentuiCoreSrc = resolve(opentuiRoot, "packages/core/src")
const opentuiSolidSrc = resolve(opentuiRoot, "packages/solid")
const solidJsRoot = resolve(opentuiRoot, "node_modules/solid-js")
const opentuiWasmPath = `/@fs/${resolveFirstExistingPath([
  resolve(opentuiCoreSrc, "zig/lib/wasm32-freestanding/libopentui.wasm"),
  resolve(opentuiCoreSrc, "zig/lib/wasm32-freestanding/opentui.wasm"),
])}`
const streamBrowserifyPath = resolve(workspaceRoot, "node_modules/stream-browserify")
const polyfillRoot = resolve(
  workspaceRoot,
  "node_modules/.pnpm/vite-plugin-node-polyfills@0.25.0_rollup@4.59.0_vite@7.3.1_@types+node@25.5.0_jiti@2.6._daa26fb775a72a80690ecb3dd476bdc8/node_modules/vite-plugin-node-polyfills/shims",
)

function migrationTimestamp(tag: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag)
  if (!match) {
    return 0
  }

  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  )
}

function resolveFirstExistingPath(paths: string[]): string {
  return paths.find((path) => existsSync(path)) ?? paths[0]
}

async function loadOpencodeMigrations(): Promise<Array<{ sql: string; timestamp: number; name: string }>> {
  const migrationRoot = resolve(opencodeRoot, "packages/opencode/migration")
  const entries = await readdir(migrationRoot, { withFileTypes: true })

  const directories = entries
    .filter((entry) => entry.isDirectory() && /^\d{14}/.test(entry.name))
    .map((entry) => entry.name)
    .sort()

  return Promise.all(
    directories.map(async (name) => ({
      name,
      sql: await readFile(resolve(migrationRoot, name, "migration.sql"), "utf8"),
      timestamp: migrationTimestamp(name),
    })),
  )
}

function almostnodeServiceWorker() {
  return {
    name: "almostnode-service-worker",
    configureServer(server: import("vite").ViteDevServer) {
      server.middlewares.use("/__sw__.js", async (_req, res) => {
        res.setHeader("Content-Type", "application/javascript")
        res.end(await readFile(almostnodePublic, "utf8"))
      })
    },
    async generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "__sw__.js",
        source: await readFile(almostnodePublic, "utf8"),
      })
    },
  }
}

function sourcePath(path: string): string {
  const queryIndex = path.indexOf("?")
  const hashIndex = path.indexOf("#")
  const end = [queryIndex, hashIndex].filter((index) => index >= 0).sort((left, right) => left - right)[0]
  return end === undefined ? path : path.slice(0, end)
}

function opentuiSolidTransform() {
  return {
    name: "opentui-solid-transform",
    enforce: "pre" as const,
    async transform(code: string, id: string) {
      const path = sourcePath(id)
      const isOpenCodeTuiSource = path.startsWith(opencodeRoot) && /\.(ts|tsx|js|jsx)$/.test(path)
      const isOpenTuiSolidSource = path.startsWith(opentuiSolidSrc) && /\.(ts|tsx|js|jsx)$/.test(path)

      if (!isOpenCodeTuiSource && !isOpenTuiSolidSource) {
        return null
      }

      if (!/\.(jsx|tsx)$/.test(path)) {
        return null
      }

      const result = await transformAsync(code, {
        filename: path,
        presets: [
          [
            solid,
            {
              moduleName: "@opentui/solid",
              generate: "universal",
            },
          ],
          [ts],
        ],
        sourceMaps: true,
      })

      return {
        code: result?.code ?? code,
        map: result?.map ?? null,
      }
    },
  }
}

function stubModulePrefixes(stubPath: string, prefixes: string[]) {
  return {
    name: "stub-module-prefixes",
    enforce: "pre" as const,
    resolveId(source: string) {
      for (const prefix of prefixes) {
        if (source === prefix || source.startsWith(`${prefix}/`)) {
          return stubPath
        }
      }

      return null
    },
  }
}

function redirectModuleImport(replacement: string, options: { source: string; importer: string }) {
  return {
    name: "redirect-module-import",
    enforce: "pre" as const,
    resolveId(source: string, importer?: string) {
      if (source !== options.source || !importer) {
        return null
      }

      const importerPath = sourcePath(importer)
      return importerPath === options.importer ? replacement : null
    },
  }
}

function treeSitterQueryLoader() {
  return {
    name: "tree-sitter-query-loader",
    enforce: "pre" as const,
    async load(id: string) {
      const path = sourcePath(id)
      if (!path.endsWith(".scm")) {
        return null
      }

      const contents = await readFile(path, "utf8")
      return `export default ${JSON.stringify(contents)}`
    },
  }
}

export default defineConfig(async ({ mode }) => {
  const opencodeMigrations = await loadOpencodeMigrations()

  return {
  plugins: [
    opentuiSolidTransform(),
    treeSitterQueryLoader(),
    redirectModuleImport(resolve(__dirname, "src/shims/opencode-models-snapshot.ts"), {
      source: "./models-snapshot",
      importer: resolve(opencodeSrc, "provider/models.ts"),
    }),
    stubModulePrefixes(resolve(opencodeBrowserSrc, "shims/stubs.ts"), [
      "bonjour-service",
      "gray-matter",
      "@zip.js/zip.js",
      "vscode-jsonrpc",
      "vscode-languageserver-types",
      "turndown",
      "@pierre/diffs",
      "@octokit/rest",
      "@octokit/graphql",
      "@modelcontextprotocol/sdk",
      "@aws-sdk/credential-providers",
      "google-auth-library",
      "@clack/prompts",
      "@openauthjs/openauth",
      "@agentclientprotocol/sdk",
      "fuzzysort",
      "@opencode-ai/script",
      "@ai-sdk/amazon-bedrock",
      "@ai-sdk/azure",
      "@ai-sdk/cerebras",
      "@ai-sdk/cohere",
      "@ai-sdk/deepinfra",
      "@ai-sdk/google",
      "@ai-sdk/google-vertex",
      "@ai-sdk/groq",
      "@ai-sdk/mistral",
      "@ai-sdk/openai",
      "@ai-sdk/openai-compatible",
      "@ai-sdk/perplexity",
      "@ai-sdk/togetherai",
      "@ai-sdk/vercel",
      "@ai-sdk/xai",
      "@openrouter/ai-sdk-provider",
      "ai-gateway-provider",
      "gitlab-ai-provider",
      "opencode-gitlab-auth",
    ]),
    react({ jsxRuntime: "classic" }),
    wasm(),
    nodePolyfills({
      include: [
        "path",
        "util",
        "events",
        "buffer",
        "url",
        "string_decoder",
        "querystring",
        "crypto",
        "assert",
        "http",
        "https",
        "tls",
        "zlib",
        "tty",
      ],
      globals: {
        Buffer: true,
        global: true,
        process: true,
      },
    }),
    almostnodeServiceWorker(),
  ],
  define: {
    global: "globalThis",
    "process.env": {},
    "process.env.NODE_ENV": JSON.stringify(mode === "production" ? "production" : "development"),
    OPENCODE_VERSION: JSON.stringify("browser-local"),
    OPENCODE_CHANNEL: JSON.stringify("browser"),
    OPENCODE_MIGRATIONS: JSON.stringify(opencodeMigrations),
    __OPENTUI_WASM_URL__: JSON.stringify(opentuiWasmPath),
  },
  resolve: {
    dedupe: ["solid-js"],
    alias: [
      {
        find: /^solid-js\/(.*)$/,
        replacement: `${solidJsRoot}/$1`,
      },
      {
        find: "solid-js",
        replacement: solidJsRoot,
      },
      {
        find: "almostnode",
        replacement: resolve(__dirname, "../../packages/almostnode/src/index.ts"),
      },
      {
        find: "almostnode-sdk",
        replacement: resolve(__dirname, "../../packages/almostnode-sdk/src/index.ts"),
      },
      {
        find: "almostnode-react",
        replacement: resolve(__dirname, "../../packages/almostnode-react/src/index.ts"),
      },
      {
        find: "opencode-browser-tui",
        replacement: resolve(opencodeBrowserSrc, "tui-bootstrap.ts"),
      },
      {
        find: "vite-plugin-node-polyfills/shims/process",
        replacement: resolve(polyfillRoot, "process/index.ts"),
      },
      {
        find: "vite-plugin-node-polyfills/shims/global",
        replacement: resolve(polyfillRoot, "global/index.ts"),
      },
      {
        find: "vite-plugin-node-polyfills/shims/buffer",
        replacement: resolve(polyfillRoot, "buffer/index.ts"),
      },
      {
        find: /^@\//,
        replacement: `${opencodeSrc}/`,
      },
      {
        find: /^@tui\//,
        replacement: `${opencodeTuiSrc}/`,
      },
      {
        find: /^@opencode-ai\/sdk(\/.*)?$/,
        replacement: `${opencodeSdkSrc}$1`,
      },
      {
        find: /^@opencode-ai\/util(\/.*)?$/,
        replacement: `${opencodeUtilSrc}$1`,
      },
      {
        find: /^@opencode-ai\/plugin(\/.*)?$/,
        replacement: `${opencodePluginSrc}$1`,
      },
      {
        find: "net",
        replacement: resolve(opencodeBrowserSrc, "shims/net.browser.ts"),
      },
      {
        find: "node:net",
        replacement: resolve(opencodeBrowserSrc, "shims/net.browser.ts"),
      },
      {
        find: "readline",
        replacement: resolve(opencodeBrowserSrc, "shims/readline.browser.ts"),
      },
      {
        find: "node:readline",
        replacement: resolve(opencodeBrowserSrc, "shims/readline.browser.ts"),
      },
      {
        find: "@opentui/core/browser",
        replacement: resolve(opentuiCoreSrc, "browser.ts"),
      },
      {
        find: "@opentui/core/testing",
        replacement: resolve(__dirname, "src/shims/opentui-testing.ts"),
      },
      {
        find: "@opentui/core",
        replacement: resolve(__dirname, "src/shims/opentui-core.ts"),
      },
      {
        find: /^opentui-spinner\/solid$/,
        replacement: opentuiSpinnerSolidPath,
      },
      {
        find: "@opentui/solid",
        replacement: resolve(opentuiSolidSrc, "index.ts"),
      },
      {
        find: "#db",
        replacement: resolve(opencodeBrowserSrc, "shims/db.browser.ts"),
      },
      {
        find: "bun:sqlite",
        replacement: resolve(opencodeBrowserSrc, "shims/bun-sqlite.browser.ts"),
      },
      {
        find: "bun:ffi",
        replacement: resolve(opencodeBrowserSrc, "shims/bun-ffi.browser.ts"),
      },
      {
        find: "bun",
        replacement: resolve(opencodeBrowserSrc, "shims/bun.browser.ts"),
      },
      {
        find: "drizzle-orm/bun-sqlite/migrator",
        replacement: resolve(opencodeBrowserSrc, "shims/drizzle-bun-sqlite-migrator.browser.ts"),
      },
      {
        find: "drizzle-orm/bun-sqlite",
        replacement: resolve(opencodeBrowserSrc, "shims/drizzle-bun-sqlite.browser.ts"),
      },
      {
        find: "bun-pty",
        replacement: resolve(opencodeBrowserSrc, "shims/pty.browser.ts"),
      },
      {
        find: "@parcel/watcher/wrapper",
        replacement: resolve(opencodeBrowserSrc, "shims/watcher-wrapper.browser.ts"),
      },
      {
        find: /^@parcel\/watcher$/,
        replacement: resolve(opencodeBrowserSrc, "shims/watcher.browser.ts"),
      },
      {
        find: "chokidar",
        replacement: resolve(opencodeBrowserSrc, "shims/watcher.browser.ts"),
      },
      {
        find: "xdg-basedir",
        replacement: resolve(opencodeBrowserSrc, "shims/xdg.browser.ts"),
      },
      {
        find: "clipboardy",
        replacement: resolve(opencodeBrowserSrc, "shims/clipboard.browser.ts"),
      },
      {
        find: "open",
        replacement: resolve(opencodeBrowserSrc, "shims/open.browser.ts"),
      },
      {
        find: "@effect/platform-node",
        replacement: resolve(opencodeBrowserSrc, "shims/effect-platform-node.browser.ts"),
      },
      {
        find: "async_hooks",
        replacement: resolve(opencodeBrowserSrc, "shims/async-hooks.browser.ts"),
      },
      {
        find: "os",
        replacement: resolve(opencodeBrowserSrc, "shims/os.browser.ts"),
      },
      {
        find: "node:os",
        replacement: resolve(opencodeBrowserSrc, "shims/os.browser.ts"),
      },
      {
        find: "fs/promises",
        replacement: resolve(opencodeBrowserSrc, "shims/fs.browser.ts"),
      },
      {
        find: "node:fs/promises",
        replacement: resolve(opencodeBrowserSrc, "shims/fs.browser.ts"),
      },
      {
        find: "fs",
        replacement: resolve(opencodeBrowserSrc, "shims/fs-sync.browser.ts"),
      },
      {
        find: "node:fs",
        replacement: resolve(opencodeBrowserSrc, "shims/fs-sync.browser.ts"),
      },
      {
        find: "child_process",
        replacement: resolve(opencodeBrowserSrc, "shims/child-process.browser.ts"),
      },
      {
        find: "node:child_process",
        replacement: resolve(opencodeBrowserSrc, "shims/child-process.browser.ts"),
      },
      {
        find: "cross-spawn",
        replacement: resolve(opencodeBrowserSrc, "shims/cross-spawn.browser.ts"),
      },
      {
        find: "which",
        replacement: resolve(opencodeBrowserSrc, "shims/which.browser.ts"),
      },
      {
        find: "web-tree-sitter/tree-sitter.wasm",
        replacement: resolve(opencodeBrowserSrc, "shims/wasm-asset.browser.ts"),
      },
      {
        find: /^web-tree-sitter$/,
        replacement: resolve(opencodeBrowserSrc, "shims/web-tree-sitter.browser.ts"),
      },
      {
        find: "tree-sitter-bash/tree-sitter-bash.wasm",
        replacement: resolve(opencodeBrowserSrc, "shims/wasm-asset.browser.ts"),
      },
      {
        find: "module",
        replacement: resolve(opencodeBrowserSrc, "shims/module.browser.ts"),
      },
      {
        find: "node:module",
        replacement: resolve(opencodeBrowserSrc, "shims/module.browser.ts"),
      },
      {
        find: "node:console",
        replacement: resolve(opencodeBrowserSrc, "shims/node-console.browser.ts"),
      },
      {
        find: "timers/promises",
        replacement: resolve(opencodeBrowserSrc, "shims/timers-promises.browser.ts"),
      },
      {
        find: "node:timers/promises",
        replacement: resolve(opencodeBrowserSrc, "shims/timers-promises.browser.ts"),
      },
      {
        find: "stream/promises",
        replacement: resolve(opencodeBrowserSrc, "shims/stream-promises.browser.ts"),
      },
      {
        find: "node:stream/promises",
        replacement: resolve(opencodeBrowserSrc, "shims/stream-promises.browser.ts"),
      },
      {
        find: /^stream-browserify\/promises$/,
        replacement: resolve(opencodeBrowserSrc, "shims/stream-promises.browser.ts"),
      },
      {
        find: "stream/consumers",
        replacement: resolve(opencodeBrowserSrc, "shims/stream-consumers.browser.ts"),
      },
      {
        find: "node:stream/consumers",
        replacement: resolve(opencodeBrowserSrc, "shims/stream-consumers.browser.ts"),
      },
      {
        find: /^stream-browserify\/consumers$/,
        replacement: resolve(opencodeBrowserSrc, "shims/stream-consumers.browser.ts"),
      },
      {
        find: "stream",
        replacement: streamBrowserifyPath,
      },
      {
        find: "node:stream",
        replacement: streamBrowserifyPath,
      },
      {
        find: "bonjour-service",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "hono/bun",
        replacement: resolve(opencodeBrowserSrc, "shims/hono-bun.browser.ts"),
      },
      {
        find: "glob",
        replacement: resolve(opencodeBrowserSrc, "shims/glob.browser.ts"),
      },
      {
        find: "ignore",
        replacement: resolve(opencodeBrowserSrc, "shims/ignore.browser.ts"),
      },
      {
        find: "gray-matter",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "mime-types",
        replacement: resolve(opencodeBrowserSrc, "shims/mime-types.browser.ts"),
      },
      {
        find: "@zip.js/zip.js",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: /^vscode-jsonrpc$/,
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: /^vscode-languageserver-types$/,
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "turndown",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "diff",
        replacement: resolve(opencodeBrowserSrc, "shims/diff.browser.ts"),
      },
      {
        find: "@pierre/diffs",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@octokit/rest",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@octokit/graphql",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: /^@modelcontextprotocol\/sdk\/.*$/,
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: /^@modelcontextprotocol\/sdk$/,
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@aws-sdk/credential-providers",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "google-auth-library",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@clack/prompts",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@openauthjs/openauth",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@agentclientprotocol/sdk",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "semver",
        replacement: resolve(opencodeBrowserSrc, "shims/semver.browser.ts"),
      },
      {
        find: "strip-ansi",
        replacement: resolve(opencodeBrowserSrc, "shims/strip-ansi.browser.ts"),
      },
      {
        find: "fuzzysort",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "minimatch",
        replacement: resolve(opencodeBrowserSrc, "shims/minimatch.browser.ts"),
      },
      {
        find: "@opencode-ai/script",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@ai-sdk/amazon-bedrock",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@ai-sdk/azure",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@ai-sdk/cerebras",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@ai-sdk/cohere",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@ai-sdk/deepinfra",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@ai-sdk/gateway",
        replacement: resolve(opencodeBrowserSrc, "shims/ai-sdk-gateway.browser.ts"),
      },
      {
        find: "@ai-sdk/google",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: /^@ai-sdk\/google-vertex\/.*$/,
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: /^@ai-sdk\/google-vertex$/,
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@ai-sdk/groq",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@ai-sdk/mistral",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@ai-sdk/openai",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@ai-sdk/openai-compatible",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@ai-sdk/perplexity",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@ai-sdk/togetherai",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@ai-sdk/vercel",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@ai-sdk/xai",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "@openrouter/ai-sdk-provider",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: /^ai-gateway-provider\/.*$/,
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: /^ai-gateway-provider$/,
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "gitlab-ai-provider",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "opencode-gitlab-auth",
        replacement: resolve(opencodeBrowserSrc, "shims/stubs.ts"),
      },
      {
        find: "v8",
        replacement: resolve(opencodeBrowserSrc, "shims/v8.browser.ts"),
      },
      {
        find: "node:zlib",
        replacement: resolve(almostnodeSrc, "shims/zlib.ts"),
      },
      {
        find: "zlib",
        replacement: resolve(almostnodeSrc, "shims/zlib.ts"),
      },
      {
        find: "node:dns",
        replacement: resolve(almostnodeSrc, "shims/dns.ts"),
      },
      {
        find: "dns",
        replacement: resolve(almostnodeSrc, "shims/dns.ts"),
      },
      {
        find: "buffer",
        replacement: "buffer",
      },
      {
        find: "process",
        replacement: "process/browser",
      },
    ],
  },
  server: {
    headers: {
      "Cross-Origin-Embedder-Policy": "credentialless",
      "Cross-Origin-Opener-Policy": "same-origin",
    },
    fs: {
      allow: [workspaceRoot, opencodeRoot, opentuiRoot],
    },
  },
  optimizeDeps: {
    include: ["buffer", "process", "pako", "sql.js"],
    exclude: [
      "brotli-wasm",
      "bun:sqlite",
      "net",
      "node:net",
      "opentui-spinner",
      "opentui-spinner/solid",
      "os",
      "node:os",
      "web-tree-sitter",
      "tree-sitter-bash",
    ],
    esbuildOptions: {
      target: "esnext",
    },
  },
  build: {
    target: "esnext",
    assetsInlineLimit: 0,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
  },
  worker: {
    format: "es",
  },
  test: {
    environment: "jsdom",
    exclude: ["**/dist/**", "**/e2e/**"],
  },
  assetsInclude: ["**/*.wasm"],
  }
})
