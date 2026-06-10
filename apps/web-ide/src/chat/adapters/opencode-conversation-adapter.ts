import type {
  ChatMessage,
  ChatToolCall,
  ConversationAdapter,
  ConversationState,
} from '../conversation-types';
import type { ActiveAgentSession } from '../agent-session-registry';
import { buildUnifiedPatch, truncateToolOutput } from '../tool-calls';

interface OpenCodeMessageInfo {
  id?: string;
  sessionID?: string;
  role?: string;
  time?: { created?: number; completed?: number };
}

interface OpenCodeToolState {
  status?: string;
  input?: Record<string, unknown>;
  output?: string;
  title?: string;
}

interface OpenCodePart {
  id?: string;
  messageID?: string;
  sessionID?: string;
  type?: string;
  text?: string;
  synthetic?: boolean;
  tool?: string;
  callID?: string;
  state?: OpenCodeToolState;
}

interface OpenCodeBusEvent {
  type?: string;
  properties?: Record<string, unknown>;
}

interface OpenCodeSessionMessage {
  info?: OpenCodeMessageInfo;
  parts?: OpenCodePart[];
}

/** Minimal slice of the opencode SDK client the adapter uses. */
export interface OpenCodeChatClient {
  session: {
    list(): Promise<unknown>;
    messages(options: { path: { id: string } }): Promise<unknown>;
  };
  tui: {
    appendPrompt(options: { body: { text: string } }): Promise<unknown>;
    submitPrompt(): Promise<unknown>;
  };
}

export interface OpenCodeChatConnection {
  client: OpenCodeChatClient;
  fetch: typeof fetch;
  dispose: () => void;
}

export interface OpenCodeConversationAdapterOptions {
  session: ActiveAgentSession;
  connect: () => Promise<OpenCodeChatConnection>;
}

function unwrapData<T>(value: unknown): T {
  // The generated SDK returns either the payload or a { data } envelope.
  if (value && typeof value === 'object' && 'data' in value) {
    return (value as { data: T }).data;
  }
  return value as T;
}

