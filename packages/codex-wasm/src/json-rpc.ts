export type CodexJsonRpcId = string | number;

export interface CodexJsonRpcRequest {
  id: CodexJsonRpcId;
  method: string;
  params?: unknown;
}

export interface CodexJsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface CodexJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface CodexJsonRpcResponse {
  id: CodexJsonRpcId;
  result?: unknown;
  error?: CodexJsonRpcError;
}

export type CodexJsonRpcMessage =
  | CodexJsonRpcRequest
  | CodexJsonRpcNotification
  | CodexJsonRpcResponse;

export interface CodexMessageTransport {
  send(message: CodexJsonRpcMessage): void;
  onMessage(listener: (message: unknown) => void): () => void;
  onClose?(listener: () => void): () => void;
  close?(): void;
}

export interface CodexClientInfo {
  name: string;
  title: string;
  version: string;
}

export interface CodexInitializeParams {
  clientInfo: CodexClientInfo;
  capabilities?: {
    experimentalApi?: boolean;
    optOutNotificationMethods?: string[];
  };
}

export interface CodexRpcPeerOptions {
  requestTimeoutMs?: number;
  nextId?: () => CodexJsonRpcId;
  onProtocolError?: (error: Error, message: unknown) => void;
}

export interface CodexServerRequest {
  id: CodexJsonRpcId;
  method: string;
  params?: unknown;
}

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
};

type Listener<T> = (value: T) => void;

export class CodexJsonRpcPeer {
  private readonly pending = new Map<CodexJsonRpcId, PendingRequest>();
  private readonly notificationListeners = new Set<Listener<CodexJsonRpcNotification>>();
  private readonly serverRequestListeners = new Set<Listener<CodexServerRequest>>();
  private readonly unsubscribeMessage: () => void;
  private readonly unsubscribeClose?: () => void;
  private nextNumericId = 1;
  private disposed = false;

  constructor(
    private readonly transport: CodexMessageTransport,
    private readonly options: CodexRpcPeerOptions = {},
  ) {
    this.unsubscribeMessage = transport.onMessage((message) => {
      this.handleIncoming(message);
    });
    this.unsubscribeClose = transport.onClose?.(() => {
      this.rejectAllPending(new Error("Codex transport closed"));
    });
  }

  async initialize(params: CodexInitializeParams): Promise<unknown> {
    const result = await this.request("initialize", params);
    this.notify("initialized", {});
    return result;
  }

  request(method: string, params?: unknown): Promise<unknown> {
    this.assertActive();
    const id = this.options.nextId?.() ?? this.nextNumericId++;
    const timeoutMs = this.options.requestTimeoutMs;

    return new Promise((resolve, reject) => {
      const timer =
        typeof timeoutMs === "number" && timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`Codex request timed out: ${method}`));
            }, timeoutMs)
          : null;

      this.pending.set(id, { resolve, reject, timer });
      this.transport.send({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.assertActive();
    this.transport.send({ method, params });
  }

  respond(id: CodexJsonRpcId, result: unknown): void {
    this.assertActive();
    this.transport.send({ id, result });
  }

  fail(id: CodexJsonRpcId, error: CodexJsonRpcError): void {
    this.assertActive();
    this.transport.send({ id, error });
  }

  onNotification(listener: Listener<CodexJsonRpcNotification>): () => void {
    this.notificationListeners.add(listener);
    return () => {
      this.notificationListeners.delete(listener);
    };
  }

  onServerRequest(listener: Listener<CodexServerRequest>): () => void {
    this.serverRequestListeners.add(listener);
    return () => {
      this.serverRequestListeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribeMessage();
    this.unsubscribeClose?.();
    this.rejectAllPending(new Error("Codex JSON-RPC peer disposed"));
    this.notificationListeners.clear();
    this.serverRequestListeners.clear();
    this.transport.close?.();
  }

  private handleIncoming(raw: unknown): void {
    if (isNonRpcControlMessage(raw)) return;
    if (!isCodexJsonRpcMessage(raw)) return;

    if ("id" in raw && ("result" in raw || "error" in raw) && !("method" in raw)) {
      this.completePending(raw);
      return;
    }

    if ("id" in raw && "method" in raw && typeof raw.method === "string") {
      const request = raw as CodexJsonRpcRequest;
      this.emitServerRequest({
        id: request.id,
        method: request.method,
        params: request.params,
      });
      return;
    }

    if ("method" in raw) {
      this.emitNotification(raw);
      return;
    }

    this.options.onProtocolError?.(
      new Error("Unrecognized Codex JSON-RPC message"),
      raw,
    );
  }

  private completePending(response: CodexJsonRpcResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) return;

    this.pending.delete(response.id);
    if (pending.timer) clearTimeout(pending.timer);

    if (response.error) {
      pending.reject(
        Object.assign(new Error(response.error.message), {
          code: response.error.code,
          data: response.error.data,
        }),
      );
      return;
    }

    pending.resolve(response.result);
  }

  private emitNotification(notification: CodexJsonRpcNotification): void {
    for (const listener of this.notificationListeners) {
      listener(notification);
    }
  }

  private emitServerRequest(request: CodexJsonRpcRequest): void {
    for (const listener of this.serverRequestListeners) {
      listener(request);
    }
  }

  private rejectAllPending(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private assertActive(): void {
    if (this.disposed) {
      throw new Error("Codex JSON-RPC peer is disposed");
    }
  }
}

function isNonRpcControlMessage(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const type = (value as Record<string, unknown>).type;
  return typeof type === "string" && type.startsWith("codex/");
}

function isCodexJsonRpcMessage(value: unknown): value is CodexJsonRpcMessage {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const hasId =
    typeof candidate.id === "string" || typeof candidate.id === "number";
  const hasMethod = typeof candidate.method === "string";
  const hasResult = Object.prototype.hasOwnProperty.call(candidate, "result");
  const hasError = Object.prototype.hasOwnProperty.call(candidate, "error");

  return hasMethod || (hasId && (hasResult || hasError));
}
