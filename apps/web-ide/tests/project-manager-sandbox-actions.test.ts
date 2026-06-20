import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createContainer } from 'almostnode';
import {
  ProjectManager,
  parsePrCreateOutput,
  parsePrViewState,
} from '../src/features/project-manager';
import { PROJECT_ROOT } from '../src/desktop/project-snapshot';
import type {
  ProjectRecord,
  ResumableThreadRecord,
  SandboxRecord,
} from '../src/features/project-db';

vi.mock('../src/features/workspace-seed', () => ({
  isTemplateId: (value: string) => ['vite', 'nextjs', 'tanstack'].includes(value),
}));

const localRepo: ProjectRecord = {
  id: 'repo-1',
  name: 'Repo One',
  templateId: 'vite',
  createdAt: 1,
  lastModified: 1,
  dbPrefix: 'repo1db',
  defaultDatabaseName: 'repo-one',
  defaultBranch: 'main',
};

const githubRepo: ProjectRecord = {
  ...localRepo,
  gitRemote: {
    name: 'origin',
    url: 'https://github.com/owner/repo.git',
    provider: 'github',
    repositoryFullName: 'owner/repo',
  },
};

function makeSandboxRecord(id = 'sandbox-1'): SandboxRecord {
  return {
    id,
    repoId: localRepo.id,
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
function stubDb(manager: ProjectManager, repo: ProjectRecord, overrides: Record<string, any> = {}) {
  Object.defineProperty(manager, 'db', {
    configurable: true,
    value: {
      listProjects: vi.fn(async () => [repo]),
      listRepos: vi.fn(async () => [repo]),
      getProject: vi.fn(async (id: string) => (id === repo.id ? repo : undefined)),
      putProject: vi.fn(async () => undefined),
      getProjectFiles: vi.fn(async () => []),
      saveProjectFiles: vi.fn(async () => undefined),
      getProjectAgentState: vi.fn(async () => undefined),
      putProjectAgentState: vi.fn(async () => undefined),
      getRepo: vi.fn(async (id: string) => (id === repo.id ? repo : undefined)),
      listSandboxes: vi.fn(async () => []),
      getSandbox: vi.fn(async () => undefined),
      putSandbox: vi.fn(async () => undefined),
      deleteSandbox: vi.fn(async () => undefined),
      getSandboxFiles: vi.fn(async () => []),
      saveSandboxFiles: vi.fn(async () => undefined),
      getSandboxAgentState: vi.fn(async () => undefined),
      putSandboxAgentState: vi.fn(async () => undefined),
      listResumableThreads: vi.fn(async () => []),
      listSandboxResumableThreads: vi.fn(async () => []),
      replaceProjectResumableThreads: vi.fn(async () => undefined),
      listAllResumableThreads: vi.fn(async () => []),
      putResumableThread: vi.fn(async () => undefined),
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

/** Host whose runSessionCommand records commands and replays canned results. */
function makeCommandHost(
  results: Record<string, { stdout?: string; stderr?: string; exitCode?: number }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  overrides: Record<string, any> = {},
) {
  const commands: string[] = [];
  const host = makeHost({
    getVfsForSession: vi.fn(() => makeVfsWithFile('merged.txt', 'merged')),
    runSessionCommand: vi.fn(async (_sessionId: string, command: string) => {
      commands.push(command);
      const match = Object.entries(results).find(([prefix]) => command.startsWith(prefix));
      return {
        stdout: match?.[1].stdout ?? '',
        stderr: match?.[1].stderr ?? '',
        exitCode: match?.[1].exitCode ?? 0,
      };
    }),
    ...overrides,
  });
  return { host, commands };
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

describe('parse helpers', () => {
  it('parses the PR url and number from gh pr create output', () => {
    expect(parsePrCreateOutput('https://github.com/owner/repo/pull/123\n')).toEqual({
      number: 123,
      url: 'https://github.com/owner/repo/pull/123',
      state: 'open',
    });
    expect(parsePrCreateOutput('gh: API error (401)\n')).toBeNull();
  });

  it('parses and lowercases the state from gh pr view --json output', () => {
    expect(parsePrViewState('{\n  "state": "MERGED"\n}\n')).toBe('merged');
    expect(parsePrViewState('not json')).toBeNull();
  });
});

describe('ProjectManager.createPrForSandbox', () => {
  it('commits when dirty, pushes the branch, creates the PR, and stores it', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    const updated: SandboxRecord[] = [];
    const db = stubDb(manager, githubRepo, {
      getSandbox: vi.fn(async (id: string) => (id === sandbox.id ? sandbox : undefined)),
      putSandbox: vi.fn(async (record: SandboxRecord) => {
        updated.push(record);
      }),
    });
    const { host, commands } = makeCommandHost({
      'git status': { stdout: ' M src/app.ts\n' },
      'gh pr create': { stdout: 'https://github.com/owner/repo/pull/12\n' },
    });
    const onSandboxesChanged = vi.fn();
    manager.setHost(host);
    manager.setCallbacks({
      onProjectsChanged: vi.fn(),
      onActiveProjectChanged: vi.fn(),
      onResumableThreadsChanged: vi.fn(),
      onSwitchingStateChanged: vi.fn(),
      onSandboxesChanged,
    });

    const pr = await manager.createPrForSandbox(sandbox.id);

    expect(commands).toEqual([
      'git status --porcelain',
      'git add -A',
      "git commit -m 'Sandbox fix-login changes'",
      "git push -u origin 'sandbox/fix-login'",
      "gh pr create --title 'fix-login' --head 'sandbox/fix-login'",
    ]);
    expect(pr).toEqual({
      number: 12,
      url: 'https://github.com/owner/repo/pull/12',
      state: 'open',
    });
    expect(updated.at(-1)?.pr).toEqual(pr);
    expect(db.putSandbox).toHaveBeenCalled();
    expect(onSandboxesChanged).toHaveBeenCalled();
  });

  it('skips the commit when the tree is clean', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    stubDb(manager, githubRepo, {
      getSandbox: vi.fn(async () => sandbox),
    });
    const { host, commands } = makeCommandHost({
      'git status': { stdout: '' },
      'gh pr create': { stdout: 'https://github.com/owner/repo/pull/7\n' },
    });
    manager.setHost(host);

    await manager.createPrForSandbox(sandbox.id);

    expect(commands).toEqual([
      'git status --porcelain',
      "git push -u origin 'sandbox/fix-login'",
      "gh pr create --title 'fix-login' --head 'sandbox/fix-login'",
    ]);
  });

  it('updates an existing PR with a push instead of creating a duplicate', async () => {
    const manager = new ProjectManager();
    const sandbox: SandboxRecord = {
      ...makeSandboxRecord(),
      pr: { number: 4, url: 'https://github.com/owner/repo/pull/4', state: 'open' },
    };
    stubDb(manager, githubRepo, {
      getSandbox: vi.fn(async () => sandbox),
    });
    const { host, commands } = makeCommandHost({
      'git status': { stdout: '' },
      'gh pr view': { stdout: '{ "state": "OPEN" }\n' },
    });
    manager.setHost(host);

    const pr = await manager.createPrForSandbox(sandbox.id);

    expect(pr.number).toBe(4);
    expect(commands.filter((command) => command.startsWith('gh pr create'))).toEqual([]);
    expect(commands).toContain("git push -u origin 'sandbox/fix-login'");
  });

  it('rejects repos without a GitHub remote', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    stubDb(manager, localRepo, {
      getSandbox: vi.fn(async () => sandbox),
    });
    const { host, commands } = makeCommandHost({});
    manager.setHost(host);

    await expect(manager.createPrForSandbox(sandbox.id)).rejects.toThrow(
      'Merge to main',
    );
    expect(commands).toEqual([]);
  });

  it('surfaces push failures and stores no PR', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    const db = stubDb(manager, githubRepo, {
      getSandbox: vi.fn(async () => sandbox),
    });
    const { host, commands } = makeCommandHost({
      'git status': { stdout: '' },
      'git push': { stderr: 'rejected: remote contains work you do not have\n', exitCode: 1 },
    });
    manager.setHost(host);

    await expect(manager.createPrForSandbox(sandbox.id)).rejects.toThrow('rejected');
    expect(commands.filter((command) => command.startsWith('gh pr create'))).toEqual([]);
    expect(db.putSandbox).not.toHaveBeenCalled();
  });

  it('opens a dormant sandbox before running the git sequence', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    stubDb(manager, githubRepo, {
      getSandbox: vi.fn(async () => sandbox),
    });
    const openSandboxSession = vi.fn(async () => ({ workspaceReplaced: true }));
    const { host, commands } = makeCommandHost(
      {
        'git status': { stdout: '' },
        'gh pr create': { stdout: 'https://github.com/owner/repo/pull/3\n' },
      },
      {
        // Not live: the action must open the sandbox first.
        getVfsForSession: vi.fn(() => null),
        openSandboxSession,
      },
    );
    manager.setHost(host);

    await manager.createPrForSandbox(sandbox.id);

    expect(openSandboxSession).toHaveBeenCalled();
    expect(commands).toContain("git push -u origin 'sandbox/fix-login'");
  });
});

describe('ProjectManager.mergeSandboxToMain', () => {
  it('merges into the default branch, promotes the base snapshot, and switches back', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    const db = stubDb(manager, localRepo, {
      getSandbox: vi.fn(async () => sandbox),
    });
    const { host, commands } = makeCommandHost({
      'git status': { stdout: '' },
    });
    manager.setHost(host);

    await manager.mergeSandboxToMain(sandbox.id);

    expect(commands).toEqual([
      'git status --porcelain',
      "git checkout 'main'",
      "git merge 'sandbox/fix-login'",
      "git checkout 'sandbox/fix-login'",
    ]);
    // The merged main (read while checked out) became the repo base snapshot.
    expect(db.saveProjectFiles).toHaveBeenCalledWith(
      localRepo.id,
      expect.arrayContaining([
        expect.objectContaining({ path: `${PROJECT_ROOT}/merged.txt` }),
      ]),
    );
    expect(db.putProject).toHaveBeenCalled();
  });

  it('pushes the merged base into a live repo-base session', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    stubDb(manager, localRepo, {
      getSandbox: vi.fn(async () => sandbox),
    });
    const refreshRepoBaseSession = vi.fn();
    const { host } = makeCommandHost(
      { 'git status': { stdout: '' } },
      { refreshRepoBaseSession },
    );
    manager.setHost(host);

    await manager.mergeSandboxToMain(sandbox.id);

    expect(refreshRepoBaseSession).toHaveBeenCalledWith(
      localRepo.id,
      expect.arrayContaining([
        expect.objectContaining({ path: `${PROJECT_ROOT}/merged.txt` }),
      ]),
    );
  });

  it('fails loudly when the sandbox session vanished after the merge', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    const db = stubDb(manager, localRepo, {
      getSandbox: vi.fn(async () => sandbox),
    });
    const openSandboxSession = vi.fn(async () => ({ workspaceReplaced: true }));
    const { host } = makeCommandHost(
      { 'git status': { stdout: '' } },
      {
        getVfsForSession: vi.fn(() => null),
        openSandboxSession,
      },
    );
    manager.setHost(host);

    await expect(manager.mergeSandboxToMain(sandbox.id)).rejects.toThrow(
      'base snapshot was not updated',
    );
    expect(db.saveProjectFiles).not.toHaveBeenCalled();
  });

  it('aborts on conflict, restores the branch, and surfaces the output', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    const db = stubDb(manager, localRepo, {
      getSandbox: vi.fn(async () => sandbox),
    });
    const { host, commands } = makeCommandHost({
      'git status': { stdout: '' },
      'git merge --abort': { exitCode: 0 },
      'git merge': {
        stderr: 'CONFLICT (content): Merge conflict in src/app.ts\nAutomatic merge failed\n',
        exitCode: 1,
      },
    });
    manager.setHost(host);

    await expect(manager.mergeSandboxToMain(sandbox.id)).rejects.toThrow(
      'Merge conflict in src/app.ts',
    );
    expect(commands).toEqual([
      'git status --porcelain',
      "git checkout 'main'",
      "git merge 'sandbox/fix-login'",
      'git merge --abort',
      "git checkout 'sandbox/fix-login'",
    ]);
    expect(db.saveProjectFiles).not.toHaveBeenCalled();
  });

  it('rejects GitHub-backed repos', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    stubDb(manager, githubRepo, {
      getSandbox: vi.fn(async () => sandbox),
    });
    const { host, commands } = makeCommandHost({});
    manager.setHost(host);

    await expect(manager.mergeSandboxToMain(sandbox.id)).rejects.toThrow('Create PR');
    expect(commands).toEqual([]);
  });
});

