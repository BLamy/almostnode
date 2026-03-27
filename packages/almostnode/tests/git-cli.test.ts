import { beforeEach, describe, expect, it, vi } from 'vitest';
import git from 'isomorphic-git';
import { createContainer } from '../src/index';

describe('git CLI command', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('supports local git workflows: init/status/add/commit/log/diff/branch/checkout/rebase', async () => {
    const container = createContainer({
      git: {
        authorName: 'Test User',
        authorEmail: 'test@example.com',
      },
    });

    container.vfs.mkdirSync('/repo', { recursive: true });
    container.vfs.writeFileSync('/repo/main.txt', 'main\n');

    let result = await container.run('git init', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git add .', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git commit -m "init"', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('init');

    container.vfs.writeFileSync('/repo/main.txt', 'main changed\n');

    result = await container.run('git diff --name-only', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('main.txt');

    result = await container.run('git add main.txt', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git diff --staged --name-only', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('main.txt');

    result = await container.run('git commit -m "main update"', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    const branchResult = await container.run('git branch', { cwd: '/repo' });
    expect(branchResult.exitCode).toBe(0);
    const currentBranch = branchResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.startsWith('* '))
      ?.slice(2)
      .trim() || 'master';

    result = await container.run('git branch feature', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git checkout feature', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    container.vfs.writeFileSync('/repo/feature.txt', 'feature\n');

    result = await container.run('git add feature.txt', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git commit -m "feature commit"', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run(`git checkout ${currentBranch}`, { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    container.vfs.writeFileSync('/repo/upstream.txt', 'upstream\n');

    result = await container.run('git add upstream.txt', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git commit -m "upstream commit"', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git checkout feature', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run(`git rebase ${currentBranch}`, { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.toLowerCase()).toContain('rebased');

    result = await container.run('git log -n 3', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('feature commit');
    expect(result.stdout).toContain('upstream commit');
  });

  it('supports diff variants and rebases transactionally on conflict', async () => {
    const container = createContainer({
      git: {
        authorName: 'Tester',
        authorEmail: 'tester@example.com',
      },
    });

    container.vfs.mkdirSync('/repo', { recursive: true });
    container.vfs.writeFileSync('/repo/app.txt', 'base\n');

    let result = await container.run('git init', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git add app.txt', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git commit -m "base"', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git branch feature', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git checkout feature', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    container.vfs.writeFileSync('/repo/app.txt', 'feature change\n');

    result = await container.run('git diff', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('diff --git');
    expect(result.stdout).toContain('feature change');

    result = await container.run('git add app.txt', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git diff --staged', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('feature change');

    result = await container.run('git commit -m "feature edits app"', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git log -n 1', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    const originalFeatureHead = result.stdout.match(/^commit\s+([0-9a-f]{40})/m)?.[1];
    expect(originalFeatureHead).toBeTruthy();

    result = await container.run('git checkout master', { cwd: '/repo' });
    if (result.exitCode !== 0) {
      result = await container.run('git checkout main', { cwd: '/repo' });
    }
    expect(result.exitCode).toBe(0);
    const defaultBranch = result.stdout.match(/'([^']+)'/)?.[1] || (result.stdout.includes('main') ? 'main' : 'master');

    container.vfs.writeFileSync('/repo/app.txt', 'main change\n');
    result = await container.run('git add app.txt', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    result = await container.run('git commit -m "main edits app"', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git log -n 2', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    const oids = Array.from(result.stdout.matchAll(/^commit\s+([0-9a-f]{40})/gm)).map((m) => m[1]);
    expect(oids.length).toBeGreaterThanOrEqual(2);
    const [newer, older] = oids;

    result = await container.run(`git diff ${older} ${newer} --name-only`, { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('app.txt');

    result = await container.run('git checkout feature', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run(`git rebase ${defaultBranch}`, { cwd: '/repo' });
    expect(result.exitCode).toBe(1);

    const fileAfterFailedRebase = container.vfs.readFileSync('/repo/app.txt', 'utf8');
    expect(fileAfterFailedRebase).toContain('feature change');

    result = await container.run('git log -n 1', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    const headAfterRollback = result.stdout.match(/^commit\s+([0-9a-f]{40})/m)?.[1];
    expect(headAfterRollback).toBe(originalFeatureHead);
  });

  it('stages large nested trees with git add .', async () => {
    const container = createContainer({
      git: {
        authorName: 'Add Tester',
        authorEmail: 'add@tester.dev',
      },
    });

    container.vfs.mkdirSync('/repo', { recursive: true });
    container.vfs.writeFileSync('/repo/README.md', '# repo\n');
    container.vfs.writeFileSync('/repo/.eslintrc.json', '{ "root": true }\n');
    container.vfs.writeFileSync('/repo/.vscode/settings.json', '{ "editor.tabSize": 2 }\n');
    container.vfs.writeFileSync('/repo/.next/cache.json', '{ "cache": true }\n');
    container.vfs.writeFileSync('/repo/node_modules/README.txt', 'placeholder\n');
    container.vfs.writeFileSync('/repo/src/app/page.tsx', 'export default function Page(){return null}\n');
    container.vfs.writeFileSync('/repo/src/lib/utils.ts', 'export const x = 1;\n');

    let result = await container.run('git init', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git add .', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git status --short', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('A  README.md');
    expect(result.stdout).toContain('A  .vscode/settings.json');
    expect(result.stdout).toContain('A  src/app/page.tsx');
  });

  it('respects .gitignore patterns for workspace-only directories', async () => {
    const container = createContainer({
      git: {
        authorName: 'Ignore Tester',
        authorEmail: 'ignore@tester.dev',
      },
    });

    container.vfs.mkdirSync('/project', { recursive: true });
    container.vfs.writeFileSync('/project/.gitignore', '.claude/\nnode_modules/\nbuild/\ntmp/\n');
    container.vfs.writeFileSync('/project/package.json', '{"name":"project"}\n');
    container.vfs.writeFileSync('/project/src/main.ts', 'export const value = 1;\n');
    container.vfs.writeFileSync('/project/.claude/settings.json', '{}\n');
    container.vfs.writeFileSync('/project/node_modules/demo/package.json', '{"name":"demo"}\n');
    container.vfs.writeFileSync('/project/build/out.txt', 'build\n');
    container.vfs.writeFileSync('/project/tmp/cache.txt', 'tmp\n');

    let result = await container.run('git init', { cwd: '/project' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git add -A', { cwd: '/project' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git status --short', { cwd: '/project' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('A  .gitignore');
    expect(result.stdout).toContain('A  package.json');
    expect(result.stdout).toContain('A  src/main.ts');
    expect(result.stdout).not.toContain('.claude/');
    expect(result.stdout).not.toContain('node_modules/');
    expect(result.stdout).not.toContain('build/');
    expect(result.stdout).not.toContain('tmp/');
  });

  it('uses the nested /project repository even when a legacy root repo exists', async () => {
    const container = createContainer({
      git: {
        authorName: 'Nested Repo Tester',
        authorEmail: 'nested@tester.dev',
      },
    });

    container.vfs.mkdirSync('/project', { recursive: true });
    container.vfs.writeFileSync('/project/.gitignore', '.claude/\nnode_modules/\n');
    container.vfs.writeFileSync('/project/package.json', '{"name":"project"}\n');
    container.vfs.writeFileSync('/project/src/main.ts', 'export const value = 1;\n');
    container.vfs.writeFileSync('/project/.claude/settings.json', '{}\n');
    container.vfs.writeFileSync('/home/user/.claude.json', '{}\n');

    let result = await container.run('git init', { cwd: '/' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git add -A', { cwd: '/' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');

    result = await container.run('git init', { cwd: '/project' });
    expect(result.exitCode).toBe(0);
    expect(container.vfs.existsSync('/project/.git')).toBe(true);

    result = await container.run('git add -A', { cwd: '/project' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git status --short', { cwd: '/project' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('A  .gitignore');
    expect(result.stdout).toContain('A  package.json');
    expect(result.stdout).toContain('A  src/main.ts');
    expect(result.stdout).not.toContain('project/');
    expect(result.stdout).not.toContain('home/user/');
    expect(result.stdout).not.toContain('.claude/settings.json');
  });

  it('keeps git index valid after status + add . across repeated resets', async () => {
    const container = createContainer({
      git: {
        authorName: 'Repeat Tester',
        authorEmail: 'repeat@tester.dev',
      },
    });

    const repo = '/workspace/stripe-slider';
    const seed = () => {
      container.vfs.writeFileSync(`${repo}/README.md`, '# repo\n');
      container.vfs.writeFileSync(`${repo}/.eslintrc.json`, '{ "root": true }\n');
      container.vfs.writeFileSync(`${repo}/.vscode/settings.json`, '{ "editor.tabSize": 2 }\n');
      container.vfs.writeFileSync(`${repo}/.next/cache.json`, '{ "cache": true }\n');
      container.vfs.writeFileSync(`${repo}/node_modules/README.txt`, 'placeholder\n');
      container.vfs.writeFileSync(`${repo}/package.json`, '{ "name": "stripe-slider" }\n');
      container.vfs.writeFileSync(`${repo}/next.config.js`, 'module.exports = {};\n');
      container.vfs.writeFileSync(`${repo}/public/logo.svg`, '<svg></svg>\n');
      container.vfs.writeFileSync(`${repo}/src/app/globals.css`, ':root{}\n');
      container.vfs.writeFileSync(`${repo}/src/app/layout.tsx`, 'export default function Layout({children}){return children}\n');
      container.vfs.writeFileSync(`${repo}/src/app/page.tsx`, 'export default function Page(){return null}\n');
      container.vfs.writeFileSync(`${repo}/src/components/panel.tsx`, 'export function Panel(){return null}\n');
      container.vfs.writeFileSync(`${repo}/src/lib/utils.ts`, 'export const x = 1;\n');
    };

    for (let i = 0; i < 10; i++) {
      container.vfs.mkdirSync(repo, { recursive: true });
      const existing = container.vfs.readdirSync(repo);
      for (const entry of existing) {
        const fullPath = `${repo}/${entry}`;
        const removeRecursive = (target: string) => {
          const stat = container.vfs.statSync(target);
          if (!stat.isDirectory()) {
            container.vfs.unlinkSync(target);
            return;
          }
          const children = container.vfs.readdirSync(target);
          for (const child of children) {
            removeRecursive(`${target}/${child}`);
          }
          container.vfs.rmdirSync(target);
        };
        removeRecursive(fullPath);
      }

      seed();

      let result = await container.run('git init', { cwd: repo });
      expect(result.exitCode).toBe(0);

      result = await container.run('git status', { cwd: repo });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('?? .eslintrc.json');

      result = await container.run('git add .', { cwd: repo });
      expect(result.exitCode).toBe(0);

      result = await container.run('git status --short', { cwd: repo });
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('A  .eslintrc.json');
      expect(result.stdout).toContain('A  src/lib/utils.ts');
    }
  });

  it('recovers from a corrupted .git/index when running git add .', async () => {
    const container = createContainer();
    const repo = '/repo';
    container.vfs.mkdirSync(repo, { recursive: true });
    container.vfs.writeFileSync(`${repo}/file.txt`, 'hello\n');

    let result = await container.run('git init', { cwd: repo });
    expect(result.exitCode).toBe(0);

    // Simulate the corruption shape users are hitting.
    container.vfs.writeFileSync(`${repo}/.git/index`, new Uint8Array([68, 73, 82, 67, 105, 255, 0, 1]));

    result = await container.run('git add .', { cwd: repo });
    expect(result.exitCode, `stderr=${result.stderr}\nstdout=${result.stdout}`).toBe(0);

    result = await container.run('git status --short', { cwd: repo });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('A  file.txt');
  });

  it('recovers from invalid dircache magic errors during git add .', async () => {
    const container = createContainer();
    const repo = '/repo-magic';
    container.vfs.mkdirSync(repo, { recursive: true });
    container.vfs.writeFileSync(`${repo}/file.txt`, 'hello\n');

    let result = await container.run('git init', { cwd: repo });
    expect(result.exitCode).toBe(0);

    // Corrupt the index header so isomorphic-git reports "Invalid dircache magic file number".
    container.vfs.writeFileSync(`${repo}/.git/index`, new Uint8Array([0, 1, 2, 3, 4, 5]));

    result = await container.run('git add .', { cwd: repo });
    expect(result.exitCode, `stderr=${result.stderr}\nstdout=${result.stdout}`).toBe(0);

    result = await container.run('git status --short', { cwd: repo });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('A  file.txt');
  });

  it('supports git remote add/remove/list and -v output', async () => {
    const container = createContainer();
    const repo = '/repo-remote';

    container.vfs.mkdirSync(repo, { recursive: true });

    let result = await container.run('git init', { cwd: repo });
    expect(result.exitCode).toBe(0);

    result = await container.run('git remote', { cwd: repo });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');

    result = await container.run('git remote add origin https://example.com/repo.git', { cwd: repo });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');

    result = await container.run('git remote', { cwd: repo });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('origin\n');

    result = await container.run('git remote -v', { cwd: repo });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('origin\thttps://example.com/repo.git (fetch)');
    expect(result.stdout).toContain('origin\thttps://example.com/repo.git (push)');

    result = await container.run('git remote add origin https://example.com/repo.git', { cwd: repo });
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain('error: remote origin already exists.');

    result = await container.run('git remote remove origin', { cwd: repo });
    expect(result.exitCode).toBe(0);

    result = await container.run('git remote', { cwd: repo });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');

    result = await container.run('git remote remove origin', { cwd: repo });
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("error: No such remote: 'origin'");
  });

  it('wires fetch/pull/push auth + cors and supports runtime auth updates', async () => {
    const container = createContainer({
      git: {
        token: 'initial-token',
        corsProxy: 'https://proxy.example/?url=',
      },
    });

    container.vfs.mkdirSync('/repo', { recursive: true });
    container.vfs.writeFileSync('/repo/file.txt', 'x\n');

    let result = await container.run('git init', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git add .', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    result = await container.run('git commit -m "init"', {
      cwd: '/repo',
      env: {
        GIT_AUTHOR_NAME: 'Auth User',
        GIT_AUTHOR_EMAIL: 'auth@example.com',
      },
    });
    expect(result.exitCode).toBe(0);

    const fetchSpy = vi.spyOn(git, 'fetch').mockResolvedValue(undefined as never);
    const pullSpy = vi.spyOn(git, 'pull').mockResolvedValue({} as never);
    const pushSpy = vi.spyOn(git, 'push').mockResolvedValue({} as never);

    result = await container.run('git fetch --single-branch --depth=1 origin main', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    let fetchArgs = fetchSpy.mock.calls[0][0] as any;
    expect(fetchArgs.singleBranch).toBe(true);
    expect(fetchArgs.depth).toBe(1);
    expect(fetchArgs.corsProxy).toBe('https://proxy.example/?url=');
    expect(fetchArgs.onAuth()).toEqual({ username: 'token', password: 'initial-token' });

    container.setGitAuth({ token: 'updated-token' });
    expect(container.getGitAuth().token).toBe('updated-token');

    result = await container.run('git pull origin main', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    const pullArgs = pullSpy.mock.calls[0][0] as any;
    expect(pullArgs.onAuth()).toEqual({ username: 'token', password: 'updated-token' });

    result = await container.run('git push origin main', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    const pushArgs = pushSpy.mock.calls[0][0] as any;
    expect(pushArgs.onAuth()).toEqual({ username: 'token', password: 'updated-token' });

    result = await container.run('git push --force origin main', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    const forcedPushArgs = pushSpy.mock.calls[1][0] as any;
    expect(forcedPushArgs.force).toBe(true);

    container.setGitAuth({ token: null });
    expect(container.getGitAuth().token).toBeUndefined();

    result = await container.run('git fetch origin main', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    fetchArgs = fetchSpy.mock.calls[1][0] as any;
    expect(fetchArgs.onAuth()).toEqual({});
  });

  it('resolves auth/env precedence as run env > live auth > container env', async () => {
    const container = createContainer({
      env: {
        GIT_TOKEN: 'container-token',
        GIT_CORS_PROXY: 'https://container-proxy/?url=',
      },
    });

    container.vfs.mkdirSync('/repo', { recursive: true });
    container.vfs.writeFileSync('/repo/file.txt', 'x\n');

    let result = await container.run('git init', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);

    const fetchSpy = vi.spyOn(git, 'fetch').mockResolvedValue(undefined as never);

    result = await container.run('git fetch origin main', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    let fetchArgs = fetchSpy.mock.calls[0][0] as any;
    expect(fetchArgs.onAuth()).toEqual({ username: 'token', password: 'container-token' });
    expect(fetchArgs.corsProxy).toBe('https://container-proxy/?url=');

    container.setGitAuth({ token: 'live-token', corsProxy: 'https://live-proxy/?url=' });

    result = await container.run('git fetch origin main', { cwd: '/repo' });
    expect(result.exitCode).toBe(0);
    fetchArgs = fetchSpy.mock.calls[1][0] as any;
    expect(fetchArgs.onAuth()).toEqual({ username: 'token', password: 'live-token' });
    expect(fetchArgs.corsProxy).toBe('https://live-proxy/?url=');

    result = await container.run('git fetch origin main', {
      cwd: '/repo',
      env: {
        GIT_TOKEN: 'run-token',
        GIT_CORS_PROXY: 'https://run-proxy/?url=',
      },
    });
    expect(result.exitCode).toBe(0);
    fetchArgs = fetchSpy.mock.calls[2][0] as any;
    expect(fetchArgs.onAuth()).toEqual({ username: 'token', password: 'run-token' });
    expect(fetchArgs.corsProxy).toBe('https://run-proxy/?url=');
  });
});
