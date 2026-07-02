// Pending Electron dialog requests (dialog.showOpenDialog / showSaveDialog /
// showMessageBox forwarded through ElectronHost.showDialog). One dialog is
// presented at a time; <ElectronDialogHost/> renders the head of the queue and
// resolves it with the user's outcome.

import { useSyncExternalStore } from "react";
import type { ElectronDialogRequest, ElectronDialogResult } from "@agent-wasm/core";

export interface ActiveDialog {
  id: number;
  request: ElectronDialogRequest;
  resolve: (result: ElectronDialogResult) => void;
}

let queue: ActiveDialog[] = [];
let dialogSeq = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function requestDialog(
  request: ElectronDialogRequest,
): Promise<ElectronDialogResult> {
  return new Promise((resolve) => {
    queue = [...queue, { id: ++dialogSeq, request, resolve }];
    emit();
  });
}

export function resolveDialog(id: number, result: ElectronDialogResult): void {
  const entry = queue.find((d) => d.id === id);
  if (!entry) return;
  queue = queue.filter((d) => d.id !== id);
  emit();
  entry.resolve(result);
}

export function useActiveDialog(): ActiveDialog | null {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => queue[0] ?? null,
    () => null,
  );
}
