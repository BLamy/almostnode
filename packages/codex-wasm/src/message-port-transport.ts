import type { CodexJsonRpcMessage, CodexMessageTransport } from "./json-rpc";

export interface MessagePortLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener?(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  removeEventListener?(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  start?(): void;
  close?(): void;
  onmessage?: ((event: MessageEvent<unknown>) => void) | null;
}

export interface MessagePortTransportOptions {
  encodeJson?: boolean;
}

export function createMessagePortTransport(
  port: MessagePortLike,
  options: MessagePortTransportOptions = {},
): CodexMessageTransport {
  const listeners = new Set<(message: unknown) => void>();
  const closeListeners = new Set<() => void>();

  const receive = (event: MessageEvent<unknown>) => {
    const data = decodeMessage(event.data);
    for (const listener of listeners) {
      listener(data);
    }
  };

  if (port.addEventListener) {
    port.addEventListener("message", receive);
  } else {
    const previous = port.onmessage;
    port.onmessage = (event) => {
      previous?.(event);
      receive(event);
    };
  }

  port.start?.();

  return {
    send(message: CodexJsonRpcMessage): void {
      port.postMessage(options.encodeJson ? JSON.stringify(message) : message);
    },
    onMessage(listener: (message: unknown) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onClose(listener: () => void): () => void {
      closeListeners.add(listener);
      return () => {
        closeListeners.delete(listener);
      };
    },
    close(): void {
      if (port.removeEventListener) {
        port.removeEventListener("message", receive);
      }
      for (const listener of closeListeners) {
        listener();
      }
      closeListeners.clear();
      listeners.clear();
      port.close?.();
    },
  };
}

function decodeMessage(message: unknown): unknown {
  if (typeof message !== "string") return message;
  try {
    return JSON.parse(message);
  } catch {
    return message;
  }
}
