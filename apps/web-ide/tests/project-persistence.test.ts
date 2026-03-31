import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import { createContainer } from 'almostnode';
import { diffSerializedFiles } from '../src/desktop/project-mirror';
import {
  PROJECT_ROOT,
  collectProjectFilesBase64,
  collectScopedFilesBase64,
  loadProjectFilesIntoVfs,
  replaceProjectFilesInVfs,
  replaceScopedFilesInVfs,
  shouldPersistProjectPath,
  type SerializedFile,
} from '../src/desktop/project-snapshot';

describe('desktop project persistence helpers', () => {
  it('collects a binary-safe project snapshot and skips host-managed directories', () => {
    const container = createContainer();
    const binaryPayload = new Uint8Array([0, 255, 16, 32, 64]);

    container.vfs.mkdirSync(`${PROJECT_ROOT}/src`, { recursive: true });
    container.vfs.mkdirSync(`${PROJECT_ROOT}/assets`, { recursive: true });
    container.vfs.mkdirSync(`${PROJECT_ROOT}/node_modules/pkg`, { recursive: true });
    container.vfs.mkdirSync(`${PROJECT_ROOT}/.git`, { recursive: true });
    container.vfs.writeFileSync(`${PROJECT_ROOT}/src/main.ts`, 'console.log("hi")\n');
    container.vfs.writeFileSync(`${PROJECT_ROOT}/assets/logo.bin`, binaryPayload);
    container.vfs.writeFileSync(`${PROJECT_ROOT}/node_modules/pkg/index.js`, 'ignore me\n');
    container.vfs.writeFileSync(`${PROJECT_ROOT}/.git/config`, 'ignore me too\n');

    const files = collectProjectFilesBase64(container.vfs);
    expect(files.map((file) => file.path)).toEqual([
      `${PROJECT_ROOT}/assets/logo.bin`,
      `${PROJECT_ROOT}/src/main.ts`,
    ]);

    const binaryFile = files.find((file) => file.path === `${PROJECT_ROOT}/assets/logo.bin`);
    expect(binaryFile).toBeDefined();
    expect(Buffer.from(binaryFile!.contentBase64, 'base64')).toEqual(Buffer.from(binaryPayload));

    expect(shouldPersistProjectPath(`${PROJECT_ROOT}/src/main.ts`)).toBe(true);
    expect(shouldPersistProjectPath(`${PROJECT_ROOT}/node_modules/pkg/index.js`)).toBe(false);
    expect(shouldPersistProjectPath(`${PROJECT_ROOT}/.git/config`)).toBe(false);
  });

  it('loads serialized project files back into the VFS', () => {
    const container = createContainer();
    const files: SerializedFile[] = [
      {
        path: `${PROJECT_ROOT}/src/main.ts`,
        contentBase64: Buffer.from('console.log("persisted")\n', 'utf8').toString('base64'),
      },
      {
        path: `${PROJECT_ROOT}/public/logo.bin`,
        contentBase64: Buffer.from([1, 2, 3, 4]).toString('base64'),
      },
    ];

    loadProjectFilesIntoVfs(container.vfs, files);

    expect(container.vfs.readFileSync(`${PROJECT_ROOT}/src/main.ts`, 'utf8')).toBe('console.log("persisted")\n');
    expect(Buffer.from(container.vfs.readFileSync(`${PROJECT_ROOT}/public/logo.bin`) as Uint8Array)).toEqual(
      Buffer.from([1, 2, 3, 4]),
    );
  });

  it('can include .git data in persisted project snapshots when requested', () => {
    const container = createContainer();
    container.vfs.mkdirSync(`${PROJECT_ROOT}/.git`, { recursive: true });
    container.vfs.writeFileSync(`${PROJECT_ROOT}/.git/config`, '[remote "origin"]\n');
    container.vfs.writeFileSync(`${PROJECT_ROOT}/README.md`, '# demo\n');

    const files = collectProjectFilesBase64(container.vfs, { includeGit: true });
    expect(files.map((file) => file.path)).toContain(`${PROJECT_ROOT}/.git/config`);

    const restored = createContainer();
    loadProjectFilesIntoVfs(restored.vfs, files, { includeGit: true });

    expect(restored.vfs.readFileSync(`${PROJECT_ROOT}/.git/config`, 'utf8')).toBe('[remote "origin"]\n');
    expect(restored.vfs.readFileSync(`${PROJECT_ROOT}/README.md`, 'utf8')).toBe('# demo\n');
  });

  it('replaces persisted project files in place while preserving host-managed directories', () => {
    const container = createContainer();
    container.vfs.mkdirSync(`${PROJECT_ROOT}/src`, { recursive: true });
    container.vfs.mkdirSync(`${PROJECT_ROOT}/node_modules/pkg`, { recursive: true });
    container.vfs.mkdirSync(`${PROJECT_ROOT}/.git`, { recursive: true });
    container.vfs.writeFileSync(`${PROJECT_ROOT}/src/old.ts`, 'old\n');
    container.vfs.writeFileSync(`${PROJECT_ROOT}/node_modules/pkg/index.js`, 'keep me\n');
    container.vfs.writeFileSync(`${PROJECT_ROOT}/.git/config`, 'keep me too\n');

    const files: SerializedFile[] = [
      {
        path: `${PROJECT_ROOT}/src/new.ts`,
        contentBase64: Buffer.from('new\n', 'utf8').toString('base64'),
      },
    ];

    replaceProjectFilesInVfs(container.vfs, files);

    expect(container.vfs.existsSync(`${PROJECT_ROOT}/src/old.ts`)).toBe(false);
    expect(container.vfs.readFileSync(`${PROJECT_ROOT}/src/new.ts`, 'utf8')).toBe('new\n');
    expect(container.vfs.readFileSync(`${PROJECT_ROOT}/node_modules/pkg/index.js`, 'utf8')).toBe('keep me\n');
    expect(container.vfs.readFileSync(`${PROJECT_ROOT}/.git/config`, 'utf8')).toBe('keep me too\n');
  });

  it('diffs persisted snapshots as writes and deletes while ignoring skipped paths', () => {
    const ops = diffSerializedFiles(
      [
        {
          path: `${PROJECT_ROOT}/src/old-name.ts`,
          contentBase64: Buffer.from('before', 'utf8').toString('base64'),
        },
        {
          path: `${PROJECT_ROOT}/.git/config`,
          contentBase64: Buffer.from('skip', 'utf8').toString('base64'),
        },
      ],
      [
        {
          path: `${PROJECT_ROOT}/src/new-name.ts`,
          contentBase64: Buffer.from('after', 'utf8').toString('base64'),
        },
        {
          path: `${PROJECT_ROOT}/node_modules/pkg/index.js`,
          contentBase64: Buffer.from('skip', 'utf8').toString('base64'),
        },
      ],
    );

    expect(ops).toEqual([
      {
        type: 'write',
        path: `${PROJECT_ROOT}/src/new-name.ts`,
        contentBase64: Buffer.from('after', 'utf8').toString('base64'),
      },
      {
        type: 'delete',
        path: `${PROJECT_ROOT}/src/old-name.ts`,
      },
    ]);
  });

  it('collects and restores scoped Claude project state without unrelated config files', () => {
    const container = createContainer();
    const claudeProjectsRoot = '/home/user/.claude/projects';
    const transcriptPath = `${claudeProjectsRoot}/demo/session.jsonl`;
    const configPath = '/home/user/.claude/.config.json';

    container.vfs.mkdirSync(`${claudeProjectsRoot}/demo`, { recursive: true });
    container.vfs.mkdirSync('/home/user/.claude', { recursive: true });
    container.vfs.writeFileSync(transcriptPath, '{"sessionId":"abc"}\n');
    container.vfs.writeFileSync(configPath, '{"token":"secret"}\n');

    const files = collectScopedFilesBase64(container.vfs, [claudeProjectsRoot]);
    expect(files).toEqual([
      {
        path: transcriptPath,
        contentBase64: Buffer.from('{"sessionId":"abc"}\n', 'utf8').toString('base64'),
      },
    ]);

    const restored = createContainer();
    replaceScopedFilesInVfs(restored.vfs, [claudeProjectsRoot], files);

    expect(restored.vfs.readFileSync(transcriptPath, 'utf8')).toBe('{"sessionId":"abc"}\n');
    expect(restored.vfs.existsSync(configPath)).toBe(false);
  });
});
