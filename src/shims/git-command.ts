import type { Command, CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import { defineCommand } from 'just-bash';
import git from 'isomorphic-git';
import httpClient from 'isomorphic-git/http/web';
import { structuredPatch } from 'diff';
import type { VirtualFS } from '../virtual-fs';
import * as path from './path';
import { readGhToken } from './gh-auth';

const DEFAULT_CORS_PROXY = 'https://almostnode-cors-proxy.langtail.workers.dev/?url=';

function createProxiedHttp(corsProxy: string) {
  return {
    async request(options: { url: string; method?: string; headers?: Record<string, string>; body?: AsyncIterableIterator<Uint8Array> }) {
      const proxiedUrl = `${corsProxy}${encodeURIComponent(options.url)}`;
      try {
        return await httpClient.request({ ...options, url: proxiedUrl });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`git: network error fetching ${options.url}: ${msg}`);
      }
    }
  };
}

// ── Interfaces ──────────────────────────────────────────────────────────────

interface GitEnv {
  token?: string;
  username?: string;
  password?: string;
  corsProxy: string;
  authorName: string;
  authorEmail: string;
}

interface GitAuthResult {
  username?: string;
  password?: string;
}

interface SimpleCommit {
  parent: string | null;
  message: string;
  author: { name: string; email: string; timestamp: number };
  tree: Record<string, string>; // filepath -> blob hash
}

interface DiffEntry {
  filepath: string;
  leftExists: boolean;
  rightExists: boolean;
  leftText: string;
  rightText: string;
}

// ── Hash ────────────────────────────────────────────────────────────────────

