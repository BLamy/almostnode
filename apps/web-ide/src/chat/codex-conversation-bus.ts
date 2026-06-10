/**
 * Tee of the Codex app-server JSON-RPC traffic that backs the browser Codex
 * TUI. The WASM build of Codex persists no rollout files, so this stream is
 * the only way to observe the conversation. Events are buffered (per app
 * server session) so a chat surface attaching mid-session can replay history.
 */
export type CodexBusEvent =
  | { kind: 'notification'; notification: unknown }
  | { kind: 'request'; method: string; params: unknown; result: unknown }
  | { kind: 'reset' };

const BUFFER_LIMIT = 5000;

export class CodexConversationBus {
  private buffer: CodexBusEvent[] = [];
  private listeners = new Set<(event: CodexBusEvent) => void>();

  /** Called when a fresh app-server session is created. */
  reset(): void {
    this.buffer = [];
    this.dispatch({ kind: 'reset' });
  }

  emitNotification(notification: unknown): void {
    this.push({ kind: 'notification', notification });
  }

  emitRequest(method: string, params: unknown, result: unknown): void {
    this.push({ kind: 'request', method, params, result });
  }

  subscribe(
    listener: (event: CodexBusEvent) => void,
    options?: { replay?: boolean },
  ): () => void {
    if (options?.replay !== false) {
      for (const event of this.buffer) {
        listener(event);
      }
    }
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private push(event: CodexBusEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > BUFFER_LIMIT) {
      this.buffer.splice(0, this.buffer.length - BUFFER_LIMIT);
    }
    this.dispatch(event);
  }

  private dispatch(event: CodexBusEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}

export const codexConversationBus = new CodexConversationBus();
