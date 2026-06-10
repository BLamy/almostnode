import type { ProjectRecord } from '../features/project-db';
import type { GitHubRepositorySummary } from '../features/github-repositories';

export interface GitHubRepoEntry {
  repo: GitHubRepositorySummary;
  /** The imported local project backing this repo, when one exists. */
  project: ProjectRecord | null;
}

export interface SidebarProjectGroups {
  /** GitHub repositories (imported ones carry their project). */
  repos: GitHubRepoEntry[];
  /** Imported GitHub projects whose repo wasn't in the fetched list (other
   * owners, deleted repos) — still shown under the GitHub section. */
  unlistedGitHubProjects: ProjectRecord[];
  /** Local projects with no GitHub remote — the "No source control" section. */
  noSourceControl: ProjectRecord[];
}

function repoKey(fullName: string | undefined | null): string {
  return (fullName ?? '').trim().toLowerCase();
}

/**
 * Partition sidebar content for the GitHub-focused layout: GitHub repos are
 * the primary list (matched to imported projects via the project's git
 * remote), and projects without source control sink to their own section.
 */
export function groupSidebarProjects(
  projects: ProjectRecord[],
  repositories: GitHubRepositorySummary[] | null,
): SidebarProjectGroups {
  const projectsByRepo = new Map<string, ProjectRecord>();
  const noSourceControl: ProjectRecord[] = [];
  for (const project of projects) {
    const key = repoKey(project.gitRemote?.repositoryFullName);
    if (key) {
      // Last write wins; duplicate imports of one repo are rare and benign.
      projectsByRepo.set(key, project);
    } else {
      noSourceControl.push(project);
    }
  }

  const repos: GitHubRepoEntry[] = [];
  const matchedKeys = new Set<string>();
  for (const repo of repositories ?? []) {
    const key = repoKey(repo.fullName);
    const project = projectsByRepo.get(key) ?? null;
    if (project) {
      matchedKeys.add(key);
    }
    repos.push({ repo, project });
  }
  // Imported repos first, then by recency of update.
  repos.sort((a, b) => {
    if (Boolean(a.project) !== Boolean(b.project)) {
      return a.project ? -1 : 1;
    }
    return (b.repo.updatedAt ?? '').localeCompare(a.repo.updatedAt ?? '');
  });

  const unlistedGitHubProjects = Array.from(projectsByRepo.entries())
    .filter(([key]) => !matchedKeys.has(key))
    .map(([, project]) => project);

  return { repos, unlistedGitHubProjects, noSourceControl };
}

const REPO_CACHE_KEY = 'almostnode-github-repos-cache';
const REPO_CACHE_TTL_MS = 5 * 60 * 1000;

export function readCachedRepositories(): GitHubRepositorySummary[] | null {
  try {
    const raw = sessionStorage.getItem(REPO_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      at?: number;
      repos?: GitHubRepositorySummary[];
    };
    if (
      typeof parsed.at !== 'number' ||
      !Array.isArray(parsed.repos) ||
      Date.now() - parsed.at > REPO_CACHE_TTL_MS
    ) {
      return null;
    }
    return parsed.repos;
  } catch {
    return null;
  }
}

export function writeCachedRepositories(repos: GitHubRepositorySummary[]): void {
  try {
    sessionStorage.setItem(
      REPO_CACHE_KEY,
      JSON.stringify({ at: Date.now(), repos }),
    );
  } catch {
    // Ignore storage failures.
  }
}

export function clearCachedRepositories(): void {
  try {
    sessionStorage.removeItem(REPO_CACHE_KEY);
  } catch {
    // Ignore storage failures.
  }
}
