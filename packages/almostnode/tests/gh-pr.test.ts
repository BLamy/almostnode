import { afterEach, describe, expect, it, vi } from 'vitest';
import { createContainer } from '../src/index';
import * as network from '../src/network';
import { writeGhToken } from '../src/shims/gh-auth';

function createJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  });
}

// Routes keyed by "METHOD url"; values are factories so a route can be hit
// more than once (Response bodies are single-use).
function mockGitHub(routes: Record<string, () => Response>) {
  return vi.spyOn(network, 'networkFetch').mockImplementation(async (input, init) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL ? input.toString() : input.url;
    const key = `${(init?.method ?? 'GET').toUpperCase()} ${url}`;
    const route = routes[key];
    if (!route) {
      throw new Error(`unexpected request: ${key}`);
    }
    return route();
  });
}

function createPrContainer() {
  const container = createContainer({
    git: {
      authorName: 'PR User',
      authorEmail: 'pr@example.com',
    },
  });
  writeGhToken(container.vfs, {
    oauth_token: 'gho_test',
    user: 'octocat',
    git_protocol: 'https',
  });
  return container;
}

// Repo with one commit on `feature`, origin pointing at octocat/demo-repo.
async function setupFeatureBranchRepo(
  container: ReturnType<typeof createContainer>,
  repo = '/repo',
): Promise<string> {
  container.vfs.mkdirSync(repo, { recursive: true });
  container.vfs.writeFileSync(`${repo}/README.md`, '# demo\n');

  const commands = [
    'git init',
    'git add README.md',
    'git commit -m "Add feature"',
    'git remote add origin https://github.com/octocat/demo-repo.git',
    'git checkout -b feature',
  ];
  for (const command of commands) {
    const result = await container.run(command, { cwd: repo });
    expect(result.exitCode).toBe(0);
  }
  return repo;
}

const samplePr = {
  number: 7,
  title: 'Add feature',
  state: 'open',
  draft: false,
  merged_at: null,
  html_url: 'https://github.com/octocat/demo-repo/pull/7',
  body: 'Feature details',
  user: { login: 'octocat' },
  base: { ref: 'main' },
  head: { ref: 'feature' },
};

