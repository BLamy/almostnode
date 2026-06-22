export type AgentHarness = 'claude' | 'codex' | 'opencode';

export interface ChatToolDiff {
  path: string;
  /** Unified diff patch text renderable by @pierre/diffs parsePatchFiles. */
  patch: string;
}

export interface ChatToolCall {
  /** Tool name (Bash, Edit, Write, Read, …) — used for icon/labeling. */
  name: string;
  /** One-line summary: the command, file path, or pattern. */
  title: string;
  command?: string;
  output?: string;
  diffs?: ChatToolDiff[];
  status?: 'running' | 'success' | 'error';
}

export interface ChatElicitationQuestion {
  /** Complete question text. */
  question: string;
  /** Very short label (chip/tag). */
  header: string;
  options: { label: string; description: string }[];
  /** Allow selecting multiple options. */
  multiple?: boolean;
  /** Allow a free-text custom answer (defaults to true for questions). */
  custom?: boolean;
}

/**
 * An agent-side request that needs the user's input: a plan-mode/question
 * tool ask, or a permission prompt that wasn't auto-approved. Surfaced as a
 * chat message so it can be answered without the TUI.
 */
export interface ChatElicitation {
  /** Server-side request id used to reply. */
  requestId: string;
  kind: 'question' | 'permission';
  questions: ChatElicitationQuestion[];
  status: 'pending' | 'answered' | 'rejected';
  /** Selected labels per question, echoed once resolved. */
  answers?: string[][];
}

export interface ChatMessage {
  /** Stable id: claude transcript uuid / codex item id / opencode messageID. */
  id: string;
  role: 'user' | 'assistant';
  /** 'tool' messages render as tool-call cards instead of bubbles. */
  kind?: 'text' | 'tool' | 'elicitation';
  text: string;
  timestamp: number;
  tool?: ChatToolCall;
  elicitation?: ChatElicitation;
  /** Sent from the chat composer but not yet observed in the agent's own record. */
  pending?: boolean;
}

export interface ConversationState {
  harness: AgentHarness;
  sessionId: string | null;
  messages: ChatMessage[];
  /** The agent is working on a turn. */
  busy: boolean;
  /**
   * Tokens currently occupying the model's context window (from the agent's
   * latest reported usage), or null when the harness doesn't report usage.
   */
  contextTokens?: number | null;
}

/**
 * A live, bidirectional view over a CLI agent session running in the
 * workbench. Implementations observe the agent's own persistence (transcript
 * files, JSON-RPC notifications, server events) and send by feeding the same
 * input channel the terminal uses — there is no separate backend.
 */
export interface ConversationAdapter {
  readonly harness: AgentHarness;
  /** Subscribe to conversation state. Fires immediately with current state. */
  subscribe(cb: (state: ConversationState) => void): () => void;
  sendUserMessage(text: string): Promise<void>;
  /** Answer a pending elicitation (selected labels per question). */
  respondToElicitation?(requestId: string, answers: string[][]): Promise<void>;
  /** Reject a pending elicitation. */
  rejectElicitation?(requestId: string): Promise<void>;
  dispose(): void;
}
