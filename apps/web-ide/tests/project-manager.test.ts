import { Buffer } from 'node:buffer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createContainer } from 'almostnode';
import { ProjectManager } from '../src/features/project-manager';
import { PROJECT_ROOT, type SerializedFile } from '../src/desktop/project-snapshot';
import type {
  ProjectAgentStateRecord,
  ProjectRecord,
  ResumableThreadRecord,
} from '../src/features/project-db';

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

    const project: ProjectRecord = {
      id: 'project-next',
      name: 'Next project',
      templateId: 'nextjs' as const,
      createdAt: Date.now(),
      lastModified: Date.now(),
      dbPrefix: 'next-db',
    };

    const restoreAgentStateSnapshot = vi.fn(async () => undefined);
    const discoverActiveProjectThreads = vi.fn(async () => ({
      claude: [],
      opencode: [],
    }));

    Object.defineProperty(manager, 'db', {
      configurable: true,
      value: {
        listProjects: vi.fn(async () => [project]),
        getProjectFiles: vi.fn(async () => savedFiles),
        getProjectAgentState: vi.fn(async () => undefined),
        listResumableThreads: vi.fn(async () => []),
        replaceProjectResumableThreads: vi.fn(async () => undefined),
        listAllResumableThreads: vi.fn(async () => []),
      },
    });

    const attachProjectContext = vi.fn(async () => undefined);
    const switchProjectWorkspace = vi.fn(async () => undefined);

    manager.setHost({
      getVfs: () => container.vfs,
      getTemplateId: () => 'vite',
      attachProjectContext,
      switchProjectWorkspace,
      collectAgentStateSnapshot: vi.fn(async () => ({ claudeFiles: [], openCodeDb: null })),
      restoreAgentStateSnapshot,
      discoverActiveProjectThreads,
      resumeResumableThread: vi.fn(async () => undefined),
    });

    await manager.init();

    expect(switchProjectWorkspace).toHaveBeenCalledWith(
      'nextjs',
      savedFiles,
      'next-db',
    );
    expect(attachProjectContext).not.toHaveBeenCalled();
    expect(restoreAgentStateSnapshot).toHaveBeenCalledWith(null);
    expect(discoverActiveProjectThreads).toHaveBeenCalledWith('project-next');

    const url = new URL(window.location.href);
    expect(url.searchParams.get('project')).toBe('project-next');
    expect(url.searchParams.has('template')).toBe(false);

    manager.dispose();
  });

  it('switches projects before resuming a thread from another project', async () => {
    window.history.replaceState({}, '', 'http://localhost:5173/ide?project=project-a');

    const manager = new ProjectManager();
    const container = createContainer();
    container.vfs.mkdirSync(PROJECT_ROOT, { recursive: true });
    container.vfs.writeFileSync(
      `${PROJECT_ROOT}/package.json`,
      JSON.stringify({ name: 'project-a' }, null, 2),
    );

    const projectA: ProjectRecord = {
      id: 'project-a',
      name: 'Project A',
      templateId: 'vite',
      createdAt: 1,
      lastModified: 2,
      dbPrefix: 'db-a',
    };
    const projectB: ProjectRecord = {
      id: 'project-b',
      name: 'Project B',
      templateId: 'nextjs',
      createdAt: 3,
      lastModified: 4,
      dbPrefix: 'db-b',
    };
    const thread: ResumableThreadRecord = {
      id: 'claude:project-b:session-1',
      projectId: 'project-b',
      harness: 'claude',
      title: 'Resume me',
      resumeToken: 'session-1',
      createdAt: 10,
      updatedAt: 20,
    };

    const projectFiles = new Map<string, SerializedFile[]>([
      [
        'project-a',
        [{
          path: `${PROJECT_ROOT}/package.json`,
          contentBase64: Buffer.from(
            JSON.stringify({ name: 'project-a' }, null, 2),
            'utf8',
          ).toString('base64'),
        }],
      ],
      [
        'project-b',
        [{
          path: `${PROJECT_ROOT}/package.json`,
          contentBase64: Buffer.from(
            JSON.stringify({ name: 'project-b' }, null, 2),
            'utf8',
          ).toString('base64'),
        }],
      ],
    ]);
    const agentState = new Map<string, ProjectAgentStateRecord | undefined>();
    const events: string[] = [];

    Object.defineProperty(manager, 'db', {
      configurable: true,
      value: {
        listProjects: vi.fn(async () => [projectB, projectA]),
        getProject: vi.fn(async (id: string) => (
          id === 'project-a' ? projectA : id === 'project-b' ? projectB : undefined
        )),
        putProject: vi.fn(async () => undefined),
        getProjectFiles: vi.fn(async (id: string) => projectFiles.get(id) ?? []),
        saveProjectFiles: vi.fn(async () => undefined),
        getProjectAgentState: vi.fn(async (id: string) => agentState.get(id)),
        putProjectAgentState: vi.fn(async (record: ProjectAgentStateRecord) => {
          agentState.set(record.projectId, record);
        }),
        listResumableThreads: vi.fn(async () => []),
        listAllResumableThreads: vi.fn(async () => [thread]),
        replaceProjectResumableThreads: vi.fn(async () => undefined),
        getResumableThread: vi.fn(async (id: string) => (
          id === thread.id ? thread : undefined
        )),
      },
    });

    manager.setHost({
      getVfs: () => container.vfs,
      getTemplateId: () => 'vite',
      attachProjectContext: vi.fn(async () => undefined),
      switchProjectWorkspace: vi.fn(async (templateId) => {
        events.push(`switch:${templateId}`);
      }),
      collectAgentStateSnapshot: vi.fn(async () => ({ claudeFiles: [], openCodeDb: null })),
      restoreAgentStateSnapshot: vi.fn(async () => {
        events.push('restore-agent');
      }),
      discoverActiveProjectThreads: vi.fn(async () => ({ claude: [], opencode: [] })),
      resumeResumableThread: vi.fn(async () => {
        events.push('resume-thread');
      }),
    });

    await manager.init();
    events.length = 0;

    await manager.resumeThread(thread.id);

    expect(events).toEqual([
      'switch:nextjs',
      'restore-agent',
      'resume-thread',
    ]);

    manager.dispose();
  });
});
