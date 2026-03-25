// Force OpenCode to use the live models catalog or cached copy in browser builds.
// An empty object is treated as a valid snapshot and hides every provider.
export const snapshot: Record<string, unknown> | undefined = undefined;
