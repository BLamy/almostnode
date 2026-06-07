import { ProjectDB, type AppBuildingJobRecord } from '../features/project-db';

const PROJECTS_STORAGE_KEY = 'almostnode.appBuilder.controlPlane.projects.v1';

export interface ControlPlaneProject {
  id: string;
  name: string;
  createdAt: number;
  flyAppName: string | null;
  imageRef: string | null;
  defaultPrompt?: string | null;
}

interface StoredProjects {
  version: 1;
  projects: ControlPlaneProject[];
}

export function listControlPlaneProjects(): ControlPlaneProject[] {
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredProjects;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.projects)) return [];
    return parsed.projects.filter(
      (project): project is ControlPlaneProject =>
        typeof project?.id === 'string' &&
        typeof project.name === 'string' &&
        typeof project.createdAt === 'number',
    );
  } catch {
    return [];
  }
}

function writeProjects(projects: ControlPlaneProject[]): void {
  const payload: StoredProjects = { version: 1, projects };
  localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(payload));
}

export function upsertControlPlaneProject(project: ControlPlaneProject): void {
  const current = listControlPlaneProjects();
  const next = [
    ...current.filter((existing) => existing.id !== project.id),
    project,
  ].sort((a, b) => b.createdAt - a.createdAt);
  writeProjects(next);
}

export function deleteControlPlaneProject(id: string): void {
  writeProjects(listControlPlaneProjects().filter((project) => project.id !== id));
}

// ── Jobs (backed by the existing IndexedDB store) ────────────────────────────

const db = new ProjectDB();

export async function listJobsForProject(projectId: string): Promise<AppBuildingJobRecord[]> {
  return db.listAppBuildingJobs(projectId);
}

export async function listAllJobs(): Promise<AppBuildingJobRecord[]> {
  const projects = listControlPlaneProjects();
  const jobsByProject = await Promise.all(
    projects.map((project) => db.listAppBuildingJobs(project.id)),
  );
  return jobsByProject.flat();
}

export async function putJob(job: AppBuildingJobRecord): Promise<void> {
  await db.putAppBuildingJob(job);
}

export async function getJob(id: string): Promise<AppBuildingJobRecord | undefined> {
  return db.getAppBuildingJob(id);
}

export function createProjectId(): string {
  return `cp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createJobId(): string {
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Kanban column schema — matches the template's status model.
export const BOARD_COLUMNS = [
  { key: 'starting', label: 'Starting', statuses: ['starting'] as const },
  { key: 'processing', label: 'In flight', statuses: ['processing'] as const },
  { key: 'idle', label: 'Waiting', statuses: ['idle'] as const },
  {
    key: 'stopped',
    label: 'Stopped',
    statuses: ['stopping', 'stopped'] as const,
  },
  { key: 'error', label: 'Attention', statuses: ['error'] as const },
] as const;

export function groupJobsByColumn(
  jobs: AppBuildingJobRecord[],
): Record<(typeof BOARD_COLUMNS)[number]['key'], AppBuildingJobRecord[]> {
  const out: Record<string, AppBuildingJobRecord[]> = {};
  for (const column of BOARD_COLUMNS) out[column.key] = [];
  for (const job of jobs) {
    const column = BOARD_COLUMNS.find((c) => (c.statuses as readonly string[]).includes(job.status));
    if (column) out[column.key].push(job);
  }
  for (const column of BOARD_COLUMNS) {
    out[column.key].sort((a, b) => b.updatedAt - a.updatedAt);
  }
  return out as Record<(typeof BOARD_COLUMNS)[number]['key'], AppBuildingJobRecord[]>;
}
