import type { Command, CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import { defineCommand } from 'just-bash';
import git, { STAGE, TREE, WORKDIR } from 'isomorphic-git';
import http from 'isomorphic-git/http/web';
import { structuredPatch } from 'diff';
import type { ReadCommitResult, WalkerEntry } from 'isomorphic-git';
import type { VirtualFS } from '../virtual-fs';
import * as path from './path';

const DEFAULT_CORS_PROXY = 'https://almostnode-cors-proxy.langtail.workers.dev/?url=';
const textDecoder = new TextDecoder();

interface GitEnv {
  token?: string;
  username?: string;
  password?: string;
  corsProxy: string;
  authorName: string;
  authorEmail: string;
}

interface DiffEntry {
  filepath: string;
  leftExists: boolean;
  rightExists: boolean;
  leftText: string;
  rightText: string;
}

interface GitAuthResult {
  username?: string;
  password?: string;
}

interface ParsedAuthor {
  name: string;
  email: string;
}

interface ParsedDiffArgs {
  staged: boolean;
  nameOnly: boolean;
  refs: string[];
}

export function createGitCommand(getVfs: () => VirtualFS | null): Command {
  return defineCommand('git', async (args, ctx) => {
    const vfs = getVfs();
    if (!vfs) {
      return failure('git: VFS not initialized', 1);
    }

    return runGitCommand(args, ctx, vfs);
  });
}

export async function runGitCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS
): Promise<JustBashExecResult> {
  const subcommand = args[0];

  if (!subcommand || subcommand === 'help' || subcommand === '--help') {
    return {
      stdout: [
        'Usage: git <command> [options]',
        '',
        'Supported commands:',
        '  init, clone, status, add, commit, log, branch, checkout',
        '  diff, rebase, fetch, pull, push',
        '',
      ].join('\n'),
      stderr: '',
      exitCode: 0,
    };
  }

  try {
    switch (subcommand) {
      case 'init':
        return handleInit(args.slice(1), ctx, vfs);
      case 'clone':
        return handleClone(args.slice(1), ctx, vfs);
      case 'status':
        return handleStatus(args.slice(1), ctx, vfs);
      case 'add':
        return handleAdd(args.slice(1), ctx, vfs);
      case 'commit':
        return handleCommit(args.slice(1), ctx, vfs);
      case 'log':
        return handleLog(args.slice(1), ctx, vfs);
      case 'branch':
        return handleBranch(args.slice(1), ctx, vfs);
      case 'checkout':
        return handleCheckout(args.slice(1), ctx, vfs);
      case 'diff':
        return handleDiff(args.slice(1), ctx, vfs);
      case 'rebase':
        return handleRebase(args.slice(1), ctx, vfs);
      case 'fetch':
        return handleFetch(args.slice(1), ctx, vfs);
      case 'pull':
        return handlePull(args.slice(1), ctx, vfs);
      case 'push':
        return handlePush(args.slice(1), ctx, vfs);
      default:
        return failure(`git: unsupported subcommand '${subcommand}'`, 2);
    }
  } catch (error) {
    if (subcommand === 'add' && isCorruptIndexError(error)) {
      try {
        const dir = findGitRootOrThrow(vfs, ctx.cwd);
        resetGitIndexFiles(vfs, dir);
        return await handleAdd(args.slice(1), ctx, vfs);
      } catch (retryError) {
        return mapGitError(retryError);
      }
    }
    return mapGitError(error);
  }
}

async function handleInit(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  let initialBranch: string | undefined;
  let targetDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-b' || arg === '--initial-branch') && i + 1 < args.length) {
      initialBranch = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--initial-branch=')) {
      initialBranch = arg.slice('--initial-branch='.length);
      continue;
    }
    if (arg.startsWith('-')) {
      return failure(`git init: unsupported option '${arg}'`, 2);
    }
    if (targetDir) {
      return failure('git init: too many directory arguments', 2);
    }
    targetDir = arg;
  }

  const dir = resolvePath(ctx.cwd, targetDir || '.');
  if (!vfs.existsSync(dir)) {
    vfs.mkdirSync(dir, { recursive: true });
  }

  await git.init({
    fs: createGitFs(vfs),
    dir,
    defaultBranch: initialBranch,
  });

  return success(`Initialized empty Git repository in ${normalizePath(path.join(dir, '.git'))}\n`);
}

