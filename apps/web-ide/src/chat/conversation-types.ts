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

export interface ChatMessage {
  /** Stable id: claude transcript uuid / codex item id / opencode messageID. */
  id: string;
  role: 'user' | 'assistant';
  /** 'tool' messages render as tool-call cards instead of bubbles. */
  kind?: 'text' | 'tool';
  text: string;
  timestamp: number;
  tool?: ChatToolCall;
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
  dispose(): void;
}
