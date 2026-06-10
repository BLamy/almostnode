import { describe, expect, it } from 'vitest';
import { groupSidebarProjects } from '../src/sidebar/github-projects';
import type { ProjectRecord } from '../src/features/project-db';
import type { GitHubRepositorySummary } from '../src/features/github-repositories';

function project(
  id: string,
  repositoryFullName?: string,
): ProjectRecord {
  return {
    id,
    name: id,
    templateId: 'vite',
    createdAt: 0,
    updatedAt: 0,
    ...(repositoryFullName
      ? {
          gitRemote: {
            name: 'origin',
            url: `https://github.com/${repositoryFullName}.git`,
            provider: 'github' as const,
            repositoryFullName,
          },
        }
      : {}),
  } as ProjectRecord;
}

function repo(id: number, fullName: string, updatedAt = ''): GitHubRepositorySummary {
  const [ownerLogin, name] = fullName.split('/');
  return {
    id,
    name,
    fullName,
    description: null,
    private: false,
    updatedAt,
    defaultBranch: 'main',
    cloneUrl: `https://github.com/${fullName}.git`,
    htmlUrl: `https://github.com/${fullName}`,
    ownerLogin,
  } as GitHubRepositorySummary;
}

describe('groupSidebarProjects', () => {
  it('matches repos to imported projects and partitions local-only projects', () => {
    const projects = [
      project('p1', 'brett/app'),
      project('p2'),
      project('p3', 'brett/other'),
    ];
    const repos = [repo(1, 'brett/app'), repo(2, 'brett/new-repo')];

    const groups = groupSidebarProjects(projects, repos);

    expect(groups.repos.map((r) => [r.repo.fullName, r.project?.id ?? null])).toEqual([
      ['brett/app', 'p1'],
      ['brett/new-repo', null],
    ]);
    // Imported project whose repo wasn't fetched still lives in the GitHub section.
    expect(groups.unlistedGitHubProjects.map((p) => p.id)).toEqual(['p3']);
    expect(groups.noSourceControl.map((p) => p.id)).toEqual(['p2']);
  });

  it('matches repository names case-insensitively', () => {
    const groups = groupSidebarProjects(
      [project('p1', 'Brett/App')],
      [repo(1, 'brett/app')],
    );
    expect(groups.repos[0].project?.id).toBe('p1');
    expect(groups.unlistedGitHubProjects).toHaveLength(0);
  });

  it('sorts imported repos first, then by update recency', () => {
    const groups = groupSidebarProjects(
      [project('p1', 'b/imported')],
      [
        repo(1, 'b/older', '2024-01-01'),
        repo(2, 'b/newer', '2025-01-01'),
        repo(3, 'b/imported', '2023-01-01'),
      ],
    );
    expect(groups.repos.map((r) => r.repo.fullName)).toEqual([
      'b/imported',
      'b/newer',
      'b/older',
    ]);
  });

  it('handles missing repository list (not yet fetched)', () => {
    const groups = groupSidebarProjects(
      [project('p1', 'b/app'), project('p2')],
      null,
    );
    expect(groups.repos).toEqual([]);
    expect(groups.unlistedGitHubProjects.map((p) => p.id)).toEqual(['p1']);
    expect(groups.noSourceControl.map((p) => p.id)).toEqual(['p2']);
  });
});
