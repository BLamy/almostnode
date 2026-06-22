import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// dir -> the external deps to pass to tsup (its own @agent-wasm deps + react)
const PKGS = {
  'packages/almostnode-sdk': ['@agent-wasm/core'],
  'packages/keychain': ['@agent-wasm/core'],
  'packages/chat-core': [],
  'packages/code': ['@agent-wasm/chat-core'],
  'packages/almostnode-react': [
    '@agent-wasm/core', '@agent-wasm/sdk', '@agent-wasm/chat-core',
    'react', 'react-dom', 'tailwindcss', 'tailwindcss/utilities',
  ],
};

for (const [dir, externals] of Object.entries(PKGS)) {
  // tsconfig.build.json: tolerant declaration emit, deps via node_modules (no paths)
  const tcPath = resolve(root, dir, 'tsconfig.build.json');
  writeFileSync(tcPath, JSON.stringify({
    extends: './tsconfig.json',
    compilerOptions: {
      paths: {},
      skipLibCheck: true,
      declaration: true,
      emitDeclarationOnly: true,
      noEmitOnError: false,
      rootDir: './src',
      outDir: './dist',
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist', 'tests'],
  }, null, 2) + '\n');

  const pjPath = resolve(root, dir, 'package.json');
  const pj = JSON.parse(readFileSync(pjPath, 'utf8'));
  // entries from the existing exports' src targets
  const entries = [...new Set(
    Object.values(pj.exports || {})
      .map((v) => (typeof v === 'string' ? v : v.default || v.types))
      .filter((t) => t && t.startsWith('./src/'))
      .map((t) => t.replace(/^\.\//, '')),
  )];
  const extFlags = externals.map((e) => `--external ${e}`).join(' ');
  // JS via tsup (deps external) + types via tolerant tsc
  pj.scripts.build =
    `tsup ${entries.join(' ')} --format esm,cjs --clean ${extFlags} ` +
    `&& tsc -p tsconfig.build.json`;
  writeFileSync(pjPath, JSON.stringify(pj, null, 2) + '\n');
  console.log(`configured ${pj.name}: entries=[${entries.join(', ')}] externals=[${externals.join(', ')}]`);
}
