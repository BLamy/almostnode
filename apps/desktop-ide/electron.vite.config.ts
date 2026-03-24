import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { workspaceTemplatesPlugin } from '../web-ide/src/plugins/vite-plugin-workspace-templates';

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

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/main',
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist/preload',
      rollupOptions: {
        output: {
          format: 'cjs',
        },
      },
    },
  },
  renderer: {
    publicDir: resolve(__dirname, '../web-ide/public'),
    resolve: {
      dedupe: ['react', 'react-dom'],
      alias: [
        {
          find: '@webide',
          replacement: resolve(__dirname, '../web-ide/src'),
        },
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
          replacement: resolve(__dirname, '../../node_modules/@codingame/monaco-vscode-api/vscode/src/$1'),
        },
        {
          find: /^@codingame\/monaco-vscode-api\/vscode\/(.*)$/,
          replacement: resolve(__dirname, '../../node_modules/@codingame/monaco-vscode-api/vscode/src/$1'),
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
    plugins: [
      workspaceTemplatesPlugin({ templatesDir: resolve(__dirname, '../web-ide/src/templates/content') }),
      react(),
      wasm(),
    ],
    define: {
      'process.env': {},
      'process.type': JSON.stringify('renderer'),
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
          resolve(__dirname, '../web-ide'),
          resolve(__dirname, '../../packages/almostnode/src'),
          resolve(__dirname, '../../node_modules'),
        ],
      },
    },
    optimizeDeps: {
      include: ['buffer', 'process', 'pako'],
      exclude: [
        'brotli-wasm',
        'convex',
        '@electric-sql/pglite',
        'monaco-editor',
        ...monacoVscodePackages,
      ],
      esbuildOptions: {
        target: 'esnext',
      },
    },
    worker: {
      format: 'es',
    },
    build: {
      outDir: 'dist/renderer',
      target: 'esnext',
      assetsInlineLimit: 0,
      commonjsOptions: {
        transformMixedEsModules: true,
      },
    },
    assetsInclude: ['**/*.wasm', '**/*.vsix', '**/*.zip', '**/*.sigzip'],
  },
});