async function handleClone(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  let depth: number | undefined;
  let singleBranch = false;
  let ref: string | undefined;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--single-branch') {
      singleBranch = true;
      continue;
    }
    if ((arg === '-b' || arg === '--branch') && i + 1 < args.length) {
      ref = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--branch=')) {
      ref = arg.slice('--branch='.length);
      continue;
    }
    if (arg === '--depth' && i + 1 < args.length) {
      depth = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--depth=')) {
      depth = Number(arg.slice('--depth='.length));
      continue;
    }
    if (arg.startsWith('-')) {
      return failure(`git clone: unsupported option '${arg}'`, 2);
    }

    positionals.push(arg);
  }

  if (positionals.length === 0) {
    return failure('git clone: missing repository URL', 2);
  }

  const url = positionals[0];
  const targetArg = positionals[1] || inferCloneTarget(url);
  const dir = resolvePath(ctx.cwd, targetArg);

  if (depth !== undefined && (!Number.isFinite(depth) || depth <= 0)) {
    return failure('git clone: --depth must be a positive number', 2);
  }

  const gitEnv = resolveGitEnv(ctx.env);
  await git.clone({
    fs: createGitFs(vfs),
    http,
    dir,
    url,
    depth,
    singleBranch,
    ref,
    corsProxy: gitEnv.corsProxy,
    onAuth: () => resolveGitAuth(gitEnv),
  });

  return success(`Cloned ${url} into ${dir}\n`);
}

async function handleStatus(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  let short = false;
  let pathspec: string | undefined;

  for (const arg of args) {
    if (arg === '--short' || arg === '--porcelain') {
      short = true;
      continue;
    }
    if (arg.startsWith('-')) {
      return failure(`git status: unsupported option '${arg}'`, 2);
    }
    if (pathspec) {
      return failure('git status: too many path arguments', 2);
    }
    pathspec = arg;
  }

  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  const relativePath = pathspec ? toRepoRelativePath(dir, resolvePath(ctx.cwd, pathspec)) : undefined;

  const matrix = await git.statusMatrix({
    fs: createGitFs(vfs),
    dir,
    filepaths: relativePath ? [relativePath] : ['.'],
  });

  const lines: string[] = [];
  for (const row of matrix) {
    const [filepath, head, workdir, stage] = row;
    const code = toShortStatusCode(head, workdir, stage);
    if (!code || code === '  ') continue;
    lines.push(`${code} ${filepath}`);
  }

  if (!short) {
    return success(lines.length === 0 ? 'nothing to commit, working tree clean\n' : `${lines.join('\n')}\n`);
  }

  return success(lines.length === 0 ? '' : `${lines.join('\n')}\n`);
}

async function handleAdd(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  if (args.length === 0) {
    return failure('git add: missing pathspec', 2);
  }

  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  const gitFs = createGitFs(vfs);
  let addAll = false;
  let sawDoubleDash = false;
  const explicitPathspecs: string[] = [];

  for (const arg of args) {
    if (!sawDoubleDash && arg === '--') {
      sawDoubleDash = true;
      continue;
    }

    if (!sawDoubleDash && (arg === '-A' || arg === '--all')) {
      addAll = true;
      continue;
    }

    if (!sawDoubleDash && arg.startsWith('-')) {
      return failure(`git add: unsupported option '${arg}'`, 2);
    }

    if (arg === '.') {
      addAll = true;
      continue;
    }

    explicitPathspecs.push(arg);
  }

  if (!addAll && explicitPathspecs.length === 0) {
    return failure('git add: missing pathspec', 2);
  }

  const runAdd = async () => {
    if (addAll) {
      await stageAllChanges(gitFs, dir);
    }

    for (const arg of explicitPathspecs) {
      const absPath = resolvePath(ctx.cwd, arg);
      const filepath = toRepoRelativePath(dir, absPath);
      await git.add({ fs: gitFs, dir, filepath });
    }
  };

  try {
    await runAdd();
  } catch (error) {
    if (!isCorruptIndexError(error)) {
      throw error;
    }

    // Recover from a corrupted index by recreating it from HEAD/worktree.
    resetGitIndexFiles(vfs, dir);
    await runAdd();
  }

  return success('');
}

async function stageAllChanges(gitFs: ReturnType<typeof createGitFs>, dir: string): Promise<void> {
  const matrix = await git.statusMatrix({
    fs: gitFs,
    dir,
    filepaths: ['.'],
  });

  for (const row of matrix) {
    const [filepath, head, workdir, stage] = row;
    if (filepath === '.') continue;

    // No-op if index already matches worktree.
    if (stage === workdir) continue;

    // Stage deletions when file disappeared from worktree.
    if (workdir === 0 && (head !== 0 || stage !== 0)) {
      await git.remove({ fs: gitFs, dir, filepath });
      continue;
    }

    await git.add({ fs: gitFs, dir, filepath });
  }
}

