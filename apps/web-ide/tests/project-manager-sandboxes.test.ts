import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createContainer } from '@agent-wasm/core';
import { ProjectManager } from '../src/features/project-manager';
import { PROJECT_ROOT } from '../src/desktop/project-snapshot';
import type { ProjectRecord, SandboxRecord } from '../src/features/project-db';

vi.mock('../src/features/workspace-seed', () => ({
  isTemplateId: (value: string) => ['vite', 'nextjs', 'tanstack'].includes(value),
}));

const repo: ProjectRecord = {
  id: 'repo-1',
  name: 'Repo One',
  templateId: 'vite',
  createdAt: 1,
  lastModified: 1,
  dbPrefix: 'repo1db',
  defaultDatabaseName: 'repo-one',
  defaultBranch: 'main',
};

function makeSandboxRecord(id = 'sandbox-1'): SandboxRecord {
  return {
    id,
    repoId: repo.id,
    name: 'fix-login',
    branch: 'sandbox/fix-login',
    createdAt: 1,
    lastActive: 1,
    filesKey: id,
    agentStateKey: id,
  };
}

function makeVfsWithFile(path: string, content: string) {
  const container = createContainer();
  container.vfs.mkdirSync(PROJECT_ROOT, { recursive: true });
  container.vfs.writeFileSync(`${PROJECT_ROOT}/${path}`, content);
  return container.vfs;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stubDb(manager: ProjectManager, overrides: Record<string, any>) {
  Object.defineProperty(manager, 'db', {
    configurable: true,
    value: {
      listProjects: vi.fn(async () => [repo]),
      getProject: vi.fn(async (id: string) => (id === repo.id ? repo : undefined)),
      putProject: vi.fn(async () => undefined),
      getProjectFiles: vi.fn(async () => []),
      saveProjectFiles: vi.fn(async () => undefined),
      getProjectAgentState: vi.fn(async () => undefined),
      putProjectAgentState: vi.fn(async () => undefined),
      getRepo: vi.fn(async (id: string) =>
        id === repo.id ? { ...repo, defaultBranch: 'main' } : undefined,
      ),
      getSandbox: vi.fn(async () => undefined),
      putSandbox: vi.fn(async () => undefined),
      getSandboxFiles: vi.fn(async () => []),
      saveSandboxFiles: vi.fn(async () => undefined),
      getSandboxAgentState: vi.fn(async () => undefined),
      putSandboxAgentState: vi.fn(async () => undefined),
      listResumableThreads: vi.fn(async () => []),
      replaceProjectResumableThreads: vi.fn(async () => undefined),
      listAllResumableThreads: vi.fn(async () => []),
      ...overrides,
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return manager.db as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeHost(overrides: Record<string, any> = {}) {
  return {
    getVfs: vi.fn(() => makeVfsWithFile('active.txt', 'active')),
    getVfsForProject: vi.fn(() => null),
    getTemplateId: () => 'vite' as const,
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
    ...overrides,
  };
}

beforeEach(() => {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', {
    url: 'http://localhost:5173/ide',
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    localStorage: dom.window.localStorage,
    history: dom.window.history,
  });
});

describe('ProjectManager sandboxes', () => {
  it('openSandbox forks a fresh sandbox from the repo base and restores agent state', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    const baseFiles = [{ path: `${PROJECT_ROOT}/a.txt`, contentBase64: 'QQ==' }];
    const agentState = {
      sandboxId: sandbox.id,
      claudeFiles: [],
      openCodeDb: null,
      savedAt: 5,
    };
    const db = stubDb(manager, {
      getSandbox: vi.fn(async (id: string) => (id === sandbox.id ? sandbox : undefined)),
      getProjectFiles: vi.fn(async () => baseFiles),
      getSandboxAgentState: vi.fn(async () => agentState),
    });

    const openSandboxSession = vi.fn(async () => ({ workspaceReplaced: true }));
    const onActiveProjectChanged = vi.fn();
    const host = makeHost({ openSandboxSession });
    manager.setHost(host);
    manager.setCallbacks({
      onProjectsChanged: vi.fn(),
      onActiveProjectChanged,
      onResumableThreadsChanged: vi.fn(),
      onSwitchingStateChanged: vi.fn(),
    });

    await manager.openSandbox(sandbox.id);

    expect(openSandboxSession).toHaveBeenCalledWith(
      { ...repo, defaultBranch: 'main' },
      sandbox,
      [],
      baseFiles,
      repo.dbPrefix,
      'repo-one',
    );
    expect(host.syncProjectGit).toHaveBeenCalled();
    expect(host.restoreAgentStateSnapshot).toHaveBeenCalledWith(agentState);
    expect(manager.getActiveSandboxId()).toBe(sandbox.id);
    expect(manager.getActiveProjectId()).toBe(repo.id);
    expect(onActiveProjectChanged).toHaveBeenCalledWith(repo.id);
    // touchSandbox bumped lastActive.
    expect(db.putSandbox).toHaveBeenCalledWith(
      expect.objectContaining({ id: sandbox.id }),
    );

    // Re-opening the active sandbox is a no-op.
    await manager.openSandbox(sandbox.id);
    expect(openSandboxSession).toHaveBeenCalledTimes(1);
  });

  it('openSandbox restores a persisted snapshot without reloading the repo base', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    const savedFiles = [{ path: `${PROJECT_ROOT}/b.txt`, contentBase64: 'Qg==' }];
    const getProjectFiles = vi.fn(async () => [
      { path: `${PROJECT_ROOT}/base.txt`, contentBase64: 'QQ==' },
    ]);
    stubDb(manager, {
      getSandbox: vi.fn(async () => sandbox),
      getSandboxFiles: vi.fn(async () => savedFiles),
      getProjectFiles,
    });

    const openSandboxSession = vi.fn(async () => ({ workspaceReplaced: false }));
    const host = makeHost({ openSandboxSession });
    manager.setHost(host);

    await manager.switchToSandbox(sandbox.id);

    expect(openSandboxSession).toHaveBeenCalledWith(
      { ...repo, defaultBranch: 'main' },
      sandbox,
      savedFiles,
      [],
      repo.dbPrefix,
      'repo-one',
    );
    // The repo base snapshot was never read for an already-saved sandbox.
    expect(getProjectFiles).not.toHaveBeenCalled();
    // A live re-attach restores no stale agent state.
    expect(host.restoreAgentStateSnapshot).not.toHaveBeenCalled();
  });

  it('saveCurrentProject persists the active sandbox and never writes the repo base from the sandbox VFS', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    const db = stubDb(manager, {
      getSandbox: vi.fn(async (id: string) => (id === sandbox.id ? sandbox : undefined)),
    });

    const sandboxVfs = makeVfsWithFile('fork.txt', 'fork');
    const host = makeHost({
      openSandboxSession: vi.fn(async () => ({ workspaceReplaced: true })),
      getVfsForSession: vi.fn((id: string) => (id === sandbox.id ? sandboxVfs : null)),
      collectAgentStateSnapshotForSession: vi.fn(async () => ({
        claudeFiles: [],
        openCodeDb: null,
      })),
      // The repo base has no live session while the sandbox is active.
      getVfsForProject: vi.fn(() => null),
    });
    manager.setHost(host);
    await manager.openSandbox(sandbox.id);
    db.saveSandboxFiles.mockClear();

    await manager.saveCurrentProject();

    expect(db.saveSandboxFiles).toHaveBeenCalledWith(
      sandbox.id,
      expect.arrayContaining([
        expect.objectContaining({ path: `${PROJECT_ROOT}/fork.txt` }),
      ]),
    );
    expect(db.putSandboxAgentState).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxId: sandbox.id }),
    );
    // The sandbox VFS must never masquerade as the repo's base snapshot.
    expect(db.saveProjectFiles).not.toHaveBeenCalled();
  });

  it('switchProject returns from a sandbox to the same repo base', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    stubDb(manager, {
      getSandbox: vi.fn(async (id: string) => (id === sandbox.id ? sandbox : undefined)),
    });

    const switchProjectWorkspaceToSession = vi.fn(async () => ({
      workspaceReplaced: false,
    }));
    const host = makeHost({
      openSandboxSession: vi.fn(async () => ({ workspaceReplaced: true })),
      switchProjectWorkspaceToSession,
      getVfsForSession: vi.fn(() => null),
    });
    manager.setHost(host);
    await manager.openSandbox(sandbox.id);
    expect(manager.getActiveSandboxId()).toBe(sandbox.id);

    await manager.switchProject(repo.id);

    expect(switchProjectWorkspaceToSession).toHaveBeenCalledWith(
      repo.id,
      repo.templateId,
      [],
      repo.dbPrefix,
      'repo-one',
    );
    expect(manager.getActiveSandboxId()).toBeNull();
    expect(manager.getActiveProjectId()).toBe(repo.id);
  });

  it('saveAllSessions snapshots background sandbox and project sessions', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord('bg-sandbox');
    const backgroundProject: ProjectRecord = {
      ...repo,
      id: 'p2',
      name: 'Background project',
    };
    const db = stubDb(manager, {
      getSandbox: vi.fn(async (id: string) => (id === sandbox.id ? sandbox : undefined)),
      getProject: vi.fn(async (id: string) => {
        if (id === repo.id) return repo;
        if (id === 'p2') return backgroundProject;
        return undefined;
      }),
    });

    const sandboxVfs = makeVfsWithFile('sandbox.txt', 'sandbox');
    const projectVfs = makeVfsWithFile('project.txt', 'project');
    const host = makeHost({
      getLiveSessionIds: vi.fn(() => ['active', 'bg-sandbox', 'bg-project']),
      getActiveSessionId: vi.fn(() => 'active'),
      getProjectIdForSession: vi.fn((id: string) => (id === 'bg-project' ? 'p2' : null)),
      getVfsForSession: vi.fn((id: string) => {
        if (id === 'bg-sandbox') return sandboxVfs;
        if (id === 'bg-project') return projectVfs;
        return null;
      }),
      collectAgentStateSnapshotForSession: vi.fn(async () => ({
        claudeFiles: [],
        openCodeDb: null,
      })),
    });
    manager.setHost(host);

    await manager.saveAllSessions();

    expect(db.saveSandboxFiles).toHaveBeenCalledWith(
      'bg-sandbox',
      expect.arrayContaining([
        expect.objectContaining({ path: `${PROJECT_ROOT}/sandbox.txt` }),
      ]),
    );
    expect(db.saveProjectFiles).toHaveBeenCalledWith(
      'p2',
      expect.arrayContaining([
        expect.objectContaining({ path: `${PROJECT_ROOT}/project.txt` }),
      ]),
    );
    expect(db.putProjectAgentState).toHaveBeenCalledWith(
      expect.objectContaining({ projectId: 'p2' }),
    );
  });

  it('setHost registers the pre-eviction persistence hook on the host', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord('evictee');
    const db = stubDb(manager, {
      getSandbox: vi.fn(async (id: string) => (id === sandbox.id ? sandbox : undefined)),
    });

    const capturedRef: {
      persist: ((sessionId: string) => Promise<void>) | null;
    } = { persist: null };
    const sandboxVfs = makeVfsWithFile('evict.txt', 'evict');
    const host = makeHost({
      setSessionPersistence: vi.fn((persist: (sessionId: string) => Promise<void>) => {
        capturedRef.persist = persist;
      }),
      getVfsForSession: vi.fn(() => sandboxVfs),
      collectAgentStateSnapshotForSession: vi.fn(async () => ({
        claudeFiles: [],
        openCodeDb: null,
      })),
    });

    manager.setHost(host);
    expect(capturedRef.persist).not.toBeNull();

    await capturedRef.persist?.('evictee');

    expect(db.saveSandboxFiles).toHaveBeenCalledWith(
      'evictee',
      expect.arrayContaining([
        expect.objectContaining({ path: `${PROJECT_ROOT}/evict.txt` }),
      ]),
    );
    expect(db.putSandboxAgentState).toHaveBeenCalledWith(
      expect.objectContaining({ sandboxId: 'evictee' }),
    );
  });
});
