/**
 * Pure derivation of sidebar running-agent indicators from the agent
 * session registry's session list. Kept free of React/registry imports so
 * the spinner logic is unit-testable.
 */

import type { ActiveAgentSession } from '@agent-wasm/chat-core';
import type { ResumableThreadRecord } from '../features/project-db';

export interface RunningAgentState {
  runningSandboxIds: string[];
  runningThreadKeys: string[];
}

/**
 * Compute which sandboxes and threads have a running agent session.
 * `isRunning()` is evaluated at call time — the 2s sidebar poll re-runs
 * this over the latest session snapshot to catch sessions whose running
 * state flipped without a registry notification.
 *
 * Thread keys are matched two ways (see {@link isThreadRunning}): the
 * session's explicit `threadId` (a ResumableThreadRecord id) and a
 * `${sandboxId}:${resumeToken}` pair for sessions registered before their
 * thread record exists.
 */
export function computeRunningAgentState(
  sessions: readonly ActiveAgentSession[],
): RunningAgentState {
  const sandboxIds = new Set<string>();
  const threadKeys = new Set<string>();

  for (const session of sessions) {
    if (!session.isRunning()) {
      continue;
    }
    if (session.sandboxId) {
      sandboxIds.add(session.sandboxId);
    }
    if (session.threadId) {
      threadKeys.add(session.threadId);
    }
    if (session.sandboxId && session.resumeToken) {
      threadKeys.add(`${session.sandboxId}:${session.resumeToken}`);
    }
  }

  return {
    runningSandboxIds: Array.from(sandboxIds).sort(),
    runningThreadKeys: Array.from(threadKeys).sort(),
  };
}

/** True when the chat row's thread has a running session in its sandbox. */
export function isThreadRunning(
  thread: Pick<ResumableThreadRecord, 'id' | 'sandboxId' | 'resumeToken'>,
  runningThreadKeys: readonly string[],
): boolean {
  if (runningThreadKeys.includes(thread.id)) {
    return true;
  }
  return Boolean(
    thread.sandboxId
    && runningThreadKeys.includes(`${thread.sandboxId}:${thread.resumeToken}`),
  );
}
