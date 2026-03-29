import { createContext, useContext, useReducer, useCallback, type ReactNode, type Dispatch } from 'react';
import type { ProjectRecord, ChatThread } from '../features/project-db';

// ── State ─────────────────────────────────────────────────────────────────────

export interface SidebarState {
  projects: ProjectRecord[];
  activeProjectId: string | null;
  chatThreads: ChatThread[];
  activeChatThreadId: string | null;
  isCollapsed: boolean;
  isSwitching: boolean;
}

const initialState: SidebarState = {
  projects: [],
  activeProjectId: null,
  chatThreads: [],
  activeChatThreadId: null,
  isCollapsed: false,
  isSwitching: false,
};

// ── Actions ───────────────────────────────────────────────────────────────────

export type SidebarAction =
  | { type: 'SET_PROJECTS'; projects: ProjectRecord[] }
  | { type: 'SET_ACTIVE_PROJECT'; projectId: string | null }
  | { type: 'SET_CHAT_THREADS'; threads: ChatThread[] }
  | { type: 'SET_ACTIVE_CHAT_THREAD'; threadId: string | null }
  | { type: 'TOGGLE_COLLAPSED' }
  | { type: 'SET_COLLAPSED'; collapsed: boolean }
  | { type: 'SET_SWITCHING'; isSwitching: boolean };

function sidebarReducer(state: SidebarState, action: SidebarAction): SidebarState {
  switch (action.type) {
    case 'SET_PROJECTS':
      return { ...state, projects: action.projects };
    case 'SET_ACTIVE_PROJECT':
      return { ...state, activeProjectId: action.projectId };
    case 'SET_CHAT_THREADS':
      return { ...state, chatThreads: action.threads };
    case 'SET_ACTIVE_CHAT_THREAD':
      return { ...state, activeChatThreadId: action.threadId };
    case 'TOGGLE_COLLAPSED':
      return { ...state, isCollapsed: !state.isCollapsed };
    case 'SET_COLLAPSED':
      return { ...state, isCollapsed: action.collapsed };
    case 'SET_SWITCHING':
      return { ...state, isSwitching: action.isSwitching };
    default:
      return state;
  }
}

// ── Context ───────────────────────────────────────────────────────────────────

interface SidebarContextValue {
  state: SidebarState;
  dispatch: Dispatch<SidebarAction>;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(sidebarReducer, initialState);

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