function simpleHash(content: string): string {
  const seeds = [0x811c9dc5, 0x01000193, 0x050c5d1f, 0x1f356823, 0x3f5a1271];
  let result = '';
  for (const seed of seeds) {
    let h = seed;
    for (let i = 0; i < content.length; i++) {
      h ^= content.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    result += (h >>> 0).toString(16).padStart(8, '0');
  }
  return result;
}

// ── VFS JSON helpers ────────────────────────────────────────────────────────

function sgDir(dir: string): string {
  return normalizePath(path.join(dir, '.git/simplegit'));
}

function readJSON<T>(vfs: VirtualFS, filePath: string): T | null {
  const p = normalizePath(filePath);
  if (!vfs.existsSync(p)) return null;
  try {
    const raw = vfs.readFileSync(p, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function writeJSON(vfs: VirtualFS, filePath: string, data: unknown): void {
  const p = normalizePath(filePath);
  const parent = path.dirname(p);
  if (parent && parent !== '/' && !vfs.existsSync(parent)) {
    vfs.mkdirSync(parent, { recursive: true });
  }
  vfs.writeFileSync(p, JSON.stringify(data));
}

// ── Blob storage ────────────────────────────────────────────────────────────

function readBlob(vfs: VirtualFS, dir: string, hash: string): string {
  const p = normalizePath(path.join(sgDir(dir), 'blobs', hash));
  if (!vfs.existsSync(p)) return '';
  return vfs.readFileSync(p, 'utf8');
}

function writeBlob(vfs: VirtualFS, dir: string, content: string): string {
  const hash = simpleHash(content);
  const p = normalizePath(path.join(sgDir(dir), 'blobs', hash));
  if (!vfs.existsSync(p)) {
    const parent = path.dirname(p);
    if (!vfs.existsSync(parent)) {
      vfs.mkdirSync(parent, { recursive: true });
    }
    vfs.writeFileSync(p, content);
  }
  return hash;
}

// ── Index (staging area) ────────────────────────────────────────────────────

function readIndex(vfs: VirtualFS, dir: string): Record<string, string> {
  const data = readJSON<{ entries: Record<string, string> }>(
    vfs,
    path.join(sgDir(dir), 'index.json')
  );
  return data?.entries ?? {};
}

function writeIndex(vfs: VirtualFS, dir: string, entries: Record<string, string>): void {
  writeJSON(vfs, path.join(sgDir(dir), 'index.json'), { entries });
}

// ── Commit storage ──────────────────────────────────────────────────────────

function readCommit(vfs: VirtualFS, dir: string, sha: string): SimpleCommit | null {
  return readJSON<SimpleCommit>(vfs, path.join(sgDir(dir), 'commits', `${sha}.json`));
}

function writeCommit(vfs: VirtualFS, dir: string, commit: SimpleCommit): string {
  const content = JSON.stringify(commit);
  const sha = simpleHash(content + Date.now() + Math.random());
  writeJSON(vfs, path.join(sgDir(dir), 'commits', `${sha}.json`), commit);
  return sha;
}

// ── Refs ────────────────────────────────────────────────────────────────────

function readHeadRef(vfs: VirtualFS, dir: string): string {
  const headPath = normalizePath(path.join(dir, '.git/HEAD'));
  if (!vfs.existsSync(headPath)) return 'main';
  const raw = vfs.readFileSync(headPath, 'utf8').trim();
  const match = raw.match(/^ref:\s*refs\/heads\/(.+)$/);
  return match ? match[1] : 'main';
}

function writeHeadRef(vfs: VirtualFS, dir: string, branch: string): void {
  const headPath = normalizePath(path.join(dir, '.git/HEAD'));
  vfs.writeFileSync(headPath, `ref: refs/heads/${branch}\n`);
}

function getRefSha(vfs: VirtualFS, dir: string, branch: string): string | null {
  const refPath = normalizePath(path.join(dir, `.git/refs/heads/${branch}`));
  if (!vfs.existsSync(refPath)) return null;
  return vfs.readFileSync(refPath, 'utf8').trim() || null;
}

function setRefSha(vfs: VirtualFS, dir: string, branch: string, sha: string): void {
  const refPath = normalizePath(path.join(dir, `.git/refs/heads/${branch}`));
  const parent = path.dirname(refPath);
  if (!vfs.existsSync(parent)) {
    vfs.mkdirSync(parent, { recursive: true });
  }
  vfs.writeFileSync(refPath, sha + '\n');
}

function listBranches(vfs: VirtualFS, dir: string): string[] {
  const refsDir = normalizePath(path.join(dir, '.git/refs/heads'));
  if (!vfs.existsSync(refsDir)) return [];
  return vfs.readdirSync(refsDir).sort();
}

function getHeadCommitSha(vfs: VirtualFS, dir: string): string | null {
  const branch = readHeadRef(vfs, dir);
  return getRefSha(vfs, dir, branch);
}

function getHeadTree(vfs: VirtualFS, dir: string): Record<string, string> {
  const sha = getHeadCommitSha(vfs, dir);
  if (!sha) return {};
  const commit = readCommit(vfs, dir, sha);
  return commit?.tree ?? {};
}

function resolveToSha(vfs: VirtualFS, dir: string, refOrSha: string): string | null {
  // Try as branch name first
  const branchSha = getRefSha(vfs, dir, refOrSha);
  if (branchSha) return branchSha;
  // Try as raw SHA (check if commit exists)
  const commit = readCommit(vfs, dir, refOrSha);
  if (commit) return refOrSha;
  // Try HEAD
  if (refOrSha === 'HEAD') return getHeadCommitSha(vfs, dir);
  return null;
}

// ── Working tree helpers ────────────────────────────────────────────────────

function collectWorkingTreeFiles(vfs: VirtualFS, dir: string): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (current: string, prefix: string) => {
    if (!vfs.existsSync(current)) return;
    const entries = vfs.readdirSync(current);
    for (const entry of entries) {
      if (entry === '.git') continue;
      const fullPath = normalizePath(path.join(current, entry));
      const relativePath = prefix ? `${prefix}/${entry}` : entry;
      const stat = vfs.statSync(fullPath);
      if (stat.isDirectory()) {
        walk(fullPath, relativePath);
      } else {
        const content = vfs.readFileSync(fullPath, 'utf8');
        result[relativePath] = content;
      }
    }
  };
  walk(dir, '');
  return result;
}

function hashWorkingTree(vfs: VirtualFS, dir: string): Record<string, string> {
  const files = collectWorkingTreeFiles(vfs, dir);
  const hashed: Record<string, string> = {};
  for (const [filepath, content] of Object.entries(files)) {
    hashed[filepath] = simpleHash(content);
  }
  return hashed;
}

// ── Status ──────────────────────────────────────────────────────────────────

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

function computeStatusMatrix(
  headTree: Record<string, string>,
  index: Record<string, string>,
  workTree: Record<string, string>
): Array<[string, string]> {
  const allPaths = new Set([
    ...Object.keys(headTree),
    ...Object.keys(index),
    ...Object.keys(workTree),
  ]);

  const result: Array<[string, string]> = [];

  for (const filepath of allPaths) {
    const headHash = headTree[filepath] ?? null;
    const indexHash = index[filepath] ?? null;
    const workHash = workTree[filepath] ?? null;

    const h = headHash !== null ? 1 : 0;

    let w: number;
    if (workHash === null) {
      w = 0;
    } else if (headHash !== null && workHash === headHash) {
      w = 1;
    } else {
      w = 2;
    }

    let s: number;
    if (indexHash === null) {
      s = 0;
    } else if (headHash !== null && indexHash === headHash) {
      s = 1;
    } else if (workHash !== null && indexHash === workHash) {
      s = 2;
    } else {
      s = 3;
    }

    const key = `${h}${w}${s}`;
    const code = SHORT_STATUS_MAP[key] ?? computeStatusFallback(h, w, s);
    if (code && code !== '  ') {
      result.push([filepath, code]);
    }
  }

  return result.sort((a, b) => a[0].localeCompare(b[0]));
}

function computeStatusFallback(head: number, workdir: number, stage: number): string {
  if (head === 0 && workdir !== 0) return '??';

  let indexChar = ' ';
  let worktreeChar = ' ';

  if (head !== stage) {
    if (stage === 0) indexChar = 'D';
    else if (head === 0) indexChar = 'A';
    else indexChar = 'M';
  }

  if (stage !== workdir) {
    if (workdir === 0) worktreeChar = 'D';
    else if (workdir === 2) worktreeChar = 'M';
  }

  return `${indexChar}${worktreeChar}`;
}

// ── Entry point ─────────────────────────────────────────────────────────────

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
    return mapGitError(error);
  }
}

// ── Local handlers ──────────────────────────────────────────────────────────

function handleInit(args: string[], ctx: CommandContext, vfs: VirtualFS): JustBashExecResult {
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

  const branch = initialBranch || 'main';
  const gitDir = normalizePath(path.join(dir, '.git'));
  if (!vfs.existsSync(gitDir)) {
    vfs.mkdirSync(gitDir, { recursive: true });
  }

  // Standard HEAD format (compatible with isomorphic-git's currentBranch)
  writeHeadRef(vfs, dir, branch);

  // Create refs/heads directory
  const refsDir = normalizePath(path.join(dir, '.git/refs/heads'));
  if (!vfs.existsSync(refsDir)) {
    vfs.mkdirSync(refsDir, { recursive: true });
  }

  // Create simplegit directory
  const sg = sgDir(dir);
  if (!vfs.existsSync(sg)) {
    vfs.mkdirSync(sg, { recursive: true });
  }

  // Initialize empty index
  writeIndex(vfs, dir, {});

  return success(`Initialized empty Git repository in ${normalizePath(path.join(dir, '.git'))}\n`);
}

function handleStatus(args: string[], ctx: CommandContext, vfs: VirtualFS): JustBashExecResult {
  let short = false;

  for (const arg of args) {
    if (arg === '--short' || arg === '--porcelain') {
      short = true;
      continue;
    }
    if (arg.startsWith('-')) {
      return failure(`git status: unsupported option '${arg}'`, 2);
    }
  }

  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  const headTree = getHeadTree(vfs, dir);
  const index = readIndex(vfs, dir);
  const workTree = hashWorkingTree(vfs, dir);

  const entries = computeStatusMatrix(headTree, index, workTree);

  const lines = entries.map(([filepath, code]) => `${code} ${filepath}`);

  if (!short) {
    return success(lines.length === 0 ? 'nothing to commit, working tree clean\n' : `${lines.join('\n')}\n`);
  }

  return success(lines.length === 0 ? '' : `${lines.join('\n')}\n`);
}

function handleAdd(args: string[], ctx: CommandContext, vfs: VirtualFS): JustBashExecResult {
  if (args.length === 0) {
    return failure('git add: missing pathspec', 2);
  }

  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  let addAll = false;
  let sawDoubleDash = false;
  const explicitPaths: string[] = [];

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
    explicitPaths.push(arg);
  }

  if (!addAll && explicitPaths.length === 0) {
    return failure('git add: missing pathspec', 2);
  }

  const index = readIndex(vfs, dir);
  const headTree = getHeadTree(vfs, dir);

  if (addAll) {
    // Stage everything: add all working tree files, remove deleted files
    const workFiles = collectWorkingTreeFiles(vfs, dir);

    // Add/update all working tree files
    for (const [filepath, content] of Object.entries(workFiles)) {
      const hash = writeBlob(vfs, dir, content);
      index[filepath] = hash;
    }

    // Remove files that are tracked (in HEAD or index) but not in working tree
    const allTracked = new Set([...Object.keys(headTree), ...Object.keys(index)]);
    for (const filepath of allTracked) {
      if (!(filepath in workFiles)) {
        delete index[filepath];
      }
    }
  }

  for (const arg of explicitPaths) {
    const absPath = resolvePath(ctx.cwd, arg);
    const filepath = toRepoRelativePath(dir, absPath);

    if (vfs.existsSync(absPath)) {
      const content = vfs.readFileSync(absPath, 'utf8');
      const hash = writeBlob(vfs, dir, content);
      index[filepath] = hash;
    } else {
      // File was deleted
      delete index[filepath];
    }
  }

  writeIndex(vfs, dir, index);
  return success('');
}

