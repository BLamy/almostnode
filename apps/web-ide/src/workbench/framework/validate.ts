import type { WorkbenchEntrypoint } from "./types";

const VALID_VIEW_LOCATIONS = new Set(["sidebar", "panel", "auxiliarybar"]);

export function validateWorkbenchEntrypoints(
  entrypoints: WorkbenchEntrypoint[],
): void {
  const seenIds = new Set<string>();

  for (const entrypoint of entrypoints) {
    if (seenIds.has(entrypoint.id)) {
      throw new Error(
        `Duplicate workbench entrypoint id "${entrypoint.id}" detected.`,
      );
    }
    seenIds.add(entrypoint.id);

    if (
      entrypoint.kind === "view" &&
      !VALID_VIEW_LOCATIONS.has(entrypoint.location)
    ) {
      throw new Error(
        `Unsupported workbench view location "${String(entrypoint.location)}" for "${entrypoint.id}".`,
      );
    }
  }
}
