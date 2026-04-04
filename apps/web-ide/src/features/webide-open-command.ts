import path from "path";

export interface WebIdeOpenTarget {
  path: string;
  line?: number;
  column?: number;
}

function parsePositionValue(
  rawValue: string,
  label: "line" | "column",
): number {
  const value = Number.parseInt(rawValue, 10);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`Invalid ${label}: ${rawValue}.`);
  }
  return value;
}

export function normalizeWebIdePath(input: string): string {
  const normalized = path.posix.normalize(input || "/");
  return normalized.startsWith("/") ? normalized : `/${normalized}`;
}

export function isPathWithinWorkspace(
  candidate: string,
  workspaceRoot: string,
): boolean {
  const normalizedCandidate = normalizeWebIdePath(candidate);
  const normalizedWorkspaceRoot = normalizeWebIdePath(workspaceRoot);

  if (normalizedWorkspaceRoot === "/") {
    return normalizedCandidate.startsWith("/");
  }

  return (
    normalizedCandidate === normalizedWorkspaceRoot
    || normalizedCandidate.startsWith(`${normalizedWorkspaceRoot}/`)
  );
}

export function parseWebIdeOpenTarget(rawInput: string): WebIdeOpenTarget {
  const input = rawInput.trim();
  if (!input) {
    throw new Error("Usage: webide-open <path[:line[:column]]>");
  }

  let resolvedPath = input;
  let line: number | undefined;
  let column: number | undefined;

  const lastColonIndex = input.lastIndexOf(":");
  if (lastColonIndex > 0) {
    const lastSegment = input.slice(lastColonIndex + 1);
    if (/^\d+$/.test(lastSegment)) {
      const beforeLastSegment = input.slice(0, lastColonIndex);
      const secondLastColonIndex = beforeLastSegment.lastIndexOf(":");

      if (secondLastColonIndex > 0) {
        const maybeLine = beforeLastSegment.slice(secondLastColonIndex + 1);
        if (/^\d+$/.test(maybeLine)) {
          resolvedPath = beforeLastSegment.slice(0, secondLastColonIndex);
          line = parsePositionValue(maybeLine, "line");
          column = parsePositionValue(lastSegment, "column");
        } else {
          resolvedPath = beforeLastSegment;
          line = parsePositionValue(lastSegment, "line");
        }
      } else {
        resolvedPath = beforeLastSegment;
        line = parsePositionValue(lastSegment, "line");
      }
    }
  }

  const trimmedPath = resolvedPath.trim();
  if (!trimmedPath) {
    throw new Error("A file path is required.");
  }

  return {
    path: trimmedPath,
    line,
    column,
  };
}

export function resolveWebIdeOpenPath(
  rawPath: string,
  cwd: string,
  workspaceRoot: string,
): string {
  const trimmedPath = rawPath.trim();
  if (!trimmedPath) {
    throw new Error("A file path is required.");
  }

  const normalizedWorkspaceRoot = normalizeWebIdePath(workspaceRoot);
  const normalizedCwd = isPathWithinWorkspace(cwd, normalizedWorkspaceRoot)
    ? normalizeWebIdePath(cwd)
    : normalizedWorkspaceRoot;
  const resolvedPath = trimmedPath.startsWith("/")
    ? normalizeWebIdePath(trimmedPath)
    : normalizeWebIdePath(path.posix.join(normalizedCwd, trimmedPath));

  if (!isPathWithinWorkspace(resolvedPath, normalizedWorkspaceRoot)) {
    throw new Error(
      `webide-open only supports files inside ${normalizedWorkspaceRoot}.`,
    );
  }

  return resolvedPath;
}
