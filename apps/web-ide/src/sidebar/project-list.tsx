import { useSidebar } from './sidebar-context';
import { ProjectItem } from './project-item';
import { ScrollArea } from '../ui/scroll-area';

interface ProjectListProps {
  onSelectProject: (id: string) => void;
  onRenameProject: (id: string, name: string) => void;
  onDeleteProject: (id: string) => void;
}

export function ProjectList({ onSelectProject, onRenameProject, onDeleteProject }: ProjectListProps) {
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1px' }}>
        {state.projects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            isActive={project.id === state.activeProjectId}
            onSelect={onSelectProject}
            onRename={onRenameProject}
            onDelete={onDeleteProject}
          />
        ))}
      </div>
    </ScrollArea>
  );
}
