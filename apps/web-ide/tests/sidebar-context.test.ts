import { describe, expect, it } from 'vitest';
import {
  groupSidebarThreads,
  initialSidebarState,
  sidebarReducer,
  type SidebarState,
} from '../src/sidebar/sidebar-context';
import {
  computeRunningAgentState,
  isThreadRunning,
} from '../src/sidebar/running-agents';
import type { ActiveAgentSession } from '@agent-wasm/chat-core';
import type {
  ProjectRecord,
  ResumableThreadRecord,
  SandboxRecord,
} from '../src/features/project-db';

function repo(id: string): ProjectRecord {
  return {
    id,
    name: id,
    templateId: 'vite',
    createdAt: 1,
    lastModified: 1,
    dbPrefix: id.slice(0, 8),
    defaultBranch: 'main',
  };
}

function sandbox(id: string, repoId = 'repo-1'): SandboxRecord {
  return {
    id,
    repoId,
    name: id,
    branch: `sandbox/${id}`,
    createdAt: 1,
    lastActive: 1,
    filesKey: id,
    agentStateKey: id,
  };
}

function thread(
  id: string,
  overrides: Partial<ResumableThreadRecord> = {},
): ResumableThreadRecord {
  return {
    id,
    projectId: 'repo-1',
    harness: 'claude',
    title: id,
    resumeToken: id,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function session(overrides: Partial<ActiveAgentSession> = {}): ActiveAgentSession {
  return {
    harness: 'claude',
    tabId: 'tab-1',
    startedAt: 0,
    resumeToken: null,
    sendInput: () => {},
    isRunning: () => true,
    ...overrides,
  };
}

describe('sidebarReducer', () => {
  it('stores repos and active ids', () => {
    let state = sidebarReducer(initialSidebarState, {
      type: 'SET_REPOS',
      repos: [repo('repo-1')],
    });
    state = sidebarReducer(state, { type: 'SET_ACTIVE_REPO', repoId: 'repo-1' });
    state = sidebarReducer(state, { type: 'SET_ACTIVE_SANDBOX', sandboxId: 'sb-1' });
    state = sidebarReducer(state, { type: 'SET_ACTIVE_CHAT', chatId: 'chat-1' });

    expect(state.repos.map((record) => record.id)).toEqual(['repo-1']);
    expect(state.activeRepoId).toBe('repo-1');
    expect(state.activeSandboxId).toBe('sb-1');
    expect(state.activeChatId).toBe('chat-1');
  });

  it('groups sandbox-keyed threads under their sandbox once sandboxes load', () => {
    // Sandbox chats follow the persistence convention projectId === sandboxId.
    const sandboxChat = thread('claude:sb-1:sess-1', {
      projectId: 'sb-1',
      sandboxId: 'sb-1',
      resumeToken: 'sess-1',
    });
    const legacy = thread('claude:repo-1:sess-2', {
      sandboxId: 'repo-1',
      resumeToken: 'sess-2',
    });

    // Threads arrive before the sandbox list: nothing is a known sandbox
    // yet, so everything lands in the legacy buckets.
    let state = sidebarReducer(initialSidebarState, {
      type: 'SET_RESUMABLE_THREADS',
      threads: [sandboxChat, legacy],
    });
    expect(state.chatsBySandbox).toEqual({});
    expect(state.legacyRepoThreads['sb-1']).toEqual([sandboxChat]);

    // Sandboxes arrive: the raw thread list is regrouped.
    state = sidebarReducer(state, {
      type: 'SET_SANDBOXES',
      sandboxesByRepo: { 'repo-1': [sandbox('sb-1')] },
    });
    expect(state.chatsBySandbox['sb-1']).toEqual([sandboxChat]);
    expect(state.legacyRepoThreads['sb-1']).toBeUndefined();
    expect(state.legacyRepoThreads['repo-1']).toEqual([legacy]);
  });

  it('keeps legacy threads (sandboxId === projectId) under the repo', () => {
    const legacy = thread('claude:repo-1:sess-1', {
      sandboxId: 'repo-1',
      resumeToken: 'sess-1',
    });
    const grouped = groupSidebarThreads([legacy], { 'repo-1': [sandbox('sb-1')] });
    expect(grouped.legacyRepoThreads['repo-1']).toEqual([legacy]);
    expect(grouped.chatsBySandbox).toEqual({});
  });

  it('drops repo-level duplicates of a sandbox chat (same harness + token)', () => {
    const sandboxChat = thread('claude:sb-1:sess-1', {
      projectId: 'sb-1',
      sandboxId: 'sb-1',
      resumeToken: 'sess-1',
    });
    // The same conversation discovered through the active-session VFS while
    // the sandbox was foregrounded — recorded against the repo.
    const duplicate = thread('claude:repo-1:sess-1', {
      sandboxId: 'repo-1',
      resumeToken: 'sess-1',
    });
    const other = thread('claude:repo-1:sess-9', {
      sandboxId: 'repo-1',
      resumeToken: 'sess-9',
    });

    const grouped = groupSidebarThreads(
      [sandboxChat, duplicate, other],
      { 'repo-1': [sandbox('sb-1')] },
    );
    expect(grouped.chatsBySandbox['sb-1']).toEqual([sandboxChat]);
    expect(grouped.legacyRepoThreads['repo-1']).toEqual([other]);
  });

  it('toggles repo and sandbox expansion', () => {
    let state = sidebarReducer(initialSidebarState, {
      type: 'TOGGLE_REPO_EXPANDED',
      repoId: 'repo-1',
    });
    expect(state.expandedRepoIds).toEqual(['repo-1']);
    state = sidebarReducer(state, { type: 'TOGGLE_REPO_EXPANDED', repoId: 'repo-1' });
    expect(state.expandedRepoIds).toEqual([]);

    state = sidebarReducer(state, { type: 'TOGGLE_SANDBOX_EXPANDED', sandboxId: 'sb-1' });
    expect(state.expandedSandboxIds).toEqual(['sb-1']);
    state = sidebarReducer(state, { type: 'TOGGLE_SANDBOX_EXPANDED', sandboxId: 'sb-1' });
    expect(state.expandedSandboxIds).toEqual([]);
  });

  it('SET_RUNNING_AGENTS bails out when the payload is unchanged', () => {
    const first = sidebarReducer(initialSidebarState, {
      type: 'SET_RUNNING_AGENTS',
      runningSandboxIds: ['sb-1'],
      runningThreadKeys: ['claude:sb-1:sess-1'],
    });
    expect(first.runningSandboxIds).toEqual(['sb-1']);
    expect(first.runningThreadKeys).toEqual(['claude:sb-1:sess-1']);

    const second = sidebarReducer(first, {
      type: 'SET_RUNNING_AGENTS',
      runningSandboxIds: ['sb-1'],
      runningThreadKeys: ['claude:sb-1:sess-1'],
    });
    expect(second).toBe(first);

    const third = sidebarReducer(second, {
      type: 'SET_RUNNING_AGENTS',
      runningSandboxIds: [],
      runningThreadKeys: [],
    });
    expect(third.runningSandboxIds).toEqual([]);
  });

  it('keeps switching and collapsed flags', () => {
    let state: SidebarState = sidebarReducer(initialSidebarState, {
      type: 'SET_SWITCHING',
      isSwitching: true,
    });
    state = sidebarReducer(state, { type: 'SET_COLLAPSED', collapsed: true });
    expect(state.isSwitching).toBe(true);
    expect(state.isCollapsed).toBe(true);
  });
});

describe('running agent derivation', () => {
  it('computes running sandboxes and thread keys from sessions', () => {
    const sessions = [
      session({
        tabId: 'tab-1',
        sandboxId: 'sb-1',
        threadId: 'claude:sb-1:sess-1',
        resumeToken: 'sess-1',
      }),
      session({
        tabId: 'tab-2',
        sandboxId: 'sb-2',
        resumeToken: 'sess-2',
        isRunning: () => false,
      }),
      // Legacy session without a sandbox: only its threadId can match.
      session({ tabId: 'tab-3', threadId: 'claude:repo-1:sess-3' }),
    ];

    const { runningSandboxIds, runningThreadKeys } = computeRunningAgentState(sessions);
    expect(runningSandboxIds).toEqual(['sb-1']);
    expect(runningThreadKeys).toEqual([
      'claude:repo-1:sess-3',
      'claude:sb-1:sess-1',
      'sb-1:sess-1',
    ]);
  });

  it('re-evaluates isRunning at compute time (poll catches silent exits)', () => {
    let running = true;
    const sessions = [
      session({ tabId: 'tab-1', sandboxId: 'sb-1', isRunning: () => running }),
    ];
    expect(computeRunningAgentState(sessions).runningSandboxIds).toEqual(['sb-1']);
    running = false;
    expect(computeRunningAgentState(sessions).runningSandboxIds).toEqual([]);
  });

  it('matches chat rows by record id or sandbox + resume token', () => {
    const keys = ['claude:sb-1:sess-1', 'sb-1:sess-1'];
    const byId = thread('claude:sb-1:sess-1', {
      projectId: 'sb-1',
      sandboxId: 'sb-1',
      resumeToken: 'sess-1',
    });
    const byToken = thread('claude:sb-1:other-id', {
      projectId: 'sb-1',
      sandboxId: 'sb-1',
      resumeToken: 'sess-1',
    });
    const miss = thread('claude:sb-2:sess-1', {
      projectId: 'sb-2',
      sandboxId: 'sb-2',
      resumeToken: 'sess-1',
    });

    expect(isThreadRunning(byId, keys)).toBe(true);
    expect(isThreadRunning(byToken, keys)).toBe(true);
    expect(isThreadRunning(miss, keys)).toBe(false);
  });
});
