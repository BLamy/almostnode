import type {
  ChatMessage,
  ConversationAdapter,
  ConversationState,
} from '@agent-wasm/chat-core';
import type { ActiveAgentSession, AgentSessionRegistry } from '@agent-wasm/chat-core';
import { ClaudeTranscriptTail } from './claude-transcript-tail';
import { CLAUDE_PROJECTS_ROOT } from './claude-threads';

/** Minimal slice of VirtualFS the adapter needs (keeps tests dependency-free). */
export interface ClaudeAdapterVfs {
  on(event: 'change', listener: (path: string, content: string) => void): unknown;
  off(event: 'change', listener: (path: string, content: string) => void): unknown;
  existsSync(path: string): boolean;
  readdirSync(path: string): string[];
  statSync(path: string): { isDirectory(): boolean; mtimeMs?: number; mtime?: Date };
  readFileSync(path: string, encoding: 'utf8'): string;
}

export interface ClaudeConversationAdapterOptions {
  vfs: ClaudeAdapterVfs;
  session: ActiveAgentSession;
  registry: AgentSessionRegistry;
}

function getMtimeMs(stats: { mtimeMs?: number; mtime?: Date }): number {
  if (typeof stats.mtimeMs === 'number') return stats.mtimeMs;
  if (stats.mtime instanceof Date) return stats.mtime.getTime();
  return 0;
}

/**
 * Conversation view over an interactive `claude` CLI session. Observes the
 * session's JSONL transcript in the VirtualFS and sends by typing into the
 * same terminal stdin the user does — the chat and the terminal TUI are two
 * views of one session.
 */
export class ClaudeConversationAdapter implements ConversationAdapter {
  readonly harness = 'claude' as const;

  private readonly vfs: ClaudeAdapterVfs;
  private readonly session: ActiveAgentSession;
  private readonly registry: AgentSessionRegistry;
  private tail = new ClaudeTranscriptTail();
  private readonly listeners = new Set<(state: ConversationState) => void>();
  private adoptedPath: string | null = null;
  private pendingMessages: ChatMessage[] = [];
  private pendingCounter = 0;
  private state: ConversationState;
  private disposed = false;

  private readonly handleChange = (path: string, content: string) => {
    if (this.disposed) return;
    if (!path.startsWith(`${CLAUDE_PROJECTS_ROOT}/`) || !path.endsWith('.jsonl')) {
      return;
    }
    if (this.adoptedPath === null) {
      // Probe transcripts written after launch and bind to the first one
      // that actually carries conversation messages — this skips snapshot
      // restores, sidechain files, and index writes.
      const probe = new ClaudeTranscriptTail();
      const update = probe.ingest(content);
      if (!update || update.messages.length === 0) {
        return;
      }
      this.adoptedPath = path;
      this.tail = probe;
      this.applyTailUpdate();
      return;
    }
    if (path !== this.adoptedPath) {
      return;
    }
    const update = this.tail.ingest(content);
    if (update) {
      this.applyTailUpdate();
    }
  };

  constructor(options: ClaudeConversationAdapterOptions) {
    this.vfs = options.vfs;
    this.session = options.session;
    this.registry = options.registry;
    this.state = {
      harness: 'claude',
      sessionId: this.session.resumeToken,
      messages: [],
      busy: false,
    };
    this.adoptExistingTranscript();
    this.vfs.on('change', this.handleChange);
  }

  subscribe(cb: (state: ConversationState) => void): () => void {
    this.listeners.add(cb);
    cb(this.state);
    return () => {
      this.listeners.delete(cb);
    };
  }

  async sendUserMessage(text: string): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed) return;
    const pending: ChatMessage = {
      id: `pending-${++this.pendingCounter}`,
      role: 'user',
      text: trimmed,
      timestamp: Date.now(),
      pending: true,
    };
    this.pendingMessages = [...this.pendingMessages, pending];
    this.publish();
    try {
      await this.registry.sendUserText(trimmed);
    } catch (error) {
      this.pendingMessages = this.pendingMessages.filter((m) => m !== pending);
      this.publish();
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.vfs.off('change', this.handleChange);
    this.listeners.clear();
  }

  /**
   * Bind to a transcript that already exists — only when resuming a known
   * session, or when a file was written strictly after this session started
   * (the chat may attach after the CLI has been running for a while). Files
   * from before launch are snapshot restores of previous sessions, not this
   * conversation.
   */
  private adoptExistingTranscript(): void {
    const candidates = this.collectTranscriptFiles(CLAUDE_PROJECTS_ROOT);
    let best: { path: string; mtime: number } | null = null;
    for (const candidate of candidates) {
      if (this.session.resumeToken) {
        if (candidate.path.endsWith(`/${this.session.resumeToken}.jsonl`)) {
          best = candidate;
          break;
        }
        continue;
      }
      if (candidate.mtime <= this.session.startedAt) {
        continue;
      }
      if (!best || candidate.mtime > best.mtime) {
        best = candidate;
      }
    }
    if (!best) return;
    const probe = new ClaudeTranscriptTail();
    const update = probe.ingest(this.vfs.readFileSync(best.path, 'utf8'));
    if (!update || update.messages.length === 0) {
      return;
    }
    this.adoptedPath = best.path;
    this.tail = probe;
    this.applyTailUpdate();
  }

  private collectTranscriptFiles(root: string): Array<{ path: string; mtime: number }> {
    const results: Array<{ path: string; mtime: number }> = [];
    if (!this.vfs.existsSync(root)) {
      return results;
    }
    const visit = (dir: string) => {
      let entries: string[];
      try {
        entries = this.vfs.readdirSync(dir);
      } catch {
        return;
      }
      for (const entry of entries) {
        const path = `${dir}/${entry}`;
        let stats: ReturnType<ClaudeAdapterVfs['statSync']>;
        try {
          stats = this.vfs.statSync(path);
        } catch {
          continue;
        }
        if (stats.isDirectory()) {
          visit(path);
        } else if (path.endsWith('.jsonl')) {
          results.push({ path, mtime: getMtimeMs(stats) });
        }
      }
    };
    visit(root);
    return results;
  }

  private applyTailUpdate(): void {
    // Drop pending sends once the transcript echoes them back.
    if (this.pendingMessages.length > 0) {
      const confirmed = new Set(
        this.tail
          .getMessages()
          .filter((m) => m.role === 'user')
          .map((m) => m.text.trim()),
      );
      this.pendingMessages = this.pendingMessages.filter(
        (pending) => !confirmed.has(pending.text.trim()),
      );
    }
    this.publish();
  }

  private publish(): void {
    const messages = [...this.tail.getMessages(), ...this.pendingMessages];
    // Busy while the conversation is waiting on the assistant: either the
    // last conversational message is from the user, or a tool is running.
    const lastAny = messages.at(-1);
    const lastText = messages.filter((m) => m.kind !== 'tool').at(-1);
    const busy =
      Boolean(lastText && lastText.role === 'user') ||
      Boolean(lastAny?.kind === 'tool' && lastAny.tool?.status === 'running');
    this.state = {
      harness: 'claude',
      sessionId: this.tail.getSessionId() ?? this.session.resumeToken,
      messages,
      busy,
      contextTokens: this.tail.getContextTokens(),
    };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