describe('gh pr', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('creates a pull request with base from the repo default branch', async () => {
    const container = createPrContainer();
    const repo = await setupFeatureBranchRepo(container);

    const fetchSpy = mockGitHub({
      'GET https://api.github.com/repos/octocat/demo-repo': () =>
        createJsonResponse({ default_branch: 'main' }),
      'POST https://api.github.com/repos/octocat/demo-repo/pulls': () =>
        createJsonResponse(samplePr, 201),
    });

    const result = await container.run(
      'gh pr create --title "Add feature" --body "Feature details"',
      { cwd: repo },
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('https://github.com/octocat/demo-repo/pull/7');

    const postCall = fetchSpy.mock.calls.find(([, init]) => init?.method === 'POST');
    expect(postCall).toBeDefined();
    const requestInit = postCall![1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toEqual({
      title: 'Add feature',
      head: 'feature',
      base: 'main',
      body: 'Feature details',
      draft: false,
    });
    expect((requestInit.headers as Record<string, string>).Authorization).toBe('Bearer gho_test');
  });

  it('fills the title from the latest commit message with --fill', async () => {
    const container = createPrContainer();
    const repo = await setupFeatureBranchRepo(container);

    const fetchSpy = mockGitHub({
      'POST https://api.github.com/repos/octocat/demo-repo/pulls': () =>
        createJsonResponse(samplePr, 201),
    });

    // Explicit --base avoids the default-branch lookup.
    const result = await container.run('gh pr create --fill --base main --draft', { cwd: repo });

    expect(result.exitCode).toBe(0);
    const requestInit = fetchSpy.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestInit.body))).toMatchObject({
      title: 'Add feature',
      head: 'feature',
      base: 'main',
      draft: true,
    });
  });

  it('tells the user to push when the head branch is missing on the remote', async () => {
    const container = createPrContainer();
    const repo = await setupFeatureBranchRepo(container);

    mockGitHub({
      'GET https://api.github.com/repos/octocat/demo-repo': () =>
        createJsonResponse({ default_branch: 'main' }),
      'POST https://api.github.com/repos/octocat/demo-repo/pulls': () =>
        createJsonResponse({
          message: 'Validation Failed',
          errors: [{ resource: 'PullRequest', field: 'head', code: 'invalid' }],
        }, 422),
    });

    const result = await container.run('gh pr create --title "Add feature"', { cwd: repo });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("the head branch 'feature' does not exist on octocat/demo-repo");
    expect(result.stderr).toContain('git push -u origin feature');
  });

  it('requires --title or --fill', async () => {
    const container = createPrContainer();
    const repo = await setupFeatureBranchRepo(container);

    const result = await container.run('gh pr create', { cwd: repo });

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('--title or --fill is required');
  });

  it('views the open pull request for the current branch', async () => {
    const container = createPrContainer();
    const repo = await setupFeatureBranchRepo(container);

    mockGitHub({
      'GET https://api.github.com/repos/octocat/demo-repo/pulls?head=octocat:feature&state=open': () =>
        createJsonResponse([samplePr]),
    });

    const result = await container.run('gh pr view', { cwd: repo });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Add feature #7');
    expect(result.stdout).toContain('Open • octocat wants to merge into main from feature');
    expect(result.stdout).toContain('https://github.com/octocat/demo-repo/pull/7');
  });

  it('errors when no pull request exists for the current branch', async () => {
    const container = createPrContainer();
    const repo = await setupFeatureBranchRepo(container);

    mockGitHub({
      'GET https://api.github.com/repos/octocat/demo-repo/pulls?head=octocat:feature&state=open': () =>
        createJsonResponse([]),
    });

    const result = await container.run('gh pr view', { cwd: repo });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('no pull requests found for branch "feature"');
  });

  it('emits --json fields for pr view by number', async () => {
    const container = createPrContainer();

    mockGitHub({
      'GET https://api.github.com/repos/octocat/demo-repo/pulls/7': () =>
        createJsonResponse(samplePr),
    });

    const result = await container.run(
      'gh pr view 7 -R octocat/demo-repo --json number,title,state,url,baseRefName,headRefName,isDraft',
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      number: 7,
      title: 'Add feature',
      state: 'OPEN',
      url: 'https://github.com/octocat/demo-repo/pull/7',
      baseRefName: 'main',
      headRefName: 'feature',
      isDraft: false,
    });
  });

  it('lists open pull requests with number, title, and branch columns', async () => {
    const container = createPrContainer();
    const repo = await setupFeatureBranchRepo(container);

    mockGitHub({
      'GET https://api.github.com/repos/octocat/demo-repo/pulls?state=open&per_page=30': () =>
        createJsonResponse([
          samplePr,
          { ...samplePr, number: 8, title: 'Fix bug', head: { ref: 'fix-bug' }, user: { login: 'hubot' } },
        ]),
    });

    const result = await container.run('gh pr list', { cwd: repo });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('#7\tAdd feature\tfeature\tOPEN');
    expect(result.stdout).toContain('#8\tFix bug\tfix-bug\tOPEN');
  });

  it('lists pull requests as JSON with --json', async () => {
    const container = createPrContainer();

    mockGitHub({
      'GET https://api.github.com/repos/octocat/demo-repo/pulls?state=open&per_page=30': () =>
        createJsonResponse([
          samplePr,
          { ...samplePr, number: 8, head: { ref: 'fix-bug' } },
        ]),
    });

    const result = await container.run('gh pr list -R octocat/demo-repo --json number,headRefName');

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      { number: 7, headRefName: 'feature' },
      { number: 8, headRefName: 'fix-bug' },
    ]);
  });

  it('reports no matches when the list is empty', async () => {
    const container = createPrContainer();

    mockGitHub({
      'GET https://api.github.com/repos/octocat/demo-repo/pulls?state=open&per_page=30': () =>
        createJsonResponse([]),
    });

    const result = await container.run('gh pr list -R octocat/demo-repo');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('no pull requests match your search in octocat/demo-repo');
  });

  it('shows current-branch and created-by-you sections in pr status', async () => {
    const container = createPrContainer();
    const repo = await setupFeatureBranchRepo(container);

    mockGitHub({
      'GET https://api.github.com/repos/octocat/demo-repo/pulls?state=open&per_page=100': () =>
        createJsonResponse([
          samplePr,
          { ...samplePr, number: 8, title: 'Fix bug', head: { ref: 'fix-bug' }, user: { login: 'hubot' } },
        ]),
    });

    const result = await container.run('gh pr status', { cwd: repo });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Relevant pull requests in octocat/demo-repo');
    expect(result.stdout).toContain('Current branch');
    expect(result.stdout).toContain('#7  Add feature [feature]');
    expect(result.stdout).toContain('Created by you');
    // hubot's PR is not created by the logged-in user
    expect(result.stdout).not.toContain('#8  Fix bug');
  });
});
