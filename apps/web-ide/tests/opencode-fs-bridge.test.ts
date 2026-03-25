import { afterEach, describe, expect, it } from 'vitest';
import {
  attachWorkspaceBridge,
  detachWorkspaceBridge,
  readFile,
  writeFile,
} from '../../../vendor/opencode/packages/browser/src/shims/fs.browser';

describe('OpenCode browser filesystem bridge', () => {
  afterEach(() => {
    detachWorkspaceBridge();
  });

  it('routes /opencode auth files through the external bridge', async () => {
    const files = new Map<string, string>();
    const directories = new Set<string>([
      '/',
      '/opencode',
      '/opencode/data',
      '/opencode/data/opencode',
    ]);

    attachWorkspaceBridge({
      exists(path) {
        return files.has(path) || directories.has(path);
      },
      mkdir(path) {
        directories.add(path);
      },
      readFile(path) {
        return files.get(path);
      },
      writeFile(path, content) {
        const parent = path.slice(0, path.lastIndexOf('/')) || '/';
        directories.add(parent);
        files.set(path, content);
      },
      readdir() {
        return [];
      },
      stat(path) {
        if (files.has(path)) {
          const content = files.get(path) ?? '';
          return {
            isDirectory: () => false,
            isFile: () => true,
            mtime: new Date(),
            mtimeMs: Date.now(),
            size: content.length,
          };
        }

        if (directories.has(path)) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            mtime: new Date(),
            mtimeMs: Date.now(),
            size: 0,
          };
        }

        return undefined;
      },
    });

    const authPath = '/opencode/data/opencode/auth.json';
    await writeFile(authPath, '{"openai":{"type":"api","key":"sk-test"}}');

    expect(files.get(authPath)).toContain('sk-test');
    await expect(readFile(authPath, 'utf8')).resolves.toContain('sk-test');
  });
});