function handleCommit(args: string[], ctx: CommandContext, vfs: VirtualFS): JustBashExecResult {
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
    if (arg === '--author' && i + 1 < args.length) {
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
  const gitEnv = resolveGitEnv(ctx.env, vfs);
  const parsedAuthor = parseAuthor(authorFlag);
  const author = parsedAuthor || { name: gitEnv.authorName, email: gitEnv.authorEmail };

  const branch = readHeadRef(vfs, dir);
  const currentSha = getRefSha(vfs, dir, branch);
  const index = readIndex(vfs, dir);

  let parentSha: string | null;
  if (amend && currentSha) {
    const currentCommit = readCommit(vfs, dir, currentSha);
    parentSha = currentCommit?.parent ?? null;
  } else {
    parentSha = currentSha;
  }

  const commit: SimpleCommit = {
    parent: parentSha,
    message,
    author: { ...author, timestamp: Math.floor(Date.now() / 1000) },
    tree: { ...index },
  };

  const oid = writeCommit(vfs, dir, commit);
  setRefSha(vfs, dir, branch, oid);

  return success(`[${branch} ${oid.slice(0, 7)}] ${message}\n`);
}

function handleLog(args: string[], ctx: CommandContext, vfs: VirtualFS): JustBashExecResult {
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

  let startSha: string | null;
  if (ref && ref !== 'HEAD') {
    startSha = resolveToSha(vfs, dir, ref);
    if (!startSha) {
      return failure(`fatal: unknown revision '${ref}'`, 128);
    }
  } else {
    startSha = getHeadCommitSha(vfs, dir);
  }

  if (!startSha) {
    return success('');
  }

  const entries: Array<{ oid: string; commit: SimpleCommit }> = [];
  let current: string | null = startSha;
  const maxDepth = depth ?? 1000;

  while (current && entries.length < maxDepth) {
    const commit = readCommit(vfs, dir, current);
    if (!commit) break;
    entries.push({ oid: current, commit });
    current = commit.parent;
  }

  if (entries.length === 0) {
    return success('');
  }

  const chunks = entries.map((entry) => {
    const a = entry.commit.author;
    const authorLine = `${a.name} <${a.email}>`;
    const date = new Date(a.timestamp * 1000).toUTCString();
    const msg = (entry.commit.message || '').trimEnd();
    return [
      `commit ${entry.oid}`,
      `Author: ${authorLine}`,
      `Date:   ${date}`,
      '',
      ...msg.split(/\r?\n/).map((line) => `    ${line}`),
      '',
    ].join('\n');
  });

  return success(chunks.join(''));
}

function handleBranch(args: string[], ctx: CommandContext, vfs: VirtualFS): JustBashExecResult {
  const dir = findGitRootOrThrow(vfs, ctx.cwd);

  if (args.length === 0) {
    const branches = listBranches(vfs, dir);
    const current = readHeadRef(vfs, dir);
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

  // Create branch pointing to current HEAD
  const headSha = getHeadCommitSha(vfs, dir);
  if (!headSha) {
    return failure('git branch: no commits yet', 1);
  }

  setRefSha(vfs, dir, ref, headSha);
  return success('');
}

function handleCheckout(args: string[], ctx: CommandContext, vfs: VirtualFS): JustBashExecResult {
  const dir = findGitRootOrThrow(vfs, ctx.cwd);
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
    const headSha = getHeadCommitSha(vfs, dir);
    if (!headSha) {
      return failure('git checkout: no commits yet', 1);
    }
    setRefSha(vfs, dir, createBranch, headSha);
    writeHeadRef(vfs, dir, createBranch);
    return success(`Switched to a new branch '${createBranch}'\n`);
  }

  if (!ref) {
    return failure('git checkout: missing branch or commit', 2);
  }

  const targetSha = resolveToSha(vfs, dir, ref);
  if (!targetSha) {
    return failure(`error: pathspec '${ref}' did not match any known refs`, 1);
  }

  // Get current tree to know what files to potentially remove
  const oldTree = getHeadTree(vfs, dir);
  const targetCommit = readCommit(vfs, dir, targetSha);
  const newTree = targetCommit?.tree ?? {};

  // Remove files that exist in old tree but not in new tree
  for (const filepath of Object.keys(oldTree)) {
    if (!(filepath in newTree)) {
      const absPath = normalizePath(path.join(dir, filepath));
      if (vfs.existsSync(absPath)) {
        vfs.unlinkSync(absPath);
      }
    }
  }

  // Write files from new tree
  for (const [filepath, blobHash] of Object.entries(newTree)) {
    const content = readBlob(vfs, dir, blobHash);
    const absPath = normalizePath(path.join(dir, filepath));
    const parent = path.dirname(absPath);
    if (parent && parent !== '/' && !vfs.existsSync(parent)) {
      vfs.mkdirSync(parent, { recursive: true });
    }
    vfs.writeFileSync(absPath, content);
  }

  // Update index to match new tree
  writeIndex(vfs, dir, { ...newTree });

  // Update HEAD
  const branchSha = getRefSha(vfs, dir, ref);
  if (branchSha) {
    writeHeadRef(vfs, dir, ref);
  }
  // If ref is a raw SHA, leave HEAD as-is (detached HEAD not fully supported)

  return success(`Switched to '${ref}'\n`);
}

function handleDiff(args: string[], ctx: CommandContext, vfs: VirtualFS): JustBashExecResult {
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
      return failure(`git diff: unsupported option '${arg}'`, 2);
    }
    refs.push(arg);
  }

  if (refs.length > 2) {
    return failure('git diff: too many revision arguments', 2);
  }

  if (staged && refs.length > 0) {
    return failure('git diff: --staged cannot be combined with explicit revisions in v1', 2);
  }

  const dir = findGitRootOrThrow(vfs, ctx.cwd);

  let entries: DiffEntry[];

  if (refs.length === 2) {
    entries = collectRefDiff(vfs, dir, refs[0], refs[1]);
  } else if (staged) {
    entries = collectStagedDiff(vfs, dir);
  } else {
    entries = collectUnstagedDiff(vfs, dir);
  }

  entries = entries.sort((a, b) => a.filepath.localeCompare(b.filepath));

  if (nameOnly) {
    return success(entries.length === 0 ? '' : `${entries.map((e) => e.filepath).join('\n')}\n`);
  }

  const patchText = entries.map((entry) => formatDiffEntry(entry)).join('');
  return success(patchText);
}

