export const KANBAN_PROJECTS_STORAGE_KEY = 'almostnode.webide.kanbanProjects.v1';

export type KanbanColumn = 'backlog' | 'doing' | 'done';

export const KANBAN_COLUMNS: readonly KanbanColumn[] = ['backlog', 'doing', 'done'];

export const KANBAN_COLUMN_LABELS: Record<KanbanColumn, string> = {
  backlog: 'Backlog',
  doing: 'Doing',
  done: 'Done',
};

export interface KanbanTask {
  id: string;
  title: string;
  description: string;
  column: KanbanColumn;
  createdAt: number;
  updatedAt: number;
}

export interface KanbanProject {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
  tasks: KanbanTask[];
}

export interface KanbanStore {
  projects: KanbanProject[];
}

function emptyStore(): KanbanStore {
  return { projects: [] };
}

function coerceColumn(value: unknown): KanbanColumn {
  return value === 'doing' || value === 'done' ? value : 'backlog';
}

function normalizeTask(value: unknown, fallbackIndex: number): KanbanTask | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<KanbanTask>;
  const id = String(raw.id || `task-${Date.now()}-${fallbackIndex}`);
  const title = String(raw.title || '').trim();
  if (!title) return null;
  const now = Date.now();
  return {
    id,
    title,
    description: String(raw.description || ''),
    column: coerceColumn(raw.column),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
  };
}

function normalizeProject(value: unknown, fallbackIndex: number): KanbanProject | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<KanbanProject> & { tasks?: unknown };
  const id = String(raw.id || `project-${Date.now()}-${fallbackIndex}`);
  const name = String(raw.name || '').trim();
  if (!name) return null;
  const now = Date.now();
  const rawTasks = Array.isArray(raw.tasks) ? raw.tasks : [];
  const tasks = rawTasks
    .map((task, index) => normalizeTask(task, index))
    .filter((task): task is KanbanTask => task !== null);
  return {
    id,
    name,
    description: String(raw.description || ''),
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : now,
    tasks,
  };
}

function safeLocalStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readKanbanStore(): KanbanStore {
  const storage = safeLocalStorage();
  if (!storage) return emptyStore();
  try {
    const raw = storage.getItem(KANBAN_PROJECTS_STORAGE_KEY);
    if (!raw) return emptyStore();
    const parsed = JSON.parse(raw) as { projects?: unknown };
    const rawProjects = Array.isArray(parsed.projects) ? parsed.projects : [];
    const projects = rawProjects
      .map((project, index) => normalizeProject(project, index))
      .filter((project): project is KanbanProject => project !== null);
    return { projects };
  } catch {
    return emptyStore();
  }
}

export function writeKanbanStore(store: KanbanStore): void {
  const storage = safeLocalStorage();
  if (!storage) return;
  try {
    storage.setItem(KANBAN_PROJECTS_STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Quota/serialization errors — drop the write rather than crash.
  }
}

function generateId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${random}`;
}

export function createKanbanProject(input: {
  name: string;
  description?: string;
  seedDoneTasks?: Array<{ title: string; description?: string }>;
}): KanbanProject {
  const now = Date.now();
  const tasks: KanbanTask[] = (input.seedDoneTasks ?? []).map((seed, index) => ({
    id: generateId(`task-${index}`),
    title: seed.title,
    description: seed.description ?? '',
    column: 'done',
    createdAt: now,
    updatedAt: now,
  }));
  const project: KanbanProject = {
    id: generateId('project'),
    name: input.name.trim(),
    description: (input.description ?? '').trim(),
    createdAt: now,
    updatedAt: now,
    tasks,
  };
  const store = readKanbanStore();
  store.projects.push(project);
  writeKanbanStore(store);
  return project;
}

export function addKanbanTask(
  projectId: string,
  input: { title: string; description?: string; column?: KanbanColumn },
): KanbanTask | null {
  const store = readKanbanStore();
  const project = store.projects.find((candidate) => candidate.id === projectId);
  if (!project) return null;
  const now = Date.now();
  const task: KanbanTask = {
    id: generateId('task'),
    title: input.title.trim(),
    description: (input.description ?? '').trim(),
    column: input.column ?? 'backlog',
    createdAt: now,
    updatedAt: now,
  };
  project.tasks.push(task);
  project.updatedAt = now;
  writeKanbanStore(store);
  return task;
}

export function moveKanbanTask(
  projectId: string,
  taskId: string,
  column: KanbanColumn,
): KanbanTask | null {
  const store = readKanbanStore();
  const project = store.projects.find((candidate) => candidate.id === projectId);
  if (!project) return null;
  const task = project.tasks.find((candidate) => candidate.id === taskId);
  if (!task) return null;
  task.column = column;
  task.updatedAt = Date.now();
  project.updatedAt = task.updatedAt;
  writeKanbanStore(store);
  return task;
}

export function deleteKanbanTask(projectId: string, taskId: string): boolean {
  const store = readKanbanStore();
  const project = store.projects.find((candidate) => candidate.id === projectId);
  if (!project) return false;
  const nextTasks = project.tasks.filter((task) => task.id !== taskId);
  if (nextTasks.length === project.tasks.length) return false;
  project.tasks = nextTasks;
  project.updatedAt = Date.now();
  writeKanbanStore(store);
  return true;
}

export function deleteKanbanProject(projectId: string): boolean {
  const store = readKanbanStore();
  const nextProjects = store.projects.filter((project) => project.id !== projectId);
  if (nextProjects.length === store.projects.length) return false;
  writeKanbanStore({ projects: nextProjects });
  return true;
}

export function readKanbanProject(projectId: string): KanbanProject | null {
  const store = readKanbanStore();
  return store.projects.find((project) => project.id === projectId) ?? null;
}