async function handleCommit(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  let message: string | undefined;
  let authorFlag: string | undefined;
  let amend = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-m' || arg === '--message') && i + 1 < args.length) {
      message = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--message=')) {
      message = arg.slice('--message='.length);
      continue;
    }
    if ((arg === '--author') && i + 1 < args.length) {
      authorFlag = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('--author=')) {
      authorFlag = arg.slice('--author='.length);
      continue;
    }
    if (arg === '--amend') {
      amend = true;
      continue;
    }
    if (arg.startsWith('-')) {
      return failure(`git commit: unsupported option '${arg}'`, 2);
    }
  }

  if (!message) {
    return failure('git commit: missing commit message (use -m)', 2);
  }

  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  const gitEnv = resolveGitEnv(ctx.env);
  const fallbackAuthor = {
    name: gitEnv.authorName,
    email: gitEnv.authorEmail,
  };
  const parsedAuthor = parseAuthor(authorFlag);
  const author = parsedAuthor || fallbackAuthor;

  const oid = await git.commit({
    fs: createGitFs(vfs),
    dir,
    message,
    author,
    committer: author,
    amend,
  });

  const branch = await git.currentBranch({ fs: createGitFs(vfs), dir, fullname: false }) || 'detached';
  return success(`[${branch} ${oid.slice(0, 7)}] ${message}\n`);
}

async function handleLog(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  let depth: number | undefined;
  let ref: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if ((arg === '-n' || arg === '--depth') && i + 1 < args.length) {
      depth = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--depth=')) {
      depth = Number(arg.slice('--depth='.length));
      continue;
    }
    if (arg.startsWith('-')) {
      return failure(`git log: unsupported option '${arg}'`, 2);
    }
    if (ref) {
      return failure('git log: too many revision arguments', 2);
    }
    ref = arg;
  }

  if (depth !== undefined && (!Number.isFinite(depth) || depth <= 0)) {
    return failure('git log: depth must be a positive number', 2);
  }

  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  const entries = await git.log({
    fs: createGitFs(vfs),
    dir,
    ref: ref || 'HEAD',
    depth,
  });

  if (entries.length === 0) {
    return success('');
  }

  const chunks = entries.map((entry) => {
    const author = entry.commit.author;
    const authorLine = author ? `${author.name} <${author.email}>` : 'Unknown <unknown@example.com>';
    const date = author ? new Date(author.timestamp * 1000).toUTCString() : 'Unknown date';
    const msg = (entry.commit.message || '').trimEnd();
    return [
      `commit ${entry.oid}`,
      `Author: ${authorLine}`,
      `Date:   ${date}`,
      '',
      ...indentMessage(msg),
      '',
    ].join('\n');
  });

  return success(chunks.join(''));
}

async function handleBranch(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  const gitFs = createGitFs(vfs);

  if (args.length === 0) {
    const branches = await git.listBranches({ fs: gitFs, dir });
    const current = await git.currentBranch({ fs: gitFs, dir, fullname: false });
    const output = branches
      .map((branch) => `${branch === current ? '*' : ' '} ${branch}`)
      .join('\n');
    return success(output ? `${output}\n` : '');
  }

  if (args.length > 1) {
    return failure('git branch: too many arguments', 2);
  }

  const ref = args[0];
  if (!ref || ref.startsWith('-')) {
    return failure(`git branch: unsupported option '${ref || ''}'`, 2);
  }

  await git.branch({ fs: gitFs, dir, ref });
  return success('');
}

async function handleCheckout(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  const gitFs = createGitFs(vfs);
  let createBranch: string | undefined;
  let ref: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-b' && i + 1 < args.length) {
      createBranch = args[i + 1];
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      return failure(`git checkout: unsupported option '${arg}'`, 2);
    }
    if (ref) {
      return failure('git checkout: too many revision arguments', 2);
    }
    ref = arg;
  }

  if (createBranch) {
    await git.branch({ fs: gitFs, dir, ref: createBranch, checkout: true });
    return success(`Switched to a new branch '${createBranch}'\n`);
  }

  if (!ref) {
    return failure('git checkout: missing branch or commit', 2);
  }

  await git.checkout({ fs: gitFs, dir, ref, force: true });
  return success(`Switched to '${ref}'\n`);
}

async function handleDiff(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  const parsed = parseDiffArgs(args);
  if ('error' in parsed) {
    return failure(parsed.error, 2);
  }

  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  const gitFs = createGitFs(vfs);

  let entries: DiffEntry[] = [];

  if (parsed.refs.length === 2) {
    entries = await collectRefDiffEntries(gitFs, dir, parsed.refs[0], parsed.refs[1]);
  } else if (parsed.staged) {
    entries = await collectStagedDiffEntries(gitFs, dir);
  } else {
    entries = await collectUnstagedDiffEntries(gitFs, dir);
  }

  entries = entries.sort((a, b) => a.filepath.localeCompare(b.filepath));

  if (parsed.nameOnly) {
    return success(entries.length === 0 ? '' : `${entries.map((entry) => entry.filepath).join('\n')}\n`);
  }

  const patchText = entries.map((entry) => formatDiffEntry(entry)).join('');
  return success(patchText);
}

