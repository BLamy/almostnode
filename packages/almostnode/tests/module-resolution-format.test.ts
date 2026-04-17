import { describe, expect, it } from 'vitest';
import { ModuleResolver } from '../src/module-resolution';
import { VirtualFS } from '../src/virtual-fs';

const fakeVfs = {
  existsSync: () => true,
  readFileSync: () => '',
  statSync: () => ({ isFile: () => true }),
} as any;

describe('ModuleResolver.detectFormat', () => {
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
});
