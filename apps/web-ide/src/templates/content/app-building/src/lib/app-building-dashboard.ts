export type DashboardJobStatus =
  | 'starting'
  | 'processing'
  | 'idle'
  | 'stopping'
  | 'stopped'
  | 'error';

export type BoardTaskStatus =
  | 'todo'
  | 'in-progress'
  | 'review'
  | 'done'
  | 'blocked';

export interface DashboardConfig {
  projectId: string;
  flyAppName: string | null;
  imageRef: string | null;
  infisicalEnvironment: string | null;
  hasInfisicalCredentials: boolean;
  hasFlyApiToken: boolean;
  updatedAt: number;
}

export interface DashboardJob {
  id: string;
  projectId: string;
  appName: string;
  prompt: string;
  promptSummary: string;
  status: DashboardJobStatus;
  repositoryFullName: string;
  repositoryUrl: string;
  pushBranch: string;
  flyApp: string;
  machineId: string;
  totalCost: number | null;
  pendingTasks: number | null;
  lastActivityAt: string | null;
  recentEvents?: string[];
  recentLogs?: string[];
  lastLogCursor?: string | null;
  lastLogTimestamp?: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface BoardTaskCard {
  id: string;
  projectId: string;
  jobId: string;
  kind: 'kickoff' | 'follow-up';
  title: string;
  prompt: string;
  promptSummary: string;
  status: BoardTaskStatus;
  createdAt: number;
  updatedAt: number;
}

export interface DashboardState {
  projectId: string | null;
  config: DashboardConfig | null;
  jobs: DashboardJob[];
  tasksByJobId: Record<string, BoardTaskCard[]>;
}

export interface PreviewAppBuildingBridgeResponse {
  type: 'almostnode-app-building-response';
  requestId: string;
  ok: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
  jobId?: string;
  error?: string;
}

type PreviewAppBuildingBridgeAction =
  | {
    action: 'create';
    name: string;
    prompt: string;
  }
  | {
    action: 'message';
    jobId: string;
    prompt: string;
  }
  | {
    action: 'status' | 'stop' | 'reset-logs';
    jobId: string;
  }
  | {
    action: 'logs';
    jobId: string;
    offset?: number;
  };

export const BOARD_COLUMNS = [
  {
    id: 'starting',
    label: 'Starting',
    description: 'Worker and branch provisioning',
    statuses: ['starting'],
  },
  {
    id: 'processing',
    label: 'In Flight',
    description: 'Workers are actively building',
    statuses: ['processing'],
  },
  {
    id: 'idle',
    label: 'Waiting',
    description: 'Ready for the next follow-up card',
    statuses: ['idle'],
  },
  {
    id: 'stopping',
    label: 'Stopped',
    description: 'Machines winding down or archived',
    statuses: ['stopping', 'stopped'],
  },
  {
    id: 'error',
    label: 'Attention',
    description: 'Needs intervention before moving on',
    statuses: ['error'],
  },
] as const satisfies Array<{
  id: string;
  label: string;
  description: string;
  statuses: DashboardJobStatus[];
}>;

export const TASK_STATUS_ORDER: BoardTaskStatus[] = [
  'todo',
  'in-progress',
  'review',
  'done',
  'blocked',
];

const DB_NAME = 'almostnode-webide';
const DB_VERSION = 4;
const ACTIVE_PROJECT_KEY = 'almostnode-active-project-id';
const CONFIG_STORE = 'app-building-config';
const JOBS_STORE = 'app-building-jobs';
const TASK_STORAGE_KEY = 'almostnode.app-building.task-cards.v1';
const BRIDGE_REQUEST_TYPE = 'almostnode-app-building-request';
const BRIDGE_RESPONSE_TYPE = 'almostnode-app-building-response';
const BRIDGE_TIMEOUT_MS = 10 * 60_000;

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CONFIG_STORE)) {
        db.createObjectStore(CONFIG_STORE, { keyPath: 'projectId' });
      }
      if (!db.objectStoreNames.contains(JOBS_STORE)) {
        const jobs = db.createObjectStore(JOBS_STORE, { keyPath: 'id' });
        jobs.createIndex('projectId', 'projectId', { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txGet<T>(db: IDBDatabase, store: string, key: IDBValidKey): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function txGetAllByIndex<T>(
  db: IDBDatabase,
  store: string,
  indexName: string,
  key: IDBValidKey,
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).index(indexName).getAll(key);
    req.onsuccess = () => resolve(req.result as T[]);
    req.onerror = () => reject(req.error);
  });
}