async function handleRebase(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  if (args.length !== 1 || args[0].startsWith('-')) {
    return failure('git rebase: only `git rebase <upstream>` is supported in v1', 2);
  }

  const upstreamRef = args[0];
  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  const gitFs = createGitFs(vfs);

  const currentRefFull = await git.currentBranch({ fs: gitFs, dir, fullname: true });
  const currentRefShort = await git.currentBranch({ fs: gitFs, dir, fullname: false });
  if (!currentRefFull || !currentRefShort) {
    return failure('git rebase: detached HEAD is not supported', 1);
  }

  const originalHead = await git.resolveRef({ fs: gitFs, dir, ref: currentRefFull });
  const upstreamOid = await resolveRefLike(gitFs, dir, upstreamRef);

  const mergeBases = await git.findMergeBase({ fs: gitFs, dir, oids: [originalHead, upstreamOid] });
  if (mergeBases.length === 0) {
    return failure(`git rebase: unable to find merge base for '${upstreamRef}'`, 1);
  }
  const mergeBase = mergeBases[0];

  if (mergeBase === upstreamOid) {
    return success(`Current branch '${currentRefShort}' is already up to date.\n`);
  }

  if (mergeBase === originalHead) {
    await git.writeRef({ fs: gitFs, dir, ref: currentRefFull, value: upstreamOid, force: true });
    await git.checkout({ fs: gitFs, dir, ref: currentRefShort, force: true });
    return success(`Successfully rebased and fast-forwarded '${currentRefShort}'.\n`);
  }

  const commits = await git.log({ fs: gitFs, dir, ref: currentRefShort, depth: 5000 });
  const replay: ReadCommitResult[] = [];
  for (const commit of commits) {
    if (commit.oid === mergeBase) break;
    replay.push(commit);
  }

  if (replay.length === 0) {
    return success(`Current branch '${currentRefShort}' is already up to date.\n`);
  }

  replay.reverse();

  const backupRef = `refs/almostnode/rebase-backup/${Date.now()}`;
  await git.writeRef({ fs: gitFs, dir, ref: backupRef, value: originalHead, force: true });

  const gitEnv = resolveGitEnv(ctx.env);
  const committer = {
    name: gitEnv.authorName,
    email: gitEnv.authorEmail,
  };

  try {
    await git.writeRef({ fs: gitFs, dir, ref: currentRefFull, value: upstreamOid, force: true });
    await git.checkout({ fs: gitFs, dir, ref: currentRefShort, force: true });

    for (const commit of replay) {
      await git.cherryPick({
        fs: gitFs,
        dir,
        oid: commit.oid,
        committer,
        abortOnConflict: true,
      });
    }

    try {
      await git.deleteRef({ fs: gitFs, dir, ref: backupRef });
    } catch {
      // best effort cleanup
    }

    return success(`Successfully rebased '${currentRefShort}' onto '${upstreamRef}'.\n`);
  } catch (error) {
    await git.writeRef({ fs: gitFs, dir, ref: currentRefFull, value: originalHead, force: true });
    await git.checkout({ fs: gitFs, dir, ref: currentRefShort, force: true });

    try {
      await git.deleteRef({ fs: gitFs, dir, ref: backupRef });
    } catch {
      // best effort cleanup
    }

    return mapGitError(error);
  }
}

async function handleFetch(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  let depth: number | undefined;
  let singleBranch = false;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--single-branch') {
      singleBranch = true;
      continue;
    }
    if (arg === '--depth' && i + 1 < args.length) {
      depth = Number(args[i + 1]);
      i += 1;
      continue;
    }
    if (arg.startsWith('--depth=')) {
      depth = Number(arg.slice('--depth='.length));
      continue;
    }
    if (arg.startsWith('-')) {
      return failure(`git fetch: unsupported option '${arg}'`, 2);
    }
    positionals.push(arg);
  }

  if (depth !== undefined && (!Number.isFinite(depth) || depth <= 0)) {
    return failure('git fetch: --depth must be a positive number', 2);
  }

  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  const gitFs = createGitFs(vfs);
  const gitEnv = resolveGitEnv(ctx.env);

  const remote = positionals[0] || 'origin';
  const ref = positionals[1];
  const remoteLooksLikeUrl = isUrlLike(remote);

  await git.fetch({
    fs: gitFs,
    http,
    dir,
    remote: remoteLooksLikeUrl ? undefined : remote,
    url: remoteLooksLikeUrl ? remote : undefined,
    ref,
    singleBranch,
    depth,
    corsProxy: gitEnv.corsProxy,
    onAuth: () => resolveGitAuth(gitEnv),
  });

  return success(`Fetched from ${remote}\n`);
}

