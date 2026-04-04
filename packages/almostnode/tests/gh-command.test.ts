import { afterEach, describe, expect, it, vi } from 'vitest';
import git from 'isomorphic-git';
import { createContainer } from '../src/index';
import * as network from '../src/network';
import { writeGhToken } from '../src/shims/gh-auth';

function createJsonResponse(body: unknown, status = 201): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

describe('gh command', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a GitHub repository through gh repo create', async () => {
    const container = createContainer();
    writeGhToken(container.vfs, {
      oauth_token: 'gho_test',
      user: 'octocat',
      git_protocol: 'https',
    });

    const fetchSpy = vi.spyOn(network, 'networkFetch').mockResolvedValue(
      createJsonResponse({
        full_name: 'octocat/demo-repo',
        html_url: 'https://github.com/octocat/demo-repo',
        clone_url: 'https://github.com/octocat/demo-repo.git',
      }),
    );

    const result = await container.run('gh repo create demo-repo --public');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Created repository octocat/demo-repo');
    expect(result.stdout).toContain('https://github.com/octocat/demo-repo');

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.github.com/user/repos',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer gho_test',
        }),
      }),
      expect.anything(),
    );

    const requestInit = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      name: 'demo-repo',
      private: false,
      has_issues: true,
      has_wiki: true,
    });
  });

  it('creates a repository, configures origin, and pushes when source and push are requested', async () => {
    const container = createContainer({
      git: {
        authorName: 'GH User',
        authorEmail: 'gh@example.com',
      },
    });
    const repo = '/repo';

    writeGhToken(container.vfs, {
      oauth_token: 'gho_test',
      user: 'octocat',
      git_protocol: 'https',
    });

    container.vfs.mkdirSync(repo, { recursive: true });
    container.vfs.writeFileSync(`${repo}/README.md`, '# demo\n');

    let result = await container.run('git init', { cwd: repo });
    expect(result.exitCode).toBe(0);
    result = await container.run('git add README.md', { cwd: repo });
    expect(result.exitCode).toBe(0);
    result = await container.run('git commit -m "init"', { cwd: repo });
    expect(result.exitCode).toBe(0);

    vi.spyOn(network, 'networkFetch').mockResolvedValue(
      createJsonResponse({
        full_name: 'octocat/demo-repo',
        html_url: 'https://github.com/octocat/demo-repo',
        clone_url: 'https://github.com/octocat/demo-repo.git',
      }),
    );
    const pushSpy = vi.spyOn(git, 'push').mockResolvedValue({} as never);

    result = await container.run('gh repo create demo-repo --private --source=. --push', { cwd: repo });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Created repository octocat/demo-repo');
    expect(result.stdout).toContain("Configured remote 'origin'");
    expect(result.stdout).toContain('Pushed local commits to origin');

    const remoteResult = await container.run('git remote get-url origin', { cwd: repo });
    expect(remoteResult.exitCode).toBe(0);
    expect(remoteResult.stdout).toBe('https://github.com/octocat/demo-repo.git\n');

    const pushArgs = pushSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(pushArgs.remote).toBe('origin');
    expect(pushArgs.ref).toBe('main');
    expect(pushArgs.remoteRef).toBe('main');
  });

  it('views a repository and can infer OWNER/REPO from origin', async () => {
    const container = createContainer({
      git: {
        authorName: 'View User',
        authorEmail: 'view@example.com',
      },
    });
    const repo = '/repo-view';

    writeGhToken(container.vfs, {
      oauth_token: 'gho_test',
      user: 'octocat',
      git_protocol: 'https',
    });

    container.vfs.mkdirSync(repo, { recursive: true });
    container.vfs.writeFileSync(`${repo}/README.md`, '# view\n');

    let result = await container.run('git init', { cwd: repo });
    expect(result.exitCode).toBe(0);
    result = await container.run('git add README.md', { cwd: repo });
    expect(result.exitCode).toBe(0);
    result = await container.run('git commit -m "init"', { cwd: repo });
    expect(result.exitCode).toBe(0);
    result = await container.run('git remote add origin https://github.com/octocat/demo-repo.git', { cwd: repo });
    expect(result.exitCode).toBe(0);

    vi.spyOn(network, 'networkFetch').mockResolvedValue(
      createJsonResponse({
        full_name: 'octocat/demo-repo',
        html_url: 'https://github.com/octocat/demo-repo',
        private: false,
        default_branch: 'main',
        stargazers_count: 12,
        forks_count: 3,
        language: 'TypeScript',
        description: 'Demo repo',
      }, 200),
    );

    result = await container.run('gh repo view', { cwd: repo });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('octocat/demo-repo');
    expect(result.stdout).toContain('https://github.com/octocat/demo-repo');
    expect(result.stdout).toContain('language: TypeScript');
  });

  it('clones a repository through the git shim', async () => {
    const container = createContainer();

    writeGhToken(container.vfs, {
      oauth_token: 'gho_test',
      user: 'octocat',
      git_protocol: 'https',
    });

    const cloneSpy = vi.spyOn(git, 'clone').mockResolvedValue({} as never);

    const result = await container.run('gh repo clone octocat/demo-repo', { cwd: '/workspace' });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('https://github.com/octocat/demo-repo.git');
    const cloneArgs = cloneSpy.mock.calls[0][0] as Record<string, unknown>;
    expect(cloneArgs.url).toBe('https://github.com/octocat/demo-repo.git');
    expect(cloneArgs.dir).toBe('/workspace/demo-repo');
  });

  it('deletes a repository when confirmed', async () => {
    const container = createContainer();

    writeGhToken(container.vfs, {
      oauth_token: 'gho_test',
      user: 'octocat',
      git_protocol: 'https',
    });

    const fetchSpy = vi.spyOn(network, 'networkFetch').mockResolvedValue(
      new Response(null, { status: 204 }),
    );

    const result = await container.run('gh repo delete octocat/demo-repo --yes');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Deleted repository octocat/demo-repo');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.github.com/repos/octocat/demo-repo',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          Authorization: 'Bearer gho_test',
        }),
      }),
      expect.anything(),
    );
  });

  it('sets a default repository and uses it for repo view outside a git checkout', async () => {
    const container = createContainer();

    writeGhToken(container.vfs, {
      oauth_token: 'gho_test',
      user: 'octocat',
      git_protocol: 'https',
    });

    let result = await container.run('gh repo set-default octocat/default-repo');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Default repository set to octocat/default-repo');

    const fetchSpy = vi.spyOn(network, 'networkFetch').mockResolvedValue(
      createJsonResponse({
        full_name: 'octocat/default-repo',
        html_url: 'https://github.com/octocat/default-repo',
        private: false,
        default_branch: 'main',
        stargazers_count: 5,
        forks_count: 1,
      }, 200),
    );

    result = await container.run('gh repo view', { cwd: '/workspace' });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('octocat/default-repo');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.github.com/repos/octocat/default-repo',
      expect.anything(),
      expect.anything(),
    );
  });

  it('renames a repository and updates local origin plus default repo state', async () => {
    const container = createContainer({
      git: {
        authorName: 'Rename User',
        authorEmail: 'rename@example.com',
      },
    });
    const repo = '/repo-rename';

    writeGhToken(container.vfs, {
      oauth_token: 'gho_test',
      user: 'octocat',
      git_protocol: 'https',
    });

    container.vfs.mkdirSync(repo, { recursive: true });
    container.vfs.writeFileSync(`${repo}/README.md`, '# rename\n');

    let result = await container.run('git init', { cwd: repo });
    expect(result.exitCode).toBe(0);
    result = await container.run('git add README.md', { cwd: repo });
    expect(result.exitCode).toBe(0);
    result = await container.run('git commit -m "init"', { cwd: repo });
    expect(result.exitCode).toBe(0);
    result = await container.run('git remote add origin https://github.com/octocat/demo-repo.git', { cwd: repo });
    expect(result.exitCode).toBe(0);
    result = await container.run('gh repo set-default octocat/demo-repo');
    expect(result.exitCode).toBe(0);

    vi.spyOn(network, 'networkFetch')
      .mockResolvedValueOnce(createJsonResponse({
        name: 'renamed-repo',
        full_name: 'octocat/renamed-repo',
        html_url: 'https://github.com/octocat/renamed-repo',
        clone_url: 'https://github.com/octocat/renamed-repo.git',
        owner: { login: 'octocat' },
      }, 200))
      .mockResolvedValueOnce(createJsonResponse({
        full_name: 'octocat/renamed-repo',
        html_url: 'https://github.com/octocat/renamed-repo',
        private: false,
        default_branch: 'main',
        stargazers_count: 0,
        forks_count: 0,
      }, 200));

    result = await container.run('gh repo rename renamed-repo', { cwd: repo });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Renamed repository octocat/demo-repo to octocat/renamed-repo');
    expect(result.stdout).toContain("Updated remote 'origin'");
    expect(result.stdout).toContain('Updated default repository');

    const remoteResult = await container.run('git remote get-url origin', { cwd: repo });
    expect(remoteResult.exitCode).toBe(0);
    expect(remoteResult.stdout).toBe('https://github.com/octocat/renamed-repo.git\n');

    result = await container.run('gh repo view', { cwd: '/workspace' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('octocat/renamed-repo');
  });

  it('edits repository settings with official flags', async () => {
    const container = createContainer();

    writeGhToken(container.vfs, {
      oauth_token: 'gho_test',
      user: 'octocat',
      git_protocol: 'https',
    });

    const fetchSpy = vi.spyOn(network, 'networkFetch').mockResolvedValue(
      createJsonResponse({
        full_name: 'octocat/demo-repo',
        html_url: 'https://github.com/octocat/demo-repo',
      }, 200),
    );

    const result = await container.run(
      'gh repo edit octocat/demo-repo --description "Updated repo" --homepage https://example.com --enable-issues=false --enable-wiki=false --allow-forking=false --default-branch trunk',
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Updated repository octocat/demo-repo');

    const requestInit = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(requestInit.method).toBe('PATCH');
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      description: 'Updated repo',
      homepage: 'https://example.com',
      has_issues: false,
      has_wiki: false,
      allow_forking: false,
      default_branch: 'trunk',
    });
  });
});
