#!/usr/bin/env node
// Make the @agent-wasm/* packages publish-ready WITHOUT changing in-repo
// resolution (main/exports stay pointed at src, so the web-ide demo keeps
// resolving to source). publishConfig overrides main/types/exports to dist at
// `pnpm publish` time, and a tsup `build` emits that dist.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// Packages whose in-repo entry is TS source (need a tsup dist build for publish).
const SRC_PACKAGES = [
  'packages/almostnode-sdk',
  'packages/almostnode-react',
  'packages/keychain',
  'packages/chat-core',
  'packages/code',
];

const REPO = {
  type: 'git',
  url: 'git+https://github.com/BLamy/agent-wasm.git',
};

// Map a "./src/x/index.ts" or "./src/x.ts" export target to a dist subpath base
// (e.g. "x/index" or "x"), preserving the structure tsup emits under dist/.
function distBase(srcTarget) {
  return srcTarget.replace(/^\.\/src\//, '').replace(/\.tsx?$/, '');
}

function toDistExports(srcExports) {
  const out = {};
  for (const [key, val] of Object.entries(srcExports)) {
    const srcTarget = typeof val === 'string' ? val : val.default || val.types;
    if (!srcTarget || !srcTarget.startsWith('./src/')) {
      out[key] = val;
      continue;
    }
    const base = distBase(srcTarget);
    out[key] = {
      types: `./dist/${base}.d.ts`,
      import: `./dist/${base}.js`,
      require: `./dist/${base}.cjs`,
      default: `./dist/${base}.js`,
    };
  }
  return out;
}

// tsup entry list = every exported src target (so each subpath gets a dist file).
function tsupEntries(srcExports) {
  const entries = new Set();
  for (const val of Object.values(srcExports)) {
    const srcTarget = typeof val === 'string' ? val : val.default || val.types;
    if (srcTarget && srcTarget.startsWith('./src/')) {
      entries.add(srcTarget.replace(/^\.\//, ''));
    }
  }
  return [...entries];
}

for (const dir of SRC_PACKAGES) {
  const pjPath = resolve(root, dir, 'package.json');
  const pj = JSON.parse(readFileSync(pjPath, 'utf8'));
  const srcExports = pj.exports || { '.': { types: './src/index.ts', default: './src/index.ts' } };

  pj.private = false;
  pj.license = pj.license || 'MIT';
  pj.repository = pj.repository || REPO;
  pj.sideEffects = pj.sideEffects ?? false;
  pj.files = ['dist', 'src', 'README.md'];

  pj.publishConfig = {
    access: 'public',
    main: './dist/index.cjs',
    module: './dist/index.js',
    types: './dist/index.d.ts',
    exports: toDistExports(srcExports),
  };

  const entries = tsupEntries(srcExports);
  pj.scripts = pj.scripts || {};
  pj.scripts.build = `tsup ${entries.join(' ')} --format esm,cjs --dts --clean --external @agent-wasm/core --external @agent-wasm/sdk --external @agent-wasm/chat-core --external react --external react-dom`;
  pj.scripts['prepublishOnly'] = 'npm run build';

  pj.devDependencies = pj.devDependencies || {};
  pj.devDependencies.tsup = pj.devDependencies.tsup || '^8.5.0';

  writeFileSync(pjPath, JSON.stringify(pj, null, 2) + '\n');
  console.log(`publish-prepped ${pj.name}: entries=[${entries.join(', ')}]`);
}

// @agent-wasm/core already has a real dual build + dist exports — just mark it
// publishable as a scoped package.
const corePath = resolve(root, 'packages/almostnode/package.json');
const core = JSON.parse(readFileSync(corePath, 'utf8'));
core.publishConfig = { ...(core.publishConfig || {}), access: 'public' };
core.private = false;
writeFileSync(corePath, JSON.stringify(core, null, 2) + '\n');
console.log(`publish-prepped ${core.name} (access: public)`);

// @agent-wasm/codex ships prebuilt wasm + TS worker entries; mark publishable.
const codexPath = resolve(root, 'packages/codex-wasm/package.json');
const codex = JSON.parse(readFileSync(codexPath, 'utf8'));
codex.private = false;
codex.publishConfig = { ...(codex.publishConfig || {}), access: 'public' };
writeFileSync(codexPath, JSON.stringify(codex, null, 2) + '\n');
console.log(`publish-prepped ${codex.name} (access: public; wasm build is separate)`);