async function handlePull(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  const positionals: string[] = [];
  let fastForwardOnly = false;

  for (const arg of args) {
    if (arg === '--ff-only') {
      fastForwardOnly = true;
      continue;
    }
    if (arg.startsWith('-')) {
      return failure(`git pull: unsupported option '${arg}'`, 2);
    }
    positionals.push(arg);
  }

  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  const gitFs = createGitFs(vfs);
  const gitEnv = resolveGitEnv(ctx.env);
  const localRef = await git.currentBranch({ fs: gitFs, dir, fullname: false });

  if (!localRef) {
    return failure('git pull: detached HEAD is not supported', 1);
  }

  const remote = positionals[0] || 'origin';
  const remoteRef = positionals[1] || localRef;

  await git.pull({
    fs: gitFs,
    http,
    dir,
    remote,
    ref: localRef,
    remoteRef,
    fastForward: true,
    fastForwardOnly,
    corsProxy: gitEnv.corsProxy,
    onAuth: () => resolveGitAuth(gitEnv),
    author: {
      name: gitEnv.authorName,
      email: gitEnv.authorEmail,
    },
    committer: {
      name: gitEnv.authorName,
      email: gitEnv.authorEmail,
    },
  });

  return success(`Pulled ${remote}/${remoteRef} into ${localRef}\n`);
}

async function handlePush(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  const positionals: string[] = [];
  let force = false;

  for (const arg of args) {
    if (arg === '--force' || arg === '-f') {
      force = true;
      continue;
    }
    if (arg.startsWith('-')) {
      return failure(`git push: unsupported option '${arg}'`, 2);
    }
    positionals.push(arg);
  }

  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  const gitFs = createGitFs(vfs);
  const gitEnv = resolveGitEnv(ctx.env);

  const current = await git.currentBranch({ fs: gitFs, dir, fullname: false });
  if (!current) {
    return failure('git push: detached HEAD is not supported', 1);
  }

  const remote = positionals[0] || 'origin';
  const ref = positionals[1] || current;

  await git.push({
    fs: gitFs,
    http,
    dir,
    remote,
    ref,
    remoteRef: ref,
    force,
    corsProxy: gitEnv.corsProxy,
    onAuth: () => resolveGitAuth(gitEnv),
  });

  return success(`Pushed ${ref} to ${remote}\n`);
}

function resolveGitEnv(env: Record<string, string>): GitEnv {
  const token = env.GIT_TOKEN || env.GITHUB_TOKEN || undefined;
  const username = env.GIT_USERNAME || undefined;
  const password = env.GIT_PASSWORD || undefined;

  return {
    token,
    username,
    password,
    corsProxy: env.GIT_CORS_PROXY || DEFAULT_CORS_PROXY,
    authorName: env.GIT_AUTHOR_NAME || env.GIT_COMMITTER_NAME || 'almostnode',
    authorEmail: env.GIT_AUTHOR_EMAIL || env.GIT_COMMITTER_EMAIL || 'almostnode@example.com',
  };
}

function resolveGitAuth(gitEnv: GitEnv): GitAuthResult {
  if (gitEnv.token) {
    return {
      username: gitEnv.username || 'token',
      password: gitEnv.token,
    };
  }

  if (gitEnv.username || gitEnv.password) {
    return {
      username: gitEnv.username || '',
      password: gitEnv.password || '',
    };
  }

  return {};
}

function resolvePath(cwd: string, maybePath: string): string {
  const resolved = path.isAbsolute(maybePath)
    ? path.normalize(maybePath)
    : path.normalize(path.join(cwd || '/', maybePath));
  return normalizePath(resolved);
}