function handleRebase(args: string[], ctx: CommandContext, vfs: VirtualFS): JustBashExecResult {
  if (args.length !== 1 || args[0].startsWith('-')) {
    return failure('git rebase: only `git rebase <upstream>` is supported in v1', 2);
  }

  const upstreamRef = args[0];
  const dir = findGitRootOrThrow(vfs, ctx.cwd);

  const currentBranch = readHeadRef(vfs, dir);
  const originalHead = getRefSha(vfs, dir, currentBranch);
  if (!originalHead) {
    return failure('git rebase: no commits on current branch', 1);
  }

  const upstreamSha = resolveToSha(vfs, dir, upstreamRef);
  if (!upstreamSha) {
    return failure(`fatal: unknown revision '${upstreamRef}'`, 1);
  }

  // Find merge base
  const mergeBase = findMergeBase(vfs, dir, originalHead, upstreamSha);
  if (!mergeBase) {
    return failure(`git rebase: unable to find merge base for '${upstreamRef}'`, 1);
  }

  // Already up to date
  if (mergeBase === upstreamSha) {
    return success(`Current branch '${currentBranch}' is already up to date.\n`);
  }

  // Fast-forward case
  if (mergeBase === originalHead) {
    setRefSha(vfs, dir, currentBranch, upstreamSha);
    restoreTree(vfs, dir, upstreamSha);
    return success(`Successfully rebased and fast-forwarded '${currentBranch}'.\n`);
  }

  // Collect commits to replay (from current branch, since merge base)
  const replay: Array<{ oid: string; commit: SimpleCommit }> = [];
  let walk: string | null = originalHead;
  while (walk && walk !== mergeBase) {
    const commit = readCommit(vfs, dir, walk);
    if (!commit) break;
    replay.push({ oid: walk, commit });
    walk = commit.parent;
  }
  replay.reverse();

  if (replay.length === 0) {
    return success(`Current branch '${currentBranch}' is already up to date.\n`);
  }

  // Check for conflicts and replay
  const mergeBaseCommit = readCommit(vfs, dir, mergeBase);
  const mergeBaseTree = mergeBaseCommit?.tree ?? {};
  const upstreamCommit = readCommit(vfs, dir, upstreamSha);
  const upstreamTree = upstreamCommit?.tree ?? {};

  let currentParentSha = upstreamSha;
  let currentTree = { ...upstreamTree };

  for (const entry of replay) {
    const parentTree = entry.commit.parent
      ? (readCommit(vfs, dir, entry.commit.parent)?.tree ?? {})
      : {};
    const commitTree = entry.commit.tree;

    // Check for conflicts: files changed in this commit that were also changed in upstream
    const allPaths = new Set([...Object.keys(commitTree), ...Object.keys(parentTree)]);
    for (const filepath of allPaths) {
      const inParent = parentTree[filepath];
      const inCommit = commitTree[filepath];
      if (inParent === inCommit) continue; // not changed in this commit

      const inBase = mergeBaseTree[filepath];
      const inUpstream = upstreamTree[filepath];
      if (inBase !== inUpstream) {
        // Conflict! Both branches modified this file — roll back
        setRefSha(vfs, dir, currentBranch, originalHead);
        restoreTree(vfs, dir, originalHead);
        return mapGitError(new Error(`CONFLICT: merge conflict in ${filepath}`));
      }
    }

    // Apply changes from this commit onto current tree
    for (const filepath of allPaths) {
      const inParent = parentTree[filepath];
      const inCommit = commitTree[filepath];
      if (inParent === inCommit) continue;

      if (inCommit === undefined) {
        delete currentTree[filepath];
      } else {
        currentTree[filepath] = inCommit;
      }
    }

    // Create new commit
    const newCommit: SimpleCommit = {
      parent: currentParentSha,
      message: entry.commit.message,
      author: entry.commit.author,
      tree: { ...currentTree },
    };

    currentParentSha = writeCommit(vfs, dir, newCommit);
  }

  // Update branch ref and restore working tree
  setRefSha(vfs, dir, currentBranch, currentParentSha);
  restoreTree(vfs, dir, currentParentSha);

  return success(`Successfully rebased '${currentBranch}' onto '${upstreamRef}'.\n`);
}

