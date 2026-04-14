import { useCallback, useEffect, useState } from 'react';
import { SidebarProvider, useSidebar } from './sidebar-context';
import { ProjectList } from './project-list';
import { NewProjectDialog } from './new-project-dialog';
import { Button } from '../ui/button';
import { TooltipProvider } from '../ui/tooltip';
import { ProjectManager } from '../features/project-manager';
import type { GitHubRepositorySummary } from '../features/github-repositories';
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
  projectLaunchDialogOpen: boolean;
  onProjectLaunchDialogOpenChange: (open: boolean) => void;
  onActiveProjectChange?: (projectId: string | null) => void;
}

function SidebarInner({
  manager,
  onToggle,
  projectLaunchDialogOpen,
  onProjectLaunchDialogOpenChange,
  onActiveProjectChange,
}: SidebarInnerProps) {
  const { state, dispatch } = useSidebar();
  const [hasGitHubCredentials, setHasGitHubCredentials] = useState(() => manager.hasGitHubCredentials());

  useEffect(() => {
    manager.setCallbacks({
      onProjectsChanged: (projects) => dispatch({ type: 'SET_PROJECTS', projects }),
      onActiveProjectChanged: (projectId) => {
        dispatch({ type: 'SET_ACTIVE_PROJECT', projectId });
        onActiveProjectChange?.(projectId);
      },
      onResumableThreadsChanged: (threads) => dispatch({ type: 'SET_RESUMABLE_THREADS', threads }),
      onSwitchingStateChanged: (isSwitching) => dispatch({ type: 'SET_SWITCHING', isSwitching }),
    });
  }, [manager, dispatch, onActiveProjectChange]);

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

  useEffect(() => {
    if (!projectLaunchDialogOpen) {
      return;
    }
    setHasGitHubCredentials(manager.hasGitHubCredentials());
  }, [manager, projectLaunchDialogOpen]);

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
    async (
      name: string,
      templateId: TemplateId,
      options: { createGitHubRepo: boolean },
    ) => {
      const project = await manager.createProject(name, templateId, options);
      dispatch({
        type: 'SET_EXPANDED_PROJECTS',
        projectIds: Array.from(new Set([...state.expandedProjectIds, project.id])),
      });
      await manager.switchProject(project.id);
      await manager.saveCurrentProject();
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

  const handleGitHubLogin = useCallback(async () => {
    await manager.requestGitHubLogin();
    const nextHasGitHubCredentials = manager.hasGitHubCredentials();
    setHasGitHubCredentials(nextHasGitHubCredentials);
    if (!nextHasGitHubCredentials) {
      throw new Error('GitHub login did not complete. Finish `gh auth login` in the terminal and try again.');
    }
  }, [manager]);

  const handleLoadGitHubRepositories = useCallback(
    () => manager.listGitHubRepositories(),
    [manager],
  );

  const handleImportGitHubRepository = useCallback(
    async (repository: GitHubRepositorySummary) => {
      dispatch({ type: 'SET_ACTIVE_THREAD', threadId: null });
      const project = await manager.importGitHubRepository(repository);
      dispatch({
        type: 'SET_EXPANDED_PROJECTS',
        projectIds: Array.from(new Set([...state.expandedProjectIds, project.id])),
      });
    },
    [dispatch, manager, state.expandedProjectIds],
  );

  return (
    <div className={`almostnode-project-sidebar ${state.isCollapsed ? 'is-collapsed' : ''}`}>
      <div className="almostnode-sidebar__header">
        <span className="almostnode-sidebar__title">Projects</span>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <Button
            variant="ghost"
            size="icon"
            style={{ width: '1.6rem', height: '1.6rem' }}
            aria-label="Create or import project"
            onClick={() => onProjectLaunchDialogOpenChange(true)}
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
        open={projectLaunchDialogOpen}
        onOpenChange={onProjectLaunchDialogOpenChange}
        hasGitHubCredentials={hasGitHubCredentials}
        onCreate={handleCreateProject}
        onLogin={handleGitHubLogin}
        onLoadRepositories={handleLoadGitHubRepositories}
        onImport={handleImportGitHubRepository}
      />
    </div>
  );
}

export interface ProjectSidebarProps {
  manager: ProjectManager;
  isCollapsed: boolean;
  onToggle: () => void;
  projectLaunchDialogOpen: boolean;
  onProjectLaunchDialogOpenChange: (open: boolean) => void;
  onActiveProjectChange?: (projectId: string | null) => void;
}

export function ProjectSidebar({
  manager,
  isCollapsed,
  onToggle,
  projectLaunchDialogOpen,
  onProjectLaunchDialogOpenChange,
  onActiveProjectChange,
}: ProjectSidebarProps) {
  return (
    <TooltipProvider>
      <SidebarProvider>
        <SidebarSyncCollapsed isCollapsed={isCollapsed} />
        <SidebarInner
          manager={manager}
          onToggle={onToggle}
          projectLaunchDialogOpen={projectLaunchDialogOpen}
          onProjectLaunchDialogOpenChange={onProjectLaunchDialogOpenChange}
          onActiveProjectChange={onActiveProjectChange}
        />
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
