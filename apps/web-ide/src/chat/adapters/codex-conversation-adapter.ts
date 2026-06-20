import type {
  ChatMessage,
  ConversationAdapter,
  ConversationState,
} from '../conversation-types';
import type { ActiveAgentSession, AgentSessionRegistry } from '../agent-session-registry';
import type { CodexBusEvent, CodexConversationBus } from '../codex-conversation-bus';
import { ensurePatchHeaders, truncateToolOutput } from '../tool-calls';

interface CodexNotification {
  method?: string;
  params?: Record<string, unknown>;
}

interface CodexThreadItem {
  type?: string;
  id?: string;
  text?: string;
  content?: unknown;
  command?: string;
  aggregatedOutput?: string;
  exitCode?: number;
  status?: string;
  changes?: Array<{ path?: string; diff?: string }>;
}

function extractUserInputText(content: unknown): string {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      if (
        part &&
        typeof part === 'object' &&
        typeof (part as { text?: unknown }).text === 'string'
      ) {
        return (part as { text: string }).text;
      }
      return '';
    })
    .join(' ')
    .trim();
}

export interface CodexConversationAdapterOptions {
  session: ActiveAgentSession;
  registry: AgentSessionRegistry;
  bus: CodexConversationBus;
}

/**
 * Conversation view over the browser Codex TUI. The WASM build persists no
 * rollout files, so messages are observed from the app-server JSON-RPC tee:
 * `item/completed` carries finished user/agent messages,
 * `item/agentMessage/delta` streams assistant text, and `turn/*` drives the
 * busy state. Sending types into the codex terminal like the user would.
 */
export class CodexConversationAdapter implements ConversationAdapter {
  readonly harness = 'codex' as const;

  private readonly registry: AgentSessionRegistry;
  private readonly listeners = new Set<(state: ConversationState) => void>();
  private readonly unsubscribe: () => void;
  private messages: ChatMessage[] = [];
  private pendingMessages: ChatMessage[] = [];
  private streamingByItemId = new Map<string, ChatMessage>();
  private pendingCounter = 0;
  private threadId: string | null = null;
  private busy = false;
  private state: ConversationState;
  private disposed = false;

  constructor(options: CodexConversationAdapterOptions) {
    this.registry = options.registry;
    this.state = {
      harness: 'codex',
      sessionId: null,
      messages: [],
      busy: false,
    };
    // Replays buffered events so chat attaching mid-session gets history.
    this.unsubscribe = options.bus.subscribe((event) => this.handleEvent(event));
    this.publish();
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
    this.unsubscribe();
    this.listeners.clear();
  }

  private handleEvent(event: CodexBusEvent): void {
    if (this.disposed) return;
    if (event.kind === 'reset') {
      this.messages = [];
      this.streamingByItemId.clear();
      this.threadId = null;
      this.busy = false;
      this.publish();
      return;
    }
    if (event.kind === 'request') {
      if (event.method === 'thread/start') {
        const thread = (event.result as { thread?: { id?: unknown } } | undefined)
          ?.thread;
        if (typeof thread?.id === 'string') {
          this.threadId = thread.id;
          this.publish();
        }
      }
      return;
    }
    this.handleNotification(event.notification as CodexNotification);
  }

