import { useMemo } from 'react';
import { ScrollArea } from '../ui/scroll-area';
import { useSidebar } from './sidebar-context';
import { ProjectItem } from './project-item';
import { ResumableThreadItem } from './resumable-thread-item';
import { groupSidebarProjects } from './github-projects';
import type { ProjectRecord } from '../features/project-db';

interface ProjectListProps {
  onSelectProject: (id: string) => void;
  onToggleProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  onSelectThread: (id: string) => void;
  onNewThread: (projectId: string) => void;
}

export function ProjectList({
  onSelectProject,
  onToggleProject,
  onRenameProject,
  onDeleteProject,
  onSelectThread,
  onNewThread,
}: ProjectListProps) {
  const { state } = useSidebar();
  // Only imported projects are listed — un-imported GitHub repositories are
  // added through the New Project dialog, never shown here.
  const groups = useMemo(
    () => groupSidebarProjects(state.projects, null),
    [state.projects],
  );

  const renderProject = (project: ProjectRecord) => {
    const threads = state.projectThreads[project.id] ?? [];
    const isExpanded = state.expandedProjectIds.includes(project.id);
    return (
      <ProjectItem
        key={project.id}
        project={project}
        isActive={project.id === state.activeProjectId}
        isExpanded={isExpanded}
        onSelect={onSelectProject}
        onToggleExpanded={onToggleProject}
        onRename={onRenameProject}
        onDelete={onDeleteProject}
        onNewThread={onNewThread}
      >
        <div className="almostnode-project-group__threads">
          {threads.length === 0 ? (
            <div className="almostnode-project-group__empty">No threads</div>
          ) : (
            threads.map((thread) => (
              <ResumableThreadItem
                key={thread.id}
                thread={thread}
                isActive={thread.id === state.activeThreadId}
                onSelect={onSelectThread}
              />
            ))
          )}
        </div>
      </ProjectItem>
    );
  };

  return (
    <ScrollArea style={{ flex: '1 1 0', minHeight: 0 }}>
      <div className="almostnode-project-list">
        <div className="almostnode-sidebar-section" data-testid="github-section">
          <div className="almostnode-sidebar-section__header">
            <span className="almostnode-sidebar-section__title">GitHub</span>
          </div>
          {groups.unlistedGitHubProjects.length === 0 ? (
            <div className="almostnode-project-group__empty">
              Import repositories from the New project dialog.
            </div>
          ) : (
            groups.unlistedGitHubProjects.map(renderProject)
          )}
        </div>

        <div className="almostnode-sidebar-section" data-testid="no-source-control-section">
          <div className="almostnode-sidebar-section__header">
            <span className="almostnode-sidebar-section__title">No source control</span>
          </div>
          {groups.noSourceControl.length === 0 ? (
            <div className="almostnode-project-group__empty">
              Local-only projects appear here.
            </div>
          ) : (
            groups.noSourceControl.map(renderProject)
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
