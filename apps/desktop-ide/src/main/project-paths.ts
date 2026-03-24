import path from 'node:path';

export const PROJECT_ROOT = '/project';

export function shouldSkipDiskPath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  return normalized === 'node_modules'
    || normalized.startsWith('node_modules/')
    || normalized === '.git'
    || normalized.startsWith('.git/');
}

export function resolveProjectOutputPath(
  rootDirectory: string,
  projectId: string,
  vfsPath: string,
): string {
  const normalizedProjectPath = path.posix.normalize(vfsPath);

  if (
    normalizedProjectPath === PROJECT_ROOT
    || normalizedProjectPath === `${PROJECT_ROOT}/`
    || !normalizedProjectPath.startsWith(`${PROJECT_ROOT}/`)
  ) {
    throw new Error(`Path must reference a file under ${PROJECT_ROOT}: ${vfsPath}`);
  }

  const relativePath = normalizedProjectPath.slice(PROJECT_ROOT.length + 1);
  if (
    !relativePath
    || relativePath === '.'
    || relativePath === '..'
    || relativePath.startsWith('../')
    || shouldSkipDiskPath(relativePath)
  ) {
    throw new Error(`Invalid project file path: ${vfsPath}`);
  }

  const root = path.resolve(rootDirectory, projectId);
  const outputPath = path.resolve(root, relativePath);
  const rootWithSeparator = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (!outputPath.startsWith(rootWithSeparator)) {
    throw new Error(`Resolved path escapes configured project root: ${vfsPath}`);
  }
  return outputPath;
}
