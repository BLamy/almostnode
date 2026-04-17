import path from 'node:path';
import type { TemplateId } from './project-types';

interface PackageJsonLike {
  name?: unknown;
  dependencies?: Record<string, unknown>;
  devDependencies?: Record<string, unknown>;
}

interface ProjectMetadataLike {
  templateId?: unknown;
}

function parsePackageJson(
  readTextFile: (absoluteProjectPath: string) => string | null,
): PackageJsonLike | null {
  const raw = readTextFile('/project/package.json');
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as PackageJsonLike;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function readDependencyNames(pkg: PackageJsonLike | null): Set<string> {
  const dependencyNames = new Set<string>();
  if (!pkg) return dependencyNames;

  const sections = [pkg.dependencies, pkg.devDependencies];
  for (const section of sections) {
    if (!section || typeof section !== 'object') continue;
    for (const name of Object.keys(section)) {
      dependencyNames.add(name);
    }
  }

  return dependencyNames;
}

function parseProjectMetadata(
  readTextFile: (absoluteProjectPath: string) => string | null,
): ProjectMetadataLike | null {
  const raw = readTextFile('/project/.almostnode/project.json');
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as ProjectMetadataLike;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function hasAnyPath(paths: Set<string>, candidates: string[]): boolean {
  return candidates.some((candidate) => paths.has(candidate));
}

export function normalizeTemplateId(value: unknown): TemplateId | null {
  if (
    value === 'vite'
    || value === 'nextjs'
    || value === 'tanstack'
    || value === 'app-building'
  ) {
    return value;
  }
  return null;
}

export function inferTemplateIdFromProjectFiles(
  projectPaths: string[],
  readTextFile: (absoluteProjectPath: string) => string | null,
): TemplateId {
  const paths = new Set(projectPaths.map((projectPath) => projectPath.replace(/\\/g, '/')));
  const projectMetadata = parseProjectMetadata(readTextFile);
  const manifestTemplateId = normalizeTemplateId(projectMetadata?.templateId);
  if (manifestTemplateId) {
    return manifestTemplateId;
  }
  const packageJson = parsePackageJson(readTextFile);
  const deps = readDependencyNames(packageJson);

  if (hasAnyPath(paths, ['/project/app/page.jsx', '/project/app/page.tsx']) || deps.has('next')) {
    return 'nextjs';
  }

  if (
    hasAnyPath(paths, ['/project/src/router.tsx', '/project/src/routes/__root.tsx'])
    || deps.has('@tanstack/react-router')
  ) {
    return 'tanstack';
  }

  if (
    hasAnyPath(paths, ['/project/src/lib/app-building-dashboard.ts'])
    || packageJson?.name === 'almostnode-app-building-control-plane'
  ) {
    return 'app-building';
  }

  return 'vite';
}

export function inferTitleFromProjectFiles(
  fallback: string,
  readTextFile: (absoluteProjectPath: string) => string | null,
): string {
  const packageJson = parsePackageJson(readTextFile);
  const name = typeof packageJson?.name === 'string' ? packageJson.name.trim() : '';
  if (!name) return fallback;

  const withoutScope = name.startsWith('@')
    ? name.split('/').slice(1).join('/') || name
    : name;
  const pretty = withoutScope
    .replace(/[-_]+/g, ' ')
    .trim();
  return pretty.length > 0 ? pretty : fallback;
}

export function titleFromProjectPath(projectPath: string): string {
  const base = path.basename(projectPath).trim();
  if (!base) return 'Untitled Project';
  return base.replace(/[-_]+/g, ' ');
}
