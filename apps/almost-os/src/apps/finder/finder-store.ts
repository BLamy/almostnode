import { useSyncExternalStore } from "react";

// Lets desktop icons (and other surfaces) tell the Finder window which VFS path
// to open when it mounts/focuses.

export type FinderTarget = { kind: "vfs"; path: string };

let pending: FinderTarget | null = null;
let seq = 0;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export const finderStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Bumped whenever a new open is requested, so Finder re-reads even for repeats. */
  getSnapshot(): number {
    return seq;
  },
  request(target: FinderTarget) {
    pending = target;
    seq += 1;
    notify();
  },
  /** Read + clear the pending target (Finder calls this on the seq change). */
  consume(): FinderTarget | null {
    const t = pending;
    pending = null;
    return t;
  },
};

/** Returns the request sequence; changes whenever a new target is requested. */
export function useFinderRequest(): number {
  return useSyncExternalStore(finderStore.subscribe, finderStore.getSnapshot, finderStore.getSnapshot);
}
