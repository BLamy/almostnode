import { describe, expect, it } from 'vitest';
import { ModuleResolver } from '../src/module-resolution';

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
});
