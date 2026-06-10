import type { ChatMessage } from './conversation-types';
import { extractClaudeMessageText } from '../features/resumable-threads';
import { claudeToolUseToToolCall, truncateToolOutput } from './tool-calls';

interface ClaudeContentBlock {
  type?: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
  content?: unknown;
}

interface ClaudeUsage {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
}

interface ClaudeTranscriptLine {
  type?: string;
  uuid?: string;
  sessionId?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  timestamp?: string;
  message?: {
    role?: string;
    content?: unknown;
    usage?: ClaudeUsage;
  };
}

function usageContextTokens(usage: ClaudeUsage | undefined): number | null {
  if (!usage || typeof usage !== 'object') return null;
  const total =
    (usage.input_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.output_tokens ?? 0);
  return total > 0 ? total : null;
}

function contentBlocks(content: unknown): ClaudeContentBlock[] {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (part): part is ClaudeContentBlock => Boolean(part) && typeof part === 'object',
  );
}

function isToolResultOnlyContent(content: unknown): boolean {
  const blocks = contentBlocks(content);
  return blocks.length > 0 && blocks.every((part) => part.type === 'tool_result');
}

function isSyntheticUserText(text: string): boolean {
  // Claude Code records slash-command invocations and local command output
  // as user entries wrapped in pseudo-XML tags.
  return text.startsWith('<command-') || text.startsWith('<local-command-');
}

export interface ClaudeTailUpdate {
  messages: ChatMessage[];
  sessionId: string | null;
}

/**
 * Incremental parser over a Claude Code transcript JSONL file. Feed it the
 * full file content on every VFS change event; it only parses lines appended
 * since the previous call and tolerates the file being replaced wholesale
 * (e.g. a fresh session reusing the path). Assistant `tool_use` blocks become
 * tool-call messages; later `tool_result` entries attach their output to the
 * originating tool message.
 */
export class ClaudeTranscriptTail {
  private offset = 0;
  private messages: ChatMessage[] = [];
  private seenIds = new Set<string>();
  /** tool_use id → index into messages, for attaching results. */
  private toolMessageIndex = new Map<string, number>();
  private sessionId: string | null = null;
  private contextTokens: number | null = null;

  getMessages(): ChatMessage[] {
    return this.messages;
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  /** Context occupancy from the latest assistant usage record, if any. */
  getContextTokens(): number | null {
    return this.contextTokens;
  }

  /** Returns the updated message list, or null when nothing new parsed. */
  ingest(content: string): ClaudeTailUpdate | null {
    if (content.length < this.offset) {
      // File shrank — it was replaced. Start over.
      this.offset = 0;
      this.messages = [];
      this.seenIds = new Set();
      this.toolMessageIndex = new Map();
      this.sessionId = null;
      this.contextTokens = null;
    }

    const appended = content.slice(this.offset);
    // Only consume complete lines; a partial trailing line is re-read next time.
    const lastNewline = appended.lastIndexOf('\n');
    if (lastNewline === -1) {
      return null;
    }
    this.offset += lastNewline + 1;

    let changed = false;
    for (const rawLine of appended.slice(0, lastNewline).split('\n')) {
      const line = rawLine.trim();
      if (!line) continue;

      let entry: ClaudeTranscriptLine;
      try {
        entry = JSON.parse(line) as ClaudeTranscriptLine;
      } catch {
        continue;
      }

      if (entry.isSidechain || entry.isMeta) continue;
      if (typeof entry.sessionId === 'string' && entry.sessionId) {
        this.sessionId = entry.sessionId;
      }

      if (this.ingestEntry(entry)) {
        changed = true;
      }
    }

    if (!changed) {
      return null;
    }
    return { messages: this.messages, sessionId: this.sessionId };
  }

  private ingestEntry(entry: ClaudeTranscriptLine): boolean {
    const role = entry.message?.role;
    if (
      (entry.type !== 'user' && entry.type !== 'assistant') ||
      (role !== 'user' && role !== 'assistant')
    ) {
      return false;
    }

    const timestampParsed = entry.timestamp
      ? Date.parse(entry.timestamp)
      : Number.NaN;
    const timestamp = Number.isFinite(timestampParsed)
      ? timestampParsed
      : Date.now();

    if (role === 'assistant') {
      const tokens = usageContextTokens(entry.message?.usage);
      if (tokens !== null) {
        this.contextTokens = tokens;
      }
    }

    if (role === 'user' && isToolResultOnlyContent(entry.message?.content)) {
      return this.attachToolResults(entry);
    }

    let changed = false;
    const baseId = entry.uuid || `${role}-${this.messages.length}`;

    const text = extractClaudeMessageText(entry.message?.content);
    if (text && !(role === 'user' && isSyntheticUserText(text))) {
      if (!this.seenIds.has(baseId)) {
        this.seenIds.add(baseId);
        this.messages = [...this.messages, { id: baseId, role, text, timestamp }];
        changed = true;
      }
    }

    if (role === 'assistant') {
      const blocks = contentBlocks(entry.message?.content);
      for (const [index, block] of blocks.entries()) {
        if (block.type !== 'tool_use' || typeof block.name !== 'string') {
          continue;
        }
        const toolUseId = block.id || `${baseId}-tool-${index}`;
        const messageId = `tool-${toolUseId}`;
        if (this.seenIds.has(messageId)) continue;
        this.seenIds.add(messageId);
        this.toolMessageIndex.set(toolUseId, this.messages.length);
        this.messages = [
          ...this.messages,
          {
            id: messageId,
            role: 'assistant',
            kind: 'tool',
            text: '',
            timestamp,
            tool: claudeToolUseToToolCall(block.name, block.input),
          },
        ];
        changed = true;
      }
    }

    return changed;
  }

  private attachToolResults(entry: ClaudeTranscriptLine): boolean {
    let changed = false;
    for (const block of contentBlocks(entry.message?.content)) {
      if (block.type !== 'tool_result' || typeof block.tool_use_id !== 'string') {
        continue;
      }
      const index = this.toolMessageIndex.get(block.tool_use_id);
      if (index === undefined) continue;
      const message = this.messages[index];
      if (!message?.tool || message.tool.status !== 'running') continue;
      const output = extractClaudeMessageText(block.content);
      const next = [...this.messages];
      next[index] = {
        ...message,
        tool: {
          ...message.tool,
          output: output ? truncateToolOutput(output) : message.tool.output,
          status: block.is_error ? 'error' : 'success',
        },
      };
      this.messages = next;
      changed = true;
    }
    return changed;
  }
}
