import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { ProjectRecord, ResumableThreadRecord, SandboxRecord } from '../features/project-db';

export interface SidebarState {
  /** Repo rows (legacy "projects" — every repo is a project record). */
  repos: ProjectRecord[];
  sandboxesByRepo: Record<string, SandboxRecord[]>;
  /** Chats grouped under their owning sandbox. */
  chatsBySandbox: Record<string, ResumableThreadRecord[]>;
  /** Old project-keyed threads that predate the sandbox model, by repo id. */
  legacyRepoThreads: Record<string, ResumableThreadRecord[]>;
  activeRepoId: string | null;
  /** Sandbox shown in the workbench; null when a repo base (read-only) is open. */
  activeSandboxId: string | null;
  activeChatId: string | null;
  expandedRepoIds: string[];
  expandedSandboxIds: string[];
  isCollapsed: boolean;
  isSwitching: boolean;
  /** Sandboxes with at least one running agent session. */
  runningSandboxIds: string[];
  /** Keys identifying threads with a running session; see running-agents.ts. */
  runningThreadKeys: string[];
  /**
   * Raw thread list as last received. Kept so chats can be regrouped when
   * the sandbox list arrives after the threads (grouping needs to know
   * which ids are sandbox ids — legacy records carry sandboxId === projectId).
   */
  threads: ResumableThreadRecord[];
}

export const initialSidebarState: SidebarState = {
  repos: [],
  sandboxesByRepo: {},
  chatsBySandbox: {},
  legacyRepoThreads: {},
  activeRepoId: null,
  activeSandboxId: null,
  activeChatId: null,
  expandedRepoIds: [],
  expandedSandboxIds: [],
  isCollapsed: false,
  isSwitching: false,
  runningSandboxIds: [],
  runningThreadKeys: [],
  threads: [],
};

export type SidebarAction =
  | { type: 'SET_REPOS'; repos: ProjectRecord[] }
  | { type: 'SET_ACTIVE_REPO'; repoId: string | null }
  | { type: 'SET_SANDBOXES'; sandboxesByRepo: Record<string, SandboxRecord[]> }
  | { type: 'SET_ACTIVE_SANDBOX'; sandboxId: string | null }
  | { type: 'SET_RESUMABLE_THREADS'; threads: ResumableThreadRecord[] }
  | { type: 'SET_ACTIVE_CHAT'; chatId: string | null }
  | { type: 'TOGGLE_REPO_EXPANDED'; repoId: string }
  | { type: 'SET_EXPANDED_REPOS'; repoIds: string[] }
  | { type: 'TOGGLE_SANDBOX_EXPANDED'; sandboxId: string }
  | { type: 'SET_EXPANDED_SANDBOXES'; sandboxIds: string[] }
  | { type: 'SET_COLLAPSED'; collapsed: boolean }
  | { type: 'SET_SWITCHING'; isSwitching: boolean }
  | { type: 'SET_RUNNING_AGENTS'; runningSandboxIds: string[]; runningThreadKeys: string[] };

interface GroupedThreads {
  chatsBySandbox: Record<string, ResumableThreadRecord[]>;
  legacyRepoThreads: Record<string, ResumableThreadRecord[]>;
}

/**
 * Split threads into sandbox chats and legacy repo-level threads. A thread
 * belongs to a sandbox iff its `sandboxId` is a known sandbox id (legacy
 * records carry `sandboxId === projectId`, so shape alone can't distinguish).
 * A legacy thread that duplicates a sandbox chat of the same repo (same
 * harness + resume token, discovered through the active-session VFS while
 * that sandbox was open) is dropped.
 */
