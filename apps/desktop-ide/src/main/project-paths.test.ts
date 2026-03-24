import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROJECT_ROOT, resolveProjectOutputPath, shouldSkipDiskPath } from './project-paths';

describe('project paths', () => {
  it('resolves persisted project files under the managed workspace root', () => {
    const outputPath = resolveProjectOutputPath('/tmp/almostnode-projects', 'demo-project', `${PROJECT_ROOT}/src/main.ts`);
    expect(outputPath).toBe(path.resolve('/tmp/almostnode-projects', 'demo-project', 'src/main.ts'));
  });

  it('rejects traversal and unmanaged paths', () => {
    expect(() => resolveProjectOutputPath('/tmp/almostnode-projects', 'demo-project', '/other/path')).toThrow(
      `Path must reference a file under ${PROJECT_ROOT}`,
    );
    expect(() => resolveProjectOutputPath('/tmp/almostnode-projects', 'demo-project', `${PROJECT_ROOT}/../escape.txt`)).toThrow(
      'Path must reference a file under /project',
    );
    expect(() => resolveProjectOutputPath('/tmp/almostnode-projects', 'demo-project', `${PROJECT_ROOT}/.git/config`)).toThrow(
      'Invalid project file path',
    );
    expect(() => resolveProjectOutputPath('/tmp/almostnode-projects', 'demo-project', `${PROJECT_ROOT}/node_modules/pkg/index.js`)).toThrow(
      'Invalid project file path',
    );
  });

  it('marks host-only directories as skipped', () => {
    expect(shouldSkipDiskPath('.git/config')).toBe(true);
    expect(shouldSkipDiskPath('node_modules/pkg/index.js')).toBe(true);
    expect(shouldSkipDiskPath('src/main.ts')).toBe(false);
  });
});
