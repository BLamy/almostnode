import { defineConfig } from 'vite';
import { resolve } from 'path';
import wasm from 'vite-plugin-wasm';
import { resolvePreferredPnpmPackagePath } from '../../scripts/resolve-pnpm-package-path.mjs';

const __dirname = new URL('.', import.meta.url).pathname;
const workspaceRoot = resolve(__dirname, '../..');
const napiWasmRuntimePath = resolvePreferredPnpmPackagePath(
  workspaceRoot,
  '@napi-rs/wasm-runtime',
  '1.1.',
);

export default defineConfig({
  plugins: [
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
  define: {
    'process.env': {},
    global: 'globalThis',
  },
  server: {
    headers: {
      'Cross-Origin-Embedder-Policy': 'credentialless',
      'Cross-Origin-Opener-Policy': 'same-origin',
    },
    fs: {
      allow: [resolve(__dirname, './'), resolve(__dirname, 'node_modules'), resolve(__dirname, '../../node_modules')],
    },
  },
  resolve: {
    alias: [
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
        find: /^@napi-rs\/wasm-runtime$/,
        replacement: napiWasmRuntimePath,
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
    include: ['buffer', 'process', 'pako'],
    exclude: ['@napi-rs/wasm-runtime', 'brotli-wasm', 'convex'],
    esbuildOptions: { target: 'esnext' },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'esnext',
    assetsInlineLimit: 0,
    commonjsOptions: {
      transformMixedEsModules: true,
    },
    rollupOptions: {
      input: {
        'examples/index': resolve(__dirname, 'examples/index.html'),
        'examples/next-demo': resolve(__dirname, 'examples/next-demo.html'),
        'examples/vite-demo': resolve(__dirname, 'examples/vite-demo.html'),
        'examples/express-demo': resolve(__dirname, 'examples/express-demo.html'),
        'examples/npm-scripts-demo': resolve(__dirname, 'examples/npm-scripts-demo.html'),
        'examples/shadcn-demo': resolve(__dirname, 'examples/shadcn-demo.html'),
        'examples/vitest-demo': resolve(__dirname, 'examples/vitest-demo.html'),
        'examples/demo-convex-app': resolve(__dirname, 'examples/demo-convex-app.html'),
        'examples/demo-vercel-ai-sdk': resolve(__dirname, 'examples/demo-vercel-ai-sdk.html'),
        'examples/editor-tutorial': resolve(__dirname, 'examples/editor-tutorial.html'),
        'examples/agent-workbench': resolve(__dirname, 'examples/agent-workbench.html'),
        'docs/index': resolve(__dirname, 'docs/index.html'),
        'docs/core-concepts': resolve(__dirname, 'docs/core-concepts.html'),
        'docs/nextjs-guide': resolve(__dirname, 'docs/nextjs-guide.html'),
        'docs/vite-guide': resolve(__dirname, 'docs/vite-guide.html'),
        'docs/security': resolve(__dirname, 'docs/security.html'),
        'docs/api-reference': resolve(__dirname, 'docs/api-reference.html'),
        'docs/tutorial-editor': resolve(__dirname, 'docs/tutorial-editor.html'),
      },
    },
    outDir: 'dist-site',
  },
  assetsInclude: ['**/*.wasm', '**/*.vsix', '**/*.zip', '**/*.sigzip'],
});
