import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  createKanbanProject,
  readKanbanStore,
  KANBAN_COLUMN_LABELS,
  type KanbanColumn,
  type KanbanProject,
} from '../features/kanban-projects';

function countByColumn(project: KanbanProject): Record<KanbanColumn, number> {
  const counts: Record<KanbanColumn, number> = { backlog: 0, doing: 0, done: 0 };
  for (const task of project.tasks) {
    counts[task.column] += 1;
  }
  return counts;
}

function formatDate(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return '';
  }
}

export function ProjectsScreen() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<KanbanProject[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProjects(readKanbanStore().projects);
  }, []);

  const handleCreate = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Project name is required.');
      return;
    }
    setError(null);
    const project = createKanbanProject({
      name: trimmed,
      description: description.trim(),
      seedDoneTasks: [
        { title: 'Complete app-builder onboarding', description: 'All six service sign-ins and builder configuration are in place.' },
      ],
    });
    setName('');
    setDescription('');
    setProjects((current) => [...current, project]);
    void navigate({ to: '/projects/$projectId', params: { projectId: project.id } });
  };

  return (
    <div className="projects-route">
      <div className="projects-route__container">
        <div className="projects-route__header">
          <div className="projects-route__heading">
            <p className="projects-route__eyebrow">Project control plane</p>
            <h1 className="projects-route__title">Your app-building projects</h1>
            <p className="projects-route__lede">
              Each project has its own kanban board with Backlog, Doing, and Done columns. Completed
              app-builder work lands in Done; queue future work into Backlog.
            </p>
          </div>
          <Link to="/app-builder">
            <Button variant="outline">Back to app builder</Button>
          </Link>
        </div>

        <div className="projects-route__create-card">
          <h2 style={{ margin: '0 0 0.85rem', fontSize: '1.1rem' }}>Create a new project</h2>
          <form className="projects-route__create-form" onSubmit={handleCreate}>
            <label className="projects-route__form-row">
              <span>Project name</span>
              <Input
                placeholder="my-next-app"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="projects-route__form-row">
              <span>Description (optional)</span>
              <Input
                placeholder="What is this app about?"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </label>
            {error ? (
              <div className="app-builder-route__message app-builder-route__message--error">
                {error}
              </div>
            ) : null}
            <div className="projects-route__form-actions">
              <Button type="submit">Create project</Button>
            </div>
          </form>
        </div>

        <div className="projects-route__list-card">
          <h2 style={{ margin: '0 0 0.85rem', fontSize: '1.1rem' }}>Projects</h2>
          {projects.length === 0 ? (
            <div className="projects-route__empty">
              No projects yet. Create your first project above.
            </div>
          ) : (
            <div className="projects-route__list">
              {projects.map((project) => {
                const counts = countByColumn(project);
                return (
                  <Link
                    key={project.id}
                    to="/projects/$projectId"
                    params={{ projectId: project.id }}
                    className="projects-route__card"
                  >
                    <h3 className="projects-route__card-name">{project.name}</h3>
                    <p className="projects-route__card-description">
                      {project.description || 'No description yet.'}
                    </p>
                    <div className="projects-route__card-meta">
                      <span>{KANBAN_COLUMN_LABELS.backlog}: {counts.backlog}</span>
                      <span>{KANBAN_COLUMN_LABELS.doing}: {counts.doing}</span>
                      <span>{KANBAN_COLUMN_LABELS.done}: {counts.done}</span>
                      <span>Updated {formatDate(project.updatedAt)}</span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
