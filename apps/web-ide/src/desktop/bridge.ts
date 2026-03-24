export interface DesktopBridge {
  invoke<T = unknown>(channel: string, ...args: unknown[]): Promise<T>;
  send(channel: string, payload?: unknown): void;
  on<T = unknown>(channel: string, listener: (payload: T) => void): () => void;
}

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
    almostnodeBridge?: {
      onRequest: (
        callback: (requestId: string, operation: string, params: Record<string, unknown>) => void,
      ) => void;
      sendResponse: (requestId: string, error: string | null, result: unknown) => void;
    };
  }
}

export function getDesktopBridge(): DesktopBridge | null {
  return window.desktopBridge ?? null;
}

export function isDesktopRuntime(): boolean {
  return getDesktopBridge() !== null;
}