describe('ProjectManager.refreshSandboxPrState', () => {
  it('updates the stored state from gh pr view in the live sandbox session', async () => {
    const manager = new ProjectManager();
    const sandbox: SandboxRecord = {
      ...makeSandboxRecord(),
      pr: { number: 12, url: 'https://github.com/owner/repo/pull/12', state: 'open' },
    };
    const updated: SandboxRecord[] = [];
    stubDb(manager, githubRepo, {
      getSandbox: vi.fn(async () => sandbox),
      putSandbox: vi.fn(async (record: SandboxRecord) => {
        updated.push(record);
      }),
    });
    const { host, commands } = makeCommandHost({
      'gh pr view': { stdout: '{\n  "state": "MERGED"\n}\n' },
    });
    manager.setHost(host);

    await manager.refreshSandboxPrState(sandbox.id);

    expect(commands).toEqual(['gh pr view 12 --json state']);
    expect(updated.at(-1)?.pr).toEqual(
      expect.objectContaining({ number: 12, state: 'merged' }),
    );
  });

  it('does nothing without a PR or without a live session', async () => {
    const manager = new ProjectManager();
    const withoutPr = makeSandboxRecord();
    stubDb(manager, githubRepo, {
      getSandbox: vi.fn(async () => withoutPr),
    });
    const { host, commands } = makeCommandHost({});
    manager.setHost(host);
    await manager.refreshSandboxPrState(withoutPr.id);
    expect(commands).toEqual([]);

    const withPr: SandboxRecord = {
      ...makeSandboxRecord(),
      pr: { number: 9, url: 'https://github.com/owner/repo/pull/9', state: 'open' },
    };
    const dormant = makeCommandHost({}, {
      getVfsForSession: vi.fn(() => null),
      getVfsForProject: vi.fn(() => null),
    });
    stubDb(manager, githubRepo, {
      getSandbox: vi.fn(async () => withPr),
    });
    manager.setHost(dormant.host);
    await manager.refreshSandboxPrState(withPr.id);
    // Never spins up a container just to poll PR state.
    expect(dormant.commands).toEqual([]);
  });
});

