import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button } from '@agent-wasm/react/ui';
import type { AppBuildingJobRecord } from '../features/project-db';
import {
  BOARD_COLUMNS,
  createJobId,
  createProjectId,
  deleteControlPlaneProject,
  groupJobsByColumn,
  listControlPlaneProjects,
  listJobsForProject,
  putJob,
  upsertControlPlaneProject,
  type ControlPlaneProject,
} from './control-plane-store';
import {
  DEFAULT_APP_BUILDING_IMAGE,
  launchAppBuildingFlyMachine,
  sanitizeMachineName,
  type LaunchTrace,
} from './launch-fly-machine';
import type { ExtractedCredentials } from './standalone-credentials';
import type { AppBuilderSelections } from './service-pickers';

interface ControlPlaneViewProps {
  credentials: ExtractedCredentials;
  selections: AppBuilderSelections;
}

type View =
  | { kind: 'list' }
  | { kind: 'project'; projectId: string };

function formatRelativeTime(value: number | string | null | undefined): string {
  if (!value) return 'never';
  const ms = typeof value === 'string' ? new Date(value).getTime() : value;
  if (!Number.isFinite(ms)) return 'never';
  const delta = Date.now() - ms;
  if (delta < 0) return 'just now';
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatStatus(status: string): string {
  return status.replace(/_/g, ' ');
}

function summarizeJobCount(jobs: AppBuildingJobRecord[]): string {
  if (jobs.length === 0) return 'No jobs yet';
  const active = jobs.filter((job) => job.status === 'processing' || job.status === 'starting')
    .length;
  return `${jobs.length} job${jobs.length === 1 ? '' : 's'}${active ? ` · ${active} active` : ''}`;
}

export function ControlPlaneView({ credentials, selections }: ControlPlaneViewProps) {
  const [projects, setProjects] = useState<ControlPlaneProject[]>(() =>
    listControlPlaneProjects(),
  );
  const [jobCounts, setJobCounts] = useState<Record<string, AppBuildingJobRecord[]>>({});
  const [view, setView] = useState<View>({ kind: 'list' });
  const [creatingOpen, setCreatingOpen] = useState(false);
  const [createState, setCreateState] = useState({
    name: '',
    prompt: '',
    submitting: false,
    error: null as string | null,
    trace: [] as LaunchTrace[],
  });

  const refreshJobs = useCallback(async (targets: ControlPlaneProject[]) => {
    const entries = await Promise.all(
      targets.map(async (project) => [project.id, await listJobsForProject(project.id)] as const),
    );
    setJobCounts((prev) => {
      const next = { ...prev };
      for (const [id, jobs] of entries) next[id] = jobs;
      return next;
    });
  }, []);

  useEffect(() => {
    void refreshJobs(projects);
  }, [projects, refreshJobs]);

  const activeProject = useMemo(
    () => (view.kind === 'project' ? projects.find((p) => p.id === view.projectId) ?? null : null),
    [view, projects],
  );
  const activeJobs = useMemo(
    () => (activeProject ? jobCounts[activeProject.id] ?? [] : []),
    [activeProject, jobCounts],
  );

  const handleCreate = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const name = createState.name.trim();
      const prompt = createState.prompt.trim();
      if (!name) {
        setCreateState((prev) => ({ ...prev, error: 'Name is required.' }));
        return;
      }
      if (!selections.flyApp) {
        setCreateState((prev) => ({
          ...prev,
          error: 'Pick a Fly app on the sign-in page before creating a project.',
        }));
        return;
      }

      setCreateState((prev) => ({ ...prev, submitting: true, error: null, trace: [] }));

      const project: ControlPlaneProject = {
        id: createProjectId(),
        name,
        createdAt: Date.now(),
        flyAppName: selections.flyApp,
        imageRef: DEFAULT_APP_BUILDING_IMAGE,
        defaultPrompt: prompt || null,
      };
      upsertControlPlaneProject(project);
      setProjects(listControlPlaneProjects());

      const jobId = createJobId();
      const machineName = sanitizeMachineName(`${project.name}-${jobId.slice(-6)}`);
      const nowMs = Date.now();
      const stub: AppBuildingJobRecord = {
        id: jobId,
        projectId: project.id,
        appName: project.name,
        prompt: prompt || project.name,
        promptSummary: prompt.slice(0, 120) || project.name,
        status: 'starting',
        repositoryName: 'app-building',
        repositoryFullName: 'replayio/app-building',
        repositoryUrl: 'https://github.com/replayio/app-building',
        repositoryCloneUrl: 'https://github.com/replayio/app-building.git',
        cloneBranch: 'main',
        pushBranch: `job/${jobId}`,
        flyApp: project.flyAppName ?? '',
        baseUrl: '',
        containerName: machineName,
        machineId: '',
        machineInstanceId: null,
        volumeId: null,
        imageRef: project.imageRef,
        agentCommand: null,
        revision: null,
        queueLength: null,
        pendingTasks: null,
        totalCost: null,
        lastActivityAt: new Date(nowMs).toISOString(),
        lastEventOffset: 0,
        lastLogOffset: 0,
        recentEvents: [],
        recentLogs: [],
        error: null,
        createdAt: nowMs,
        updatedAt: nowMs,
      };
      await putJob(stub);
      await refreshJobs([project]);

      const traceLog: LaunchTrace[] = [];
      try {
        const result = await launchAppBuildingFlyMachine({
          credentials,
          selections,
          machineName,
          imageRef: project.imageRef ?? DEFAULT_APP_BUILDING_IMAGE,
          extraEnv: {
            JOB_ID: jobId,
            PROJECT_ID: project.id,
            PROJECT_NAME: project.name,
            PUSH_BRANCH: stub.pushBranch,
            CONTAINER_NAME: machineName,
            INITIAL_PROMPT: prompt,
            REPO_URL: stub.repositoryCloneUrl,
            REPO_CLONE_BRANCH: stub.cloneBranch,
          },
          onTrace: (event) => {
            traceLog.push(event);
            setCreateState((prev) => ({ ...prev, trace: [...traceLog] }));
          },
        });
        const started = Date.now();
        const booted: AppBuildingJobRecord = {
          ...stub,
          status: 'processing',
          machineId: result.machine.machineId,
          machineInstanceId: result.machine.instanceId ?? null,
          volumeId: result.machine.volumeId,
          updatedAt: started,
          lastActivityAt: new Date(started).toISOString(),
        };
        await putJob(booted);
        await refreshJobs([project]);
        setCreateState({ name: '', prompt: '', submitting: false, error: null, trace: [] });
        setCreatingOpen(false);
        setView({ kind: 'project', projectId: project.id });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const failed: AppBuildingJobRecord = {
          ...stub,
          status: 'error',
          error: message,
          updatedAt: Date.now(),
        };
        await putJob(failed);
        await refreshJobs([project]);
        setCreateState((prev) => ({
          ...prev,
          submitting: false,
          error: message,
          trace: traceLog,
        }));
      }
    },
    [createState.name, createState.prompt, credentials, selections, refreshJobs],
  );

  const handleDelete = useCallback((id: string) => {
    if (!window.confirm('Delete this project and forget its worker history?')) return;
    deleteControlPlaneProject(id);
    setProjects(listControlPlaneProjects());
    setView({ kind: 'list' });
  }, []);

  if (view.kind === 'project' && activeProject) {
    const columns = groupJobsByColumn(activeJobs);
    return (
      <div className="app-builder-route__cp">
        <div className="app-builder-route__cp-project-header">
          <div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setView({ kind: 'list' })}
            >
              ← Projects
            </Button>
            <h2>{activeProject.name}</h2>
            <p className="app-builder-route__cp-muted">
              Fly app · {activeProject.flyAppName ?? '—'} · {summarizeJobCount(activeJobs)} ·
              created {formatRelativeTime(activeProject.createdAt)}
            </p>
          </div>
          <div className="app-builder-route__cp-project-actions">
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setCreateState({
                  name: `${activeProject.name}`,
                  prompt: activeProject.defaultPrompt ?? '',
                  submitting: false,
                  error: null,
                  trace: [],
                });
                setView({ kind: 'list' });
                setCreatingOpen(true);
              }}
            >
              + New worker
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => handleDelete(activeProject.id)}
            >
              Delete
            </Button>
          </div>
        </div>

        <div className="app-builder-route__cp-kanban">
          {BOARD_COLUMNS.map((column) => (
            <div key={column.key} className="app-builder-route__cp-column">
              <div className="app-builder-route__cp-column-header">
                <span>{column.label}</span>
                <span className="app-builder-route__cp-column-count">
                  {columns[column.key].length}
                </span>
              </div>
              <div className="app-builder-route__cp-column-body">
                {columns[column.key].length === 0 ? (
                  <p className="app-builder-route__cp-muted app-builder-route__cp-empty">
                    No jobs here.
                  </p>
                ) : (
                  columns[column.key].map((job) => (
                    <article key={job.id} className="app-builder-route__cp-card">
                      <header>
                        <strong>{job.appName}</strong>
                        <span className="app-builder-route__cp-card-status">
                          {formatStatus(job.status)}
                        </span>
                      </header>
                      <p>{job.promptSummary || job.prompt || '(no prompt)'}</p>
                      <footer>
                        <span>{formatRelativeTime(job.lastActivityAt ?? job.updatedAt)}</span>
                        {job.machineId ? (
                          <code title="Fly machine id">{job.machineId.slice(0, 10)}</code>
                        ) : null}
                      </footer>
                      {job.error ? (
                        <p className="app-builder-route__cp-card-error">{job.error}</p>
                      ) : null}
                    </article>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="app-builder-route__cp">
      <div className="app-builder-route__cp-list-header">
        <div>
          <h2>Projects</h2>
          <p className="app-builder-route__cp-muted">
            Each project spins up a Fly machine running the app-building worker image. Click a
            card to open its kanban.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => {
            setCreateState({ name: '', prompt: '', submitting: false, error: null, trace: [] });
            setCreatingOpen(true);
          }}
        >
          + New project
        </Button>
      </div>

      {projects.length === 0 ? (
        <div className="app-builder-route__cp-empty-state">
          <p>No projects yet — create one to kick off a Fly worker.</p>
        </div>
      ) : (
        <div className="app-builder-route__cp-grid">
          {projects.map((project) => {
            const jobs = jobCounts[project.id] ?? [];
            return (
              <button
                key={project.id}
                type="button"
                className="app-builder-route__cp-project-card"
                onClick={() => setView({ kind: 'project', projectId: project.id })}
              >
                <div className="app-builder-route__cp-project-card-title">{project.name}</div>
                <div className="app-builder-route__cp-muted">{summarizeJobCount(jobs)}</div>
                <div className="app-builder-route__cp-muted">
                  Fly app · {project.flyAppName ?? '—'}
                </div>
                <div className="app-builder-route__cp-muted">
                  Created {formatRelativeTime(project.createdAt)}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {creatingOpen ? (
        <div className="app-builder-route__cp-modal-backdrop" onClick={() => setCreatingOpen(false)}>
          <form
            className="app-builder-route__cp-modal"
            onSubmit={(event) => void handleCreate(event)}
            onClick={(event) => event.stopPropagation()}
          >
            <h3>New project</h3>
            <p className="app-builder-route__cp-muted">
              Creates a project record and launches a Fly machine from
              <code>{' '}{DEFAULT_APP_BUILDING_IMAGE}{' '}</code>
              using your unlocked credentials.
            </p>
            <label>
              <span>Name</span>
              <input
                type="text"
                required
                value={createState.name}
                onChange={(event) =>
                  setCreateState((prev) => ({ ...prev, name: event.target.value }))
                }
                placeholder="e.g. sales-crm"
              />
            </label>
            <label>
              <span>Initial prompt (optional)</span>
              <textarea
                rows={4}
                value={createState.prompt}
                onChange={(event) =>
                  setCreateState((prev) => ({ ...prev, prompt: event.target.value }))
                }
                placeholder="What should the first worker build?"
              />
            </label>
            {createState.error ? (
              <p className="app-builder-route__cp-error">Launch failed: {createState.error}</p>
            ) : null}
            {createState.trace.length > 0 ? (
              <ol className="app-builder-route__cp-trace">
                {createState.trace.map((entry, index) => (
                  <li
                    key={`${entry.step}-${index}`}
                    className={entry.ok ? 'is-ok' : 'is-failed'}
                  >
                    <span>{entry.step}</span>
                    {entry.detail ? <code>{entry.detail}</code> : null}
                  </li>
                ))}
              </ol>
            ) : null}
            <div className="app-builder-route__cp-modal-actions">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreatingOpen(false)}
                disabled={createState.submitting}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={createState.submitting}>
                {createState.submitting ? 'Launching Fly machine…' : 'Create & launch worker'}
              </Button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
