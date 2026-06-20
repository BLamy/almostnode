/**
 * Fork-on-edit: repo bases (main) are read-only. When the workbench host
 * refuses an edit or agent launch on a read-only repo base it broadcasts
 * this event; the sidebar reacts by forking a fresh sandbox from main and
 * opening it.
 */

import type { SandboxRecord } from '../features/project-db';

/** Mirrors FORK_REQUESTED_EVENT in workbench-host.ts (not imported — the
 * sidebar must stay loadable without the 10k-line host module). */
export const FORK_REQUESTED_EVENT = 'almostnode:fork-requested';

export interface ForkRequestDetail {
  repoId?: string | null;
}

export interface ForkCapableManager {
  createSandbox(repoId: string, name?: string): Promise<SandboxRecord>;
  openSandbox(sandboxId: string): Promise<void>;
}

/** Create a sandbox on the repo and open it; resolves with the new record. */
export async function forkRepoIntoSandbox(
  manager: ForkCapableManager,
  repoId: string,
): Promise<SandboxRecord> {
  const sandbox = await manager.createSandbox(repoId);
  await manager.openSandbox(sandbox.id);
  return sandbox;
}
