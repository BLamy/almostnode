import { existsSync, readFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { transformAsync } from "@babel/core";
import ts from "@babel/preset-typescript";
import react from "@vitejs/plugin-react";
import solid from "babel-preset-solid";
import { build } from "esbuild";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig, type Plugin } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import wasm from "vite-plugin-wasm";
import tailwindcss from "@tailwindcss/vite";
import { resolvePreferredPnpmPackagePath } from "../../scripts/resolve-pnpm-package-path.mjs";
import { corsProxyPlugin } from "./src/plugins/vite-plugin-cors-proxy";
import { workbenchEntrypointsPlugin } from "./src/plugins/vite-plugin-workbench-entrypoints";
import { workspaceTemplatesPlugin } from "./src/plugins/vite-plugin-workspace-templates";

const monacoVscodePackages = [
  "@codingame/monaco-vscode-api",
  "@codingame/monaco-vscode-configuration-service-override",
  "@codingame/monaco-vscode-css-default-extension",
  "@codingame/monaco-vscode-extensions-service-override",
  "@codingame/monaco-vscode-files-service-override",
  "@codingame/monaco-vscode-html-default-extension",
  "@codingame/monaco-vscode-javascript-default-extension",
  "@codingame/monaco-vscode-json-default-extension",
  "@codingame/monaco-vscode-keybindings-service-override",
  "@codingame/monaco-vscode-languages-service-override",
  "@codingame/monaco-vscode-log-service-override",
  "@codingame/monaco-vscode-search-service-override",
  "@codingame/monaco-vscode-sql-default-extension",
  "@codingame/monaco-vscode-textmate-service-override",
  "@codingame/monaco-vscode-theme-defaults-default-extension",
  "@codingame/monaco-vscode-theme-service-override",
  "@codingame/monaco-vscode-typescript-basics-default-extension",
  "@codingame/monaco-vscode-workbench-service-override",
];

const __dirname = new URL(".", import.meta.url).pathname;
const workspaceRoot = resolve(__dirname, "../..");
const napiWasmRuntimePath = resolvePreferredPnpmPackagePath(
  workspaceRoot,
  "@napi-rs/wasm-runtime",
  "1.1.",
);
const opencodeRoot = resolve(workspaceRoot, "vendor/opencode");
const opentuiRoot = resolve(workspaceRoot, "vendor/opentui");
const isTest = process.env.VITEST === "true";
const appBase = process.env.GITHUB_PAGES ? "/almostnode/" : "/";
const codespacesApiTarget =
  process.env.CODESPACES_API_ORIGIN || "http://127.0.0.1:4167";

