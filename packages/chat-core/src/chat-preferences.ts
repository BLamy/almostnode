/**
 * Chat launch preferences (model, thinking effort, plan mode) shared between
 * the composer UI and the workbench host's agent launch command builder.
 * Stored in localStorage so they survive reloads and apply to the next
 * session launch (a running CLI session keeps the settings it started with).
 */

const MODEL_KEY = 'almostnode-chat-model';
const EFFORT_KEY = 'almostnode-chat-effort';
const PLAN_MODE_KEY = 'almostnode-chat-plan-mode';

export interface ChatModelOption {
  /** Model id passed to `claude --model`, or null for the CLI default. */
  id: string | null;
  label: string;
  provider: string;
}

export const CHAT_MODEL_OPTIONS: ChatModelOption[] = [
  { id: null, label: 'Default', provider: 'Claude' },
  { id: 'claude-fable-5', label: 'Claude Fable 5', provider: 'Claude' },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', provider: 'Claude' },
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', provider: 'Claude' },
  { id: 'claude-opus-4-6', label: 'Claude Opus 4.6', provider: 'Claude' },
  { id: 'claude-opus-4-5', label: 'Claude Opus 4.5', provider: 'Claude' },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', provider: 'Claude' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', provider: 'Claude' },
];

export type ChatEffort = 'low' | 'medium' | 'high';

export const CHAT_EFFORT_LABELS: Record<ChatEffort, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
};

/**
 * Thinking budget per effort level, applied via the Claude Code
 * MAX_THINKING_TOKENS environment variable. `medium` is the CLI default and
 * sets nothing.
 */
export const CHAT_EFFORT_THINKING_TOKENS: Record<ChatEffort, number | null> = {
  low: 1024,
  medium: null,
  high: 31999,
};

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch {
    // Ignore storage failures.
  }
}

export function readChatModel(): string | null {
  const stored = read(MODEL_KEY);
  return CHAT_MODEL_OPTIONS.some((option) => option.id === stored) ? stored : null;
}

export function writeChatModel(modelId: string | null): void {
  write(MODEL_KEY, modelId);
}

export function readChatEffort(): ChatEffort {
  const stored = read(EFFORT_KEY);
  return stored === 'low' || stored === 'high' ? stored : 'medium';
}

export function writeChatEffort(effort: ChatEffort): void {
  write(EFFORT_KEY, effort === 'medium' ? null : effort);
}

export function readChatPlanMode(): boolean {
  return read(PLAN_MODE_KEY) === 'true';
}

export function writeChatPlanMode(enabled: boolean): void {
  write(PLAN_MODE_KEY, enabled ? 'true' : null);
}
