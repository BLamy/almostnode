import { BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
}

const pending = new Map<string, PendingRequest>();
const TIMEOUT_MS = 1_800_000;

export function setupAlmostNodeBridge(): void {
  ipcMain.on('almostnode:response', (_event, requestId: string, error: string | null, result: unknown) => {
    const entry = pending.get(requestId);
    if (!entry) return;
    clearTimeout(entry.timer);
    pending.delete(requestId);
    if (error) {
      entry.reject(new Error(error));
    } else {
      entry.resolve(result);
    }
  });
}

export function invokeRendererForWindowId(
  windowId: number,
  operation: string,
  params: Record<string, unknown>,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const win = BrowserWindow.fromId(windowId);
    if (!win || win.isDestroyed()) {
      reject(new Error(`No renderer window available for id ${windowId}`));
      return;
    }

    const requestId = randomUUID();
    const timer = setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`almostnode request timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    pending.set(requestId, { resolve, reject, timer });
    win.webContents.send('almostnode:request', requestId, operation, params);
  });
}