function normalizePath(input: string): string {
  if (!input) return '/';
  const normalized = input.replace(/\\/g, '/').replace(/\/+/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function findGitRoot(vfs: VirtualFS, startPath: string): string | null {
  let current = resolvePath('/', startPath || '/');

  while (true) {
    const dotGit = normalizePath(path.join(current, '.git'));
    if (vfs.existsSync(dotGit)) {
      return current;
    }
    if (current === '/') break;
    current = path.dirname(current);
  }

  return null;
}

function findGitRootOrThrow(vfs: VirtualFS, startPath: string): string {
  const root = findGitRoot(vfs, startPath);
  if (!root) {
    throw new Error('fatal: not a git repository (or any of the parent directories): .git');
  }
  return root;
}

function toRepoRelativePath(repoRoot: string, absolutePath: string): string {
  const normalizedRoot = normalizePath(repoRoot);
  const normalizedPath = normalizePath(absolutePath);

  if (normalizedPath === normalizedRoot) return '.';
  if (!normalizedPath.startsWith(`${normalizedRoot}/`)) {
    throw new Error(`fatal: path '${absolutePath}' is outside repository '${repoRoot}'`);
  }

  return normalizedPath.slice(normalizedRoot.length + 1);
}

function parseAuthor(raw?: string): ParsedAuthor | undefined {
  if (!raw) return undefined;
  const match = raw.match(/^(.*)\s+<([^>]+)>$/);
  if (!match) return undefined;
  const name = match[1].trim();
  const email = match[2].trim();
  if (!name || !email) return undefined;
  return { name, email };
}

function toShortStatusCode(head: number, workdir: number, stage: number): string {
  const key = `${head}${workdir}${stage}`;
  const code = SHORT_STATUS_MAP[key];
  if (code) return code;

  if (head === 0 && workdir !== 0) return '??';

  let index = ' ';
  let worktree = ' ';

  if (head !== stage) {
    if (stage === 0) index = 'D';
    else if (head === 0) index = 'A';
    else index = 'M';
  }

  if (stage !== workdir) {
    if (workdir === 0) worktree = 'D';
    else if (workdir === 2) worktree = 'M';
  }

  return `${index}${worktree}`;
}

const SHORT_STATUS_MAP: Record<string, string> = {
  '000': '  ',
  '003': 'AD',
  '020': '??',
  '022': 'A ',
  '023': 'AM',
  '100': 'D ',
  '101': ' D',
  '103': 'MD',
  '110': 'D ',
  '111': '  ',
  '113': 'MM',
  '120': 'D ',
  '121': ' M',
  '122': 'M ',
  '123': 'MM',
};

function parseDiffArgs(args: string[]): ParsedDiffArgs | { error: string } {
  let staged = false;
  let nameOnly = false;
  const refs: string[] = [];

  for (const arg of args) {
    if (arg === '--staged' || arg === '--cached') {
      staged = true;
      continue;
    }
    if (arg === '--name-only') {
      nameOnly = true;
      continue;
    }
    if (arg.startsWith('-')) {
      return { error: `git diff: unsupported option '${arg}'` };
    }
    refs.push(arg);
  }

  if (refs.length > 2) {
    return { error: 'git diff: too many revision arguments' };
  }

  if (staged && refs.length > 0) {
    return { error: 'git diff: --staged cannot be combined with explicit revisions in v1' };
  }

  return { staged, nameOnly, refs };
}

async function collectUnstagedDiffEntries(gitFs: ReturnType<typeof createGitFs>, dir: string): Promise<DiffEntry[]> {
  const rows = await git.walk({
    fs: gitFs,
    dir,
    trees: [STAGE(), WORKDIR()],
    map: async (filepath: string, entries: Array<WalkerEntry | null>) => {
      if (filepath === '.') return undefined;
      const [stageEntry, workdirEntry] = entries;
      return collectDiffEntryForPair(gitFs, dir, filepath, stageEntry, workdirEntry, 'stage', 'workdir');
    },
  }) as Array<DiffEntry | undefined>;

  return rows.filter((entry): entry is DiffEntry => Boolean(entry));
}

async function collectStagedDiffEntries(gitFs: ReturnType<typeof createGitFs>, dir: string): Promise<DiffEntry[]> {
  const rows = await git.walk({
    fs: gitFs,
    dir,
    trees: [TREE({ ref: 'HEAD' }), STAGE()],
    map: async (filepath: string, entries: Array<WalkerEntry | null>) => {
      if (filepath === '.') return undefined;
      const [headEntry, stageEntry] = entries;
      return collectDiffEntryForPair(gitFs, dir, filepath, headEntry, stageEntry, 'tree', 'stage');
    },
  }) as Array<DiffEntry | undefined>;

  return rows.filter((entry): entry is DiffEntry => Boolean(entry));
}

async function collectRefDiffEntries(
  gitFs: ReturnType<typeof createGitFs>,
  dir: string,
  leftRef: string,
  rightRef: string
): Promise<DiffEntry[]> {
  const rows = await git.walk({
    fs: gitFs,
    dir,
    trees: [TREE({ ref: leftRef }), TREE({ ref: rightRef })],
    map: async (filepath: string, entries: Array<WalkerEntry | null>) => {
      if (filepath === '.') return undefined;
      const [leftEntry, rightEntry] = entries;
      return collectDiffEntryForPair(gitFs, dir, filepath, leftEntry, rightEntry, 'tree', 'tree');
    },
  }) as Array<DiffEntry | undefined>;

  return rows.filter((entry): entry is DiffEntry => Boolean(entry));
}

async function collectDiffEntryForPair(
  gitFs: ReturnType<typeof createGitFs>,
  dir: string,
  filepath: string,
  leftEntry: WalkerEntry | null,
  rightEntry: WalkerEntry | null,
  leftKind: 'tree' | 'stage' | 'workdir',
  rightKind: 'tree' | 'stage' | 'workdir'
): Promise<DiffEntry | undefined> {
  const [leftExists, leftOid] = await getEntryIdentity(leftEntry);
  const [rightExists, rightOid] = await getEntryIdentity(rightEntry);

  if (!leftExists && !rightExists) return undefined;
  if (leftExists && rightExists && leftOid && rightOid && leftOid === rightOid) return undefined;

  const leftText = await readEntryText(gitFs, dir, leftEntry, leftKind);
  const rightText = await readEntryText(gitFs, dir, rightEntry, rightKind);

  if (leftText === rightText && leftExists === rightExists) return undefined;

  return {
    filepath,
    leftExists,
    rightExists,
    leftText,
    rightText,
  };
}

async function getEntryIdentity(entry: WalkerEntry | null): Promise<[boolean, string | undefined]> {
  if (!entry) return [false, undefined];
  const type = await entry.type();
  if (type !== 'blob') return [false, undefined];
  const oid = await entry.oid();
  return [true, oid];
}

async function readEntryText(
  gitFs: ReturnType<typeof createGitFs>,
  dir: string,
  entry: WalkerEntry | null,
  kind: 'tree' | 'stage' | 'workdir'
): Promise<string> {
  if (!entry) return '';

  const type = await entry.type();
  if (type !== 'blob') return '';

  if (kind === 'stage') {
    const oid = await entry.oid();
    if (!oid) return '';
    const obj = await git.readObject({
      fs: gitFs,
      dir,
      oid,
      format: 'content',
    });
    if (!('object' in obj) || !(obj.object instanceof Uint8Array)) return '';
    return decodeBytes(obj.object);
  }

  const content = await entry.content();
  if (!content) return '';
  return decodeBytes(content);
}

function decodeBytes(data: Uint8Array): string {
  if (data.length === 0) return '';
  return textDecoder.decode(data);
}

function formatDiffEntry(entry: DiffEntry): string {
  const filepath = entry.filepath;
  const patch = structuredPatch(
    `a/${filepath}`,
    `b/${filepath}`,
    entry.leftText,
    entry.rightText,
    '',
    '',
    { context: 3 }
  );

  let output = `diff --git a/${filepath} b/${filepath}\n`;
  if (!entry.leftExists) {
    output += `new file mode 100644\n`;
    output += `--- /dev/null\n`;
    output += `+++ b/${filepath}\n`;
  } else if (!entry.rightExists) {
    output += `deleted file mode 100644\n`;
    output += `--- a/${filepath}\n`;
    output += `+++ /dev/null\n`;
  } else {
    output += `--- a/${filepath}\n`;
    output += `+++ b/${filepath}\n`;
  }

  if (patch.hunks.length === 0) {
    return output;
  }

  for (const hunk of patch.hunks) {
    output += `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n`;
    for (const line of hunk.lines) {
      output += `${line}\n`;
    }
  }

  return output;
}

async function resolveRefLike(gitFs: ReturnType<typeof createGitFs>, dir: string, ref: string): Promise<string> {
  try {
    return await git.resolveRef({ fs: gitFs, dir, ref });
  } catch {
    try {
      return await git.expandOid({ fs: gitFs, dir, oid: ref });
    } catch {
      throw new Error(`fatal: unknown revision '${ref}'`);
    }
  }
}

function inferCloneTarget(url: string): string {
  const trimmed = url.replace(/[\/?#]+$/, '');
  const parts = trimmed.split('/');
  const last = parts[parts.length - 1] || 'repo';
  return last.endsWith('.git') ? last.slice(0, -4) : last;
}

function isUrlLike(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function indentMessage(message: string): string[] {
  if (!message) return ['    (no message)'];
  return message.split(/\r?\n/).map((line) => `    ${line}`);
}

function mapGitError(error: unknown): JustBashExecResult {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('not a git repository')) {
    return failure(message, 128);
  }
  if (lower.includes('unknown revision')) {
    return failure(message, 128);
  }
  if (lower.includes('unsupported option') || lower.includes('missing') || lower.includes('invalid')) {
    return failure(message, 2);
  }

  return failure(message, 1);
}

function isCorruptIndexError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return message.includes('invalid dircache magic file number')
    || message.includes('invalid checksum in gitindex buffer')
    || message.includes('offset is out of bounds')
    || message.includes('corrupt index');
}

function resetGitIndexFiles(vfs: VirtualFS, dir: string): void {
  const indexPath = normalizePath(path.join(dir, '.git/index'));
  const indexLockPath = `${indexPath}.lock`;
  if (vfs.existsSync(indexLockPath)) {
    try {
      vfs.unlinkSync(indexLockPath);
    } catch {
      // best effort cleanup
    }
  }
  if (vfs.existsSync(indexPath)) {
    try {
      vfs.unlinkSync(indexPath);
    } catch {
      // best effort cleanup
    }
  }
}

function createGitFs(vfs: VirtualFS): {
  promises: {
    readFile: (filePath: string, options?: unknown) => Promise<Uint8Array | string>;
    writeFile: (filePath: string, data: Uint8Array | string) => Promise<void>;
    unlink: (filePath: string) => Promise<void>;
    readdir: (filePath: string) => Promise<string[]>;
    mkdir: (filePath: string, options?: { recursive?: boolean }) => Promise<void>;
    rmdir: (filePath: string, options?: { recursive?: boolean }) => Promise<void>;
    stat: (filePath: string) => Promise<unknown>;
    lstat: (filePath: string) => Promise<unknown>;
    readlink: (_filePath: string) => Promise<string>;
    symlink: (_target: string, _linkPath: string) => Promise<void>;
    chmod: (filePath: string, _mode: number) => Promise<void>;
    rm: (filePath: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>;
  };
} {
  const removeRecursive = (filePath: string): void => {
    const stats = vfs.statSync(filePath);
    if (stats.isDirectory()) {
      const children = vfs.readdirSync(filePath);
      for (const child of children) {
        removeRecursive(normalizePath(path.join(filePath, child)));
      }
      vfs.rmdirSync(filePath);
      return;
    }
    vfs.unlinkSync(filePath);
  };

  const promises = {
    readFile: async (filePath: string, options?: unknown): Promise<Uint8Array | string> => {
      const normalized = normalizePath(filePath);
      const encoding = typeof options === 'string'
        ? options
        : (typeof options === 'object' && options && 'encoding' in (options as Record<string, unknown>)
          ? (options as { encoding?: string }).encoding
          : undefined);
      if (encoding && (encoding === 'utf8' || encoding === 'utf-8')) {
        return vfs.readFileSync(normalized, 'utf8');
      }
      return vfs.readFileSync(normalized);
    },
    writeFile: async (filePath: string, data: Uint8Array | string): Promise<void> => {
      const normalized = normalizePath(filePath);
      const parent = path.dirname(normalized);
      if (parent && parent !== '/' && !vfs.existsSync(parent)) {
        vfs.mkdirSync(parent, { recursive: true });
      }
      vfs.writeFileSync(normalized, data);
    },
    unlink: async (filePath: string): Promise<void> => {
      vfs.unlinkSync(normalizePath(filePath));
    },
    readdir: async (filePath: string): Promise<string[]> => {
      return vfs.readdirSync(normalizePath(filePath));
    },
    mkdir: async (filePath: string, options?: { recursive?: boolean }): Promise<void> => {
      vfs.mkdirSync(normalizePath(filePath), { recursive: options?.recursive });
    },
    rmdir: async (filePath: string, options?: { recursive?: boolean }): Promise<void> => {
      const normalized = normalizePath(filePath);
      if (options?.recursive) {
        removeRecursive(normalized);
        return;
      }
      vfs.rmdirSync(normalized);
    },
    stat: async (filePath: string): Promise<unknown> => {
      return vfs.statSync(normalizePath(filePath));
    },
    lstat: async (filePath: string): Promise<unknown> => {
      return vfs.lstatSync(normalizePath(filePath));
    },
    readlink: async (): Promise<string> => {
      throw new Error('Symbolic links are not supported in VirtualFS');
    },
    symlink: async (): Promise<void> => {
      throw new Error('Symbolic links are not supported in VirtualFS');
    },
    chmod: async (filePath: string): Promise<void> => {
      if (!vfs.existsSync(normalizePath(filePath))) {
        throw new Error(`ENOENT: no such file or directory, chmod '${filePath}'`);
      }
    },
    rm: async (filePath: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> => {
      const normalized = normalizePath(filePath);
      if (!vfs.existsSync(normalized)) {
        if (options?.force) return;
        throw new Error(`ENOENT: no such file or directory, rm '${filePath}'`);
      }

      if (options?.recursive) {
        removeRecursive(normalized);
        return;
      }

      const stats = vfs.statSync(normalized);
      if (stats.isDirectory()) {
        vfs.rmdirSync(normalized);
      } else {
        vfs.unlinkSync(normalized);
      }
    },
  };

  return { promises };
}

function success(stdout: string): JustBashExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function failure(stderr: string, exitCode: number): JustBashExecResult {
  return {
    stdout: '',
    stderr: stderr.endsWith('\n') ? stderr : `${stderr}\n`,
    exitCode,
  };
}
