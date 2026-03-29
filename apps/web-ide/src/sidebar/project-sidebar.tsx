import { useEffect, useState, useCallback, useRef } from 'react';
import { SidebarProvider, useSidebar } from './sidebar-context';
import { ProjectList } from './project-list';
import { ChatThreadList } from './chat-thread-list';
import { NewProjectDialog } from './new-project-dialog';
import { Separator } from '../ui/separator';
import { Button } from '../ui/button';
import { TooltipProvider } from '../ui/tooltip';
import { ProjectManager, type ProjectManagerHost } from '../features/project-manager';
import type { TemplateId } from '../features/workspace-seed';
import './sidebar.css';

// ── Inner component that uses context ─────────────────────────────────────────

interface SidebarInnerProps {
  manager: ProjectManager;
  onToggle: () => void;
}

function SidebarInner({ manager, onToggle }: SidebarInnerProps) {
  const { state, dispatch } = useSidebar();
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  // Wire manager callbacks to dispatch
  useEffect(() => {
    manager.setCallbacks({
      onProjectsChanged: (projects) => dispatch({ type: 'SET_PROJECTS', projects }),
      onActiveProjectChanged: (projectId) => dispatch({ type: 'SET_ACTIVE_PROJECT', projectId }),
      onChatThreadsChanged: (threads) => dispatch({ type: 'SET_CHAT_THREADS', threads }),
      onSwitchingStateChanged: (isSwitching) => dispatch({ type: 'SET_SWITCHING', isSwitching }),
    });
  }, [manager, dispatch]);

  const handleSelectProject = useCallback(
    (id: string) => {
      void manager.switchProject(id);
    },
    [manager],
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
        await manager.switchProject(project.id);
      })();
    },
    [manager],
  );

  const handleSelectThread = useCallback(
    (id: string) => {
      dispatch({ type: 'SET_ACTIVE_CHAT_THREAD', threadId: id });
    },
    [dispatch],
  );

  const handleCreateThread = useCallback(() => {
    void manager.createChatThread('New Chat');
  }, [manager]);

  return (
    <div
      className={`almostnode-project-sidebar ${state.isCollapsed ? 'is-collapsed' : ''}`}
    >
      {/* Header */}
      <div className="almostnode-sidebar__header">
        <span className="almostnode-sidebar__title">Projects</span>
        <div style={{ display: 'flex', gap: '0.25rem' }}>
          <Button variant="ghost" size="icon" onClick={() => setNewProjectOpen(true)} style={{ width: '1.6rem', height: '1.6rem' }}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
              <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </Button>
          <button className="almostnode-sidebar__toggle" onClick={onToggle}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 4h10M3 8h10M3 12h10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Project list */}
      <ProjectList
        onSelectProject={handleSelectProject}
        onRenameProject={handleRenameProject}
        onDeleteProject={handleDeleteProject}
      />

      <Separator />

      {/* Chat threads */}
      <ChatThreadList onSelectThread={handleSelectThread} onCreateThread={handleCreateThread} />

      {/* Switching overlay */}
      {state.isSwitching && (
        <div className="almostnode-sidebar__switching-overlay">
          <div className="almostnode-sidebar__switching-spinner" />
        </div>
      )}

      {/* New Project Dialog */}
      <NewProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
        onCreate={handleCreateProject}
      />
    </div>
  );
}

// ── Public component ───────────���──────────────────────────────────────────────

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

/** Syncs external collapsed state into the sidebar context */
function SidebarSyncCollapsed({ isCollapsed }: { isCollapsed: boolean }) {
  const { dispatch } = useSidebar();
  useEffect(() => {
    dispatch({ type: 'SET_COLLAPSED', collapsed: isCollapsed });
  }, [isCollapsed, dispatch]);
  return null;
}
