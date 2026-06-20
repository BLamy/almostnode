/**
 * Pure LRU eviction policy for live sandbox sessions. The workbench host
 * consults this after each session switch; entries it reports get their
 * files + agent state snapshotted and their containers disposed.
 */

/** Maximum number of live (in-memory) sandbox sessions. */
export const SESSION_POOL_CAP = 3;

export interface SessionPoolEntry {
  id: string;
  /** Millisecond timestamp of the session's most recent attach. */
  lastActiveAt: number;
  /**
   * Pinned sessions are never evicted: the active session, sessions with a
   * running agent CLI, and sessions with a running terminal command.
   */
  pinned: boolean;
}

/**
 * Returns the session ids to evict so at most `cap` sessions stay live.
 * Eviction picks the least-recently-active unpinned entries, oldest first
 * (ties broken by input order). Pinned entries never appear in the result,
 * even when they alone exceed the cap — the pool may run over budget rather
 * than kill running work. When pinned entries already meet or exceed the
 * cap, every unpinned entry is evicted.
 */
export function selectSessionsToEvict(
  entries: readonly SessionPoolEntry[],
  cap: number = SESSION_POOL_CAP,
): string[] {
  const overflow = entries.length - Math.max(cap, 0);
  if (overflow <= 0) {
    return [];
  }

  const unpinned = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => !entry.pinned)
    .sort(
      (left, right) =>
        left.entry.lastActiveAt - right.entry.lastActiveAt ||
        left.index - right.index,
    );

  return unpinned.slice(0, overflow).map(({ entry }) => entry.id);
}