function summarizePrompt(prompt: string, maxLength = 112): string {
  const singleLine = prompt.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function normalizeTaskStatus(value: unknown): BoardTaskStatus {
  switch (value) {
    case 'todo':
    case 'in-progress':
    case 'review':
    case 'done':
    case 'blocked':
      return value;
    default:
      return 'todo';
  }
}

function readTaskCards(): BoardTaskCard[] {
  try {
    const raw = window.localStorage.getItem(TASK_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') {
        return [];
      }

      const candidate = entry as Partial<BoardTaskCard>;
      if (
        typeof candidate.id !== 'string'
        || typeof candidate.projectId !== 'string'
        || typeof candidate.jobId !== 'string'
        || typeof candidate.prompt !== 'string'
      ) {
        return [];
      }

      return [{
        id: candidate.id,
        projectId: candidate.projectId,
        jobId: candidate.jobId,
        kind: candidate.kind === 'kickoff' ? 'kickoff' : 'follow-up',
        title: typeof candidate.title === 'string' && candidate.title.trim()
          ? candidate.title.trim()
          : summarizePrompt(candidate.prompt, 72),
        prompt: candidate.prompt,
        promptSummary: typeof candidate.promptSummary === 'string' && candidate.promptSummary.trim()
          ? candidate.promptSummary
          : summarizePrompt(candidate.prompt),
        status: normalizeTaskStatus(candidate.status),
        createdAt: Number.isFinite(candidate.createdAt) ? Number(candidate.createdAt) : Date.now(),
        updatedAt: Number.isFinite(candidate.updatedAt) ? Number(candidate.updatedAt) : Date.now(),
      }];
    });
  } catch {
    return [];
  }
}

function writeTaskCards(cards: BoardTaskCard[]): void {
  window.localStorage.setItem(TASK_STORAGE_KEY, JSON.stringify(cards));
}

function sortTaskCards(cards: BoardTaskCard[]): BoardTaskCard[] {
  return [...cards].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === 'kickoff' ? -1 : 1;
    }
    if (left.createdAt !== right.createdAt) {
      return left.createdAt - right.createdAt;
    }
    return left.updatedAt - right.updatedAt;
  });
}

function deriveKickoffTaskStatus(job: DashboardJob): BoardTaskStatus {
  if (job.status === 'error') {
    return 'blocked';
  }
  if (job.status === 'stopped') {
    return 'done';
  }
  if (job.status === 'idle') {
    return 'review';
  }
  return 'in-progress';
}

