import {
  startTransition,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  TASK_STATUS_ORDER,
  canRefreshLogs,
  canStopJob,
  canUsePreviewBridge,
  createBoardTitleFromPrompt,
  createFollowUpTaskCard,
  executePreviewAppBuildingAction,
  formatCurrency,
  formatJobStatus,
  formatRelativeTime,
  formatTaskStatus,
  loadDashboardState,
  shouldAutoSyncJob,
  updateTaskCardStatus,
  type BoardTaskCard,
  type BoardTaskStatus,
  type DashboardJob,
  type DashboardState,
} from './lib/app-building-dashboard.ts';

/* ── constants ── */

const EMPTY_STATE: DashboardState = {
  projectId: null,
  config: null,
  jobs: [],
  tasksByJobId: {},
};

const REFRESH_MS = 6_000;

type NoticeTone = 'success' | 'error' | 'info';

/* ── tiny helpers ── */

function dotColor(status: string): string {
  switch (status) {
    case 'starting':
    case 'review':
      return 'bg-blue-400';
    case 'processing':
    case 'in-progress':
      return 'bg-amber-400';
    case 'idle':
    case 'done':
      return 'bg-emerald-400';
    case 'error':
    case 'blocked':
      return 'bg-red-400';
    default:
      return 'bg-zinc-500';
  }
}

function badgeColor(status: string): string {
  switch (status) {
    case 'starting':
    case 'review':
      return 'bg-blue-500/15 text-blue-400 ring-blue-500/25';
    case 'processing':
    case 'in-progress':
      return 'bg-amber-500/15 text-amber-400 ring-amber-500/25';
    case 'idle':
    case 'done':
      return 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/25';
    case 'error':
    case 'blocked':
      return 'bg-red-500/15 text-red-400 ring-red-500/25';
    default:
      return 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/25';
  }
}

function StatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        badgeColor(status),
      )}
    >
      <span className={cn('size-1.5 rounded-full', dotColor(status))} />
      {label}
    </span>
  );
}