const opencodeSrc = resolve(opencodeRoot, "packages/opencode/src");
const opencodeTuiSrc = resolve(opencodeSrc, "cli/cmd/tui");
const opencodeBrowserSrc = resolve(opencodeRoot, "packages/browser/src");
const opencodeSdkSrc = resolve(opencodeRoot, "packages/sdk/js/src");
const opencodeUtilSrc = resolve(opencodeRoot, "packages/util/src");
const opencodePluginSrc = resolve(opencodeRoot, "packages/plugin/src");
const opencodeNodeModules = resolve(opencodeRoot, "node_modules");
const opentuiSpinnerSolidPath = resolve(opencodeNodeModules, "opentui-spinner/dist/solid.mjs");
const almostnodeShimsRoot = resolve(workspaceRoot, "packages/almostnode/src/shims");
const streamBrowserifyPath = resolve(almostnodeShimsRoot, "stream.ts");
const webIdeEventsShimPath = resolve(almostnodeShimsRoot, "events.ts");
const webIdeBufferShimPath = resolve(__dirname, "src/shims/node-buffer.ts");
const webIdeGlobalShimPath = resolve(__dirname, "src/shims/node-global.ts");
const webIdeProcessShimPath = resolve(__dirname, "src/shims/node-process.ts");
const webIdeGrayMatterShimPath = resolve(__dirname, "src/shims/gray-matter.browser.ts");
const opencodeChildProcessShimPath = resolve(__dirname, "src/shims/opencode-child-process.ts");
const opencodeCorsProxyShimPath = resolve(__dirname, "src/shims/opencode-cors-proxy.ts");
const opencodeRipgrepShimPath = resolve(__dirname, "src/shims/opencode-ripgrep.ts");
const opencodeXtermShimPath = resolve(__dirname, "src/shims/opencode-xterm.ts");
const sourceMapGeneratorShimPath = resolve(__dirname, "src/shims/source-map-generator.ts");
const sourceMapConsumerShimPath = resolve(__dirname, "src/shims/source-map-consumer.ts");
const sourceMapNodeShimPath = resolve(__dirname, "src/shims/source-map-node.ts");
const commonJsInteropAliasMap = new Map<string, string>([
  ["assert", resolve(almostnodeShimsRoot, "assert.ts")],
  ["node:assert", resolve(almostnodeShimsRoot, "assert.ts")],
  ["assert/build/assert.js", resolve(almostnodeShimsRoot, "assert.ts")],
  ["crypto", resolve(almostnodeShimsRoot, "crypto.ts")],
  ["node:crypto", resolve(almostnodeShimsRoot, "crypto.ts")],
  ["crypto-browserify", resolve(almostnodeShimsRoot, "crypto.ts")],
  ["crypto-browserify/index.js", resolve(almostnodeShimsRoot, "crypto.ts")],
  ["events", webIdeEventsShimPath],
  ["node:events", webIdeEventsShimPath],
  ["events/events.js", webIdeEventsShimPath],
  ["http", resolve(almostnodeShimsRoot, "http.ts")],
  ["node:http", resolve(almostnodeShimsRoot, "http.ts")],
  ["stream-http", resolve(almostnodeShimsRoot, "http.ts")],
  ["stream-http/index.js", resolve(almostnodeShimsRoot, "http.ts")],
  ["https", resolve(almostnodeShimsRoot, "https.ts")],
  ["node:https", resolve(almostnodeShimsRoot, "https.ts")],
  ["https-browserify", resolve(almostnodeShimsRoot, "https.ts")],
  ["https-browserify/index.js", resolve(almostnodeShimsRoot, "https.ts")],
  ["path", resolve(almostnodeShimsRoot, "path.ts")],
  ["node:path", resolve(almostnodeShimsRoot, "path.ts")],
  ["path-browserify", resolve(almostnodeShimsRoot, "path.ts")],
  ["path-browserify/index.js", resolve(almostnodeShimsRoot, "path.ts")],
  ["querystring", resolve(almostnodeShimsRoot, "querystring.ts")],
  ["node:querystring", resolve(almostnodeShimsRoot, "querystring.ts")],
  ["querystring-es3", resolve(almostnodeShimsRoot, "querystring.ts")],
  ["querystring-es3/index.js", resolve(almostnodeShimsRoot, "querystring.ts")],
  ["stream", streamBrowserifyPath],
  ["node:stream", streamBrowserifyPath],
  ["stream/promises", resolve(opencodeBrowserSrc, "shims/stream-promises.browser.ts")],
  ["node:stream/promises", resolve(opencodeBrowserSrc, "shims/stream-promises.browser.ts")],
  ["stream/consumers", resolve(opencodeBrowserSrc, "shims/stream-consumers.browser.ts")],
  ["node:stream/consumers", resolve(opencodeBrowserSrc, "shims/stream-consumers.browser.ts")],
  ["tls", resolve(almostnodeShimsRoot, "tls.ts")],
  ["node:tls", resolve(almostnodeShimsRoot, "tls.ts")],
  ["tty", resolve(almostnodeShimsRoot, "tty.ts")],
  ["node:tty", resolve(almostnodeShimsRoot, "tty.ts")],
  ["tty-browserify", resolve(almostnodeShimsRoot, "tty.ts")],
  ["tty-browserify/index.js", resolve(almostnodeShimsRoot, "tty.ts")],
  ["url", resolve(almostnodeShimsRoot, "url.ts")],
  ["node:url", resolve(almostnodeShimsRoot, "url.ts")],
  ["url/url.js", resolve(almostnodeShimsRoot, "url.ts")],
  ["util", resolve(almostnodeShimsRoot, "util.ts")],
  ["node:util", resolve(almostnodeShimsRoot, "util.ts")],
  ["util/util.js", resolve(almostnodeShimsRoot, "util.ts")],
  ["zlib", resolve(almostnodeShimsRoot, "zlib.ts")],
  ["node:zlib", resolve(almostnodeShimsRoot, "zlib.ts")],
  ["dns", resolve(almostnodeShimsRoot, "dns.ts")],
  ["node:dns", resolve(almostnodeShimsRoot, "dns.ts")],
  ["fs", resolve(opencodeBrowserSrc, "shims/fs-sync.browser.ts")],
  ["node:fs", resolve(opencodeBrowserSrc, "shims/fs-sync.browser.ts")],
  ["fs/promises", resolve(opencodeBrowserSrc, "shims/fs.browser.ts")],
  ["node:fs/promises", resolve(opencodeBrowserSrc, "shims/fs.browser.ts")],
  ["child_process", opencodeChildProcessShimPath],
  ["node:child_process", opencodeChildProcessShimPath],
  ["net", resolve(opencodeBrowserSrc, "shims/net.browser.ts")],
  ["node:net", resolve(opencodeBrowserSrc, "shims/net.browser.ts")],
  ["readline", resolve(opencodeBrowserSrc, "shims/readline.browser.ts")],
  ["node:readline", resolve(opencodeBrowserSrc, "shims/readline.browser.ts")],
  ["os", resolve(opencodeBrowserSrc, "shims/os.browser.ts")],
  ["node:os", resolve(opencodeBrowserSrc, "shims/os.browser.ts")],
  ["async_hooks", resolve(opencodeBrowserSrc, "shims/async-hooks.browser.ts")],
  ["module", resolve(opencodeBrowserSrc, "shims/module.browser.ts")],
  ["node:module", resolve(opencodeBrowserSrc, "shims/module.browser.ts")],
  ["browserify-zlib", resolve(almostnodeShimsRoot, "zlib.ts")],
  ["browserify-zlib/lib/index.js", resolve(almostnodeShimsRoot, "zlib.ts")],
  ["fsevents", resolve(almostnodeShimsRoot, "fsevents.ts")],
]);

