import { Buffer } from 'node:buffer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createContainer } from 'almostnode';
import { ProjectManager } from '../src/features/project-manager';
import { PROJECT_ROOT, type SerializedFile } from '../src/desktop/project-snapshot';
import type {
  ProjectAgentStateRecord,
  ProjectRecord,
  ResumableThreadRecord,
} from '../src/features/project-db';
import {
  attachWorkspaceBridge,
  detachWorkspaceBridge,
  readFile,
  withWorkspaceBridgeScope,
} from '../../../vendor/opencode/packages/browser/src/shims/fs.browser';

vi.mock('../src/features/workspace-seed', () => ({
  isTemplateId: (value: string) => ['vite', 'nextjs', 'tanstack'].includes(value),
}));

describe('ProjectManager init', () => {
  afterEach(() => {
    detachWorkspaceBridge();
    vi.restoreAllMocks();
  });

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
    const syncProjectGit = vi.fn(async () => undefined);

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
      hasGitHubCredentials: () => false,
      createGitHubRemote: vi.fn(async () => {
        throw new Error('unexpected');
      }),
      syncProjectGit,
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
      'next-project',
    );
    expect(attachProjectContext).not.toHaveBeenCalled();
    expect(syncProjectGit).toHaveBeenCalledWith(project);
    expect(restoreAgentStateSnapshot).toHaveBeenCalledWith(null);
    expect(discoverActiveProjectThreads).toHaveBeenCalledWith('project-next');

    const url = new URL(window.location.href);
    expect(url.searchParams.get('project')).toBe('project-next');
    expect(url.searchParams.has('template')).toBe(false);

    manager.dispose();
  });

  it('creates a new project from template and name query params before restoring saved projects', async () => {
    window.history.replaceState({}, '', 'http://localhost:5173/ide?template=nextjs&name=reponame');

    const randomUuidSpy = vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('project-created');
    const manager = new ProjectManager();
    const container = createContainer();
    container.vfs.mkdirSync(PROJECT_ROOT, { recursive: true });
    container.vfs.writeFileSync(
      `${PROJECT_ROOT}/package.json`,
      JSON.stringify({ name: 'fresh-next-project' }, null, 2),
    );

    const existingProject: ProjectRecord = {
      id: 'project-existing',
      name: 'Existing project',
      templateId: 'vite',
      createdAt: Date.now() - 10_000,
      lastModified: Date.now() - 10_000,
      dbPrefix: 'existing',
    };

    const projects = new Map<string, ProjectRecord>([
      [existingProject.id, existingProject],
    ]);
    const filesByProject = new Map<string, SerializedFile[]>();
    const agentStateByProject = new Map<string, ProjectAgentStateRecord>();

    Object.defineProperty(manager, 'db', {
      configurable: true,
      value: {
        listProjects: vi.fn(async () => Array.from(projects.values())),
        putProject: vi.fn(async (project: ProjectRecord) => {
          projects.set(project.id, project);
        }),
        getProjectFiles: vi.fn(async (projectId: string) => filesByProject.get(projectId) ?? []),
        saveProjectFiles: vi.fn(async (projectId: string, files: SerializedFile[]) => {
          filesByProject.set(projectId, files);
        }),
        getProjectAgentState: vi.fn(async (projectId: string) => agentStateByProject.get(projectId)),
        putProjectAgentState: vi.fn(async (state: ProjectAgentStateRecord) => {
          agentStateByProject.set(state.projectId, state);
        }),
        listResumableThreads: vi.fn(async () => []),
        replaceProjectResumableThreads: vi.fn(async () => undefined),
        listAllResumableThreads: vi.fn(async () => []),
      },
    });

    const attachProjectContext = vi.fn(async () => undefined);
    const switchProjectWorkspace = vi.fn(async () => undefined);
    const collectAgentStateSnapshot = vi.fn(async () => ({
      claudeFiles: [],
      openCodeDb: null,
    }));
    const restoreAgentStateSnapshot = vi.fn(async () => undefined);
    const syncProjectGit = vi.fn(async () => undefined);
    const discoverActiveProjectThreads = vi.fn(async () => ({
      claude: [],
      opencode: [],
    }));

    manager.setHost({
      getVfs: () => container.vfs,
      getTemplateId: () => 'nextjs',
      hasGitHubCredentials: () => false,
      createGitHubRemote: vi.fn(async () => {
        throw new Error('unexpected');
      }),
      syncProjectGit,
      attachProjectContext,
      switchProjectWorkspace,
      collectAgentStateSnapshot,
      restoreAgentStateSnapshot,
      discoverActiveProjectThreads,
      resumeResumableThread: vi.fn(async () => undefined),
    });

    await manager.init();

    const createdProject = projects.get('project-created');
    expect(randomUuidSpy).toHaveBeenCalled();
    expect(createdProject).toEqual(expect.objectContaining({
      id: 'project-created',
      name: 'reponame',
      templateId: 'nextjs',
      dbPrefix: 'project-',
      defaultDatabaseName: 'reponame',
    }));
    expect(filesByProject.get('project-created')).toEqual([
      {
        path: `${PROJECT_ROOT}/package.json`,
        contentBase64: Buffer.from(
          JSON.stringify({ name: 'fresh-next-project' }, null, 2),
          'utf8',
        ).toString('base64'),
      },
    ]);
    expect(collectAgentStateSnapshot).toHaveBeenCalled();
    expect(switchProjectWorkspace).not.toHaveBeenCalled();
    expect(attachProjectContext).toHaveBeenCalledWith(
      'nextjs',
      'project-',
      'reponame',
    );
    expect(syncProjectGit).toHaveBeenCalledWith(createdProject);
    expect(restoreAgentStateSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-created',
        claudeFiles: [],
        openCodeDb: null,
      }),
    );
    expect(discoverActiveProjectThreads).toHaveBeenCalledWith('project-created');

    const url = new URL(window.location.href);
    expect(url.searchParams.get('project')).toBe('project-created');
    expect(url.searchParams.has('template')).toBe(false);
    expect(url.searchParams.has('name')).toBe(false);

    manager.dispose();
  });

  it('generates a container-style project name when template creation omits one', async () => {
    window.history.replaceState({}, '', 'http://localhost:5173/ide?template=vite');

    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('project-random');
    const manager = new ProjectManager();
    const container = createContainer();
    container.vfs.mkdirSync(PROJECT_ROOT, { recursive: true });
    container.vfs.writeFileSync(`${PROJECT_ROOT}/README.md`, '# demo\n');

    const projects = new Map<string, ProjectRecord>();
    const filesByProject = new Map<string, SerializedFile[]>();
    const agentStateByProject = new Map<string, ProjectAgentStateRecord>();

    Object.defineProperty(manager, 'db', {
      configurable: true,
      value: {
        listProjects: vi.fn(async () => Array.from(projects.values())),
        putProject: vi.fn(async (project: ProjectRecord) => {
          projects.set(project.id, project);
        }),
        getProjectFiles: vi.fn(async (projectId: string) => filesByProject.get(projectId) ?? []),
        saveProjectFiles: vi.fn(async (projectId: string, files: SerializedFile[]) => {
          filesByProject.set(projectId, files);
        }),
        getProjectAgentState: vi.fn(async (projectId: string) => agentStateByProject.get(projectId)),
        putProjectAgentState: vi.fn(async (state: ProjectAgentStateRecord) => {
          agentStateByProject.set(state.projectId, state);
        }),
        listResumableThreads: vi.fn(async () => []),
        replaceProjectResumableThreads: vi.fn(async () => undefined),
        listAllResumableThreads: vi.fn(async () => []),
      },
    });

    manager.setHost({
      getVfs: () => container.vfs,
      getTemplateId: () => 'vite',
      hasGitHubCredentials: () => false,
      createGitHubRemote: vi.fn(async () => {
        throw new Error('unexpected');
      }),
      syncProjectGit: vi.fn(async () => undefined),
      attachProjectContext: vi.fn(async () => undefined),
      switchProjectWorkspace: vi.fn(async () => undefined),
      collectAgentStateSnapshot: vi.fn(async () => ({ claudeFiles: [], openCodeDb: null })),
      restoreAgentStateSnapshot: vi.fn(async () => undefined),
      discoverActiveProjectThreads: vi.fn(async () => ({ claude: [], opencode: [] })),
      resumeResumableThread: vi.fn(async () => undefined),
    });

    await manager.init();

    expect(projects.get('project-random')?.name).toMatch(/^[a-z0-9]+-[a-z0-9]+$/);

    manager.dispose();
  });

  it('allows the IDE to remain empty when no saved projects exist', async () => {
    window.history.replaceState({}, '', 'http://localhost:5173/ide');

    const manager = new ProjectManager();
    const container = createContainer();
    const teardownActiveProject = vi.fn(async () => undefined);
    const attachProjectContext = vi.fn(async () => undefined);
    const switchProjectWorkspace = vi.fn(async () => undefined);
    const syncProjectGit = vi.fn(async () => undefined);
    const discoverActiveProjectThreads = vi.fn(async () => ({ claude: [], opencode: [] }));

    Object.defineProperty(manager, 'db', {
      configurable: true,
      value: {
        listProjects: vi.fn(async () => []),
        listAllResumableThreads: vi.fn(async () => []),
      },
    });

    manager.setCallbacks({
      onProjectsChanged: vi.fn(),
      onActiveProjectChanged: vi.fn(),
      onResumableThreadsChanged: vi.fn(),
      onSwitchingStateChanged: vi.fn(),
    });

    manager.setHost({
      getVfs: () => container.vfs,
      getTemplateId: () => 'vite',
      hasGitHubCredentials: () => false,
      createGitHubRemote: vi.fn(async () => {
        throw new Error('unexpected');
      }),
      syncProjectGit,
      attachProjectContext,
      switchProjectWorkspace,
      collectAgentStateSnapshot: vi.fn(async () => ({ claudeFiles: [], openCodeDb: null })),
      restoreAgentStateSnapshot: vi.fn(async () => undefined),
      teardownActiveProject,
      discoverActiveProjectThreads,
      resumeResumableThread: vi.fn(async () => undefined),
    });

    await manager.init();

    expect(manager.getActiveProjectId()).toBeNull();
    expect(teardownActiveProject).toHaveBeenCalled();
    expect(attachProjectContext).not.toHaveBeenCalled();
    expect(switchProjectWorkspace).not.toHaveBeenCalled();
    expect(syncProjectGit).not.toHaveBeenCalled();
    expect(discoverActiveProjectThreads).not.toHaveBeenCalled();
    expect(localStorage.getItem('almostnode-active-project-id')).toBeNull();
    expect(new URL(window.location.href).searchParams.has('project')).toBe(false);

    manager.dispose();
  });

  it('keeps the mounted OpenCode workspace bridge readable after thread sync runs', async () => {
    window.history.replaceState({}, '', 'http://localhost:5173/ide?project=project-open');

    const manager = new ProjectManager();
    const container = createContainer();
    container.vfs.mkdirSync(PROJECT_ROOT, { recursive: true });
    container.vfs.writeFileSync(
      `${PROJECT_ROOT}/package.json`,
      JSON.stringify({ name: 'project-open' }, null, 2),
    );

    const savedFiles: SerializedFile[] = [
      {
        path: `${PROJECT_ROOT}/package.json`,
        contentBase64: Buffer.from(
          JSON.stringify({ name: 'project-open' }, null, 2),
          'utf8',
        ).toString('base64'),
      },
    ];

    const project: ProjectRecord = {
      id: 'project-open',
      name: 'Open project',
      templateId: 'vite',
      createdAt: Date.now(),
      lastModified: Date.now(),
      dbPrefix: 'open-db',
    };

    const mountedDirectories = new Set<string>(['/', '/workspace']);
    attachWorkspaceBridge({
      exists(path: string) {
        if (path === '/workspace') {
          return true;
        }
        if (path.startsWith('/workspace/')) {
          return container.vfs.existsSync(`${PROJECT_ROOT}${path.slice('/workspace'.length)}`);
        }
        return false;
      },
      mkdir(path: string) {
        mountedDirectories.add(path);
      },
      readFile(path: string) {
        if (!path.startsWith('/workspace/')) {
          return undefined;
        }
        const mapped = `${PROJECT_ROOT}${path.slice('/workspace'.length)}`;
        try {
          if (container.vfs.statSync(mapped).isDirectory()) {
            return undefined;
          }
          return String(container.vfs.readFileSync(mapped, 'utf8'));
        } catch {
          return undefined;
        }
      },
      writeFile(path: string, content: string) {
        const mapped = `${PROJECT_ROOT}${path.slice('/workspace'.length)}`;
        const directory = mapped.slice(0, mapped.lastIndexOf('/'));
        if (directory) {
          container.vfs.mkdirSync(directory, { recursive: true });
        }
        container.vfs.writeFileSync(mapped, content);
      },
      readdir(path: string) {
        if (path === '/workspace') {
          return (container.vfs.readdirSync(PROJECT_ROOT) as string[]).map((name) => {
            const stat = container.vfs.statSync(`${PROJECT_ROOT}/${name}`);
            return {
              name,
              isDirectory: () => stat.isDirectory(),
              isFile: () => stat.isFile(),
              isSymbolicLink: () => false,
            };
          });
        }
        return [];
      },
      stat(path: string) {
        if (mountedDirectories.has(path)) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            mtime: new Date(),
            mtimeMs: Date.now(),
            size: 0,
          };
        }

        if (!path.startsWith('/workspace/')) {
          return undefined;
        }

        const mapped = `${PROJECT_ROOT}${path.slice('/workspace'.length)}`;
        try {
          const stat = container.vfs.statSync(mapped);
          return {
            isDirectory: () => stat.isDirectory(),
            isFile: () => stat.isFile(),
            mtime: new Date(),
            mtimeMs: Date.now(),
            size: Number(stat.size ?? 0),
          };
        } catch {
          return undefined;
        }
      },
    });

    const helperDirectories = new Set<string>(['/', '/workspace']);
    const helperBridge = {
      exists(path: string) {
        return path === '/workspace' || path === '/workspace/package.json';
      },
      mkdir(path: string) {
        helperDirectories.add(path);
      },
      readFile(path: string) {
        if (path === '/workspace/package.json') {
          return '{"name":"helper-open"}';
        }
        return undefined;
      },
      writeFile() {},
      readdir() {
        return [];
      },
      stat(path: string) {
        if (helperDirectories.has(path)) {
          return {
            isDirectory: () => true,
            isFile: () => false,
            mtime: new Date(),
            mtimeMs: Date.now(),
            size: 0,
          };
        }

        if (path === '/workspace/package.json') {
          const content = '{"name":"helper-open"}';
          return {
            isDirectory: () => false,
            isFile: () => true,
            mtime: new Date(),
            mtimeMs: Date.now(),
            size: content.length,
          };
        }

        return undefined;
      },
    };

    const discoverActiveProjectThreads = vi.fn(async () => {
      await withWorkspaceBridgeScope(helperBridge, async () => {
        await expect(readFile('/workspace/package.json', 'utf8')).resolves.toContain('"helper-open"');
      });
      return { claude: [], opencode: [] };
    });

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

    manager.setHost({
      getVfs: () => container.vfs,
      getTemplateId: () => 'vite',
      hasGitHubCredentials: () => false,
      createGitHubRemote: vi.fn(async () => {
        throw new Error('unexpected');
      }),
      syncProjectGit: vi.fn(async () => undefined),
      attachProjectContext: vi.fn(async () => undefined),
      switchProjectWorkspace: vi.fn(async () => undefined),
      collectAgentStateSnapshot: vi.fn(async () => ({ claudeFiles: [], openCodeDb: null })),
      restoreAgentStateSnapshot: vi.fn(async () => undefined),
      discoverActiveProjectThreads,
      resumeResumableThread: vi.fn(async () => undefined),
    });

    await expect(readFile('/workspace/package.json', 'utf8')).resolves.toContain('"project-open"');
    await manager.init();

    expect(discoverActiveProjectThreads).toHaveBeenCalledWith('project-open');
    await expect(readFile('/workspace/package.json', 'utf8')).resolves.toContain('"project-open"');

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
      hasGitHubCredentials: () => false,
      createGitHubRemote: vi.fn(async () => {
        throw new Error('unexpected');
      }),
      syncProjectGit: vi.fn(async (project: ProjectRecord) => {
        events.push(`sync-git:${project.id}`);
      }),
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
      'sync-git:project-b',
      'restore-agent',
      'resume-thread',
    ]);

    manager.dispose();
  });

  it('persists agent state when an AI sidebar tab closes', async () => {
    window.history.replaceState({}, '', 'http://localhost:5173/ide?project=project-open');

    const manager = new ProjectManager();
    const container = createContainer();
    container.vfs.mkdirSync(PROJECT_ROOT, { recursive: true });
    container.vfs.writeFileSync(
      `${PROJECT_ROOT}/package.json`,
      JSON.stringify({ name: 'project-open' }, null, 2),
    );

    const savedFiles: SerializedFile[] = [
      {
        path: `${PROJECT_ROOT}/package.json`,
        contentBase64: Buffer.from(
          JSON.stringify({ name: 'project-open' }, null, 2),
          'utf8',
        ).toString('base64'),
      },
    ];

    const project: ProjectRecord = {
      id: 'project-open',
      name: 'Open project',
      templateId: 'vite',
      createdAt: Date.now(),
      lastModified: Date.now(),
      dbPrefix: 'open-db',
    };

    const putProjectAgentState = vi.fn(async () => undefined);
    const saveProjectFiles = vi.fn(async () => undefined);
    const putProject = vi.fn(async () => undefined);
    const openCodeDb = new Uint8Array([1, 2, 3, 4]);

    Object.defineProperty(manager, 'db', {
      configurable: true,
      value: {
        listProjects: vi.fn(async () => [project]),
        getProject: vi.fn(async () => project),
        putProject,
        getProjectFiles: vi.fn(async () => savedFiles),
        saveProjectFiles,
        getProjectAgentState: vi.fn(async () => undefined),
        putProjectAgentState,
        listResumableThreads: vi.fn(async () => []),
        replaceProjectResumableThreads: vi.fn(async () => undefined),
        listAllResumableThreads: vi.fn(async () => []),
      },
    });

    manager.setHost({
      getVfs: () => container.vfs,
      getTemplateId: () => 'vite',
      hasGitHubCredentials: () => false,
      createGitHubRemote: vi.fn(async () => {
        throw new Error('unexpected');
      }),
      syncProjectGit: vi.fn(async () => undefined),
      attachProjectContext: vi.fn(async () => undefined),
      switchProjectWorkspace: vi.fn(async () => undefined),
      collectAgentStateSnapshot: vi.fn(async () => ({ claudeFiles: [], openCodeDb })),
      restoreAgentStateSnapshot: vi.fn(async () => undefined),
      discoverActiveProjectThreads: vi.fn(async () => ({ claude: [], opencode: [] })),
      resumeResumableThread: vi.fn(async () => undefined),
    });

    await manager.init();
    window.dispatchEvent(new window.CustomEvent('almostnode:ai-sidebar-tab-closed'));

    await vi.waitFor(() => {
      expect(saveProjectFiles).toHaveBeenCalled();
      expect(putProjectAgentState).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: 'project-open',
          openCodeDb,
        }),
      );
    });

    manager.dispose();
  });

  it('creates a project with a GitHub remote when requested', async () => {
    const manager = new ProjectManager();
    const putProject = vi.fn(async () => undefined);
    const notifyProjectsChanged = vi.fn(async () => undefined);

    Object.defineProperty(manager, 'db', {
      configurable: true,
      value: {
        putProject,
      },
    });

    Object.defineProperty(manager, 'notifyProjectsChanged', {
      configurable: true,
      value: notifyProjectsChanged,
    });

    manager.setHost({
      getVfs: () => ({}),
      getTemplateId: () => 'vite',
      hasGitHubCredentials: () => true,
      createGitHubRemote: vi.fn(async () => ({
        name: 'origin',
        url: 'https://github.com/example/demo.git',
        provider: 'github' as const,
        repositoryFullName: 'example/demo',
        repositoryUrl: 'https://github.com/example/demo',
      })),
      syncProjectGit: vi.fn(async () => undefined),
      attachProjectContext: vi.fn(async () => undefined),
      switchProjectWorkspace: vi.fn(async () => undefined),
      collectAgentStateSnapshot: vi.fn(async () => ({ claudeFiles: [], openCodeDb: null })),
      restoreAgentStateSnapshot: vi.fn(async () => undefined),
      discoverActiveProjectThreads: vi.fn(async () => ({ claude: [], opencode: [] })),
      resumeResumableThread: vi.fn(async () => undefined),
    });

    const project = await manager.createProject('Demo App', 'vite', {
      createGitHubRepo: true,
    });

    expect(project.gitRemote).toEqual({
      name: 'origin',
      url: 'https://github.com/example/demo.git',
      provider: 'github',
      repositoryFullName: 'example/demo',
      repositoryUrl: 'https://github.com/example/demo',
    });
    expect(putProject).toHaveBeenCalledWith(project);
    expect(notifyProjectsChanged).toHaveBeenCalled();
  });

  it('imports a GitHub repository as a new active project', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('project-imported');

    const manager = new ProjectManager();
    const container = createContainer();
    const currentProject: ProjectRecord = {
      id: 'project-current',
      name: 'Current project',
      templateId: 'vite',
      createdAt: Date.now() - 1_000,
      lastModified: Date.now() - 1_000,
      dbPrefix: 'currentdb',
    };

    const putProject = vi.fn(async () => undefined);
    const saveProjectFiles = vi.fn(async () => undefined);
    const putProjectAgentState = vi.fn(async () => undefined);

    Object.defineProperty(manager, 'db', {
      configurable: true,
      value: {
        getProject: vi.fn(async (projectId: string) => (
          projectId === currentProject.id ? currentProject : undefined
        )),
        getProjectAgentState: vi.fn(async () => undefined),
        getProjectFiles: vi.fn(async () => []),
        putProject,
        saveProjectFiles,
        putProjectAgentState,
      },
    });

    Object.defineProperty(manager, 'activeProjectId', {
      configurable: true,
      writable: true,
      value: currentProject.id,
    });
    Object.defineProperty(manager, 'saveCurrentProject', {
      configurable: true,
      value: vi.fn(async () => undefined),
    });
    Object.defineProperty(manager, 'notifyProjectsChanged', {
      configurable: true,
      value: vi.fn(async () => undefined),
    });
    Object.defineProperty(manager, 'syncActiveProjectThreads', {
      configurable: true,
      value: vi.fn(async () => []),
    });

    const importGitHubRepository = vi.fn(async () => {
      container.vfs.mkdirSync(PROJECT_ROOT, { recursive: true });
      container.vfs.writeFileSync(
        `${PROJECT_ROOT}/package.json`,
        JSON.stringify({ name: 'imported-next', dependencies: { next: '15.0.0' } }, null, 2),
      );
      return 'nextjs' as const;
    });

    manager.setHost({
      getVfs: () => container.vfs,
      getTemplateId: () => 'vite',
      hasGitHubCredentials: () => true,
      requestGitHubLogin: vi.fn(async () => undefined),
      listGitHubRepositories: vi.fn(async () => []),
      createGitHubRemote: vi.fn(async () => {
        throw new Error('unexpected');
      }),
      importGitHubRepository,
      syncProjectGit: vi.fn(async () => undefined),
      attachProjectContext: vi.fn(async () => undefined),
      switchProjectWorkspace: vi.fn(async () => undefined),
      collectAgentStateSnapshot: vi.fn(async () => ({ claudeFiles: [], openCodeDb: null })),
      restoreAgentStateSnapshot: vi.fn(async () => undefined),
      discoverActiveProjectThreads: vi.fn(async () => ({ claude: [], opencode: [] })),
      resumeResumableThread: vi.fn(async () => undefined),
    });

    const project = await manager.importGitHubRepository({
      id: 1,
      name: 'web-ide',
      fullName: 'octocat/web-ide',
      description: 'Imported repo',
      private: true,
      updatedAt: '2026-04-08T12:00:00.000Z',
      defaultBranch: 'main',
      cloneUrl: 'https://github.com/octocat/web-ide.git',
      htmlUrl: 'https://github.com/octocat/web-ide',
      ownerLogin: 'octocat',
    });

    expect(importGitHubRepository).toHaveBeenCalledWith(
      expect.objectContaining({ fullName: 'octocat/web-ide' }),
      'project-',
      'octocat-web-ide',
    );
    expect(project).toEqual(expect.objectContaining({
      id: 'project-imported',
      name: 'octocat/web-ide',
      templateId: 'nextjs',
      defaultDatabaseName: 'octocat-web-ide',
      gitRemote: {
        name: 'origin',
        url: 'https://github.com/octocat/web-ide.git',
        provider: 'github',
        repositoryFullName: 'octocat/web-ide',
        repositoryUrl: 'https://github.com/octocat/web-ide',
      },
    }));
    expect(putProject).toHaveBeenCalledWith(project);
    expect(saveProjectFiles).toHaveBeenCalledWith(
      'project-imported',
      expect.arrayContaining([
        expect.objectContaining({
          path: `${PROJECT_ROOT}/package.json`,
        }),
      ]),
    );
    expect(putProjectAgentState).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-imported',
      }),
    );
    expect(manager.getActiveProjectId()).toBe('project-imported');
  });

  it('restores the previous workspace when GitHub import fails', async () => {
    const manager = new ProjectManager();
    const currentProject: ProjectRecord = {
      id: 'project-current',
      name: 'Current project',
      templateId: 'vite',
      createdAt: Date.now() - 1_000,
      lastModified: Date.now() - 1_000,
      dbPrefix: 'currentdb',
    };
    const previousAgentState: ProjectAgentStateRecord = {
      projectId: currentProject.id,
      claudeFiles: [],
      openCodeDb: null,
      savedAt: Date.now() - 500,
    };
    const previousFiles: SerializedFile[] = [
      {
        path: `${PROJECT_ROOT}/README.md`,
        contentBase64: Buffer.from('# current\n', 'utf8').toString('base64'),
      },
    ];

    Object.defineProperty(manager, 'db', {
      configurable: true,
      value: {
        getProject: vi.fn(async (projectId: string) => (
          projectId === currentProject.id ? currentProject : undefined
        )),
        getProjectAgentState: vi.fn(async () => previousAgentState),
        getProjectFiles: vi.fn(async () => previousFiles),
      },
    });

    Object.defineProperty(manager, 'activeProjectId', {
      configurable: true,
      writable: true,
      value: currentProject.id,
    });
    Object.defineProperty(manager, 'saveCurrentProject', {
      configurable: true,
      value: vi.fn(async () => undefined),
    });

    const switchProjectWorkspace = vi.fn(async () => undefined);
    const syncProjectGit = vi.fn(async () => undefined);
    const restoreAgentStateSnapshot = vi.fn(async () => undefined);

    manager.setHost({
      getVfs: () => ({}),
      getTemplateId: () => 'vite',
      hasGitHubCredentials: () => true,
      requestGitHubLogin: vi.fn(async () => undefined),
      listGitHubRepositories: vi.fn(async () => []),
      createGitHubRemote: vi.fn(async () => {
        throw new Error('unexpected');
      }),
      importGitHubRepository: vi.fn(async () => {
        throw new Error('clone failed');
      }),
      syncProjectGit,
      attachProjectContext: vi.fn(async () => undefined),
      switchProjectWorkspace,
      collectAgentStateSnapshot: vi.fn(async () => ({ claudeFiles: [], openCodeDb: null })),
      restoreAgentStateSnapshot,
      discoverActiveProjectThreads: vi.fn(async () => ({ claude: [], opencode: [] })),
      resumeResumableThread: vi.fn(async () => undefined),
    });

    await expect(manager.importGitHubRepository({
      id: 1,
      name: 'broken-repo',
      fullName: 'octocat/broken-repo',
      description: null,
      private: true,
      updatedAt: '2026-04-08T12:00:00.000Z',
      defaultBranch: 'main',
      cloneUrl: 'https://github.com/octocat/broken-repo.git',
      htmlUrl: 'https://github.com/octocat/broken-repo',
      ownerLogin: 'octocat',
    })).rejects.toThrow('clone failed');

    expect(switchProjectWorkspace).toHaveBeenCalledWith(
      'vite',
      previousFiles,
      'currentdb',
      'current-project',
    );
    expect(syncProjectGit).toHaveBeenCalledWith(currentProject);
    expect(restoreAgentStateSnapshot).toHaveBeenCalledWith(previousAgentState);
    expect(manager.getActiveProjectId()).toBe('project-current');
  });

  it('deletes the last active project and clears the selection', async () => {
    window.history.replaceState({}, '', 'http://localhost:5173/ide?project=project-last');

    const manager = new ProjectManager();
    const project: ProjectRecord = {
      id: 'project-last',
      name: 'Last project',
      templateId: 'vite',
      createdAt: Date.now(),
      lastModified: Date.now(),
      dbPrefix: 'last-db',
    };

    let projects: ProjectRecord[] = [project];
    const teardownActiveProject = vi.fn(async () => undefined);
    const onProjectsChanged = vi.fn();
    const onActiveProjectChanged = vi.fn();

    Object.defineProperty(manager, 'db', {
      configurable: true,
      value: {
        listProjects: vi.fn(async () => projects),
        deleteProject: vi.fn(async (id: string) => {
          projects = projects.filter((entry) => entry.id !== id);
        }),
        listAllResumableThreads: vi.fn(async () => []),
      },
    });

    manager.setCallbacks({
      onProjectsChanged,
      onActiveProjectChanged,
      onResumableThreadsChanged: vi.fn(),
      onSwitchingStateChanged: vi.fn(),
    });

    manager.setHost({
      getVfs: () => ({}),
      getTemplateId: () => 'vite',
      hasGitHubCredentials: () => false,
      createGitHubRemote: vi.fn(async () => {
        throw new Error('unexpected');
      }),
      syncProjectGit: vi.fn(async () => undefined),
      attachProjectContext: vi.fn(async () => undefined),
      switchProjectWorkspace: vi.fn(async () => undefined),
      collectAgentStateSnapshot: vi.fn(async () => ({ claudeFiles: [], openCodeDb: null })),
      restoreAgentStateSnapshot: vi.fn(async () => undefined),
      teardownActiveProject,
      discoverActiveProjectThreads: vi.fn(async () => ({ claude: [], opencode: [] })),
      resumeResumableThread: vi.fn(async () => undefined),
    });

    Object.defineProperty(manager, 'activeProjectId', {
      configurable: true,
      writable: true,
      value: project.id,
    });

    await manager.deleteProject(project.id);

    expect(manager.getActiveProjectId()).toBeNull();
    expect(teardownActiveProject).toHaveBeenCalled();
    expect(onActiveProjectChanged).toHaveBeenCalledWith(null);
    expect(onProjectsChanged).toHaveBeenLastCalledWith([]);
    expect(localStorage.getItem('almostnode-active-project-id')).toBeNull();
    expect(new URL(window.location.href).searchParams.has('project')).toBe(false);
  });
});