function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 backdrop-blur-sm pt-[10vh]"
      onClick={onClose}
    >
      <div
        className={cn(
          'w-full rounded-lg border bg-card shadow-xl max-h-[80vh] overflow-y-auto animate-scale-in',
          wide ? 'max-w-2xl' : 'max-w-lg',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-5 py-3.5">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <button
            className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
            onClick={onClose}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M4 4l8 8M12 4l-8 8" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

const inputClass =
  'flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring';

function collectJobsToSync(jobs: DashboardJob[], selectedId: string | null): DashboardJob[] {
  const targets = new Map<string, DashboardJob>();
  if (selectedId) {
    const sel = jobs.find((j) => j.id === selectedId);
    if (sel && sel.status !== 'error' && sel.status !== 'stopped') targets.set(sel.id, sel);
  }
  for (const job of jobs) {
    if (shouldAutoSyncJob(job)) targets.set(job.id, job);
  }
  return Array.from(targets.values()).slice(0, 6);
}

/* ── App ── */

function App() {
  /* state */
  const [dashboard, setDashboard] = useState<DashboardState>(EMPTY_STATE);
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  const [view, setView] = useState<'list' | 'board'>('list');
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<BoardTaskCard | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showFollowUp, setShowFollowUp] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [boardDraft, setBoardDraft] = useState({ title: '', prompt: '' });
  const [taskDraft, setTaskDraft] = useState({ title: '', prompt: '', status: 'in-progress' as BoardTaskStatus });
  const [createPending, setCreatePending] = useState(false);
  const [taskPending, setTaskPending] = useState(false);
  const [actionKey, setActionKey] = useState<string | null>(null);

  const jobs = useDeferredValue(dashboard.jobs);
  const bridge = canUsePreviewBridge();
  const mountedRef = useRef(true);
  const refreshingRef = useRef(false);
  const selRef = useRef(selectedJobId);

  useEffect(() => { selRef.current = selectedJobId; }, [selectedJobId]);

  /* refresh logic */
  const refresh = async (opts: { force?: boolean; syncJobs?: boolean; syncLogs?: boolean } = {}) => {
    if (refreshingRef.current && !opts.force) return;
    refreshingRef.current = true;
    try {
      let next = await loadDashboardState();
      if (opts.syncJobs && bridge) {
        const toSync = collectJobsToSync(next.jobs, selRef.current);
        if (toSync.length) {
          await Promise.all(toSync.map(async (j) => {
            try { await executePreviewAppBuildingAction({ action: 'status', jobId: j.id }); } catch { /* noop */ }
          }));
        }
        if (opts.syncLogs && selRef.current) {
          const sel = next.jobs.find((j) => j.id === selRef.current);
          if (sel && canRefreshLogs(sel)) {
            try { await executePreviewAppBuildingAction({ action: 'logs', jobId: sel.id }); } catch { /* noop */ }
          }
        }
        if (toSync.length || opts.syncLogs) next = await loadDashboardState();
      }
      if (!mountedRef.current) return;
      startTransition(() => { setDashboard(next); });
    } catch { /* keep stale state */ } finally {
      refreshingRef.current = false;
    }
  };

  useEffect(() => {
    mountedRef.current = true;
    void refresh({ force: true, syncJobs: true, syncLogs: true });
    const id = window.setInterval(() => void refresh({ syncJobs: true, syncLogs: Boolean(selRef.current) }), REFRESH_MS);
    const onVis = () => { if (document.visibilityState === 'visible') void refresh({ force: true, syncJobs: true, syncLogs: Boolean(selRef.current) }); };
    window.addEventListener('focus', onVis);
    document.addEventListener('visibilitychange', onVis);
    return () => { mountedRef.current = false; clearInterval(id); window.removeEventListener('focus', onVis); document.removeEventListener('visibilitychange', onVis); };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(id);
  }, [notice]);

  useEffect(() => {
    const handler = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selectedCard) setSelectedCard(null);
      else if (showFollowUp) setShowFollowUp(false);
      else if (showCreate) setShowCreate(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedCard, showCreate, showFollowUp]);

  useEffect(() => {
    if (view === 'board' && selectedJobId && jobs.length > 0 && !jobs.find((j) => j.id === selectedJobId)) {
      setView('list');
      setSelectedJobId(null);
    }
  }, [view, selectedJobId, jobs]);

  /* derived */
  const activeJob = selectedJobId ? (jobs.find((j) => j.id === selectedJobId) ?? null) : null;
  const activeTasks = activeJob ? dashboard.tasksByJobId[activeJob.id] ?? [] : [];
  const columns: Record<BoardTaskStatus, BoardTaskCard[]> = { todo: [], 'in-progress': [], review: [], done: [], blocked: [] };
  for (const t of activeTasks) columns[t.status].push(t);

  /* nav */
  const openBoard = (id: string) => { setSelectedJobId(id); setView('board'); setShowLogs(false); setSelectedCard(null); };
  const goBack = () => { setView('list'); setSelectedJobId(null); setSelectedCard(null); setShowLogs(false); };

  /* bridge helper */
  const run = async (action: Parameters<typeof executePreviewAppBuildingAction>[0]) => {
    const r = await executePreviewAppBuildingAction(action);
    if (!r.ok) throw new Error(r.error || r.stderr.trim() || 'Action failed.');
    return r;
  };

  /* handlers */
  const handleCreate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const prompt = boardDraft.prompt.trim();
    if (!prompt) { setNotice({ tone: 'error', message: 'Kickoff prompt is required.' }); return; }
    const title = boardDraft.title.trim() || createBoardTitleFromPrompt(prompt);
    setCreatePending(true);
    try {
      const r = await run({ action: 'create', name: title, prompt });
      setBoardDraft({ title: '', prompt: '' });
      setShowCreate(false);
      await refresh({ force: true, syncJobs: true });
      if (r.jobId) openBoard(r.jobId);
      setNotice({ tone: 'success', message: `${title} is provisioning.` });
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : 'Failed.' });
    } finally { setCreatePending(false); }
  };

  const handleFollowUp = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!activeJob || !dashboard.projectId) return;
    const prompt = taskDraft.prompt.trim();
    if (!prompt) { setNotice({ tone: 'error', message: 'Follow-up prompt is required.' }); return; }
    setTaskPending(true);
    try {
      await run({ action: 'message', jobId: activeJob.id, prompt });
      createFollowUpTaskCard({ projectId: dashboard.projectId, jobId: activeJob.id, prompt, title: taskDraft.title, status: taskDraft.status });
      setTaskDraft({ title: '', prompt: '', status: 'in-progress' });
      setShowFollowUp(false);
      await refresh({ force: true, syncJobs: true, syncLogs: true });
      setNotice({ tone: 'success', message: 'Follow-up queued.' });
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : 'Failed.' });
    } finally { setTaskPending(false); }
  };

  const handleSync = async (job: DashboardJob, logs: boolean) => {
    const key = logs ? `logs:${job.id}` : `status:${job.id}`;
    setActionKey(key);
    try {
      await run({ action: 'status', jobId: job.id });
      if (logs && canRefreshLogs(job)) await run({ action: 'logs', jobId: job.id });
      await refresh({ force: true });
      setNotice({ tone: 'success', message: logs ? 'Logs updated.' : 'Synced.' });
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : 'Sync failed.' });
    } finally { setActionKey(null); }
  };

  const handleStop = async (job: DashboardJob) => {
    setActionKey(`stop:${job.id}`);
    try {
      await run({ action: 'stop', jobId: job.id });
      await refresh({ force: true, syncJobs: true });
      setNotice({ tone: 'success', message: `${job.appName} stopped.` });
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : 'Failed.' });
    } finally { setActionKey(null); }
  };

  const handleRefreshLogs = async (job: DashboardJob) => {
    setActionKey(`reset-logs:${job.id}`);
    try {
      await run({ action: 'reset-logs', jobId: job.id });
      await run({ action: 'logs', jobId: job.id });
      await refresh({ force: true });
      setNotice({ tone: 'success', message: 'Logs refreshed.' });
    } catch (err) {
      setNotice({ tone: 'error', message: err instanceof Error ? err.message : 'Refresh failed.' });
    } finally { setActionKey(null); }
  };

  const handleStatusChange = async (taskId: string, status: BoardTaskStatus) => {
    if (!dashboard.projectId) return;
    updateTaskCardStatus(dashboard.projectId, taskId, status);
    await refresh({ force: true });
  };

  /* ─────────────────── JobsList ─────────────────── */

  const renderProjectsList = () => (
    <div className="min-h-screen">
      <header className="border-b">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Jobs</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">Manage remote workers against the shared target repo</p>
          </div>
          <Button size="sm" onClick={() => setShowCreate(true)} disabled={!bridge}>
            + New Job
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-6">
        {jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
            <p className="text-sm font-medium">No jobs yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {dashboard.projectId ? 'Launch your first job to get started.' : 'Open App Building setup in the sidebar first.'}
            </p>
          </div>
        ) : (
          <div className="rounded-lg border bg-card">
            {/* table head */}
            <div className="grid grid-cols-[1fr_110px_56px_80px_130px] gap-4 border-b px-4 py-2.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <span>Name</span>
              <span>Status</span>
              <span className="text-right">Tasks</span>
              <span className="text-right">Cost</span>
              <span className="text-right">Activity</span>
            </div>
            {/* rows */}
            {jobs.map((job) => {
              const tasks = dashboard.tasksByJobId[job.id] ?? [];
              return (
                <div
                  key={job.id}
                  className="grid cursor-pointer grid-cols-[1fr_110px_56px_80px_130px] items-center gap-4 border-b px-4 py-3 text-sm transition-colors last:border-0 hover:bg-muted/40"
                  onClick={() => openBoard(job.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openBoard(job.id); } }}
                  role="button"
                  tabIndex={0}
                >
                  <div className="min-w-0">
                    <span className="font-medium">{job.appName}</span>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{job.promptSummary}</p>
                  </div>
                  <StatusBadge status={job.status} label={formatJobStatus(job.status)} />
                  <span className="text-right text-muted-foreground">{tasks.length}</span>
                  <span className="text-right text-muted-foreground">{formatCurrency(job.totalCost)}</span>
                  <span className="text-right text-xs text-muted-foreground">{formatRelativeTime(job.lastActivityAt ?? job.updatedAt)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  /* ─────────────────── JobView ─────────────────── */

  const renderProjectView = () => {
    if (!activeJob) return null;

    return (
      <div className="flex h-screen flex-col">
        {/* nav header */}
        <header className="shrink-0 border-b">
          <div className="flex items-center gap-3 px-5 py-3">
            <button
              className="rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
              onClick={goBack}
              title="Back to jobs"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 4L6 9l5 5" />
              </svg>
            </button>

            <span className="text-xs text-muted-foreground">/</span>

            <button className="text-sm text-muted-foreground hover:text-foreground transition-colors" onClick={goBack}>
              Jobs
            </button>

            <span className="text-xs text-muted-foreground">/</span>

            <h1 className="text-sm font-semibold">{activeJob.appName}</h1>

            <StatusBadge status={activeJob.status} label={formatJobStatus(activeJob.status)} />

            {/* spacer */}
            <div className="flex-1" />

            {/* actions */}
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleSync(activeJob, false)}
                disabled={!bridge || actionKey === `status:${activeJob.id}`}
              >
                {actionKey === `status:${activeJob.id}` ? 'Syncing...' : 'Sync'}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowLogs((v) => !v)}>
                Logs
              </Button>
              {activeJob.repositoryUrl ? (
                <a
                  className="inline-flex h-8 items-center rounded-md px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                  href={activeJob.repositoryUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Repo
                </a>
              ) : null}
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleStop(activeJob)}
                disabled={!bridge || !canStopJob(activeJob) || actionKey === `stop:${activeJob.id}`}
              >
                {actionKey === `stop:${activeJob.id}` ? 'Stopping...' : 'Stop'}
              </Button>
              <Button size="sm" onClick={() => setShowFollowUp(true)} disabled={!bridge}>
                + Follow-up
              </Button>
            </div>
          </div>
        </header>

        {/* kanban */}
        <div className="flex-1 overflow-auto p-4">
          <div className="flex min-h-full gap-3">
            {TASK_STATUS_ORDER.map((status) => (
              <div key={status} className="flex min-w-[200px] flex-1 flex-col">
                {/* column header */}
                <div className="mb-2 flex items-center gap-2 px-2 py-1">
                  <span className={cn('size-2 rounded-full', dotColor(status))} />
                  <span className="text-xs font-medium text-muted-foreground">{formatTaskStatus(status)}</span>
                  <span className="text-xs text-muted-foreground/50">{columns[status].length}</span>
                </div>
                {/* cards */}
                <div className="flex flex-col gap-1.5 px-0.5">
                  {columns[status].map((card) => (
                    <article
                      key={card.id}
                      className="cursor-pointer rounded-lg border bg-card p-3 transition-colors hover:border-muted-foreground/25"
                      onClick={() => setSelectedCard(card)}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedCard(card); } }}
                      role="button"
                      tabIndex={0}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-medium leading-snug">{card.title}</span>
                        {card.kind === 'kickoff' ? (
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                            Kickoff
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                        {card.promptSummary}
                      </p>
                      <p className="mt-2 text-[11px] text-muted-foreground/50">
                        {formatRelativeTime(card.updatedAt)}
                      </p>
                    </article>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* logs panel */}
        {showLogs ? (
          <div className="shrink-0 border-t">
            <div className="flex items-center justify-between px-5 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground">Worker Logs</span>
                {canRefreshLogs(activeJob) ? (
                  <span
                    title="Streaming live"
                    className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-emerald-600"
                  >
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                    Live
                  </span>
                ) : null}
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void handleRefreshLogs(activeJob)}
                disabled={!bridge || !canRefreshLogs(activeJob) || actionKey === `reset-logs:${activeJob.id}`}
              >
                {actionKey === `reset-logs:${activeJob.id}` ? 'Refreshing...' : 'Refresh'}
              </Button>
            </div>
            <pre className="max-h-48 overflow-auto border-t bg-background px-5 py-3 font-mono text-xs leading-relaxed text-muted-foreground">
              {activeJob.recentLogs?.length ? activeJob.recentLogs.join('\n') : 'Waiting for logs...'}
            </pre>
          </div>
        ) : null}
      </div>
    );
  };

  /* ─────────────────── render ─────────────────── */

  return (
    <>
      {view === 'list' ? renderProjectsList() : renderProjectView()}

      {/* ── Create Job Modal ── */}
      {showCreate ? (
        <Modal title="New Job" onClose={() => setShowCreate(false)}>
          <form className="space-y-4 p-5" onSubmit={handleCreate}>
            <Field label="Title">
              <input
                className={inputClass}
                value={boardDraft.title}
                onChange={(e) => setBoardDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="Auto-generated from prompt"
              />
            </Field>
            <Field label="Kickoff prompt">
              <textarea
                className={cn(inputClass, 'min-h-[100px] resize-y')}
                value={boardDraft.prompt}
                onChange={(e) => setBoardDraft((d) => ({ ...d, prompt: e.target.value }))}
                onBlur={(e) => {
                  const p = e.target.value.trim();
                  if (p && !boardDraft.title.trim()) setBoardDraft((d) => ({ ...d, title: createBoardTitleFromPrompt(p) }));
                }}
                placeholder="Describe what to build..."
              />
            </Field>
            <div className="flex justify-end pt-1">
              <Button type="submit" size="sm" disabled={createPending || !bridge}>
                {createPending ? 'Launching...' : 'Launch Job'}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {/* ── Follow-up Modal ── */}
      {showFollowUp ? (
        <Modal title="Send Follow-up" onClose={() => setShowFollowUp(false)}>
          <form className="space-y-4 p-5" onSubmit={handleFollowUp}>
            <Field label="Title">
              <input
                className={inputClass}
                value={taskDraft.title}
                onChange={(e) => setTaskDraft((d) => ({ ...d, title: e.target.value }))}
                placeholder="Optional title"
              />
            </Field>
            <Field label="Prompt">
              <textarea
                className={cn(inputClass, 'min-h-[100px] resize-y')}
                value={taskDraft.prompt}
                onChange={(e) => setTaskDraft((d) => ({ ...d, prompt: e.target.value }))}
                placeholder="Follow-up instructions..."
              />
            </Field>
            <Field label="Initial status">
              <select
                className={inputClass}
                value={taskDraft.status}
                onChange={(e) => setTaskDraft((d) => ({ ...d, status: e.target.value as BoardTaskStatus }))}
              >
                {TASK_STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>{formatTaskStatus(s)}</option>
                ))}
              </select>
            </Field>
            <div className="flex justify-end pt-1">
              <Button type="submit" size="sm" disabled={taskPending || !bridge}>
                {taskPending ? 'Sending...' : 'Send'}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}

      {/* ── Card Detail Modal ── */}
      {selectedCard ? (
        <Modal title={selectedCard.title} onClose={() => setSelectedCard(null)} wide>
          <div className="p-5">
            {/* meta grid */}
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <span className="block text-xs text-muted-foreground">Status</span>
                <div className="mt-1 flex items-center gap-2">
                  <span className={cn('size-2 rounded-full', dotColor(selectedCard.status))} />
                  {selectedCard.kind === 'follow-up' ? (
                    <select
                      className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                      value={selectedCard.status}
                      onChange={(e) => {
                        const next = e.target.value as BoardTaskStatus;
                        void handleStatusChange(selectedCard.id, next);
                        setSelectedCard({ ...selectedCard, status: next, updatedAt: Date.now() });
                      }}
                    >
                      {TASK_STATUS_ORDER.map((s) => (
                        <option key={s} value={s}>{formatTaskStatus(s)}</option>
                      ))}
                    </select>
                  ) : (
                    <span>{formatTaskStatus(selectedCard.status)}</span>
                  )}
                </div>
              </div>
              <div>
                <span className="block text-xs text-muted-foreground">Type</span>
                <p className="mt-1">{selectedCard.kind === 'kickoff' ? 'Kickoff' : 'Follow-up'}</p>
              </div>
              <div>
                <span className="block text-xs text-muted-foreground">Created</span>
                <p className="mt-1 text-muted-foreground">{formatRelativeTime(selectedCard.createdAt)}</p>
              </div>
              <div>
                <span className="block text-xs text-muted-foreground">Updated</span>
                <p className="mt-1 text-muted-foreground">{formatRelativeTime(selectedCard.updatedAt)}</p>
              </div>
            </div>

            {/* prompt */}
            <div className="mt-5">
              <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Prompt</h4>
              <div className="whitespace-pre-wrap rounded-md border bg-background p-3 text-sm leading-relaxed text-muted-foreground">
                {selectedCard.prompt}
              </div>
            </div>

            {/* job details */}
            {activeJob ? (
              <div className="mt-5">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Worker</h4>
                <div className="grid grid-cols-3 gap-3 text-sm">
                  <div className="rounded-md border bg-background p-3">
                    <span className="block text-xs text-muted-foreground">Repository</span>
                    {activeJob.repositoryUrl ? (
                      <a className="mt-0.5 block truncate text-blue-400 hover:underline" href={activeJob.repositoryUrl} target="_blank" rel="noreferrer">
                        {activeJob.repositoryFullName}
                      </a>
                    ) : (
                      <span className="mt-0.5 block text-muted-foreground">Pending</span>
                    )}
                  </div>
                  <div className="rounded-md border bg-background p-3">
                    <span className="block text-xs text-muted-foreground">Branch</span>
                    <span className="mt-0.5 block font-mono text-xs">{activeJob.pushBranch || 'Pending'}</span>
                  </div>
                  <div className="rounded-md border bg-background p-3">
                    <span className="block text-xs text-muted-foreground">Cost</span>
                    <span className="mt-0.5 block">{formatCurrency(activeJob.totalCost)}</span>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {/* ── Toast ── */}
      {notice ? (
        <div
          className={cn(
            'fixed bottom-5 left-1/2 z-[200] max-w-sm -translate-x-1/2 rounded-lg border bg-card px-4 py-2.5 text-sm shadow-xl',
            notice.tone === 'success' && 'border-emerald-500/30',
            notice.tone === 'error' && 'border-red-500/30',
            notice.tone === 'info' && 'border-blue-500/30',
          )}
        >
          {notice.message}
        </div>
      ) : null}
    </>
  );
}

export default App;