export function groupSidebarThreads(
  threads: ResumableThreadRecord[],
  sandboxesByRepo: Record<string, SandboxRecord[]>,
): GroupedThreads {
  const sandboxRepoIds = new Map<string, string>();
  for (const [repoId, sandboxes] of Object.entries(sandboxesByRepo)) {
    for (const sandbox of sandboxes) {
      sandboxRepoIds.set(sandbox.id, repoId);
    }
  }

  const chatsBySandbox: Record<string, ResumableThreadRecord[]> = {};
  const legacyRepoThreads: Record<string, ResumableThreadRecord[]> = {};
  const sandboxChatTokens = new Set<string>();

  for (const thread of threads) {
    const repoId = thread.sandboxId ? sandboxRepoIds.get(thread.sandboxId) : undefined;
    if (thread.sandboxId && repoId) {
      (chatsBySandbox[thread.sandboxId] ??= []).push(thread);
      sandboxChatTokens.add(`${repoId}:${thread.harness}:${thread.resumeToken}`);
    }
  }

  for (const thread of threads) {
    if (thread.sandboxId && sandboxRepoIds.has(thread.sandboxId)) {
      continue;
    }
    if (sandboxChatTokens.has(`${thread.projectId}:${thread.harness}:${thread.resumeToken}`)) {
      continue;
    }
    (legacyRepoThreads[thread.projectId] ??= []).push(thread);
  }

  return { chatsBySandbox, legacyRepoThreads };
}

function sameStringArray(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function sidebarReducer(state: SidebarState, action: SidebarAction): SidebarState {
  switch (action.type) {
    case 'SET_REPOS':
      return { ...state, repos: action.repos };
    case 'SET_ACTIVE_REPO':
      return { ...state, activeRepoId: action.repoId };
    case 'SET_SANDBOXES':
      return {
        ...state,
        sandboxesByRepo: action.sandboxesByRepo,
        ...groupSidebarThreads(state.threads, action.sandboxesByRepo),
      };
    case 'SET_ACTIVE_SANDBOX':
      return { ...state, activeSandboxId: action.sandboxId };
    case 'SET_RESUMABLE_THREADS':
      return {
        ...state,
        threads: action.threads,
        ...groupSidebarThreads(action.threads, state.sandboxesByRepo),
      };
    case 'SET_ACTIVE_CHAT':
      return { ...state, activeChatId: action.chatId };
    case 'TOGGLE_REPO_EXPANDED':
      return {
        ...state,
        expandedRepoIds: state.expandedRepoIds.includes(action.repoId)
          ? state.expandedRepoIds.filter((repoId) => repoId !== action.repoId)
          : [...state.expandedRepoIds, action.repoId],
      };
    case 'SET_EXPANDED_REPOS':
      return { ...state, expandedRepoIds: action.repoIds };
    case 'TOGGLE_SANDBOX_EXPANDED':
      return {
        ...state,
        expandedSandboxIds: state.expandedSandboxIds.includes(action.sandboxId)
          ? state.expandedSandboxIds.filter((sandboxId) => sandboxId !== action.sandboxId)
          : [...state.expandedSandboxIds, action.sandboxId],
      };
    case 'SET_EXPANDED_SANDBOXES':
      return { ...state, expandedSandboxIds: action.sandboxIds };
    case 'SET_COLLAPSED':
      return { ...state, isCollapsed: action.collapsed };
    case 'SET_SWITCHING':
      return { ...state, isSwitching: action.isSwitching };
    case 'SET_RUNNING_AGENTS':
      // The 2s poll re-dispatches identical payloads; bail out so the whole
      // sidebar doesn't re-render when nothing changed.
      if (
        sameStringArray(state.runningSandboxIds, action.runningSandboxIds)
        && sameStringArray(state.runningThreadKeys, action.runningThreadKeys)
      ) {
        return state;
      }
      return {
        ...state,
        runningSandboxIds: action.runningSandboxIds,
        runningThreadKeys: action.runningThreadKeys,
      };
    default:
      return state;
  }
}

interface SidebarContextValue {
  state: SidebarState;
  dispatch: Dispatch<SidebarAction>;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(sidebarReducer, initialSidebarState);

  return (
    <SidebarContext.Provider value={{ state, dispatch }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error('useSidebar must be used within a SidebarProvider');
  }
  return ctx;
}
