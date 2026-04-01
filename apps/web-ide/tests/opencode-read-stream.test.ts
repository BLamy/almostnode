import { afterEach, describe, expect, it } from 'vitest';
import {
  attachWorkspaceBridge,
  detachWorkspaceBridge,
  setWorkspaceRoot,
} from '../../../vendor/opencode/packages/browser/src/shims/fs.browser';
import { createReadStream } from '../../../vendor/opencode/packages/browser/src/shims/fs-sync.browser';
import { createInterface } from '../../../vendor/opencode/packages/browser/src/shims/readline.browser';

describe('OpenCode browser read stream bridge', () => {
  afterEach(() => {
    detachWorkspaceBridge();
    setWorkspaceRoot('/workspace');
  });

  it('preserves file contents through the stream and readline shims', async () => {
    const filePath = '/project/src/App.tsx';
    const content = [
      'import { Button } from "./components/ui/button";',
      '',
      'export function App() {',
      '  return <Button>Hi</Button>;',
      '}',
    ].join('\n');
    const files = new Map<string, string>([[filePath, content]]);
    const directories = new Set<string>(['/', '/project', '/project/src']);

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
      writeFile(path, nextContent) {
        files.set(path, nextContent);
      },
      readdir() {
        return [];
      },
      stat(path) {
        if (files.has(path)) {
          const value = files.get(path) ?? '';
          return {
            isDirectory: () => false,
            isFile: () => true,
            mtime: new Date(),
            mtimeMs: Date.now(),
            size: value.length,
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
    setWorkspaceRoot('/project');

    const rl = createInterface({
      input: createReadStream(filePath),
      crlfDelay: Infinity,
    });
    const lines: string[] = [];

    for await (const line of rl) {
      lines.push(line);
    }

    expect(lines).toEqual(content.split('\n'));
  });
});
