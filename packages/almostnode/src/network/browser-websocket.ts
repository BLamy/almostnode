const isBrowser =
  typeof window !== 'undefined'
  && typeof window.document !== 'undefined';

const browserNativeWebSocket: typeof globalThis.WebSocket | null =
  isBrowser && typeof globalThis.WebSocket === 'function'
    ? globalThis.WebSocket
    : null;

export function getBrowserNativeWebSocket(): typeof globalThis.WebSocket | null {
  return browserNativeWebSocket;
}
