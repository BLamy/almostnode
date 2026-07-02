// How the AI's actions are approved — the OS-wide policy the (future) action
// gate reads. Modeled on Codex's three presets. "Approve for me" needs a
// guardian classifier we haven't built, so it's disabled ("Coming soon") for
// now; Full access is the default while the gate matures.
//
// This is the UI-facing source of truth; enforcement (gating OS mutations and
// codemode tool calls) hooks into `getApprovalMode()` in a later phase.

import { useSyncExternalStore } from "react";

export type ApprovalMode = "ask" | "auto" | "full";

export interface ApprovalModeDef {
  id: ApprovalMode;
  label: string;
  description: string;
  /** Disabled modes render greyed with a "Coming soon" tooltip. */
  disabled?: boolean;
}

export const APPROVAL_MODES: readonly ApprovalModeDef[] = [
  {
    id: "ask",
    label: "Ask for approval",
    description: "Always ask to edit external files and use the internet",
  },
  {
    id: "auto",
    label: "Approve for me",
    description: "Only ask for actions detected as potentially unsafe",
    disabled: true, // needs the guardian classifier — not built yet
  },
  {
    id: "full",
    label: "Full access",
    description: "Unrestricted access to the internet and any file on your computer",
  },
];

let mode: ApprovalMode = "full";
const listeners = new Set<() => void>();

export function getApprovalMode(): ApprovalMode {
  return mode;
}

export function setApprovalMode(next: ApprovalMode): void {
  const def = APPROVAL_MODES.find((m) => m.id === next);
  if (!def || def.disabled || next === mode) return;
  mode = next;
  for (const listener of listeners) listener();
}

export function useApprovalMode(): ApprovalMode {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => mode,
    () => mode,
  );
}
