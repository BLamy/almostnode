import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { createContainer } from '@agent-wasm/core';
import { ProjectManager } from '../src/features/project-manager';
import { forkRepoIntoSandbox } from '../src/sidebar/fork-on-edit';
import { formatSandboxBadge } from '../src/sidebar/sandbox-item';
import { CLAUDE_PROJECTS_ROOT } from '../src/features/resumable-threads';
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function stubDb(manager: ProjectManager, overrides: Record<string, any>) {
  Object.defineProperty(manager, 'db', {
    configurable: true,
    value: {
      listProjects: vi.fn(async () => [repo]),
      listRepos: vi.fn(async () => [{ ...repo, defaultBranch: 'main' }]),
      getProject: vi.fn(async (id: string) => (id === repo.id ? repo : undefined)),
      putProject: vi.fn(async () => undefined),
      getRepo: vi.fn(async (id: string) =>
        id === repo.id ? { ...repo, defaultBranch: 'main' } : undefined,
      ),
      listSandboxes: vi.fn(async () => []),
      getSandbox: vi.fn(async () => undefined),
      putSandbox: vi.fn(async () => undefined),
      deleteSandbox: vi.fn(async () => undefined),
      getSandboxAgentState: vi.fn(async () => undefined),
      listSandboxResumableThreads: vi.fn(async () => []),
      putResumableThread: vi.fn(async () => undefined),
      listAllResumableThreads: vi.fn(async () => []),
      ...overrides,
    },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return manager.db as any;
}

function makeCallbacks() {
  return {
    onProjectsChanged: vi.fn(),
    onActiveProjectChanged: vi.fn(),
    onResumableThreadsChanged: vi.fn(),
    onSwitchingStateChanged: vi.fn(),
    onSandboxesChanged: vi.fn(),
  };
}

const TRANSCRIPT_LINE = JSON.stringify({
  type: 'user',
  sessionId: 'sess-1',
  timestamp: '2026-01-02T03:04:05.000Z',
  message: { role: 'user', content: 'Fix the login bug' },
});

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

describe('forkRepoIntoSandbox', () => {
  it('creates the sandbox, then opens it', async () => {
    const calls: string[] = [];
    const sandbox = makeSandboxRecord();
    const manager = {
      createSandbox: vi.fn(async (repoId: string) => {
        calls.push(`create:${repoId}`);
        return sandbox;
      }),
      openSandbox: vi.fn(async (sandboxId: string) => {
        calls.push(`open:${sandboxId}`);
      }),
    };

    const result = await forkRepoIntoSandbox(manager, repo.id);

    expect(result).toBe(sandbox);
    expect(calls).toEqual(['create:repo-1', 'open:sandbox-1']);
  });

  it('does not open anything when creation fails', async () => {
    const manager = {
      createSandbox: vi.fn(async () => {
        throw new Error('no such repo');
      }),
      openSandbox: vi.fn(async () => undefined),
    };

    await expect(forkRepoIntoSandbox(manager, 'missing')).rejects.toThrow('no such repo');
    expect(manager.openSandbox).not.toHaveBeenCalled();
  });
});

describe('formatSandboxBadge', () => {
  it('shows the branch until a PR exists, then PR number + state', () => {
    expect(formatSandboxBadge({ branch: 'sandbox/fix-login' })).toBe('sandbox/fix-login');
    expect(
      formatSandboxBadge({
        branch: 'sandbox/fix-login',
        pr: { number: 42, url: 'https://github.com/a/b/pull/42', state: 'open' },
      }),
    ).toBe('PR #42 (open)');
  });
});

describe('ProjectManager sandbox listing', () => {
  it('getSandboxesGroupedByRepo groups sandboxes by repo id', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    stubDb(manager, {
      listSandboxes: vi.fn(async (repoId: string) =>
        repoId === repo.id ? [sandbox] : [],
      ),
    });

    const grouped = await manager.getSandboxesGroupedByRepo();
    expect(grouped).toEqual({ [repo.id]: [sandbox] });
  });

  it('createSandbox fires onSandboxesChanged with the grouped listing', async () => {
    const manager = new ProjectManager();
    const stored: SandboxRecord[] = [];
    stubDb(manager, {
      listSandboxes: vi.fn(async () => stored),
      putSandbox: vi.fn(async (sandbox: SandboxRecord) => {
        stored.push(sandbox);
      }),
    });
    const callbacks = makeCallbacks();
    manager.setCallbacks(callbacks);

    const sandbox = await manager.createSandbox(repo.id);

    expect(sandbox.repoId).toBe(repo.id);
    expect(callbacks.onSandboxesChanged).toHaveBeenCalledWith({
      [repo.id]: [sandbox],
    });
  });
});

describe('ProjectManager.discoverSandboxThreads', () => {
  it('reads transcripts from the live session VFS and persists the threads', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    const container = createContainer();
    const transcriptDir = `${CLAUDE_PROJECTS_ROOT}/-project`;
    container.vfs.mkdirSync(transcriptDir, { recursive: true });
    container.vfs.writeFileSync(`${transcriptDir}/sess-1.jsonl`, `${TRANSCRIPT_LINE}\n`);

    const db = stubDb(manager, {
      getSandbox: vi.fn(async (id: string) => (id === sandbox.id ? sandbox : undefined)),
    });
    const callbacks = makeCallbacks();
    manager.setCallbacks(callbacks);
    manager.setHost({
      getVfsForSession: vi.fn((sessionId: string) =>
        sessionId === sandbox.id ? container.vfs : null,
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const threads = await manager.discoverSandboxThreads(sandbox.id);

    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      id: `claude:${sandbox.id}:sess-1`,
      projectId: sandbox.id,
      sandboxId: sandbox.id,
      harness: 'claude',
      title: 'Fix the login bug',
      resumeToken: 'sess-1',
    });
    expect(db.putResumableThread).toHaveBeenCalledWith(threads[0]);
    // The snapshot store must not be consulted while the session is live.
    expect(db.getSandboxAgentState).not.toHaveBeenCalled();
    expect(callbacks.onResumableThreadsChanged).toHaveBeenCalled();
  });

  it('falls back to the persisted agent-state snapshot when not live', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    const db = stubDb(manager, {
      getSandbox: vi.fn(async (id: string) => (id === sandbox.id ? sandbox : undefined)),
      getSandboxAgentState: vi.fn(async () => ({
        sandboxId: sandbox.id,
        claudeFiles: [
          {
            path: `${CLAUDE_PROJECTS_ROOT}/-project/sess-1.jsonl`,
            contentBase64: Buffer.from(`${TRANSCRIPT_LINE}\n`, 'utf8').toString('base64'),
          },
        ],
        openCodeDb: null,
        savedAt: 10,
      })),
    });
    manager.setHost({
      getVfsForSession: vi.fn(() => null),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    const threads = await manager.discoverSandboxThreads(sandbox.id);

    expect(threads).toHaveLength(1);
    expect(threads[0]!.id).toBe(`claude:${sandbox.id}:sess-1`);
    expect(db.getSandboxAgentState).toHaveBeenCalledWith(sandbox.id);
  });

  it('returns stored threads when nothing new is discovered', async () => {
    const manager = new ProjectManager();
    const sandbox = makeSandboxRecord();
    const stored = {
      id: `opencode:${sandbox.id}:oc-1`,
      projectId: sandbox.id,
      sandboxId: sandbox.id,
      harness: 'opencode' as const,
      title: 'OpenCode session',
      resumeToken: 'oc-1',
      createdAt: 1,
      updatedAt: 2,
    };
    const db = stubDb(manager, {
      getSandbox: vi.fn(async (id: string) => (id === sandbox.id ? sandbox : undefined)),
      listSandboxResumableThreads: vi.fn(async () => [stored]),
    });
    const callbacks = makeCallbacks();
    manager.setCallbacks(callbacks);

    const threads = await manager.discoverSandboxThreads(sandbox.id);

    expect(threads).toEqual([stored]);
    expect(db.putResumableThread).not.toHaveBeenCalled();
    expect(callbacks.onResumableThreadsChanged).not.toHaveBeenCalled();
  });

  it('returns an empty list for unknown sandboxes', async () => {
    const manager = new ProjectManager();
    stubDb(manager, {});
    await expect(manager.discoverSandboxThreads('missing')).resolves.toEqual([]);
  });
});
