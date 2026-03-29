import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createContainer } from 'almostnode';
import { ProjectManager } from '../src/features/project-manager';
import { PROJECT_ROOT, type SerializedFile } from '../src/desktop/project-snapshot';

describe('ProjectManager init', () => {
  beforeEach(() => {
    const dom = new JSDOM('<!doctype html><html><body></body></html>', {
      url: 'http://localhost:5173/ide?template=vite&project=project-next',
    });

    Object.assign(globalThis, {
      window: dom.window,
      document: dom.window.document,
      localStorage: dom.window.localStorage,
      history: dom.window.history,
    });
  });

  it('restores the selected project workspace and removes the template query param', async () => {
    const manager = new ProjectManager();
    const container = createContainer();
    container.vfs.mkdirSync(PROJECT_ROOT, { recursive: true });
    container.vfs.writeFileSync(
      `${PROJECT_ROOT}/package.json`,
      JSON.stringify({ name: 'vite-current' }, null, 2),
    );

    const savedFiles: SerializedFile[] = [
      {
        path: `${PROJECT_ROOT}/package.json`,
        contentBase64: Buffer.from(
          JSON.stringify({ name: 'next-restored' }, null, 2),
          'utf8',
        ).toString('base64'),
      },
    ];

    const project = {
      id: 'project-next',
      name: 'Next project',
      templateId: 'nextjs' as const,
      createdAt: Date.now(),
      lastModified: Date.now(),
      dbPrefix: 'next-db',
    };

    Object.defineProperty(manager, 'db', {
      configurable: true,
      value: {
        listProjects: vi.fn(async () => [project]),
        getProjectFiles: vi.fn(async () => savedFiles),
        listChatThreads: vi.fn(async () => []),
      },
    });

    const attachProjectContext = vi.fn(async () => undefined);
    const switchProjectWorkspace = vi.fn(async () => undefined);

    manager.setHost({
      getVfs: () => container.vfs,
      getTemplateId: () => 'vite',
      attachProjectContext,
      switchProjectWorkspace,
    });

    await manager.init();

    expect(switchProjectWorkspace).toHaveBeenCalledWith(
      'nextjs',
      savedFiles,
      'next-db',
    );
    expect(attachProjectContext).not.toHaveBeenCalled();

    const url = new URL(window.location.href);
    expect(url.searchParams.get('project')).toBe('project-next');
    expect(url.searchParams.has('template')).toBe(false);

    manager.dispose();
  });
});
