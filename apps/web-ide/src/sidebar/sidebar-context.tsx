import { createContext, useContext, useReducer, type Dispatch, type ReactNode } from 'react';
import type { ProjectRecord, ResumableThreadRecord } from '../features/project-db';

export interface SidebarState {
  projects: ProjectRecord[];
  projectThreads: Record<string, ResumableThreadRecord[]>;
  activeProjectId: string | null;
  activeThreadId: string | null;
  expandedProjectIds: string[];
  isCollapsed: boolean;
  isSwitching: boolean;
}

const initialState: SidebarState = {
  projects: [],
  projectThreads: {},
  activeProjectId: null,
  activeThreadId: null,
  expandedProjectIds: [],
  isCollapsed: false,
  isSwitching: false,
};

export type SidebarAction =
  | { type: 'SET_PROJECTS'; projects: ProjectRecord[] }
  | { type: 'SET_ACTIVE_PROJECT'; projectId: string | null }
  | { type: 'SET_RESUMABLE_THREADS'; threads: ResumableThreadRecord[] }
  | { type: 'SET_ACTIVE_THREAD'; threadId: string | null }
  | { type: 'TOGGLE_PROJECT_EXPANDED'; projectId: string }
  | { type: 'SET_EXPANDED_PROJECTS'; projectIds: string[] }
  | { type: 'SET_COLLAPSED'; collapsed: boolean }
  | { type: 'SET_SWITCHING'; isSwitching: boolean };

function groupThreadsByProject(
  threads: ResumableThreadRecord[],
): Record<string, ResumableThreadRecord[]> {
  const grouped: Record<string, ResumableThreadRecord[]> = {};
  for (const thread of threads) {
    if (!grouped[thread.projectId]) {
      grouped[thread.projectId] = [];
    }
    grouped[thread.projectId]!.push(thread);
  }
  return grouped;
}

function sidebarReducer(state: SidebarState, action: SidebarAction): SidebarState {
  switch (action.type) {
    case 'SET_PROJECTS':
      return { ...state, projects: action.projects };
    case 'SET_ACTIVE_PROJECT':
      return { ...state, activeProjectId: action.projectId };
    case 'SET_RESUMABLE_THREADS':
      return {
        ...state,
        projectThreads: groupThreadsByProject(action.threads),
      };
    case 'SET_ACTIVE_THREAD':
      return { ...state, activeThreadId: action.threadId };
    case 'TOGGLE_PROJECT_EXPANDED':
      return {
        ...state,
        expandedProjectIds: state.expandedProjectIds.includes(action.projectId)
          ? state.expandedProjectIds.filter((projectId) => projectId !== action.projectId)
          : [...state.expandedProjectIds, action.projectId],
      };
    case 'SET_EXPANDED_PROJECTS':
      return { ...state, expandedProjectIds: action.projectIds };
    case 'SET_COLLAPSED':
      return { ...state, isCollapsed: action.collapsed };
    case 'SET_SWITCHING':
      return { ...state, isSwitching: action.isSwitching };
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