describe('ProjectManager.deleteSandbox while foreground', () => {
  it('switches back to the repo base, disposes the session, and clears selection', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    const baseFiles = [{ path: `${PROJECT_ROOT}/base.txt`, contentBase64: 'QQ==' }];
    const db = stubDb(manager, localRepo, {
      getSandbox: vi.fn(async (id: string) => (id === sandbox.id ? sandbox : undefined)),
      getProjectFiles: vi.fn(async () => baseFiles),
    });

    const switchProjectWorkspaceToSession = vi.fn(async () => ({
      workspaceReplaced: false,
    }));
    const disposeSession = vi.fn();
    const host = makeHost({
      openSandboxSession: vi.fn(async () => ({ workspaceReplaced: false })),
      switchProjectWorkspaceToSession,
      disposeSession,
      getVfsForSession: vi.fn(() => null),
    });
    const onActiveSandboxChanged = vi.fn();
    manager.setHost(host);
    manager.setCallbacks({
      onProjectsChanged: vi.fn(),
      onActiveProjectChanged: vi.fn(),
      onResumableThreadsChanged: vi.fn(),
      onSwitchingStateChanged: vi.fn(),
      onSandboxesChanged: vi.fn(),
      onActiveSandboxChanged,
    });
    await manager.openSandbox(sandbox.id);
    expect(manager.getActiveSandboxId()).toBe(sandbox.id);
    onActiveSandboxChanged.mockClear();

    await manager.deleteSandbox(sandbox.id);

    expect(manager.getActiveSandboxId()).toBeNull();
    expect(onActiveSandboxChanged).toHaveBeenCalledWith(null);
    expect(switchProjectWorkspaceToSession).toHaveBeenCalledWith(
      localRepo.id,
      localRepo.templateId,
      baseFiles,
      localRepo.dbPrefix,
      'repo-one',
    );
    expect(disposeSession).toHaveBeenCalledWith(sandbox.id);
    expect(db.deleteSandbox).toHaveBeenCalledWith(sandbox.id);
    // The dying sandbox was never snapshotted on the way out.
    expect(db.saveSandboxFiles).not.toHaveBeenCalled();
  });

  it('deletes background sandboxes without touching the active workspace', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord('bg-sandbox');
    const db = stubDb(manager, localRepo, {
      getSandbox: vi.fn(async () => sandbox),
    });
    const switchProjectWorkspaceToSession = vi.fn(async () => ({
      workspaceReplaced: false,
    }));
    const disposeSession = vi.fn();
    const host = makeHost({ switchProjectWorkspaceToSession, disposeSession });
    manager.setHost(host);

    await manager.deleteSandbox(sandbox.id);

    expect(switchProjectWorkspaceToSession).not.toHaveBeenCalled();
    expect(disposeSession).toHaveBeenCalledWith(sandbox.id);
    expect(db.deleteSandbox).toHaveBeenCalledWith(sandbox.id);
  });
});