function findMergeBase(vfs: VirtualFS, dir: string, oid1: string, oid2: string): string | null {
  const ancestors1 = new Set<string>();
  let current: string | null = oid1;
  while (current) {
    ancestors1.add(current);
    const commit = readCommit(vfs, dir, current);
    if (!commit?.parent) break;
    current = commit.parent;
  }

  current = oid2;
  while (current) {
    if (ancestors1.has(current)) return current;
    const commit = readCommit(vfs, dir, current);
    if (!commit?.parent) break;
    current = commit.parent;
  }

  return null;
}

function restoreTree(vfs: VirtualFS, dir: string, sha: string): void {
  const commit = readCommit(vfs, dir, sha);
  const tree = commit?.tree ?? {};

  // Get current HEAD tree to remove stale files
  const oldTree = getHeadTree(vfs, dir);

  for (const filepath of Object.keys(oldTree)) {
    if (!(filepath in tree)) {
      const absPath = normalizePath(path.join(dir, filepath));
      if (vfs.existsSync(absPath)) {
        vfs.unlinkSync(absPath);
      }
    }
  }

  for (const [filepath, blobHash] of Object.entries(tree)) {
    const content = readBlob(vfs, dir, blobHash);
    const absPath = normalizePath(path.join(dir, filepath));
    const parent = path.dirname(absPath);
    if (parent && parent !== '/' && !vfs.existsSync(parent)) {
      vfs.mkdirSync(parent, { recursive: true });
    }
    vfs.writeFileSync(absPath, content);
  }

  writeIndex(vfs, dir, { ...tree });
}

