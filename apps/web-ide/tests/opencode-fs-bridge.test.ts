import { afterEach, describe, expect, it } from 'vitest';
import {
  attachWorkspaceBridge,
  detachWorkspaceBridge,
  readFile,
  withWorkspaceBridgeScope,
  writeFile,
} from '../../../vendor/opencode/packages/browser/src/shims/fs.browser';
import { globSync } from '../../../vendor/opencode/packages/browser/src/shims/glob.browser';

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

  it('restores the mounted /workspace bridge after a nested helper scope exits', async () => {
    const mountedFiles = new Map<string, string>([
      ['/workspace/package.json', '{"name":"mounted"}'],
    ]);
    const helperFiles = new Map<string, string>([
      ['/workspace/package.json', '{"name":"helper"}'],
    ]);
    const directories = new Set<string>(['/', '/workspace']);

    const createBridge = (files: Map<string, string>) => ({
      exists(path: string) {
        return files.has(path) || directories.has(path);
      },
      mkdir(path: string) {
        directories.add(path);
      },
      readFile(path: string) {
        return files.get(path);
      },
      writeFile(path: string, content: string) {
        files.set(path, content);
      },
      readdir() {
        return [];
      },
      stat(path: string) {
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

    attachWorkspaceBridge(createBridge(mountedFiles));

    await expect(readFile('/workspace/package.json', 'utf8')).resolves.toContain('"mounted"');

    await withWorkspaceBridgeScope(
      createBridge(helperFiles),
      async () => {
        await expect(readFile('/workspace/package.json', 'utf8')).resolves.toContain('"helper"');
      },
    );

    await expect(readFile('/workspace/package.json', 'utf8')).resolves.toContain('"mounted"');
  });

  it('exposes scoped workspace files to glob-based agent and skill discovery', async () => {
    const files = new Map<string, string>([
      ['/workspace/.claude/skills/planning/SKILL.md', '---\nname: planning\ndescription: test\n---\nbody\n'],
      ['/workspace/.opencode/agent/qa-tester.md', '---\ndescription: qa\n---\nprompt\n'],
    ]);
    const directories = new Set<string>([
      '/',
      '/workspace',
      '/workspace/.claude',
      '/workspace/.claude/skills',
      '/workspace/.claude/skills/planning',
      '/workspace/.opencode',
      '/workspace/.opencode/agent',
    ]);

    const bridge = {
      exists(path: string) {
        return files.has(path) || directories.has(path);
      },
      mkdir(path: string) {
        directories.add(path);
      },
      readFile(path: string) {
        return files.get(path);
      },
      writeFile(path: string, content: string) {
        files.set(path, content);
      },
      readdir(path: string) {
        const prefix = path === '/' ? '/' : `${path}/`;
        const entries = new Map<string, { name: string; isDirectory: boolean }>();

        for (const filePath of files.keys()) {
          if (!filePath.startsWith(prefix)) continue;
          const relative = filePath.slice(prefix.length);
          const name = relative.split('/')[0];
          if (!name) continue;
          entries.set(name, {
            name,
            isDirectory: relative.includes('/'),
          });
        }

        for (const dirPath of directories) {
          if (dirPath === path || !dirPath.startsWith(prefix)) continue;
          const relative = dirPath.slice(prefix.length);
          const name = relative.split('/')[0];
          if (!name) continue;
          entries.set(name, {
            name,
            isDirectory: true,
          });
        }

        return Array.from(entries.values()).map((entry) => ({
          name: entry.name,
          isDirectory: () => entry.isDirectory,
          isFile: () => !entry.isDirectory,
        }));
      },
      stat(path: string) {
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
      listFiles(root = '/workspace') {
        return Array.from(files.keys()).filter((filePath) =>
          filePath === root || filePath.startsWith(`${root}/`),
        );
      },
    };

    await withWorkspaceBridgeScope(bridge, async () => {
      expect(globSync('skills/**/SKILL.md', {
        cwd: '/workspace/.claude',
        absolute: true,
        dot: true,
      })).toContain('/workspace/.claude/skills/planning/SKILL.md');

      expect(globSync('{agent,agents}/**/*.md', {
        cwd: '/workspace/.opencode',
        absolute: true,
        dot: true,
      })).toContain('/workspace/.opencode/agent/qa-tester.md');
    });
  });
});