describe('ProjectManager.resumeThread', () => {
  function makeThread(overrides: Partial<ResumableThreadRecord> = {}): ResumableThreadRecord {
    return {
      id: 'claude:repo-1:sess-1',
      projectId: localRepo.id,
      sandboxId: localRepo.id,
      harness: 'claude',
      title: 'Legacy chat',
      resumeToken: 'sess-1',
      createdAt: 1,
      updatedAt: 2,
      ...overrides,
    };
  }

  it('forks a sandbox seeded from the repo agent state for legacy threads', async () => {
    const manager = new ProjectManager();
    const thread = makeThread();
    const events: string[] = [];
    const sandboxes = new Map<string, SandboxRecord>();
    const legacyAgentState = {
      projectId: localRepo.id,
      claudeFiles: [{ path: '/home/user/.claude/projects/p/t.jsonl', contentBase64: 'e30=' }],
      openCodeDb: null,
      savedAt: 3,
    };
    stubDb(manager, localRepo, {
      getResumableThread: vi.fn(async () => thread),
      getProjectAgentState: vi.fn(async () => legacyAgentState),
      // Legacy records carry sandboxId === projectId — not a real sandbox.
      getSandbox: vi.fn(async (id: string) => sandboxes.get(id)),
      putSandbox: vi.fn(async (record: SandboxRecord) => {
        sandboxes.set(record.id, record);
      }),
      putSandboxAgentState: vi.fn(async () => {
        events.push('seed-agent-state');
      }),
      getSandboxAgentState: vi.fn(async () => undefined),
    });
    const host = makeHost({
      openSandboxSession: vi.fn(async () => {
        events.push('open-sandbox');
        return { workspaceReplaced: true };
      }),
      resumeResumableThread: vi.fn(async () => {
        events.push('resume');
      }),
      getVfsForSession: vi.fn(() => null),
      switchProjectWorkspaceToSession: vi.fn(async () => ({ workspaceReplaced: true })),
    });
    manager.setHost(host);

    await manager.resumeThread(thread.id);

    // Seeding happens BEFORE the sandbox opens so the fresh session
    // restores the legacy transcripts.
    expect(events).toEqual(['seed-agent-state', 'open-sandbox', 'resume']);
    expect(manager.getActiveSandboxId()).not.toBeNull();
    const fork = sandboxes.get(manager.getActiveSandboxId()!);
    expect(fork?.repoId).toBe(localRepo.id);
  });

  it('opens the owning sandbox before resuming sandbox-keyed threads', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    const thread = makeThread({
      id: `claude:${sandbox.id}:sess-9`,
      projectId: sandbox.id,
      sandboxId: sandbox.id,
      resumeToken: 'sess-9',
    });
    stubDb(manager, localRepo, {
      getResumableThread: vi.fn(async () => thread),
      getSandbox: vi.fn(async (id: string) => (id === sandbox.id ? sandbox : undefined)),
    });
    const openSandboxSession = vi.fn(async () => ({ workspaceReplaced: false }));
    const resumeResumableThread = vi.fn(async () => undefined);
    const host = makeHost({
      openSandboxSession,
      resumeResumableThread,
      getVfsForSession: vi.fn(() => null),
    });
    manager.setHost(host);

    await manager.resumeThread(thread.id);

    expect(openSandboxSession).toHaveBeenCalled();
    expect(manager.getActiveSandboxId()).toBe(sandbox.id);
    expect(resumeResumableThread).toHaveBeenCalledWith(thread);
  });
});

describe('ProjectManager boot read-only', () => {
  it('marks the boot-restored repo base read-only', async () => {
    const manager = new ProjectManager();
    stubDb(manager, localRepo, {
      getProjectFiles: vi.fn(async () => [
        { path: `${PROJECT_ROOT}/base.txt`, contentBase64: 'QQ==' },
      ]),
    });
    const markActiveSessionReadOnly = vi.fn();
    const host = makeHost({ markActiveSessionReadOnly });
    manager.setHost(host);

    await manager.init();

    expect(host.switchProjectWorkspace).toHaveBeenCalled();
    expect(markActiveSessionReadOnly).toHaveBeenCalled();

    manager.dispose();
  });
});