// ── Diff helpers ────────────────────────────────────────────────────────────

function collectUnstagedDiff(vfs: VirtualFS, dir: string): DiffEntry[] {
  const index = readIndex(vfs, dir);
  const workFiles = collectWorkingTreeFiles(vfs, dir);
  const entries: DiffEntry[] = [];

  const allPaths = new Set([...Object.keys(index), ...Object.keys(workFiles)]);

  for (const filepath of allPaths) {
    const indexHash = index[filepath];
    const workContent = workFiles[filepath];

    if (indexHash === undefined && workContent !== undefined) continue; // untracked
    if (indexHash !== undefined && workContent === undefined) {
      // Deleted in working tree
      entries.push({
        filepath,
        leftExists: true,
        rightExists: false,
        leftText: readBlob(vfs, dir, indexHash),
        rightText: '',
      });
      continue;
    }

    if (indexHash !== undefined && workContent !== undefined) {
      const workHash = simpleHash(workContent);
      if (workHash !== indexHash) {
        entries.push({
          filepath,
          leftExists: true,
          rightExists: true,
          leftText: readBlob(vfs, dir, indexHash),
          rightText: workContent,
        });
      }
    }
  }

  return entries;
}

function collectStagedDiff(vfs: VirtualFS, dir: string): DiffEntry[] {
  const headTree = getHeadTree(vfs, dir);
  const index = readIndex(vfs, dir);
  const entries: DiffEntry[] = [];

  const allPaths = new Set([...Object.keys(headTree), ...Object.keys(index)]);

  for (const filepath of allPaths) {
    const headHash = headTree[filepath];
    const indexHash = index[filepath];

    if (headHash === indexHash) continue;

    entries.push({
      filepath,
      leftExists: headHash !== undefined,
      rightExists: indexHash !== undefined,
      leftText: headHash ? readBlob(vfs, dir, headHash) : '',
      rightText: indexHash ? readBlob(vfs, dir, indexHash) : '',
    });
  }

  return entries;
}

