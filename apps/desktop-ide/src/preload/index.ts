import { contextBridge, ipcRenderer } from 'electron';

const desktopBridge = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>,
  send: (channel: string, payload?: unknown) => {
    ipcRenderer.send(channel, payload);
  },
  on: <T = unknown>(channel: string, listener: (payload: T) => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: T) => {
      listener(payload);
    };
    ipcRenderer.on(channel, wrapped);
    return () => {
      ipcRenderer.off(channel, wrapped);
    };
  },
};

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('desktopBridge', desktopBridge);
  contextBridge.exposeInMainWorld('almostnodeBridge', {
    onRequest: (callback: (requestId: string, operation: string, params: Record<string, unknown>) => void) => {
      ipcRenderer.on('almostnode:request', (_event, requestId, operation, params) => {
        callback(requestId, operation, params);
      });
    },
    sendResponse: (requestId: string, error: string | null, result: unknown) => {
      ipcRenderer.send('almostnode:response', requestId, error, result);
    },
  });
} else {
  (window as typeof window & { desktopBridge: typeof desktopBridge }).desktopBridge = desktopBridge;
}
