import { stream } from 'almostnode';
import type { SerializedFile } from '../desktop/project-snapshot';
import type { ResumableThreadRecord } from './project-db';

const { Buffer } = stream;

export const CLAUDE_PROJECTS_ROOT = '/home/user/.claude/projects';

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

function extractClaudeMessageText(content: unknown): string {
  if (typeof content === 'string') {
    return content.trim();
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') {
          return part;
        }
        if (part && typeof part === 'object' && 'text' in part && typeof part.text === 'string') {
          return part.text;
        }
        return '';
      })
      .join(' ')
      .trim();
  }

  if (content && typeof content === 'object' && 'text' in content && typeof content.text === 'string') {
    return content.text.trim();
  }

  return '';
}

export function discoverClaudeThreads(
  projectId: string,
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
      id: `claude:${projectId}:${sessionId}`,
      projectId,
      harness: 'claude' as const,
      title: record.title || 'Claude conversation',
      resumeToken: sessionId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function toOpenCodeThreads(
  projectId: string,
  sessions: OpenCodeSessionSummary[],
): ResumableThreadRecord[] {
  return sessions
    .filter((session) => !session.parentID)
    .map((session) => ({
      id: `opencode:${projectId}:${session.id}`,
      projectId,
      harness: 'opencode' as const,
      title: session.title?.trim() || 'OpenCode session',
      resumeToken: session.id,
      createdAt: session.time?.created ?? Date.now(),
      updatedAt: session.time?.updated ?? session.time?.created ?? Date.now(),
    }))
    .sort((left, right) => right.updatedAt - left.updatedAt);
}

export function mergeDiscoveredThreads(
  _existing: ResumableThreadRecord[],
  discovered: {
    claude: ResumableThreadRecord[];
    opencode: ResumableThreadRecord[];
  },
): ResumableThreadRecord[] {
  const next = new Map<string, ResumableThreadRecord>();

  for (const thread of discovered.claude) {
    next.set(thread.id, thread);
  }

  for (const thread of discovered.opencode) {
    next.set(thread.id, thread);
  }

  return Array.from(next.values()).sort((left, right) => right.updatedAt - left.updatedAt);
}