const opentuiCoreSrc = resolve(opentuiRoot, "packages/core/src");
const opentuiSolidSrc = resolve(opentuiRoot, "packages/solid");
const solidJsRoot = resolve(opentuiRoot, "node_modules/solid-js");
const opentuiWasmSourcePath = resolveFirstExistingPath([
  resolve(opentuiCoreSrc, "zig/lib/wasm32-freestanding/libopentui.wasm"),
  resolve(opentuiCoreSrc, "zig/lib/wasm32-freestanding/opentui.wasm"),
]);
const opentuiWasmPath = `${appBase}opentui/opentui.wasm`;

function migrationTimestamp(tag: string): number {
  const match = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(tag);
  if (!match) {
    return 0;
  }

  return Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
  );
}

function resolveFirstExistingPath(paths: string[]): string {
  return paths.find((path) => existsSync(path)) ?? paths[0];
}

function opentuiWasmAsset(): Plugin {
  const publicPathname = "/opentui/opentui.wasm";

  return {
    name: "opentui-wasm-asset",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestUrl = req.url;
        if (!requestUrl) {
          next();
          return;
        }

        const pathname = new URL(requestUrl, "http://127.0.0.1").pathname;
        if (pathname !== publicPathname) {
          next();
          return;
        }

        res.setHeader("Content-Type", "application/wasm");
        res.end(readFileSync(opentuiWasmSourcePath));
      });
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "opentui/opentui.wasm",
        source: readFileSync(opentuiWasmSourcePath),
      });
    },
  };
}

async function loadOpencodeMigrations(): Promise<Array<{ sql: string; timestamp: number; name: string }>> {
  const migrationRoot = resolve(opencodeRoot, "packages/opencode/migration");
  const entries = await readdir(migrationRoot, { withFileTypes: true });

  const directories = entries
    .filter((entry) => entry.isDirectory() && /^\d{14}/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  return Promise.all(
    directories.map(async (name) => ({
      name,
      sql: await readFile(resolve(migrationRoot, name, "migration.sql"), "utf8"),
      timestamp: migrationTimestamp(name),
    })),
  );
}

function sourcePath(path: string): string {
  const queryIndex = path.indexOf("?");
  const hashIndex = path.indexOf("#");
  const end = [queryIndex, hashIndex].filter((index) => index >= 0).sort((left, right) => left - right)[0];
  const resolved = end === undefined ? path : path.slice(0, end);
  const normalized = resolved.startsWith("/@fs/") ? resolved.slice("/@fs".length) : resolved;
  return decodeURIComponent(normalized);
}

function opentuiSolidTransform() {
  return {
    name: "opentui-solid-transform",
    enforce: "pre" as const,
    async transform(code: string, id: string) {
      const path = sourcePath(id);
      const isOpenCodeTuiSource = path.startsWith(opencodeRoot) && /\.(ts|tsx|js|jsx)$/.test(path);
      const isOpenTuiSolidSource = path.startsWith(opentuiSolidSrc) && /\.(ts|tsx|js|jsx)$/.test(path);

      if (!isOpenCodeTuiSource && !isOpenTuiSolidSource) {
        return null;
      }

      if (!/\.(jsx|tsx)$/.test(path)) {
        return null;
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
      });

      return {
        code: result?.code ?? code,
        map: result?.map ?? null,
      };
    },
  };
}

function stubModulePrefixes(stubPath: string, prefixes: string[]) {
  return {
    name: "stub-module-prefixes",
    enforce: "pre" as const,
    resolveId(source: string) {
      for (const prefix of prefixes) {
        if (source === prefix || source.startsWith(`${prefix}/`)) {
          return stubPath;
        }
      }

      return null;
    },
  };
}

function redirectModuleImport(replacement: string, options: { source: string; importer: string }) {
  return {
    name: "redirect-module-import",
    enforce: "pre" as const,
    resolveId(source: string, importer?: string) {
      if (source !== options.source || !importer) {
        return null;
      }

      const importerPath = sourcePath(importer);
      return importerPath === options.importer ? replacement : null;
    },
  };
}

function redirectModuleImportByPrefix(
  name: string,
  replacement: string,
  options: {
    sources: string[];
    importerPrefix: string;
  },
) {
  const sources = new Set(options.sources);

  return {
    name,
    enforce: "pre" as const,
    resolveId(source: string, importer?: string) {
      if (!importer || !sources.has(source)) {
        return null;
      }

      const importerPath = sourcePath(importer);
      return importerPath.startsWith(options.importerPrefix) ? replacement : null;
    },
  };
}

function redirectResolvedModulePaths(
  name: string,
  rules: Array<{
    pattern: RegExp;
    replacement: string;
  }>,
) {
  return {
    name,
    enforce: "pre" as const,
    resolveId(source: string) {
      const normalized = sourcePath(source);

      for (const rule of rules) {
        if (rule.pattern.test(normalized)) {
          return rule.replacement;
        }
      }

      return null;
    },
  };
}

