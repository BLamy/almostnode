import { ScrollArea } from '../ui/scroll-area';
import { useSidebar } from './sidebar-context';
import { ProjectItem } from './project-item';
import { ResumableThreadItem } from './resumable-thread-item';

interface ProjectListProps {
  onSelectProject: (id: string) => void;
  onToggleProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
  onSelectThread: (id: string) => void;
}

export function ProjectList({
  onSelectProject,
  onToggleProject,
  onRenameProject,
  onDeleteProject,
  onSelectThread,
}: ProjectListProps) {
  const { state } = useSidebar();

  if (state.projects.length === 0) {
    return (
      <div style={{ padding: '0.75rem', fontSize: '0.78rem', color: 'var(--muted)' }}>
        No projects yet.
      </div>
    );
  }

  return (
    <ScrollArea style={{ flex: '1 1 0', minHeight: 0 }}>
      <div className="almostnode-project-list">
        {state.projects.map((project) => {
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
        })}
      </div>
    </ScrollArea>
  );
}
