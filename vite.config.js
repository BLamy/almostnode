import { defineConfig } from 'vite';
import { resolve } from 'path';
import wasm from 'vite-plugin-wasm';

const monacoVscodePackages = [
  '@codingame/monaco-vscode-api',
  '@codingame/monaco-vscode-configuration-service-override',
  '@codingame/monaco-vscode-css-default-extension',
  '@codingame/monaco-vscode-extensions-service-override',
  '@codingame/monaco-vscode-files-service-override',
  '@codingame/monaco-vscode-html-default-extension',
  '@codingame/monaco-vscode-javascript-default-extension',
  '@codingame/monaco-vscode-json-default-extension',
  '@codingame/monaco-vscode-keybindings-service-override',
  '@codingame/monaco-vscode-languages-service-override',
  '@codingame/monaco-vscode-search-service-override',
  '@codingame/monaco-vscode-textmate-service-override',
  '@codingame/monaco-vscode-theme-defaults-default-extension',
  '@codingame/monaco-vscode-theme-service-override',
  '@codingame/monaco-vscode-typescript-basics-default-extension',
  '@codingame/monaco-vscode-workbench-service-override',
];

const isTest = process.env.VITEST === 'true';
export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/almostnode/' : '/',
  test: {
    // Exclude e2e tests - they should be run with `npm run test:e2e`
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
      '**/examples/**/e2e/**',
    ],
  },
  plugins: isTest ? [] : [
    wasm(),
    {
      name: 'browser-shims',
      enforce: 'pre',
      resolveId(source) {
        if (source === 'node:zlib' || source === 'zlib') {
          return resolve(__dirname, 'src/shims/zlib.ts');
        }
        if (source === 'node:dns' || source === 'dns') {
          return resolve(__dirname, 'src/shims/dns.ts');
        }
        if (source === 'brotli-wasm/pkg.web/brotli_wasm.js') {
          return resolve(__dirname, 'node_modules/brotli-wasm/pkg.web/brotli_wasm.js');
        }
        if (source === 'brotli-wasm/pkg.web/brotli_wasm_bg.wasm?url') {
          return {
            id: resolve(__dirname, 'node_modules/brotli-wasm/pkg.web/brotli_wasm_bg.wasm') + '?url',
            external: false,
          };
        }
        return null;
      },
    },
  ],
  define: isTest ? {} : {
    'process.env': {},
    global: 'globalThis',
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    fs: {
      allow: [resolve(__dirname, './'), resolve(__dirname, 'node_modules')],
    },
  },
  resolve: {
    alias: isTest ? [] : [
      {
        find: /^@codingame\/monaco-vscode-api\/vscode\/(.*)$/,
        replacement: resolve(__dirname, 'node_modules/@codingame/monaco-vscode-api/vscode/src/$1'),
      },
      {
        find: 'node:zlib',
        replacement: resolve(__dirname, 'src/shims/zlib.ts'),
      },
      {
        find: 'zlib',
        replacement: resolve(__dirname, 'src/shims/zlib.ts'),
      },
      {
        find: 'node:dns',
        replacement: resolve(__dirname, 'src/shims/dns.ts'),
      },
      {
        find: 'dns',
        replacement: resolve(__dirname, 'src/shims/dns.ts'),
      },
      {
        find: 'buffer',
        replacement: 'buffer',
      },
      {
        find: 'process',
        replacement: 'process/browser',
      },
    ],
  },
  optimizeDeps: {
    include: isTest ? [] : ['buffer', 'process', 'pako'],
    // Keep the Monaco VS Code stack out of dep prebundling so every package shares
    // the same singleton module instances, and relative assets like extension
    // `resources/*` and `external/vscode-oniguruma/release/onig.wasm` stay addressable.
    exclude: [
      'brotli-wasm',
      'convex',
      ...monacoVscodePackages,
    ],
    esbuildOptions: { target: 'esnext' },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        'examples/index': resolve(__dirname, 'examples/index.html'),
        'examples/next-demo': resolve(__dirname, 'examples/next-demo.html'),
        'examples/vite-demo': resolve(__dirname, 'examples/vite-demo.html'),
        'examples/express-demo': resolve(__dirname, 'examples/express-demo.html'),
        'examples/npm-scripts-demo': resolve(__dirname, 'examples/npm-scripts-demo.html'),
        'examples/shadcn-demo': resolve(__dirname, 'examples/shadcn-demo.html'),
        'examples/web-ide-demo': resolve(__dirname, 'examples/web-ide-demo.html'),
        'examples/vitest-demo': resolve(__dirname, 'examples/vitest-demo.html'),
        'examples/demo-convex-app': resolve(__dirname, 'examples/demo-convex-app.html'),
        'examples/demo-vercel-ai-sdk': resolve(__dirname, 'examples/demo-vercel-ai-sdk.html'),
        'docs/index': resolve(__dirname, 'docs/index.html'),
        'docs/core-concepts': resolve(__dirname, 'docs/core-concepts.html'),
        'docs/nextjs-guide': resolve(__dirname, 'docs/nextjs-guide.html'),
        'docs/vite-guide': resolve(__dirname, 'docs/vite-guide.html'),
        'docs/security': resolve(__dirname, 'docs/security.html'),
        'docs/api-reference': resolve(__dirname, 'docs/api-reference.html'),
        'docs/tutorial-editor': resolve(__dirname, 'docs/tutorial-editor.html'),
        'examples/editor-tutorial': resolve(__dirname, 'examples/editor-tutorial.html'),
        'examples/agent-workbench': resolve(__dirname, 'examples/agent-workbench.html'),
      },
    },
    outDir: 'dist-site',
  },
  assetsInclude: ['**/*.wasm', '**/*.vsix', '**/*.zip', '**/*.sigzip'],
});
