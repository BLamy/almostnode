import { describe, expect, it } from 'vitest';
import { ModuleResolver } from '../src/module-resolution';
import { VirtualFS } from '../src/virtual-fs';

const fakeVfs = {
  existsSync: () => true,
  readFileSync: () => '',
  statSync: () => ({ isFile: () => true }),
} as any;

describe('ModuleResolver.detectFormat', () => {
  it('routes Rollup subpath imports to the Rollup builtin shim', () => {
    const resolver = new ModuleResolver(new VirtualFS(), {
      builtinModules: { rollup: {} },
    });

    expect(resolver.resolve('rollup/parseAst', '/project/src').format).toBe('builtin');
    expect(resolver.resolve('rollup/parseAst', '/project/src').builtinId).toBe('rollup');
    expect(resolver.resolve('@rollup/rollup-linux-x64-gnu', '/project/src').builtinId).toBe('rollup');
  });

  it('does not treat import.meta inside string literals as ESM syntax', () => {
    const resolver = new ModuleResolver(fakeVfs);
    const code = `
      "use strict";
      const message = "The import.meta meta-property is only allowed when the module option is es2020.";
      module.exports = { message };
    `;

    expect(resolver.detectFormat('/node_modules/@ts-morph/common/dist/typescript.js', code)).toBe('cjs');
  });

  it('treats real import.meta usage as ESM syntax', () => {
    const resolver = new ModuleResolver(fakeVfs);
    const code = `
      const currentUrl = import.meta.url;
      console.log(currentUrl);
    `;

    expect(resolver.detectFormat('/project/meta-only.js', code)).toBe('esm');
  });

  it('treats transformed CommonJS in type module packages as CJS', () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/node_modules/string-width', { recursive: true });
    vfs.writeFileSync('/node_modules/string-width/package.json', JSON.stringify({
      name: 'string-width',
      type: 'module',
      exports: {
        default: './index.js',
      },
    }));
    vfs.writeFileSync(
      '/node_modules/string-width/index.js',
      `
        "use strict";
        var stripAnsi = require("strip-ansi");
        module.exports = { stripAnsi };
      `
    );

    const resolver = new ModuleResolver(vfs);

    expect(resolver.detectFormat('/node_modules/string-width/index.js')).toBe('cjs');
  });

  it('treats shebang ESM bin files in type module packages as ESM', () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/node_modules/@anthropic-ai/claude-code', { recursive: true });
    vfs.writeFileSync('/node_modules/@anthropic-ai/claude-code/package.json', JSON.stringify({
      name: '@anthropic-ai/claude-code',
      type: 'module',
      bin: {
        claude: './cli.js',
      },
    }));
    vfs.writeFileSync(
      '/node_modules/@anthropic-ai/claude-code/cli.js',
      [
        '#!/usr/bin/env node',
        'import { createRequire } from "node:module";',
        'const require = createRequire(import.meta.url);',
        'export default require;',
      ].join('\n'),
    );

    const resolver = new ModuleResolver(vfs);

    expect(resolver.detectFormat('/node_modules/@anthropic-ai/claude-code/cli.js')).toBe('esm');
  });

  // acorn can't parse TS type syntax, so a typed `.ts` file throws during
  // detection. It must still route to ESM (where it gets transpiled) rather than
  // fall back to CJS raw-eval — otherwise an electron-vite TS main never runs.
  it('detects a typed .ts file with imports as ESM (acorn cannot parse it)', () => {
    const resolver = new ModuleResolver(fakeVfs);
    const code = [
      "import { app, BrowserWindow } from 'electron'",
      'const make = (): void => { const w: BrowserWindow = new BrowserWindow({}) }',
      'app.whenReady().then(make)',
    ].join('\n');
    expect(resolver.detectFormat('/project/src/main/index.ts', code)).toBe('esm');
  });

  it('detects a typed .tsx file with imports as ESM', () => {
    const resolver = new ModuleResolver(fakeVfs);
    const code = "import React from 'react'\nexport const A = (): JSX.Element => <div/>";
    expect(resolver.detectFormat('/project/App.tsx', code)).toBe('esm');
  });

  it('detects a require-based typed .ts file (no import/export) as CJS', () => {
    const resolver = new ModuleResolver(fakeVfs);
    const code = "const x: number = require('electron').app\nmodule.exports = x";
    expect(resolver.detectFormat('/project/legacy.ts', code)).toBe('cjs');
  });

  it('treats .mts as ESM and .cts as CJS by extension', () => {
    const resolver = new ModuleResolver(fakeVfs);
    expect(resolver.detectFormat('/project/main.mts', 'const x: number = 1')).toBe('esm');
    expect(resolver.detectFormat('/project/main.cts', 'const x: number = 1')).toBe('cjs');
  });
});