function patchOpenCodeBashTool() {
  const bashToolPath = resolve(opencodeSrc, "tool/bash.ts");

  return {
    name: "patch-opencode-bash-tool",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (sourcePath(id) !== bashToolPath) {
        return null;
      }

      const withoutFileUrlImport = code.replace(/^import \{ fileURLToPath \} from "url"\n/m, "");
      const start = withoutFileUrlImport.indexOf("const resolveWasm =");
      const end = withoutFileUrlImport.indexOf("// TODO: we may wanna rename this tool");
      if (start < 0 || end < 0) {
        return null;
      }

      const replacement = [
        "const parser = lazy(async () => {",
        '  const { Parser } = await import("web-tree-sitter")',
        "  await Parser.init()",
        '  const bashLanguage = await Language.load("")',
        "  const p = new Parser()",
        "  p.setLanguage(bashLanguage)",
        "  return p",
        "})",
        "",
      ].join("\n");

      return {
        code: withoutFileUrlImport.slice(0, start) + replacement + withoutFileUrlImport.slice(end),
        map: null,
      };
    },
  };
}

function treeSitterQueryLoader() {
  return {
    name: "tree-sitter-query-loader",
    enforce: "pre" as const,
    async load(id: string) {
      const path = sourcePath(id);
      if (!path.endsWith(".scm")) {
        return null;
      }

      const contents = await readFile(path, "utf8");
      return `export default ${JSON.stringify(contents)}`;
    },
  };
}

function extractCommonJsNamedExports(code: string): string[] {
  const names = new Set<string>();
  const patterns = [
    /exports\.([A-Za-z_$][\w$]*)\s*=/g,
    /exports\[['"]([^'"]+)['"]\]\s*=/g,
    /module\.exports\.([A-Za-z_$][\w$]*)\s*=/g,
    /Object\.defineProperty\(exports,\s*['"]([^'"]+)['"]/g,
  ];

  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const name = match[1];
      if (name && name !== "__esModule" && name !== "default") {
        names.add(name);
      }
    }
  }

  return [...names];
}