function openCodeToolToCall(part: OpenCodePart): ChatToolCall {
  const tool = part.tool ?? 'tool';
  const state = part.state ?? {};
  const input = state.input ?? {};
  const status =
    state.status === 'completed'
      ? 'success'
      : state.status === 'error'
        ? 'error'
        : 'running';
  const filePath =
    typeof input.filePath === 'string'
      ? input.filePath.replace(/^\/project\//, '')
      : '';

  if (tool === 'bash') {
    const command = typeof input.command === 'string' ? input.command : '';
    return {
      name: 'Bash',
      title: state.title || command || 'Run command',
      command: command || undefined,
      output: state.output ? truncateToolOutput(state.output) : undefined,
      status,
    };
  }
  if (tool === 'edit' && filePath) {
    return {
      name: 'Edit',
      title: filePath,
      diffs: [
        {
          path: filePath,
          patch: buildUnifiedPatch(
            filePath,
            typeof input.oldString === 'string' ? input.oldString : '',
            typeof input.newString === 'string' ? input.newString : '',
          ),
        },
      ],
      status,
    };
  }
  if (tool === 'write' && filePath) {
    return {
      name: 'Write',
      title: filePath,
      diffs: [
        {
          path: filePath,
          patch: buildUnifiedPatch(
            filePath,
            '',
            typeof input.content === 'string' ? input.content : '',
          ),
        },
      ],
      status,
    };
  }
  const summary =
    state.title ||
    filePath ||
    (typeof input.pattern === 'string' ? input.pattern : '') ||
    (typeof input.query === 'string' ? input.query : '');
  return {
    name: tool.charAt(0).toUpperCase() + tool.slice(1),
    title: summary || tool,
    output: state.output ? truncateToolOutput(state.output) : undefined,
    status,
  };
}

interface TrackedMessage {
  info: OpenCodeMessageInfo;
  parts: Map<string, OpenCodePart>;
  order: string[];
}

/**
 * Conversation view over the in-browser OpenCode TUI. Observes the shared
 * opencode server's `/event` SSE stream (the same Bus the TUI renders from)
 * and sends through the TUI prompt endpoints, so the DOM-mounted TUI and the
 * chat stay two views of one session. There is no terminal stdin for
 * opencode in browser mode — the TUI routes are the equivalent.
 */
export class OpenCodeConversationAdapter implements ConversationAdapter {
  readonly harness = 'opencode' as const;

  private readonly listeners = new Set<(state: ConversationState) => void>();
  private readonly messagesById = new Map<string, TrackedMessage>();
  private messageOrder: string[] = [];
  private pendingMessages: ChatMessage[] = [];
  private pendingCounter = 0;
  private sessionId: string | null;
  private busy = false;
  private state: ConversationState;
  private disposed = false;
  private connection: OpenCodeChatConnection | null = null;
  private abortController = new AbortController();

  constructor(private readonly options: OpenCodeConversationAdapterOptions) {
    this.sessionId = options.session.resumeToken;
    this.state = {
      harness: 'opencode',
      sessionId: this.sessionId,
      messages: [],
      busy: false,
    };
    void this.start();
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
    const connection = await this.waitForConnection();
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
      await connection.client.tui.appendPrompt({ body: { text: trimmed } });
      await connection.client.tui.submitPrompt();
    } catch (error) {
      this.pendingMessages = this.pendingMessages.filter((m) => m !== pending);
      this.publish();
      throw error;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abortController.abort();
    this.connection?.dispose();
    this.listeners.clear();
  }

  private async waitForConnection(): Promise<OpenCodeChatConnection> {
    for (let attempt = 0; attempt < 100 && !this.connection && !this.disposed; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!this.connection) {
      throw new Error('OpenCode is still starting — try again in a moment.');
    }
    return this.connection;
  }

  private async start(): Promise<void> {
    try {
      const connection = await this.options.connect();
      if (this.disposed) {
        connection.dispose();
        return;
      }
      this.connection = connection;
      await this.hydrate(connection);
      void this.streamEvents(connection);
    } catch (error) {
      console.warn('[chat] opencode adapter failed to connect', error);
    }
  }

  private async hydrate(connection: OpenCodeChatConnection): Promise<void> {
    if (!this.sessionId) {
      // Bind to the most recently updated session (the one the TUI shows).
      const sessions = unwrapData<Array<{ id?: string; time?: { updated?: number } }>>(
        await connection.client.session.list().catch(() => []),
      );
      if (Array.isArray(sessions) && sessions.length > 0) {
        const newest = [...sessions].sort(
          (a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0),
        )[0];
        this.sessionId = newest?.id ?? null;
      }
    }
    if (!this.sessionId) return;
    const messages = unwrapData<OpenCodeSessionMessage[]>(
      await connection.client.session
        .messages({ path: { id: this.sessionId } })
        .catch(() => []),
    );
    if (!Array.isArray(messages)) return;
    for (const message of messages) {
      if (message?.info?.id) {
        this.upsertInfo(message.info);
        for (const part of message.parts ?? []) {
          const normalized = this.normalizeHydratedPart(part, message.info);
          if (normalized) {
            this.upsertPart(normalized);
          }
        }
      }
    }
    this.publish();
  }

  private async streamEvents(connection: OpenCodeChatConnection): Promise<void> {
    try {
      const response = await connection.fetch('http://opencode.internal/event', {
        signal: this.abortController.signal,
      });
      const reader = response.body?.getReader();
      if (!reader) return;
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done || this.disposed) break;
        buffer += decoder.decode(value, { stream: true });
        let separator = buffer.indexOf('\n\n');
        while (separator !== -1) {
          const chunk = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data:')) {
              this.handleEventPayload(line.slice(5).trim());
            }
          }
          separator = buffer.indexOf('\n\n');
        }
      }
    } catch (error) {
      if (!this.disposed) {
        console.warn('[chat] opencode event stream ended', error);
      }
    }
  }

  private handleEventPayload(payload: string): void {
    if (!payload) return;
    let event: OpenCodeBusEvent;
    try {
      event = JSON.parse(payload) as OpenCodeBusEvent;
    } catch {
      return;
    }
    const properties = event.properties ?? {};
    switch (event.type) {
      case 'message.updated': {
        const info = properties.info as OpenCodeMessageInfo | undefined;
        if (!info?.id) return;
        if (!this.sessionId && info.sessionID) {
          // Fresh TUI session — adopt it on first traffic.
          this.sessionId = info.sessionID;
        }
        if (info.sessionID !== this.sessionId) return;
        this.upsertInfo(info);
        this.publish();
        return;
      }
      case 'message.part.updated': {
        const part = properties.part as OpenCodePart | undefined;
        if (!part?.messageID) return;
        if (part.sessionID && this.sessionId && part.sessionID !== this.sessionId) {
          return;
        }
        this.upsertPart(part);
        this.publish();
        return;
      }
      case 'session.idle': {
        if (properties.sessionID === this.sessionId) {
          this.busy = false;
          this.publish();
        }
        return;
      }
      default:
    }
  }

  private upsertInfo(info: OpenCodeMessageInfo): void {
    const id = info.id!;
    const existing = this.messagesById.get(id);
    if (existing) {
      existing.info = info;
    } else {
      this.messagesById.set(id, { info, parts: new Map(), order: [] });
      this.messageOrder.push(id);
    }
    if (info.role === 'user') {
      this.busy = true;
    } else if (info.role === 'assistant' && info.time?.completed) {
      this.busy = false;
    }
  }

  private normalizeHydratedPart(
    part: OpenCodePart,
    info: OpenCodeMessageInfo,
  ): OpenCodePart | null {
    if (!part || typeof part !== 'object') return null;
    const messageID = typeof part.messageID === 'string' ? part.messageID : info.id;
    if (!messageID) return null;
    const sessionID =
      typeof part.sessionID === 'string' ? part.sessionID : info.sessionID;
    return {
      ...part,
      messageID,
      sessionID,
    };
  }

  private upsertPart(part: OpenCodePart): void {
    const messageId = part.messageID;
    if (!messageId) return;
    let tracked = this.messagesById.get(messageId);
    if (!tracked) {
      tracked = {
        info: { id: messageId, sessionID: part.sessionID },
        parts: new Map(),
        order: [],
      };
      this.messagesById.set(messageId, tracked);
      this.messageOrder.push(messageId);
    }
    const partId = part.id ?? `${messageId}-part-${tracked.order.length}`;
    if (!tracked.parts.has(partId)) {
      tracked.order.push(partId);
    }
    tracked.parts.set(partId, part);
  }

  private publish(): void {
    const messages: ChatMessage[] = [];
    for (const messageId of this.messageOrder) {
      const tracked = this.messagesById.get(messageId);
      if (!tracked) continue;
      const role = tracked.info.role === 'user' ? 'user' : 'assistant';
      const timestamp = tracked.info.time?.created ?? Date.now();
      const textParts: string[] = [];
      let textSegment = 0;
      const flushText = () => {
        const text = textParts.join('\n').trim();
        if (!text) return;
        messages.push({
          id: textSegment === 0 ? messageId : `${messageId}-text-${textSegment}`,
          role,
          text,
          timestamp,
        });
        textSegment += 1;
        textParts.length = 0;
      };
      for (const partId of tracked.order) {
        const part = tracked.parts.get(partId);
        if (!part || part.synthetic) continue;
        if (part.type === 'text' && part.text) {
          textParts.push(part.text);
        } else if (part.type === 'tool') {
          flushText();
          messages.push({
            id: `tool-${partId}`,
            role: 'assistant',
            kind: 'tool',
            text: '',
            timestamp,
            tool: openCodeToolToCall(part),
          });
        }
      }
      flushText();
    }

    // Reconcile optimistic sends against observed user messages.
    if (this.pendingMessages.length > 0) {
      const confirmed = new Set(
        messages.filter((m) => m.role === 'user').map((m) => m.text.trim()),
      );
      this.pendingMessages = this.pendingMessages.filter(
        (pending) => !confirmed.has(pending.text.trim()),
      );
    }

    this.state = {
      harness: 'opencode',
      sessionId: this.sessionId,
      messages: [...messages, ...this.pendingMessages],
      busy: this.busy || this.pendingMessages.length > 0,
    };
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }
}
