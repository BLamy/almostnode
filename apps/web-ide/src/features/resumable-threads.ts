import { stream } from '@agent-wasm/core';
import type { SerializedFile } from '../desktop/project-snapshot';
import type { ResumableThreadRecord } from './project-db';
// The Claude-specific thread primitives now ship from @agent-wasm/code; this
// demo feature still discovers threads across all agents and re-exports them.
import { CLAUDE_PROJECTS_ROOT, extractClaudeMessageText } from '@agent-wasm/code';

const { Buffer } = stream;

export { CLAUDE_PROJECTS_ROOT, extractClaudeMessageText } from '@agent-wasm/code';

interface ClaudeTranscriptEntry {
  type?: string;
  timestamp?: string;
  sessionId?: string;
  isSidechain?: boolean;
  message?: {
    role?: string;
    content?: unknown;
  };
}

interface OpenCodeSessionSummary {
  id: string;
  title: string;
  parentID?: string;
  time?: {
    created: number;
    updated: number;
  };
}

function parseTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * `ownerId` is the project id today and the sandbox id once the sandbox
 * model lands; during the transition the record carries it in both
 * `projectId` and `sandboxId` so grouping by either key works.
 */
export function discoverClaudeThreads(
  ownerId: string,
  files: SerializedFile[],
): ResumableThreadRecord[] {
  const sessions = new Map<
    string,
    {
      createdAt: number;
      updatedAt: number;
      title: string | null;
    }
  >();

  for (const file of files) {
    if (!file.path.endsWith('.jsonl')) {
      continue;
    }

    const transcript = Buffer.from(file.contentBase64, 'base64').toString('utf8');
    for (const rawLine of transcript.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      let entry: ClaudeTranscriptEntry;
      try {
        entry = JSON.parse(line) as ClaudeTranscriptEntry;
      } catch {
        continue;
      }

      if (entry.isSidechain || typeof entry.sessionId !== 'string' || !entry.sessionId) {
        continue;
      }

      const timestamp = parseTimestamp(entry.timestamp);
      const record = sessions.get(entry.sessionId) ?? {
        createdAt: timestamp || Date.now(),
        updatedAt: timestamp || Date.now(),
        title: null,
      };

      if (timestamp > 0) {
        record.createdAt = Math.min(record.createdAt, timestamp);
        record.updatedAt = Math.max(record.updatedAt, timestamp);
      }

      const messageRole = entry.message?.role ?? entry.type;
      if (!record.title && messageRole === 'user') {
        const text = extractClaudeMessageText(entry.message?.content);
        if (text) {
          record.title = text.slice(0, 80);
        }
      }

      sessions.set(entry.sessionId, record);
    }
  }

  return Array.from(sessions.entries())
    .map(([sessionId, record]) => ({
      id: `claude:${ownerId}:${sessionId}`,
      projectId: ownerId,
      sandboxId: ownerId,
      harness: 'claude' as const,
      title: record.title || 'Claude conversation',
      resumeToken: sessionId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

/** See {@link discoverClaudeThreads} for the ownerId transition semantics. */
export function toOpenCodeThreads(
  ownerId: string,
  sessions: OpenCodeSessionSummary[],
): ResumableThreadRecord[] {
  return sessions
    .filter((session) => !session.parentID)
    .map((session) => ({
      id: `opencode:${ownerId}:${session.id}`,
      projectId: ownerId,
      sandboxId: ownerId,
      harness: 'opencode' as const,
      title: session.title?.trim() || 'OpenCode session',
      resumeToken: session.id,
      createdAt: session.time?.created ?? Date.now(),
      updatedAt: session.time?.updated ?? session.time?.created ?? Date.now(),
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export interface CodexThreadSummary {
  id: string;
  title?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** See {@link discoverClaudeThreads} for the ownerId transition semantics. */
export function toCodexThreads(
  ownerId: string,
  threads: CodexThreadSummary[],
): ResumableThreadRecord[] {
  return threads
    .map((thread) => ({
      id: `codex:${ownerId}:${thread.id}`,
      projectId: ownerId,
      sandboxId: ownerId,
      harness: 'codex' as const,
      title: thread.title?.trim() || 'Codex conversation',
      resumeToken: thread.id,
      createdAt: thread.createdAt ?? Date.now(),
      updatedAt: thread.updatedAt ?? thread.createdAt ?? Date.now(),
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function mergeDiscoveredThreads(
  existing: ResumableThreadRecord[],
  discovered: {
    claude: ResumableThreadRecord[];
    opencode: ResumableThreadRecord[];
  },
): ResumableThreadRecord[] {
  // A record whose sandboxId differs from its projectId was assigned to a
  // real sandbox (e.g. a legacy repo thread resumed into a fork). Re-running
  // repo-level discovery rebuilds records with sandboxId === projectId;
  // carry the assignment over so resuming never forks a second sandbox.
  const sandboxAssignments = new Map<string, string>();
  for (const thread of existing) {
    if (thread.sandboxId && thread.sandboxId !== thread.projectId) {
      sandboxAssignments.set(thread.id, thread.sandboxId);
    }
  }

  const next = new Map<string, ResumableThreadRecord>();

  for (const thread of [...discovered.claude, ...discovered.opencode]) {
    const assignedSandboxId = sandboxAssignments.get(thread.id);
    next.set(
      thread.id,
      assignedSandboxId ? { ...thread, sandboxId: assignedSandboxId } : thread,
    );
  }

  return Array.from(next.values()).sort((left, right) => right.updatedAt - left.updatedAt);
}
