import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

function compareNumericSegments(left, right) {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue !== rightValue) {
      return leftValue - rightValue;
    }
  }

  return 0;
}

export function resolvePreferredPnpmPackagePath(
  workspaceRoot,
  packageName,
  versionPrefix,
) {
  const packageStoreName = packageName.replace(/\//g, "+");
  const pnpmStoreRoot = resolve(workspaceRoot, "node_modules/.pnpm");
  const matchingVersions = [];

  if (existsSync(pnpmStoreRoot)) {
    for (const entry of readdirSync(pnpmStoreRoot, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith(`${packageStoreName}@`)) {
        continue;
      }

      const version = entry.name.slice(packageStoreName.length + 1).split("_", 1)[0] ?? "";
      if (versionPrefix && !version.startsWith(versionPrefix)) {
        continue;
      }

      const packagePath = resolve(pnpmStoreRoot, entry.name, "node_modules", packageName);
      if (existsSync(packagePath)) {
        matchingVersions.push({ version, packagePath });
      }
    }
  }

  matchingVersions.sort((left, right) => compareNumericSegments(right.version, left.version));

  return (
    matchingVersions[0]?.packagePath
    ?? resolve(workspaceRoot, "node_modules", packageName)
  );
}
