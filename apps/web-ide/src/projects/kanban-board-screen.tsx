import { Link, useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import {
  KANBAN_COLUMNS,
  KANBAN_COLUMN_LABELS,
  addKanbanTask,
  deleteKanbanProject,
  deleteKanbanTask,
  moveKanbanTask,
  readKanbanProject,
  type KanbanColumn,
  type KanbanProject,
  type KanbanTask,
} from '../features/kanban-projects';

interface KanbanBoardScreenProps {
  projectId: string;
}

function nextColumn(column: KanbanColumn): KanbanColumn | null {
  if (column === 'backlog') return 'doing';
  if (column === 'doing') return 'done';
  return null;
}

function previousColumn(column: KanbanColumn): KanbanColumn | null {
  if (column === 'done') return 'doing';
  if (column === 'doing') return 'backlog';
  return null;
}

function KanbanCard({
  task,
  onMove,
  onDelete,
}: {
  task: KanbanTask;
  onMove: (column: KanbanColumn) => void;
  onDelete: () => void;
}) {
  const back = previousColumn(task.column);
  const forward = nextColumn(task.column);
  return (
    <div className="kanban-card">
      <h4 className="kanban-card__title">{task.title}</h4>
      {task.description ? <p className="kanban-card__description">{task.description}</p> : null}
      <div className="kanban-card__actions">
        <div className="kanban-card__move">
          {back ? (
            <Button size="sm" variant="ghost" onClick={() => onMove(back)}>
              ← {KANBAN_COLUMN_LABELS[back]}
            </Button>
          ) : null}
          {forward ? (
            <Button size="sm" variant="ghost" onClick={() => onMove(forward)}>
              {KANBAN_COLUMN_LABELS[forward]} →
            </Button>
          ) : null}
        </div>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          Remove
        </Button>
      </div>
    </div>
  );
}

export function KanbanBoardScreen({ projectId }: KanbanBoardScreenProps) {
  const navigate = useNavigate();
  const [project, setProject] = useState<KanbanProject | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setProject(readKanbanProject(projectId));
    setLoaded(true);
  }, [projectId]);

  const tasksByColumn = useMemo(() => {
    const grouped: Record<KanbanColumn, KanbanTask[]> = { backlog: [], doing: [], done: [] };
    if (project) {
      for (const task of project.tasks) {
        grouped[task.column].push(task);
      }
    }
    return grouped;
  }, [project]);

  const refresh = () => {
    setProject(readKanbanProject(projectId));
  };

  const handleAddTask = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!project) return;
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Task title is required.');
      return;
    }
    setError(null);
    addKanbanTask(project.id, {
      title: trimmed,
      description: description.trim(),
      column: 'backlog',
    });
    setTitle('');
    setDescription('');
    refresh();
  };

  const handleMove = (taskId: string, column: KanbanColumn) => {
    if (!project) return;
    moveKanbanTask(project.id, taskId, column);
    refresh();
  };

  const handleDeleteTask = (taskId: string) => {
    if (!project) return;
    deleteKanbanTask(project.id, taskId);
    refresh();
  };

  const handleDeleteProject = () => {
    if (!project) return;
    const confirmed = typeof window !== 'undefined'
      ? window.confirm(`Delete project "${project.name}"? This removes all tasks.`)
      : true;
    if (!confirmed) return;
    deleteKanbanProject(project.id);
    void navigate({ to: '/projects' });
  };

  if (!loaded) {
    return (
      <div className="kanban-route">
        <div className="kanban-route__container">
          <p>Loading…</p>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="kanban-route">
        <div className="kanban-route__container">
          <p>Project not found.</p>
          <Link to="/projects">
            <Button>Back to projects</Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="kanban-route">
      <div className="kanban-route__container">
        <div className="kanban-route__header">
          <div className="kanban-route__heading">
            <p className="projects-route__eyebrow">Project control plane</p>
            <h1 className="kanban-route__title">{project.name}</h1>
            {project.description ? (
              <p className="kanban-route__description">{project.description}</p>
            ) : null}
          </div>
          <div className="kanban-route__actions">
            <Link to="/projects">
              <Button variant="outline">All projects</Button>
            </Link>
            <Button variant="ghost" onClick={handleDeleteProject}>
              Delete project
            </Button>
          </div>
        </div>

        <form className="kanban-route__add-form" onSubmit={handleAddTask}>
          <div className="kanban-route__add-row">
            <span>Queue a new task for the backlog</span>
            <Input
              placeholder="What needs to happen next?"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </div>
          <div className="kanban-route__add-row">
            <Input
              placeholder="Description (optional)"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          {error ? (
            <div className="app-builder-route__message app-builder-route__message--error">
              {error}
            </div>
          ) : null}
          <div className="projects-route__form-actions">
            <Button type="submit">Add to backlog</Button>
          </div>
        </form>

        <div className="kanban-route__board">
          {KANBAN_COLUMNS.map((column) => {
            const tasks = tasksByColumn[column];
            return (
              <div key={column} className="kanban-column">
                <div className="kanban-column__header">
                  <span>{KANBAN_COLUMN_LABELS[column]}</span>
                  <span className="kanban-column__count">{tasks.length}</span>
                </div>
                {tasks.length === 0 ? (
                  <div className="kanban-column__empty">
                    {column === 'backlog'
                      ? 'Queue work here.'
                      : column === 'doing'
                        ? 'Nothing in progress.'
                        : 'Nothing shipped yet.'}
                  </div>
                ) : (
                  tasks.map((task) => (
                    <KanbanCard
                      key={task.id}
                      task={task}
                      onMove={(nextCol) => handleMove(task.id, nextCol)}
                      onDelete={() => handleDeleteTask(task.id)}
                    />
                  ))
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