function collectRefDiff(vfs: VirtualFS, dir: string, leftRef: string, rightRef: string): DiffEntry[] {
  const leftSha = resolveToSha(vfs, dir, leftRef);
  const rightSha = resolveToSha(vfs, dir, rightRef);

  const leftTree = leftSha ? (readCommit(vfs, dir, leftSha)?.tree ?? {}) : {};
  const rightTree = rightSha ? (readCommit(vfs, dir, rightSha)?.tree ?? {}) : {};

  const entries: DiffEntry[] = [];
  const allPaths = new Set([...Object.keys(leftTree), ...Object.keys(rightTree)]);

  for (const filepath of allPaths) {
    const leftHash = leftTree[filepath];
    const rightHash = rightTree[filepath];

    if (leftHash === rightHash) continue;

    entries.push({
      filepath,
      leftExists: leftHash !== undefined,
      rightExists: rightHash !== undefined,
      leftText: leftHash ? readBlob(vfs, dir, leftHash) : '',
      rightText: rightHash ? readBlob(vfs, dir, rightHash) : '',
    });
  }

  return entries;
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

// ── Remote handlers (still use isomorphic-git) ─────────────────────────────

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

  const gitEnv = resolveGitEnv(ctx.env, vfs);
  const proxiedHttp = createProxiedHttp(gitEnv.corsProxy);
  await git.clone({
    fs: createGitFs(vfs),
    http: proxiedHttp,
    dir,
    url,
    depth,
    singleBranch,
    ref,
    onAuth: () => resolveGitAuth(gitEnv),
  });

  return success(`Cloned ${url} into ${dir}\n`);
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
  const gitEnv = resolveGitEnv(ctx.env, vfs);

  const remote = positionals[0] || 'origin';
  const ref = positionals[1];
  const remoteLooksLikeUrl = isUrlLike(remote);

  const proxiedHttp = createProxiedHttp(gitEnv.corsProxy);
  await git.fetch({
    fs: gitFs,
    http: proxiedHttp,
    dir,
    remote: remoteLooksLikeUrl ? undefined : remote,
    url: remoteLooksLikeUrl ? remote : undefined,
    ref,
    singleBranch,
    depth,
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
  const gitEnv = resolveGitEnv(ctx.env, vfs);
  const localRef = await git.currentBranch({ fs: gitFs, dir, fullname: false });

  if (!localRef) {
    return failure('git pull: detached HEAD is not supported', 1);
  }

  const remote = positionals[0] || 'origin';
  const remoteRef = positionals[1] || localRef;

  const proxiedHttp = createProxiedHttp(gitEnv.corsProxy);
  await git.pull({
    fs: gitFs,
    http: proxiedHttp,
    dir,
    remote,
    ref: localRef,
    remoteRef,
    fastForward: true,
    fastForwardOnly,
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
  const gitEnv = resolveGitEnv(ctx.env, vfs);

  const current = await git.currentBranch({ fs: gitFs, dir, fullname: false });
  if (!current) {
    return failure('git push: detached HEAD is not supported', 1);
  }

  const remote = positionals[0] || 'origin';
  const ref = positionals[1] || current;

  const proxiedHttp = createProxiedHttp(gitEnv.corsProxy);
  await git.push({
    fs: gitFs,
    http: proxiedHttp,
    dir,
    remote,
    ref,
    remoteRef: ref,
    force,
    onAuth: () => resolveGitAuth(gitEnv),
  });

  return success(`Pushed ${ref} to ${remote}\n`);
}

// ── Utilities ───────────────────────────────────────────────────────────────

function resolveGitEnv(env: Record<string, string>, vfs?: VirtualFS): GitEnv {
  let token = env.GIT_TOKEN || env.GITHUB_TOKEN || undefined;

  // Fall back to stored gh auth token
  if (!token && vfs) {
    const ghConfig = readGhToken(vfs);
    if (ghConfig?.oauth_token) {
      token = ghConfig.oauth_token;
    }
  }
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

function parseAuthor(raw?: string): { name: string; email: string } | undefined {
  if (!raw) return undefined;
  const match = raw.match(/^(.*)\s+<([^>]+)>$/);
  if (!match) return undefined;
  const name = match[1].trim();
  const email = match[2].trim();
  if (!name || !email) return undefined;
  return { name, email };
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

function mapGitError(error: unknown): JustBashExecResult {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('not a git repository')) {
    return failure(message, 128);
  }
  if (lower.includes('unknown revision')) {
    return failure(message, 128);
  }
  if (lower.includes('network error') || lower.includes('failed to fetch')) {
    return failure(`git: network error — check your internet connection\n${message}`, 1);
  }
  if (lower.includes('unsupported option') || lower.includes('missing') || lower.includes('invalid')) {
    return failure(message, 2);
  }

  return failure(message, 1);
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
