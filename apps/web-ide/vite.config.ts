import { defineConfig } from 'vite';
import { resolve } from 'path';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import tailwindcss from '@tailwindcss/vite';
import { corsProxyPlugin } from './src/plugins/vite-plugin-cors-proxy';
import { workspaceTemplatesPlugin } from './src/plugins/vite-plugin-workspace-templates';

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
  '@codingame/monaco-vscode-sql-default-extension',
  '@codingame/monaco-vscode-textmate-service-override',
  '@codingame/monaco-vscode-theme-defaults-default-extension',
  '@codingame/monaco-vscode-theme-service-override',
  '@codingame/monaco-vscode-typescript-basics-default-extension',
  '@codingame/monaco-vscode-workbench-service-override',
];

const __dirname = new URL('.', import.meta.url).pathname;
const isTest = process.env.VITEST === 'true';

export default defineConfig({
  base: process.env.GITHUB_PAGES ? '/almostnode/' : '/',
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/e2e/**',
    ],
  },
  plugins: [
    corsProxyPlugin(),
    workspaceTemplatesPlugin({ templatesDir: resolve(__dirname, 'src/templates/content') }),
    ...(isTest ? [] : [
      tanstackStart({ spa: { enabled: true } }),
      react(),
      tailwindcss(),
      wasm(),
      {
        name: 'browser-shims',
        enforce: 'pre' as const,
        resolveId(source: string) {
          if (source === 'node:zlib' || source === 'zlib') {
            return resolve(__dirname, '../../packages/almostnode/src/shims/zlib.ts');
          }
          if (source === 'node:dns' || source === 'dns') {
            return resolve(__dirname, '../../packages/almostnode/src/shims/dns.ts');
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
        transform(code: string) {
          if (code.includes('ENVIRONMENT_IS_NODE')) {
            return code.replace(
              /ENVIRONMENT_IS_NODE\s*=\s*typeof process[^;]+;/g,
              'ENVIRONMENT_IS_NODE=false;'
            );
          }
        },
      },
    ]),
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
      allow: [
        resolve(__dirname, './'),
        resolve(__dirname, 'node_modules'),
        resolve(__dirname, '../../node_modules'),
        resolve(__dirname, '../../packages/almostnode/src'),
      ],
    },
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
    alias: isTest ? [] : [
      {
        find: 'almostnode/internal',
        replacement: resolve(__dirname, '../../packages/almostnode/src/internal.ts'),
      },
      {
        find: 'almostnode',
        replacement: resolve(__dirname, '../../packages/almostnode/src/index.ts'),
      },
      {
        find: /^@codingame\/monaco-vscode-api\/vscode\/src\/(.*)$/,
        replacement: resolve(__dirname, 'node_modules/@codingame/monaco-vscode-api/vscode/src/$1'),
      },
      {
        find: /^@codingame\/monaco-vscode-api\/vscode\/(.*)$/,
        replacement: resolve(__dirname, 'node_modules/@codingame/monaco-vscode-api/vscode/src/$1'),
      },
      {
        find: 'node:zlib',
        replacement: resolve(__dirname, '../../packages/almostnode/src/shims/zlib.ts'),
      },
      {
        find: 'zlib',
        replacement: resolve(__dirname, '../../packages/almostnode/src/shims/zlib.ts'),
      },
      {
        find: 'node:dns',
        replacement: resolve(__dirname, '../../packages/almostnode/src/shims/dns.ts'),
      },
      {
        find: 'dns',
        replacement: resolve(__dirname, '../../packages/almostnode/src/shims/dns.ts'),
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
    exclude: [
      'brotli-wasm',
      'convex',
      '@electric-sql/pglite',
      'monaco-editor',
      ...monacoVscodePackages,
    ],
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
      plugins: [
        {
          name: 'pglite-emscripten-fix',
          renderChunk(code: string) {
            if (code.includes('ENVIRONMENT_IS_NODE')) {
              return code.replace(
                /ENVIRONMENT_IS_NODE\s*=\s*typeof process[^;]+;/g,
                'ENVIRONMENT_IS_NODE=false;'
              );
            }
          },
        },
      ],
    },
    outDir: 'dist-site',
  },
  assetsInclude: ['**/*.wasm', '**/*.vsix', '**/*.zip', '**/*.sigzip'],
});