function commonJsNodeModulesInterop() {
  const passthroughPackages = [
    "/node_modules/react/",
    "/node_modules/react-dom/",
    "/node_modules/scheduler/",
    "/node_modules/use-sync-external-store/",
  ];

  return {
    name: "commonjs-node-modules-interop",
    enforce: "pre" as const,
    async load(id: string) {
      const path = sourcePath(id);
      if (
        !path.includes("/node_modules/") ||
        path.includes("/.vite/") ||
        !(path.endsWith(".js") || path.endsWith(".cjs"))
      ) {
        return null;
      }
      if (path.includes("vite-plugin-node-polyfills")) {
        return null;
      }
      if (passthroughPackages.some((segment) => path.includes(segment))) {
        return null;
      }
      if (!existsSync(path)) {
        return null;
      }

      const code = readFileSync(path, "utf8");
      const looksCommonJs =
        code.includes("module.exports") ||
        code.includes("exports.") ||
        code.includes("exports[") ||
        /\brequire\(/.test(code);

      if (!looksCommonJs || /\bexport\s+/.test(code) || /\bimport\s+/.test(code)) {
        return null;
      }

      try {
        const result = await build({
          entryPoints: [path],
          bundle: true,
          format: "esm",
          platform: "browser",
          write: false,
          sourcemap: false,
          mainFields: ["browser", "module", "main"],
          conditions: ["browser", "module", "default"],
          plugins: [
            {
              name: "commonjs-node-modules-browser-aliases",
              setup(buildContext) {
                buildContext.onResolve({ filter: /.*/ }, (args) => {
                  const replacement = commonJsInteropAliasMap.get(args.path);
                  if (replacement) {
                    return { path: replacement };
                  }

                  if (args.path.endsWith(".node") || args.path.startsWith("chromium-bidi/")) {
                    return { path: args.path, namespace: "almostnode-empty-module" };
                  }

                  return null;
                });

                buildContext.onLoad({ filter: /.*/, namespace: "almostnode-empty-module" }, () => ({
                  contents: "export default {};\n",
                  loader: "js",
                }));
              },
            },
          ],
        });
        const bundled = result.outputFiles[0]?.text;
        if (!bundled) {
          return null;
        }

        const namedExports = extractCommonJsNamedExports(code);
        const rewritten = bundled.replace(
          /export default ([A-Za-z_$][\w$]*)\(\);\s*$/,
          (_match, expr) => {
            const lines = [
              `const __cjsInterop = ${expr}();`,
              "export default __cjsInterop;",
            ];
            for (const name of namedExports) {
              lines.push(`export const ${name} = __cjsInterop[${JSON.stringify(name)}];`);
            }
            return `${lines.join("\n")}\n`;
          },
        );

        return rewritten === bundled ? bundled : rewritten;
      } catch {
        return null;
      }
    },
  };
}

function stripNodePolyfillSelfInject(shimPaths: string[]) {
  const pathSet = new Set(shimPaths);
  const polyfillPrelude =
    /^import __buffer_polyfill from .+\nglobalThis\.Buffer = globalThis\.Buffer \|\| __buffer_polyfill\nimport __global_polyfill from .+\nglobalThis\.global = globalThis\.global \|\| __global_polyfill\nimport __process_polyfill from .+\nglobalThis\.process = globalThis\.process \|\| __process_polyfill\n\n?/;

  return {
    name: "strip-node-polyfill-self-inject",
    enforce: "post" as const,
    transform(code: string, id: string) {
      if (!pathSet.has(sourcePath(id))) {
        return null;
      }

      const stripped = code.replace(polyfillPrelude, "");
      return stripped === code ? null : { code: stripped, map: null };
    },
  };
}

export default defineConfig(async ({ mode }) => {
  const opencodeMigrations = await loadOpencodeMigrations();

  return {
    base: appBase,
    test: {
      exclude: [
        "**/node_modules/**",
        "**/dist/**",
        "**/e2e/**",
      ],
    },
    plugins: [
      corsProxyPlugin(),
      workbenchEntrypointsPlugin({
        entrypointsDir: resolve(__dirname, "src/workbench/entrypoints"),
      }),
      workspaceTemplatesPlugin({ templatesDir: resolve(__dirname, "src/templates/content") }),
      opentuiWasmAsset(),
      opentuiSolidTransform(),
      treeSitterQueryLoader(),
      commonJsNodeModulesInterop(),
      redirectModuleImportByPrefix("redirect-opencode-ripgrep-imports", opencodeRipgrepShimPath, {
        sources: [
          "../file/ripgrep",
          "../../file/ripgrep",
          "@/file/ripgrep",
        ],
        importerPrefix: opencodeSrc,
      }),
      redirectModuleImportByPrefix("redirect-opencode-browser-imports", opencodeChildProcessShimPath, {
        sources: [
          "./shims/child-process.browser",
          "./child-process.browser",
        ],
        importerPrefix: opencodeBrowserSrc,
      }),
      redirectModuleImportByPrefix("redirect-opencode-cors-proxy-imports", opencodeCorsProxyShimPath, {
        sources: [
          "./cors-proxy",
        ],
        importerPrefix: opencodeBrowserSrc,
      }),
      redirectModuleImportByPrefix(
        "redirect-opencode-bash-tree-sitter-runtime",
        resolve(opencodeBrowserSrc, "shims/web-tree-sitter.browser.ts"),
        {
          sources: ["web-tree-sitter"],
          importerPrefix: resolve(opencodeSrc, "tool/bash.ts"),
        },
      ),
      redirectModuleImportByPrefix(
        "redirect-opencode-bash-tree-sitter-wasm",
        resolve(opencodeBrowserSrc, "shims/wasm-asset.browser.ts"),
        {
          sources: ["web-tree-sitter/tree-sitter.wasm", "tree-sitter-bash/tree-sitter-bash.wasm"],
          importerPrefix: resolve(opencodeSrc, "tool/bash.ts"),
        },
      ),
      redirectResolvedModulePaths("redirect-resolved-node-module-paths", [
        {
          pattern: /\/events\/events\.js$/,
          replacement: webIdeEventsShimPath,
        },
        {
          pattern: /\/vendor\/opencode\/packages\/browser\/src\/shims\/child-process\.browser\.ts$/,
          replacement: opencodeChildProcessShimPath,
        },
      ]),
      patchOpenCodeBashTool(),
      redirectModuleImport(opencodeXtermShimPath, {
        source: "@xterm/xterm",
        importer: resolve(opencodeBrowserSrc, "terminal-adapter.ts"),
      }),
      redirectModuleImport(opencodeXtermShimPath, {
        source: "@xterm/xterm",
        importer: resolve(opencodeBrowserSrc, "tui-bootstrap.ts"),
      }),
      redirectModuleImport(resolve(__dirname, "src/shims/opencode-models-snapshot.ts"), {
        source: "./models-snapshot",
        importer: resolve(opencodeSrc, "provider/models.ts"),
      }),
      stubModulePrefixes(resolve(opencodeBrowserSrc, "shims/stubs.ts"), [
        "bonjour-service",
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
        "ai-gateway-provider",
        "gitlab-ai-provider",
        "opencode-gitlab-auth",
      ]),
      stubModulePrefixes(resolve(opencodeBrowserSrc, "shims/bun-bundle.browser.ts"), [
        "bun:bundle",
      ]),
      stubModulePrefixes(resolve(opencodeBrowserSrc, "shims/bun-sqlite.browser.ts"), [
        "bun:sqlite",
      ]),
      stubModulePrefixes(resolve(opencodeBrowserSrc, "shims/bun-ffi.browser.ts"), [
        "bun:ffi",
      ]),
      stubModulePrefixes(resolve(opencodeBrowserSrc, "shims/bun.browser.ts"), [
        "bun",
      ]),
      ...(isTest ? [] : [
        tanstackStart({ spa: { enabled: true } }),
        react(),
        tailwindcss(),
        wasm(),
        nodePolyfills({
          include: [
            "buffer",
            "string_decoder",
            "zlib",
          ],
          globals: {
            Buffer: true,
            global: true,
            process: true,
          },
        }),
        {
          name: "browser-shims",
          enforce: "pre" as const,
          resolveId(source: string) {
            if (
              source === "assert"
              || source === "node:assert"
              || source === "assert/build/assert.js"
              || /(?:^|\/)assert\/build\/assert\.js$/.test(source)
            ) {
              return resolve(__dirname, "../../packages/almostnode/src/shims/assert.ts");
            }
            if (
              source === "crypto"
              || source === "node:crypto"
              || source === "crypto-browserify"
              || source === "crypto-browserify/index.js"
              || /(?:^|\/)crypto-browserify\/index\.js$/.test(source)
            ) {
              return resolve(__dirname, "../../packages/almostnode/src/shims/crypto.ts");
            }
            if (
              source === "events"
              || source === "node:events"
              || source === "events/events.js"
              || /(?:^|\/)events\/events\.js$/.test(source)
            ) {
              return webIdeEventsShimPath;
            }
            if (
              source === "http"
              || source === "node:http"
              || source === "stream-http"
              || source === "stream-http/index.js"
              || /(?:^|\/)stream-http\/index\.js$/.test(source)
            ) {
              return resolve(__dirname, "../../packages/almostnode/src/shims/http.ts");
            }
            if (
              source === "https"
              || source === "node:https"
              || source === "https-browserify"
              || source === "https-browserify/index.js"
              || /(?:^|\/)https-browserify\/index\.js$/.test(source)
            ) {
              return resolve(__dirname, "../../packages/almostnode/src/shims/https.ts");
            }
            if (
              source === "path"
              || source === "node:path"
              || source === "path-browserify"
              || source === "path-browserify/index.js"
              || /(?:^|\/)path-browserify\/index\.js$/.test(source)
            ) {
              return resolve(__dirname, "../../packages/almostnode/src/shims/path.ts");
            }
            if (
              source === "querystring"
              || source === "node:querystring"
              || source === "querystring-es3"
              || source === "querystring-es3/index.js"
              || /(?:^|\/)querystring-es3\/index\.js$/.test(source)
            ) {
              return resolve(__dirname, "../../packages/almostnode/src/shims/querystring.ts");
            }
            if (
              source === "tls"
              || source === "node:tls"
            ) {
              return resolve(__dirname, "../../packages/almostnode/src/shims/tls.ts");
            }
            if (
              source === "tty"
              || source === "node:tty"
              || source === "tty-browserify"
              || source === "tty-browserify/index.js"
              || /(?:^|\/)tty-browserify\/index\.js$/.test(source)
            ) {
              return resolve(__dirname, "../../packages/almostnode/src/shims/tty.ts");
            }
            if (
              source === "url"
              || source === "node:url"
              || source === "url/url.js"
              || /(?:^|\/)url\/url\.js$/.test(source)
            ) {
              return resolve(__dirname, "../../packages/almostnode/src/shims/url.ts");
            }
            if (
              source === "util"
              || source === "node:util"
              || source === "util/util.js"
              || /(?:^|\/)util\/util\.js$/.test(source)
            ) {
              return resolve(__dirname, "../../packages/almostnode/src/shims/util.ts");
            }
            if (source.includes("browserify-zlib")) {
              return resolve(__dirname, "../../packages/almostnode/src/shims/zlib.ts");
            }
            if (source.includes("source-map-js/lib/source-map-generator.js")) {
              return sourceMapGeneratorShimPath;
            }
            if (source.includes("source-map-js/lib/source-map-consumer.js")) {
              return sourceMapConsumerShimPath;
            }
            if (source.includes("source-map-js/lib/source-node.js")) {
              return sourceMapNodeShimPath;
            }
            if (source === "node:zlib" || source === "zlib") {
              return resolve(__dirname, "../../packages/almostnode/src/shims/zlib.ts");
            }
            if (source === "node:dns" || source === "dns") {
              return resolve(__dirname, "../../packages/almostnode/src/shims/dns.ts");
            }
            if (source === "brotli-wasm/pkg.web/brotli_wasm.js") {
              return resolve(__dirname, "node_modules/brotli-wasm/pkg.web/brotli_wasm.js");
            }
            if (source === "brotli-wasm/pkg.web/brotli_wasm_bg.wasm?url") {
              return {
                id: `${resolve(__dirname, "node_modules/brotli-wasm/pkg.web/brotli_wasm_bg.wasm")}?url`,
                external: false,
              };
            }
            return null;
          },
          transform(code: string) {
            if (code.includes("ENVIRONMENT_IS_NODE")) {
              return code.replace(
                /ENVIRONMENT_IS_NODE\s*=\s*typeof process[^;]+;/g,
                "ENVIRONMENT_IS_NODE=false;",
              );
            }
          },
        },
        stripNodePolyfillSelfInject([
          webIdeEventsShimPath,
          webIdeBufferShimPath,
          webIdeGlobalShimPath,
          webIdeProcessShimPath,
        ]),
      ]),
    ],
    define: isTest ? {} : {
      "process.env": {},
      "process.env.NODE_ENV": JSON.stringify(mode === "production" ? "production" : "development"),
      global: "globalThis",
      OPENCODE_VERSION: JSON.stringify("browser-local"),
      OPENCODE_CHANNEL: JSON.stringify("browser"),
      OPENCODE_MIGRATIONS: JSON.stringify(opencodeMigrations),
      __OPENTUI_WASM_URL__: JSON.stringify(opentuiWasmPath),
    },
    server: {
      headers: {
        "Cross-Origin-Embedder-Policy": "credentialless",
        "Cross-Origin-Opener-Policy": "same-origin",
      },
      proxy: {
        "/__api/codespaces": {
          target: codespacesApiTarget,
          changeOrigin: true,
        },
      },
      fs: {
        allow: [
          resolve(__dirname, "./"),
          resolve(__dirname, "node_modules"),
          resolve(__dirname, "../../node_modules"),
          resolve(__dirname, "../../packages/almostnode/src"),
          opencodeRoot,
          opentuiRoot,
        ],
      },
    },
    resolve: {
      dedupe: ["react", "react-dom", "solid-js"],
      alias: [
        {
          find: /^almostnode\/internal$/,
          replacement: resolve(__dirname, "../../packages/almostnode/src/internal.ts"),
        },
        {
          find: /^almostnode$/,
          replacement: resolve(__dirname, "../../packages/almostnode/src/browser.ts"),
        },
        {
          find: /^@napi-rs\/wasm-runtime$/,
          replacement: napiWasmRuntimePath,
        },
        ...(isTest ? [] : [
        {
          find: /^@codingame\/monaco-vscode-api\/vscode\/src\/(.*)$/,
          replacement: resolve(__dirname, "node_modules/@codingame/monaco-vscode-api/vscode/src/$1"),
        },
        {
          find: /^@codingame\/monaco-vscode-api\/vscode\/(.*)$/,
          replacement: resolve(__dirname, "node_modules/@codingame/monaco-vscode-api/vscode/src/$1"),
        },
        {
          find: /^solid-js\/(.*)$/,
          replacement: `${solidJsRoot}/$1`,
        },
        {
          find: "solid-js",
          replacement: solidJsRoot,
        },
        {
          find: "opencode-browser-tui",
          replacement: resolve(opencodeBrowserSrc, "tui-bootstrap.ts"),
        },
        {
          find: "vite-plugin-node-polyfills/shims/process",
          replacement: webIdeProcessShimPath,
        },
        {
          find: "vite-plugin-node-polyfills/shims/global",
          replacement: webIdeGlobalShimPath,
        },
        {
          find: "vite-plugin-node-polyfills/shims/buffer",
          replacement: webIdeBufferShimPath,
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
          find: "assert",
          replacement: resolve(almostnodeShimsRoot, "assert.ts"),
        },
        {
          find: "node:assert",
          replacement: resolve(almostnodeShimsRoot, "assert.ts"),
        },
        {
          find: /(?:^|\/)assert\/build\/assert\.js$/,
          replacement: resolve(almostnodeShimsRoot, "assert.ts"),
        },
        {
          find: "crypto",
          replacement: resolve(almostnodeShimsRoot, "crypto.ts"),
        },
        {
          find: "node:crypto",
          replacement: resolve(almostnodeShimsRoot, "crypto.ts"),
        },
        {
          find: /(?:^crypto-browserify$|^crypto-browserify\/index\.js$|(?:^|\/)crypto-browserify\/index\.js$)/,
          replacement: resolve(almostnodeShimsRoot, "crypto.ts"),
        },
        {
          find: "events",
          replacement: webIdeEventsShimPath,
        },
        {
          find: "node:events",
          replacement: webIdeEventsShimPath,
        },
        {
          find: /^events\/events(?:\.js)?$/,
          replacement: webIdeEventsShimPath,
        },
        {
          find: /(?:^|\/)events\/events\.js$/,
          replacement: webIdeEventsShimPath,
        },
        {
          find: "http",
          replacement: resolve(almostnodeShimsRoot, "http.ts"),
        },
        {
          find: "node:http",
          replacement: resolve(almostnodeShimsRoot, "http.ts"),
        },
        {
          find: /(?:^stream-http$|^stream-http\/index\.js$|(?:^|\/)stream-http\/index\.js$)/,
          replacement: resolve(almostnodeShimsRoot, "http.ts"),
        },
        {
          find: "https",
          replacement: resolve(almostnodeShimsRoot, "https.ts"),
        },
        {
          find: "node:https",
          replacement: resolve(almostnodeShimsRoot, "https.ts"),
        },
        {
          find: /(?:^https-browserify$|^https-browserify\/index\.js$|(?:^|\/)https-browserify\/index\.js$)/,
          replacement: resolve(almostnodeShimsRoot, "https.ts"),
        },
        {
          find: "path",
          replacement: resolve(almostnodeShimsRoot, "path.ts"),
        },
        {
          find: "node:path",
          replacement: resolve(almostnodeShimsRoot, "path.ts"),
        },
        {
          find: /(?:^path-browserify$|^path-browserify\/index\.js$)/,
          replacement: resolve(almostnodeShimsRoot, "path.ts"),
        },
        {
          find: /(?:^|\/)path-browserify\/index\.js$/,
          replacement: resolve(almostnodeShimsRoot, "path.ts"),
        },
        {
          find: "querystring",
          replacement: resolve(almostnodeShimsRoot, "querystring.ts"),
        },
        {
          find: "node:querystring",
          replacement: resolve(almostnodeShimsRoot, "querystring.ts"),
        },
        {
          find: /(?:^querystring-es3$|^querystring-es3\/index\.js$|(?:^|\/)querystring-es3\/index\.js$)/,
          replacement: resolve(almostnodeShimsRoot, "querystring.ts"),
        },
        {
          find: "net",
          replacement: resolve(opencodeBrowserSrc, "shims/net.browser.ts"),
        },
        {
          find: /(?:^browserify-zlib$|browserify-zlib\/lib\/index\.js$)/,
          replacement: resolve(__dirname, "../../packages/almostnode/src/shims/zlib.ts"),
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
          find: "bun:bundle",
          replacement: resolve(opencodeBrowserSrc, "shims/bun-bundle.browser.ts"),
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
          replacement: opencodeChildProcessShimPath,
        },
        {
          find: "node:child_process",
          replacement: opencodeChildProcessShimPath,
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
          find: /(?:^|\/)stream-browserify\/index\.js$/,
          replacement: streamBrowserifyPath,
        },
        {
          find: "tls",
          replacement: resolve(almostnodeShimsRoot, "tls.ts"),
        },
        {
          find: "node:tls",
          replacement: resolve(almostnodeShimsRoot, "tls.ts"),
        },
        {
          find: "tty",
          replacement: resolve(almostnodeShimsRoot, "tty.ts"),
        },
        {
          find: "node:tty",
          replacement: resolve(almostnodeShimsRoot, "tty.ts"),
        },
        {
          find: /(?:^tty-browserify$|^tty-browserify\/index\.js$|(?:^|\/)tty-browserify\/index\.js$)/,
          replacement: resolve(almostnodeShimsRoot, "tty.ts"),
        },
        {
          find: "url",
          replacement: resolve(almostnodeShimsRoot, "url.ts"),
        },
        {
          find: "node:url",
          replacement: resolve(almostnodeShimsRoot, "url.ts"),
        },
        {
          find: /(?:^url\/url\.js$|(?:^|\/)url\/url\.js$)/,
          replacement: resolve(almostnodeShimsRoot, "url.ts"),
        },
        {
          find: "util",
          replacement: resolve(almostnodeShimsRoot, "util.ts"),
        },
        {
          find: "node:util",
          replacement: resolve(almostnodeShimsRoot, "util.ts"),
        },
        {
          find: /(?:^util\/util\.js$|(?:^|\/)util\/util\.js$)/,
          replacement: resolve(almostnodeShimsRoot, "util.ts"),
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
          find: "gray-matter",
          replacement: webIdeGrayMatterShimPath,
        },
        {
          find: "ignore",
          replacement: resolve(opencodeBrowserSrc, "shims/ignore.browser.ts"),
        },
        {
          find: "mime-types",
          replacement: resolve(opencodeBrowserSrc, "shims/mime-types.browser.ts"),
        },
        {
          find: "diff",
          replacement: resolve(opencodeBrowserSrc, "shims/diff.browser.ts"),
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
          find: "minimatch",
          replacement: resolve(opencodeBrowserSrc, "shims/minimatch.browser.ts"),
        },
        {
          find: "@ai-sdk/gateway",
          replacement: resolve(opencodeBrowserSrc, "shims/ai-sdk-gateway.browser.ts"),
        },
        {
          find: "v8",
          replacement: resolve(opencodeBrowserSrc, "shims/v8.browser.ts"),
        },
        {
          find: "node:zlib",
          replacement: resolve(__dirname, "../../packages/almostnode/src/shims/zlib.ts"),
        },
        {
          find: "zlib",
          replacement: resolve(__dirname, "../../packages/almostnode/src/shims/zlib.ts"),
        },
        {
          find: "node:dns",
          replacement: resolve(__dirname, "../../packages/almostnode/src/shims/dns.ts"),
        },
        {
          find: "dns",
          replacement: resolve(__dirname, "../../packages/almostnode/src/shims/dns.ts"),
        },
        ]),
      ],
    },
    optimizeDeps: {
      noDiscovery: true,
      include: isTest ? [] : ["debug", "isomorphic-git", "process", "pako", "source-map-js", "sprintf-js", "style-to-js"],
      exclude: [
        "buffer",
        "brotli-wasm",
        "bun:sqlite",
        "convex",
        "@electric-sql/pglite",
        "@napi-rs/wasm-runtime",
        "monaco-editor",
        "net",
        "node:net",
        "opentui-spinner",
        "opentui-spinner/solid",
        "os",
        "node:os",
        "web-tree-sitter",
        "tree-sitter-bash",
        ...monacoVscodePackages,
      ],
      esbuildOptions: { target: "esnext" },
    },
    worker: {
      format: "es",
    },
    build: {
      target: "esnext",
      assetsInlineLimit: 0,
      commonjsOptions: {
        transformMixedEsModules: true,
      },
      rollupOptions: {
        plugins: [
          {
            name: "pglite-emscripten-fix",
            renderChunk(code: string) {
              if (code.includes("ENVIRONMENT_IS_NODE")) {
                return code.replace(
                  /ENVIRONMENT_IS_NODE\s*=\s*typeof process[^;]+;/g,
                  "ENVIRONMENT_IS_NODE=false;",
                );
              }
            },
          },
        ],
      },
      outDir: "dist-site",
    },
    assetsInclude: ["**/*.wasm", "**/*.vsix", "**/*.zip", "**/*.sigzip"],
  };
});
