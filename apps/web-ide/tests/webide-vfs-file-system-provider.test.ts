import { beforeEach, describe, expect, it } from 'vitest';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import { FileChangeType, FileType } from '@codingame/monaco-vscode-api/vscode/vs/platform/files/common/files';
import { VirtualFS } from 'almostnode';
import { VfsFileSystemProvider } from '../src/features/vfs-file-system-provider';

describe('VfsFileSystemProvider', () => {
  let vfs: VirtualFS;
  let provider: VfsFileSystemProvider;

  beforeEach(() => {
    vfs = new VirtualFS();
    vfs.mkdirSync('/project/src', { recursive: true });
    vfs.writeFileSync('/project/src/main.ts', 'export const value = 1;\n');
    provider = new VfsFileSystemProvider(vfs, '/project');
  });

  it('reads workspace stats, files, and directory entries', async () => {
    const stat = await provider.stat(URI.file('/project/src/main.ts'));
    const bytes = await provider.readFile(URI.file('/project/src/main.ts'));
    const entries = await provider.readdir(URI.file('/project/src'));

    expect(stat.size).toBeGreaterThan(0);
    expect(new TextDecoder().decode(bytes)).toContain('value = 1');
    expect(entries).toContainEqual(['main.ts', FileType.File]);
  });

  it('writes model saves back into VirtualFS', async () => {
    await provider.writeFile(
      URI.file('/project/src/main.ts'),
      new TextEncoder().encode('export const value = 2;\n'),
      { create: true, overwrite: true, unlock: false, atomic: false },
    );

    expect(vfs.readFileSync('/project/src/main.ts', 'utf8')).toContain('value = 2');
  });

  it('renames and deletes workspace entries', async () => {
    await provider.rename(
      URI.file('/project/src/main.ts'),
      URI.file('/project/src/theme.ts'),
      { overwrite: false },
    );

    expect(vfs.existsSync('/project/src/main.ts')).toBe(false);
    expect(vfs.readFileSync('/project/src/theme.ts', 'utf8')).toContain('value = 1');

    await provider.delete(URI.file('/project/src/theme.ts'), { recursive: false, useTrash: false, atomic: false });
    expect(vfs.existsSync('/project/src/theme.ts')).toBe(false);
  });

  it('emits change events for external VirtualFS updates', () => {
    const events: Array<{ type: FileChangeType; path: string }> = [];
    provider.onDidChangeFile((changes) => {
      for (const change of changes) {
        events.push({ type: change.type, path: change.resource.path });
      }
    });

    vfs.writeFileSync('/project/src/external.ts', 'export const external = true;\n');

    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: FileChangeType.ADDED,
          path: '/project/src/external.ts',
        }),
      ]),
    );
  });

  it('rejects URIs outside the workspace root', async () => {
    await expect(provider.readFile(URI.file('/outside.txt'))).rejects.toMatchObject({
      code: 'EntryNotFound',
    });
  });
});
