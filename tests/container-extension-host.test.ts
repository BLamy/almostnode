import { describe, expect, it } from 'vitest';
import { VirtualFS } from '../src/virtual-fs';
import { Runtime } from '../src/runtime';

describe('container extension host — Runtime integration', () => {
  it('registerBuiltinModule makes a module available via require()', () => {
    const vfs = new VirtualFS();
    const runtime = new Runtime(vfs);

    const fakeVscodeApi = { version: '1.90.0', commands: { registerCommand: () => {} } };
    runtime.registerBuiltinModule('vscode', fakeVscodeApi);

    vfs.writeFileSync('/test-ext.js', `
      const vscode = require('vscode');
      module.exports = { apiVersion: vscode.version };
    `);

    const result = runtime.loadModule('/test-ext.js');
    expect((result.exports as any).apiVersion).toBe('1.90.0');
  });

  it('loadModule reads from VFS and returns exports', () => {
    const vfs = new VirtualFS();
    const runtime = new Runtime(vfs);

    vfs.writeFileSync('/hello.js', `
      module.exports.greet = function() { return 'hello from container'; };
    `);

    const result = runtime.loadModule('/hello.js');
    expect((result.exports as any).greet()).toBe('hello from container');
  });

  it('loadModule handles ESM syntax in VFS files', () => {
    const vfs = new VirtualFS();
    const runtime = new Runtime(vfs);

    vfs.writeFileSync('/esm-ext.js', `
      export function activate() { return 'activated'; }
    `);

    const result = runtime.loadModule('/esm-ext.js');
    expect((result.exports as any).activate()).toBe('activated');
  });

  it('registerBuiltinModule overwrites previous registrations', () => {
    const vfs = new VirtualFS();
    const runtime = new Runtime(vfs);

    runtime.registerBuiltinModule('my-custom', { v: 1 });
    runtime.registerBuiltinModule('my-custom', { v: 2 });

    vfs.writeFileSync('/check.js', `
      const mod = require('my-custom');
      module.exports = { v: mod.v };
    `);

    const result = runtime.loadModule('/check.js');
    expect((result.exports as any).v).toBe(2);
  });
});
