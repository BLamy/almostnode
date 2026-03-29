import { useCallback, useEffect, useState } from 'react';
import { SidebarProvider, useSidebar } from './sidebar-context';
import { ProjectList } from './project-list';
import { NewProjectDialog } from './new-project-dialog';
import { Button } from '../ui/button';
import { TooltipProvider } from '../ui/tooltip';
import { ProjectManager } from '../features/project-manager';
import type { TemplateId } from '../features/workspace-seed';
import './sidebar.css';

const EXPANDED_PROJECTS_KEY = 'almostnode-expanded-project-ids';

function readExpandedProjectIds(): string[] {
  try {
    const raw = localStorage.getItem(EXPANDED_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

function writeExpandedProjectIds(projectIds: string[]): void {
  try {
    localStorage.setItem(EXPANDED_PROJECTS_KEY, JSON.stringify(projectIds));
  } catch {
    // Ignore storage failures.
  }
}

interface SidebarInnerProps {
  manager: ProjectManager;
  onToggle: () => void;
}

function SidebarInner({ manager, onToggle }: SidebarInnerProps) {
  const { state, dispatch } = useSidebar();
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  useEffect(() => {
    manager.setCallbacks({
      onProjectsChanged: (projects) => dispatch({ type: 'SET_PROJECTS', projects }),
      onActiveProjectChanged: (projectId) => dispatch({ type: 'SET_ACTIVE_PROJECT', projectId }),
      onResumableThreadsChanged: (threads) => dispatch({ type: 'SET_RESUMABLE_THREADS', threads }),
      onSwitchingStateChanged: (isSwitching) => dispatch({ type: 'SET_SWITCHING', isSwitching }),
    });
  }, [manager, dispatch]);

  useEffect(() => {
    dispatch({ type: 'SET_EXPANDED_PROJECTS', projectIds: readExpandedProjectIds() });
  }, [dispatch]);

  useEffect(() => {
    if (!state.activeProjectId || state.expandedProjectIds.includes(state.activeProjectId)) {
      return;
    }

    dispatch({
      type: 'SET_EXPANDED_PROJECTS',
      projectIds: [...state.expandedProjectIds, state.activeProjectId],
    });
  }, [state.activeProjectId, state.expandedProjectIds, dispatch]);

  useEffect(() => {
    writeExpandedProjectIds(state.expandedProjectIds);
  }, [state.expandedProjectIds]);

  const handleSelectProject = useCallback(
    (id: string) => {
      dispatch({ type: 'SET_ACTIVE_THREAD', threadId: null });
      void manager.switchProject(id);
    },
    [dispatch, manager],
  );

  const handleToggleProject = useCallback(
    (id: string) => {
      dispatch({ type: 'TOGGLE_PROJECT_EXPANDED', projectId: id });
    },
    [dispatch],
  );

  const handleRenameProject = useCallback(
    (id: string, name: string) => {
      void manager.renameProject(id, name);
    },
    [manager],
  );

  const handleDeleteProject = useCallback(
    (id: string) => {
      void manager.deleteProject(id);
    },
    [manager],
  );

  const handleCreateProject = useCallback(
    (name: string, templateId: TemplateId) => {
      void (async () => {
        const project = await manager.createProject(name, templateId);
        dispatch({
          type: 'SET_EXPANDED_PROJECTS',
          projectIds: Array.from(new Set([...state.expandedProjectIds, project.id])),
        });
        await manager.switchProject(project.id);
      })();
    },
    [dispatch, manager, state.expandedProjectIds],
  );

  const handleSelectThread = useCallback(
    (id: string) => {
      dispatch({ type: 'SET_ACTIVE_THREAD', threadId: id });
      void manager.resumeThread(id);
    },
    [dispatch, manager],
  );

  return (
    <div className={`almostnode-project-sidebar ${state.isCollapsed ? 'is-collapsed' : ''}`}>
      <div className="almostnode-sidebar__header">
        <span className="almostnode-sidebar__title">Threads</span>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setNewProjectOpen(true)}
            style={{ width: '1.6rem', height: '1.6rem' }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </Button>
          <button className="almostnode-sidebar__toggle" onClick={onToggle} type="button">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <ProjectList
        onSelectProject={handleSelectProject}
        onToggleProject={handleToggleProject}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
        onSelectThread={handleSelectThread}
      />

      {state.isSwitching && (
        <div className="almostnode-sidebar__switching-overlay">
          <div className="almostnode-sidebar__switching-spinner" />
        </div>
      )}

      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        onCreate={handleCreateProject}
      />
    </div>
  );
}

export interface ProjectSidebarProps {
  manager: ProjectManager;
  isCollapsed: boolean;
  onToggle: () => void;
}

export function ProjectSidebar({ manager, isCollapsed, onToggle }: ProjectSidebarProps) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <SidebarSyncCollapsed isCollapsed={isCollapsed} />
        <SidebarInner manager={manager} onToggle={onToggle} />
      </SidebarProvider>
    </TooltipProvider>
  );
}

function SidebarSyncCollapsed({ isCollapsed }: { isCollapsed: boolean }) {
  const { dispatch } = useSidebar();
  useEffect(() => {
    dispatch({ type: 'SET_COLLAPSED', collapsed: isCollapsed });
  }, [isCollapsed, dispatch]);
  return null;
}