function buildKickoffTask(job: DashboardJob): BoardTaskCard {
  return {
    id: `kickoff:${job.id}`,
    projectId: job.projectId,
    jobId: job.id,
    kind: 'kickoff',
    title: 'Kickoff prompt',
    prompt: job.prompt || job.promptSummary,
    promptSummary: summarizePrompt(job.prompt || job.promptSummary),
    status: deriveKickoffTaskStatus(job),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function syncTaskCardsForProject(
  projectId: string,
  jobs: DashboardJob[],
): Record<string, BoardTaskCard[]> {
  const storedCards = readTaskCards();
  const activeJobIds = new Set(jobs.map((job) => job.id));
  const preservedCards = storedCards.filter((card) => (
    card.projectId !== projectId
    || (card.kind !== 'kickoff' && activeJobIds.has(card.jobId))
  ));
  const nextCards = [
    ...preservedCards,
    ...jobs.map(buildKickoffTask),
  ];

  writeTaskCards(nextCards);

  const grouped: Record<string, BoardTaskCard[]> = {};
  for (const card of nextCards) {
    if (card.projectId !== projectId || !activeJobIds.has(card.jobId)) {
      continue;
    }
    grouped[card.jobId] = grouped[card.jobId] || [];
    grouped[card.jobId].push(card);
  }

  for (const jobId of Object.keys(grouped)) {
    grouped[jobId] = sortTaskCards(grouped[jobId]);
  }

  return grouped;
}

function readHostWindow(): Window | null {
  if (typeof window === 'undefined' || !window.parent || window.parent === window) {
    return null;
  }
  return window.parent;
}

export function canUsePreviewBridge(): boolean {
  return readHostWindow() !== null;
}

export function readActiveProjectId(): string | null {
  try {
    const value = window.localStorage.getItem(ACTIVE_PROJECT_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export async function loadDashboardState(): Promise<DashboardState> {
  const projectId = readActiveProjectId();
  if (!projectId) {
    return {
      projectId: null,
      config: null,
      jobs: [],
      tasksByJobId: {},
    };
  }

  const db = await openDB();
  const [config, jobs] = await Promise.all([
    txGet<DashboardConfig>(db, CONFIG_STORE, projectId),
    txGetAllByIndex<DashboardJob>(db, JOBS_STORE, 'projectId', projectId),
  ]);
  const sortedJobs = jobs.sort((left, right) => right.updatedAt - left.updatedAt);

  return {
    projectId,
    config: config ?? null,
    jobs: sortedJobs,
    tasksByJobId: syncTaskCardsForProject(projectId, sortedJobs),
  };
}

export function createBoardTitleFromPrompt(prompt: string): string {
  const sentence = prompt.replace(/\s+/g, ' ').trim().split(/[.!?]/)[0]?.trim() || '';
  if (!sentence) {
    return 'Untitled board';
  }
  const clipped = sentence.split(' ').slice(0, 5).join(' ');
  return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}

export function createFollowUpTaskCard(input: {
  projectId: string;
  jobId: string;
  prompt: string;
  title?: string;
  status?: BoardTaskStatus;
}): BoardTaskCard {
  const prompt = input.prompt.trim();
  const card: BoardTaskCard = {
    id: crypto.randomUUID(),
    projectId: input.projectId,
    jobId: input.jobId,
    kind: 'follow-up',
    title: input.title?.trim() || summarizePrompt(prompt, 72),
    prompt,
    promptSummary: summarizePrompt(prompt),
    status: input.status ?? 'in-progress',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const cards = readTaskCards();
  writeTaskCards([...cards, card]);
  return card;
}

export function updateTaskCardStatus(
  projectId: string,
  taskId: string,
  status: BoardTaskStatus,
): void {
  const cards = readTaskCards();
  const nextCards = cards.map((card) => {
    if (card.projectId !== projectId || card.id !== taskId || card.kind === 'kickoff') {
      return card;
    }
    return {
      ...card,
      status,
      updatedAt: Date.now(),
    };
  });
  writeTaskCards(nextCards);
}

export async function executePreviewAppBuildingAction(
  action: PreviewAppBuildingBridgeAction,
): Promise<PreviewAppBuildingBridgeResponse> {
  const hostWindow = readHostWindow();
  if (!hostWindow) {
    throw new Error('The kanban controls only work inside the Web IDE preview.');
  }

  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const timeoutId = window.setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for the Web IDE host to handle the app-building action.'));
    }, BRIDGE_TIMEOUT_MS);

    const handleMessage = (event: MessageEvent) => {
      if (event.source !== hostWindow) {
        return;
      }

      const payload = event.data as PreviewAppBuildingBridgeResponse | undefined;
      if (
        !payload
        || payload.type !== BRIDGE_RESPONSE_TYPE
        || payload.requestId !== requestId
      ) {
        return;
      }

      cleanup();
      resolve(payload);
    };

    const cleanup = () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener('message', handleMessage);
    };

    window.addEventListener('message', handleMessage);
    hostWindow.postMessage({
      type: BRIDGE_REQUEST_TYPE,
      requestId,
      ...action,
    }, '*');
  });
}

export function getBoardColumnId(status: DashboardJobStatus): string {
  const column = BOARD_COLUMNS.find((entry) => (
    (entry.statuses as readonly DashboardJobStatus[]).includes(status)
  ));
  return column?.id ?? 'error';
}

export function formatJobStatus(status: DashboardJobStatus): string {
  switch (status) {
    case 'starting':
      return 'Starting';
    case 'processing':
      return 'Processing';
    case 'idle':
      return 'Idle';
    case 'stopping':
      return 'Stopping';
    case 'stopped':
      return 'Stopped';
    case 'error':
      return 'Blocked';
  }
}

export function formatTaskStatus(status: BoardTaskStatus): string {
  switch (status) {
    case 'todo':
      return 'To do';
    case 'in-progress':
      return 'In progress';
    case 'review':
      return 'Review';
    case 'done':
      return 'Done';
    case 'blocked':
      return 'Blocked';
  }
}

export function formatRelativeTime(value: string | number | null | undefined): string {
  if (!value) {
    return 'No recent activity';
  }

  const timestamp = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return 'No recent activity';
  }

  const diffMs = Date.now() - timestamp;
  const diffMinutes = Math.round(diffMs / 60_000);
  if (diffMinutes <= 1) {
    return 'Updated just now';
  }
  if (diffMinutes < 60) {
    return `Updated ${diffMinutes}m ago`;
  }
  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) {
    return `Updated ${diffHours}h ago`;
  }
  const diffDays = Math.round(diffHours / 24);
  return `Updated ${diffDays}d ago`;
}

export function formatCurrency(value: number | null): string {
  if (value === null) {
    return 'Pending';
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

export function canStopJob(job: DashboardJob): boolean {
  return Boolean(job.machineId) && job.status !== 'stopped' && job.status !== 'stopping';
}

export function canRefreshLogs(job: DashboardJob): boolean {
  return Boolean(job.machineId);
}

export function shouldAutoSyncJob(job: DashboardJob): boolean {
  return job.status === 'starting' || job.status === 'processing' || job.status === 'stopping';
}