  private handleNotification(notification: CodexNotification): void {
    if (!notification || typeof notification !== 'object') return;
    const params = notification.params ?? {};
    if (typeof params.threadId === 'string') {
      this.threadId = params.threadId;
    }

    switch (notification.method) {
      case 'turn/started': {
        this.busy = true;
        this.publish();
        return;
      }
      case 'turn/completed':
      case 'turn/failed':
      case 'turn/aborted': {
        this.busy = false;
        this.publish();
        return;
      }
      case 'item/agentMessage/delta': {
        const itemId = typeof params.itemId === 'string' ? params.itemId : null;
        const delta = typeof params.delta === 'string' ? params.delta : '';
        if (!itemId || !delta) return;
        const existing = this.streamingByItemId.get(itemId);
        if (existing) {
          existing.text += delta;
        } else {
          const message: ChatMessage = {
            id: itemId,
            role: 'assistant',
            text: delta,
            timestamp: Date.now(),
          };
          this.streamingByItemId.set(itemId, message);
          this.messages = [...this.messages, message];
        }
        this.messages = [...this.messages];
        this.publish();
        return;
      }
      case 'item/started': {
        // Long-running commands (Codex background terminals like
        // `npm run typecheck`) only emit item/completed when they finish —
        // render them as soon as they start so the command is visible.
        const item = params.item as CodexThreadItem | undefined;
        if (!item || typeof item.id !== 'string') return;
        if (item.type === 'commandExecution') {
          this.upsertCommandExecution(item, { running: true });
        }
        return;
      }
      case 'item/completed': {
        const item = params.item as CodexThreadItem | undefined;
        if (!item || typeof item.id !== 'string') return;
        if (item.type === 'agentMessage') {
          this.upsertMessage({
            id: item.id,
            role: 'assistant',
            text: typeof item.text === 'string' ? item.text : '',
            timestamp: Date.now(),
          });
          this.streamingByItemId.delete(item.id);
        } else if (item.type === 'userMessage') {
          const text = extractUserInputText(item.content);
          if (!text) return;
          // Reconcile against optimistic chat sends.
          this.pendingMessages = this.pendingMessages.filter(
            (pending) => pending.text.trim() !== text,
          );
          this.upsertMessage({
            id: item.id,
            role: 'user',
            text,
            timestamp: Date.now(),
          });
        } else if (item.type === 'commandExecution') {
          this.upsertCommandExecution(item, { running: false });
        } else if (item.type === 'fileChange') {
          const changes = Array.isArray(item.changes) ? item.changes : [];
          const diffs = changes
            .filter(
              (change) =>
                typeof change.path === 'string' && typeof change.diff === 'string',
            )
            .map((change) => ({
              path: change.path as string,
              patch: ensurePatchHeaders(change.path as string, change.diff as string),
            }));
          if (diffs.length === 0) return;
          this.upsertMessage({
            id: item.id,
            role: 'assistant',
            kind: 'tool',
            text: '',
            timestamp: Date.now(),
            tool: {
              name: 'Edit',
              title: diffs.map((diff) => diff.path).join(', '),
              diffs,
              status: item.status === 'failed' ? 'error' : 'success',
            },
          });
        }
        return;
      }
      default:
    }
  }

  private upsertCommandExecution(
    item: CodexThreadItem,
    { running }: { running: boolean },
  ): void {
    const command = typeof item.command === 'string' ? item.command : '';
    if (!command || typeof item.id !== 'string') return;
    const failed =
      item.status === 'failed' ||
      (typeof item.exitCode === 'number' && item.exitCode !== 0);
    this.upsertMessage({
      id: item.id,
      role: 'assistant',
      kind: 'tool',
      text: '',
      timestamp: Date.now(),
      tool: {
        name: 'Bash',
        title: command,
        command,
        output:
          typeof item.aggregatedOutput === 'string' && item.aggregatedOutput
            ? truncateToolOutput(item.aggregatedOutput)
            : undefined,
        status: running ? 'running' : failed ? 'error' : 'success',
      },
    });
  }

  private upsertMessage(message: ChatMessage): void {
    if (!message.text && message.kind !== 'tool') return;
    const index = this.messages.findIndex((m) => m.id === message.id);
    if (index >= 0) {
      const next = [...this.messages];
      next[index] = { ...next[index], ...message };
      this.messages = next;
    } else {
      this.messages = [...this.messages, message];
    }
    this.publish();
  }

  private publish(): void {
    this.state = {
      harness: 'codex',
      sessionId: this.threadId,
      messages: [...this.messages, ...this.pendingMessages],
      busy: this.busy,
    };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
