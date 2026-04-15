import type { Command, CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import { defineCommand } from 'just-bash';
import git from 'isomorphic-git';
import httpClient from 'isomorphic-git/http/web';
import { structuredPatch } from 'diff';
import type { VirtualFS } from '../virtual-fs';
import * as path from './path';
import { readGhToken } from './gh-auth';

const DEFAULT_CORS_PROXY = 'https://almostnode-cors-proxy.langtail.workers.dev/?url=';
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function createProxiedHttp(corsProxy: string) {
  return {
    async request(options: { url: string; method?: string; headers?: Record<string, string>; body?: AsyncIterableIterator<Uint8Array> }) {
      const attempts = corsProxy
        ? [
          `${corsProxy}${encodeURIComponent(options.url)}`,
          options.url,
        ]
        : [options.url];

      let lastError: unknown;
      for (let index = 0; index < attempts.length; index++) {
        const url = attempts[index];
        try {
          const response = await httpClient.request({ ...options, url }) as { statusCode?: number };
          if (
            index < attempts.length - 1 &&
            typeof response.statusCode === 'number' &&
            shouldRetryDirectGitHttp(response.statusCode)
          ) {
            continue;
          }
          return response;
        } catch (err) {
          lastError = err;
        }
      }

      const msg = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`git: network error fetching ${options.url}: ${msg}`);
    }
  };
}

function toEnvRecord(
  env: Map<string, string> | Record<string, string> | undefined,
): Record<string, string> {
  if (!env) {
    return {};
  }
  return env instanceof Map ? Object.fromEntries(env) : env;
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

interface IgnoreRule {
  baseRel: string;
  pattern: string;
  negated: boolean;
  dirOnly: boolean;
  anchored: boolean;
  hasSlash: boolean;
}

interface SimpleTreeNode {
  files: Map<string, string>;
  dirs: Map<string, SimpleTreeNode>;
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

function writeMirroredCommit(vfs: VirtualFS, dir: string, sha: string, commit: SimpleCommit): void {
  writeJSON(vfs, path.join(sgDir(dir), 'commits', `${sha}.json`), commit);
}

function getTimezoneOffsetMinutes(timestampSeconds: number): number {
  return new Date(timestampSeconds * 1000).getTimezoneOffset();
}

function buildTreeShape(tree: Record<string, string>): SimpleTreeNode {
  const root: SimpleTreeNode = {
    files: new Map<string, string>(),
    dirs: new Map<string, SimpleTreeNode>(),
  };

  for (const [filepath, hash] of Object.entries(tree)) {
    const parts = filepath.split('/').filter(Boolean);
    if (parts.length === 0) continue;

    let cursor = root;
    for (let index = 0; index < parts.length - 1; index++) {
      const segment = parts[index];
      let next = cursor.dirs.get(segment);
      if (!next) {
        next = {
          files: new Map<string, string>(),
          dirs: new Map<string, SimpleTreeNode>(),
        };
        cursor.dirs.set(segment, next);
      }
      cursor = next;
    }

    cursor.files.set(parts[parts.length - 1], hash);
  }

  return root;
}

async function writeGitTreeFromSimpleTree(
  vfs: VirtualFS,
  dir: string,
  tree: Record<string, string>,
): Promise<string> {
  const gitFs = createGitFs(vfs);
  const root = buildTreeShape(tree);

  const writeNode = async (node: SimpleTreeNode): Promise<string> => {
    const entries: Array<{ mode: string; path: string; oid: string; type: 'blob' | 'tree' }> = [];

    for (const [name, child] of [...node.dirs.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const oid = await writeNode(child);
      entries.push({
        mode: '040000',
        path: name,
        oid,
        type: 'tree',
      });
    }

    for (const [name, hash] of [...node.files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const content = readBlob(vfs, dir, hash);
      const oid = await git.writeBlob({
        fs: gitFs,
        dir,
        blob: textEncoder.encode(content),
      });
      entries.push({
        mode: '100644',
        path: name,
        oid,
        type: 'blob',
      });
    }

    return git.writeTree({
      fs: gitFs,
      dir,
      tree: entries,
    });
  };

  return writeNode(root);
}

async function writeCommitAsync(vfs: VirtualFS, dir: string, commit: SimpleCommit): Promise<string> {
  const gitFs = createGitFs(vfs);
  const timestamp = commit.author.timestamp;
  const timezoneOffset = getTimezoneOffsetMinutes(timestamp);
  const tree = await writeGitTreeFromSimpleTree(vfs, dir, commit.tree);
  const oid = await git.writeCommit({
    fs: gitFs,
    dir,
    commit: {
      message: commit.message,
      tree,
      parent: commit.parent ? [commit.parent] : [],
      author: {
        name: commit.author.name,
        email: commit.author.email,
        timestamp,
        timezoneOffset,
      },
      committer: {
        name: commit.author.name,
        email: commit.author.email,
        timestamp,
        timezoneOffset,
      },
    },
  });

  writeMirroredCommit(vfs, dir, oid, commit);
  return oid;
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

function relativizeGitPath(cwd: string, target: string): string {
  const relative = path.relative(normalizePath(cwd), normalizePath(target));
  return relative ? normalizePath(relative).replace(/^\//, '') : '.';
}

async function readGitTreeAsSimpleTree(
  vfs: VirtualFS,
  dir: string,
  treeOid: string,
  prefix = '',
): Promise<Record<string, string>> {
  const gitFs = createGitFs(vfs);
  const result: Record<string, string> = {};
  const { tree } = await git.readTree({
    fs: gitFs,
    dir,
    oid: treeOid,
  });

  for (const entry of tree) {
    const filepath = prefix ? `${prefix}/${entry.path}` : entry.path;
    if (entry.type === 'tree') {
      Object.assign(result, await readGitTreeAsSimpleTree(vfs, dir, entry.oid, filepath));
      continue;
    }
    if (entry.type !== 'blob') {
      continue;
    }

    const { blob } = await git.readBlob({
      fs: gitFs,
      dir,
      oid: entry.oid,
    });
    result[filepath] = writeBlob(vfs, dir, textDecoder.decode(blob));
  }

  return result;
}

async function readCommitAsync(vfs: VirtualFS, dir: string, sha: string): Promise<SimpleCommit | null> {
  const mirrored = readCommit(vfs, dir, sha);
  if (mirrored) {
    return mirrored;
  }

  try {
    const gitFs = createGitFs(vfs);
    const { commit } = await git.readCommit({
      fs: gitFs,
      dir,
      oid: sha,
    });
    const simpleCommit: SimpleCommit = {
      parent: commit.parent[0] ?? null,
      message: commit.message,
      author: {
        name: commit.author.name,
        email: commit.author.email,
        timestamp: commit.author.timestamp,
      },
      tree: await readGitTreeAsSimpleTree(vfs, dir, commit.tree),
    };
    writeMirroredCommit(vfs, dir, sha, simpleCommit);
    return simpleCommit;
  } catch {
    return null;
  }
}

async function getHeadTreeAsync(vfs: VirtualFS, dir: string): Promise<Record<string, string>> {
  const sha = getHeadCommitSha(vfs, dir);
  if (!sha) return {};
  const commit = await readCommitAsync(vfs, dir, sha);
  return commit?.tree ?? {};
}

async function ensureIndexInitialized(vfs: VirtualFS, dir: string): Promise<Record<string, string>> {
  const data = readJSON<{ entries: Record<string, string> }>(
    vfs,
    path.join(sgDir(dir), 'index.json'),
  );
  if (data?.entries) {
    return data.entries;
  }

  const headTree = await getHeadTreeAsync(vfs, dir);
  writeIndex(vfs, dir, { ...headTree });
  return { ...headTree };
}

async function syncIndexToHead(vfs: VirtualFS, dir: string): Promise<void> {
  writeIndex(vfs, dir, await getHeadTreeAsync(vfs, dir));
}

async function resolveToSha(vfs: VirtualFS, dir: string, refOrSha: string): Promise<string | null> {
  if (refOrSha === 'HEAD') {
    return getHeadCommitSha(vfs, dir);
  }

  const mirrored = readCommit(vfs, dir, refOrSha);
  if (mirrored) {
    return refOrSha;
  }

  const gitFs = createGitFs(vfs);
  const candidates = refOrSha.startsWith('refs/')
    ? [refOrSha]
    : [refOrSha, `refs/heads/${refOrSha}`, `refs/remotes/${refOrSha}`];

  for (const candidate of candidates) {
    try {
      return await git.resolveRef({
        fs: gitFs,
        dir,
        ref: candidate,
      });
    } catch {
      // Try the next candidate.
    }
  }

  if (/^[0-9a-f]{40}$/i.test(refOrSha)) {
    const commit = await readCommitAsync(vfs, dir, refOrSha);
    if (commit) {
      return refOrSha;
    }
  }

  return null;
}

// ── Working tree helpers ────────────────────────────────────────────────────

function escapeRegex(input: string): string {
  return input.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function segmentPatternToRegex(pattern: string): RegExp {
  const source = pattern
    .split('')
    .map((char) => {
      if (char === '*') return '[^/]*';
      if (char === '?') return '[^/]';
      return escapeRegex(char);
    })
    .join('');
  return new RegExp(`^${source}$`);
}

function pathPatternToRegex(pattern: string): RegExp {
  const normalized = pattern.replace(/^\/+/, '').replace(/\/+/g, '/');
  const source = normalized
    .split('/')
    .map((segment) => segmentPatternToRegex(segment).source.slice(1, -1))
    .join('/');
  return new RegExp(`^${source}$`);
}

function parseIgnoreRules(content: string, baseRel: string): IgnoreRule[] {
  const rules: IgnoreRule[] = [];
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    let pattern = line;
    let negated = false;
    if (pattern.startsWith('!')) {
      negated = true;
      pattern = pattern.slice(1).trim();
    }

    const dirOnly = pattern.endsWith('/');
    if (dirOnly) {
      pattern = pattern.slice(0, -1);
    }

    const anchored = pattern.startsWith('/');
    if (anchored) {
      pattern = pattern.replace(/^\/+/, '');
    }

    pattern = pattern.replace(/\/+/g, '/');
    if (!pattern || pattern === '.') {
      continue;
    }

    rules.push({
      baseRel,
      pattern,
      negated,
      dirOnly,
      anchored,
      hasSlash: pattern.includes('/'),
    });
  }
  return rules;
}

function relativeToIgnoreBase(repoRel: string, baseRel: string): string | null {
  if (!baseRel) {
    return repoRel;
  }
  if (repoRel === baseRel) {
    return '.';
  }
  if (!repoRel.startsWith(`${baseRel}/`)) {
    return null;
  }
  return repoRel.slice(baseRel.length + 1);
}

function listDirectoryCandidates(candidateRel: string, isDir: boolean): string[] {
  const segments = candidateRel.split('/').filter(Boolean);
  const max = isDir ? segments.length : Math.max(segments.length - 1, 0);
  const candidates: string[] = [];
  for (let index = 1; index <= max; index += 1) {
    candidates.push(segments.slice(0, index).join('/'));
  }
  return candidates;
}

function matchesIgnoreRule(repoRel: string, isDir: boolean, rule: IgnoreRule): boolean {
  const candidateRel = relativeToIgnoreBase(repoRel, rule.baseRel);
  if (!candidateRel || candidateRel === '.') {
    return false;
  }

  if (!rule.hasSlash && !rule.anchored) {
    const matcher = segmentPatternToRegex(rule.pattern);
    if (rule.dirOnly) {
      const directoryCandidates = listDirectoryCandidates(candidateRel, isDir);
      return directoryCandidates.some((directory) => {
        const lastSegment = directory.split('/').pop();
        return lastSegment ? matcher.test(lastSegment) : false;
      });
    }

    return candidateRel.split('/').some((segment) => matcher.test(segment));
  }

  const matcher = pathPatternToRegex(rule.pattern);
  if (rule.dirOnly) {
    return listDirectoryCandidates(candidateRel, isDir).some((directory) => matcher.test(directory));
  }

  return matcher.test(candidateRel);
}

function isIgnoredPath(repoRel: string, isDir: boolean, rules: IgnoreRule[]): boolean {
  let ignored = false;
  for (const rule of rules) {
    if (!matchesIgnoreRule(repoRel, isDir, rule)) {
      continue;
    }
    ignored = !rule.negated;
  }
  return ignored;
}

function hasTrackedDescendant(trackedPaths: Set<string>, prefix: string): boolean {
  if (trackedPaths.has(prefix)) {
    return true;
  }
  const normalizedPrefix = `${prefix}/`;
  for (const trackedPath of trackedPaths) {
    if (trackedPath.startsWith(normalizedPrefix)) {
      return true;
    }
  }
  return false;
}

function collectWorkingTreeFiles(
  vfs: VirtualFS,
  dir: string,
  trackedPaths: Set<string> = new Set(),
): Record<string, string> {
  const result: Record<string, string> = {};
  const walk = (current: string, prefix: string, inheritedRules: IgnoreRule[]) => {
    if (!vfs.existsSync(current)) return;
    let activeRules = inheritedRules;
    const ignorePath = normalizePath(path.join(current, '.gitignore'));
    if (vfs.existsSync(ignorePath)) {
      const baseRel = prefix;
      const rules = parseIgnoreRules(vfs.readFileSync(ignorePath, 'utf8'), baseRel);
      if (rules.length > 0) {
        activeRules = [...inheritedRules, ...rules];
      }
    }
    const entries = vfs.readdirSync(current);
    for (const entry of entries) {
      if (entry === '.git') continue;
      const fullPath = normalizePath(path.join(current, entry));
      const relativePath = prefix ? `${prefix}/${entry}` : entry;
      const stat = vfs.statSync(fullPath);
      const tracked = stat.isDirectory()
        ? hasTrackedDescendant(trackedPaths, relativePath)
        : trackedPaths.has(relativePath);
      const ignored = isIgnoredPath(relativePath, stat.isDirectory(), activeRules);
      if (ignored && !tracked) {
        continue;
      }
      if (stat.isDirectory()) {
        walk(fullPath, relativePath, activeRules);
      } else {
        const content = vfs.readFileSync(fullPath, 'utf8');
        result[relativePath] = content;
      }
    }
  };
  walk(dir, '', []);
  return result;
}

function hashWorkingTree(
  vfs: VirtualFS,
  dir: string,
  trackedPaths: Set<string> = new Set(),
): Record<string, string> {
  const files = collectWorkingTreeFiles(vfs, dir, trackedPaths);
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
        '  init, clone, status, add, commit, log, branch, checkout, remote',
        '  diff, reset, rebase, fetch, pull, push, rev-parse, rev-list',
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
      case 'remote':
        return handleRemote(args.slice(1), ctx, vfs);
      case 'diff':
        return handleDiff(args.slice(1), ctx, vfs);
      case 'reset':
        return handleReset(args.slice(1), ctx, vfs);
      case 'rebase':
        return handleRebase(args.slice(1), ctx, vfs);
      case 'fetch':
        return handleFetch(args.slice(1), ctx, vfs);
      case 'pull':
        return handlePull(args.slice(1), ctx, vfs);
      case 'push':
        return handlePush(args.slice(1), ctx, vfs);
      case 'rev-parse':
        return handleRevParse(args.slice(1), ctx, vfs);
      case 'rev-list':
        return handleRevList(args.slice(1), ctx, vfs);
      default:
        return failure(`git: unsupported subcommand '${subcommand}'`, 2);
    }
  } catch (error) {
    return mapGitError(error);
  }
}

// ── Local handlers ──────────────────────────────────────────────────────────

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

  const branch = initialBranch || 'main';
  await git.init({
    fs: createGitFs(vfs),
    dir,
    defaultBranch: branch,
  });

  // Create simplegit directory
  const sg = sgDir(dir);
  if (!vfs.existsSync(sg)) {
    vfs.mkdirSync(sg, { recursive: true });
  }

  // Initialize empty index
  writeIndex(vfs, dir, {});

  return success(`Initialized empty Git repository in ${normalizePath(path.join(dir, '.git'))}\n`);
}

async function handleStatus(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
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
  const headTree = await getHeadTreeAsync(vfs, dir);
  const index = await ensureIndexInitialized(vfs, dir);
  const trackedPaths = new Set([
    ...Object.keys(headTree),
    ...Object.keys(index),
  ]);
  const workTree = hashWorkingTree(vfs, dir, trackedPaths);

  const entries = computeStatusMatrix(headTree, index, workTree);

  const lines = entries.map(([filepath, code]) => `${code} ${filepath}`);

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

  const index = await ensureIndexInitialized(vfs, dir);
  const headTree = await getHeadTreeAsync(vfs, dir);
  const trackedPaths = new Set([
    ...Object.keys(headTree),
    ...Object.keys(index),
  ]);
  const recursiveWorkFiles = explicitPaths.some((arg) => {
    const absPath = resolvePath(ctx.cwd, arg);
    return vfs.existsSync(absPath) && vfs.statSync(absPath).isDirectory();
  })
    ? collectWorkingTreeFiles(vfs, dir, trackedPaths)
    : null;

  if (addAll) {
    // Stage everything: add all working tree files, remove deleted files
    const workFiles = collectWorkingTreeFiles(vfs, dir, trackedPaths);

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
      if (vfs.statSync(absPath).isDirectory()) {
        const workFiles = recursiveWorkFiles ?? collectWorkingTreeFiles(vfs, dir, trackedPaths);
        const prefix = filepath === '.' ? '' : `${filepath}/`;
        const matchingFiles = Object.entries(workFiles).filter(([candidate]) => (
          candidate === filepath || candidate.startsWith(prefix)
        ));

        for (const [candidate, content] of matchingFiles) {
          index[candidate] = writeBlob(vfs, dir, content);
        }

        for (const candidate of new Set([...Object.keys(headTree), ...Object.keys(index)])) {
          if ((candidate === filepath || candidate.startsWith(prefix)) && !(candidate in workFiles)) {
            delete index[candidate];
          }
        }

        continue;
      }

      const content = vfs.readFileSync(absPath, 'utf8');
      const hash = writeBlob(vfs, dir, content);
      index[filepath] = hash;
    } else {
      const prefix = filepath === '.' ? '' : `${filepath}/`;
      let removedAny = false;
      for (const candidate of new Set([...Object.keys(headTree), ...Object.keys(index)])) {
        if (candidate === filepath || candidate.startsWith(prefix)) {
          delete index[candidate];
          removedAny = true;
        }
      }
      if (!removedAny) {
        delete index[filepath];
      }
    }
  }

  writeIndex(vfs, dir, index);
  return success('');
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
  const index = await ensureIndexInitialized(vfs, dir);

  let parentSha: string | null;
  if (amend && currentSha) {
    const currentCommit = await readCommitAsync(vfs, dir, currentSha);
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

  const oid = await writeCommitAsync(vfs, dir, commit);
  setRefSha(vfs, dir, branch, oid);
  await git.checkout({
    fs: createGitFs(vfs),
    dir,
    ref: branch,
    force: true,
  });
  await syncIndexToHead(vfs, dir);

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

  let startSha: string | null;
  if (ref && ref !== 'HEAD') {
    startSha = await resolveToSha(vfs, dir, ref);
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
    const commit = await readCommitAsync(vfs, dir, current);
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

async function handleBranch(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  const gitFs = createGitFs(vfs);
  let rename = false;
  let forceRename = false;
  const positionals: string[] = [];

  for (const arg of args) {
    if (arg === '-m' || arg === '--move') {
      rename = true;
      continue;
    }
    if (arg === '-M') {
      rename = true;
      forceRename = true;
      continue;
    }
    if (arg.startsWith('-')) {
      return failure(`git branch: unsupported option '${arg}'`, 2);
    }
    positionals.push(arg);
  }

  if (!rename && positionals.length === 0) {
    const branches = (await git.listBranches({ fs: gitFs, dir })).sort((left, right) => left.localeCompare(right));
    const current = await git.currentBranch({ fs: gitFs, dir, fullname: false }) || readHeadRef(vfs, dir);
    const output = branches
      .map((branch) => `${branch === current ? '*' : ' '} ${branch}`)
      .join('\n');
    return success(output ? `${output}\n` : '');
  }

  if (rename) {
    if (positionals.length === 0 || positionals.length > 2) {
      return failure('usage: git branch (-m | -M) [<oldbranch>] <newbranch>', 2);
    }

    const current = await git.currentBranch({ fs: gitFs, dir, fullname: false }) || readHeadRef(vfs, dir);
    const oldref = positionals.length === 2 ? positionals[0] : current;
    const ref = positionals[positionals.length - 1];

    if (!oldref) {
      return failure('git branch -m: detached HEAD is not supported', 1);
    }

    const branches = await git.listBranches({ fs: gitFs, dir });
    if (!branches.includes(oldref)) {
      return failure(`error: branch '${oldref}' not found.`, 1);
    }
    if (oldref === ref) {
      return success('');
    }

    if (branches.includes(ref)) {
      if (!forceRename) {
        return failure(`fatal: a branch named '${ref}' already exists`, 1);
      }
      await git.deleteRef({
        fs: gitFs,
        dir,
        ref: `refs/heads/${ref}`,
      });
      await clearBranchConfig(gitFs, dir, ref);
    }

    await git.renameBranch({
      fs: gitFs,
      dir,
      oldref,
      ref,
      checkout: current === oldref,
    });
    await moveBranchConfig(gitFs, dir, oldref, ref);
    return success(`Branch '${oldref}' renamed to '${ref}'\n`);
  }

  if (positionals.length > 1) {
    return failure('git branch: too many arguments', 2);
  }

  const ref = positionals[0];
  if (!ref) {
    return failure('git branch: missing branch name', 2);
  }

  // Create branch pointing to current HEAD
  const headSha = getHeadCommitSha(vfs, dir);
  if (!headSha) {
    return failure('git branch: no commits yet', 1);
  }

  await git.branch({
    fs: gitFs,
    dir,
    ref,
  });
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
    if (ref) {
      const targetSha = await resolveToSha(vfs, dir, ref);
      if (!targetSha) {
        return failure(`error: pathspec '${ref}' did not match any known refs`, 1);
      }
      await git.branch({
        fs: gitFs,
        dir,
        ref: createBranch,
        object: targetSha,
        checkout: true,
      });
    } else {
      const headSha = getHeadCommitSha(vfs, dir);
      if (!headSha) {
        return failure('git checkout: no commits yet', 1);
      }
      await git.branch({
        fs: gitFs,
        dir,
        ref: createBranch,
        checkout: true,
      });
    }
    await syncIndexToHead(vfs, dir);
    return success(`Switched to a new branch '${createBranch}'\n`);
  }

  if (!ref) {
    return failure('git checkout: missing branch or commit', 2);
  }

  try {
    await git.checkout({
      fs: gitFs,
      dir,
      ref,
      force: true,
    });
    await syncIndexToHead(vfs, dir);
    return success(`Switched to '${ref}'\n`);
  } catch {
    // Fall back to a detached checkout for raw SHAs or remote refs isomorphic-git won't accept directly.
  }

  const targetSha = await resolveToSha(vfs, dir, ref);
  if (!targetSha) {
    return failure(`error: pathspec '${ref}' did not match any known refs`, 1);
  }

  await restoreTree(vfs, dir, targetSha);
  return success(`Switched to '${ref}'\n`);
}

async function handleRemote(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  const gitFs = createGitFs(vfs);
  let verbose = false;
  const positionals: string[] = [];

  for (const arg of args) {
    if (arg === '-v' || arg === '--verbose') {
      verbose = true;
      continue;
    }
    positionals.push(arg);
  }

  if (positionals.length === 0) {
    return listRemotes(dir, gitFs, verbose);
  }

  const action = positionals[0];

  switch (action) {
    case 'add': {
      if (verbose) {
        return failure('git remote add: unsupported option \'-v\'', 2);
      }
      if (positionals.length !== 3) {
        return failure('usage: git remote add <name> <url>', 2);
      }

      const remote = positionals[1];
      const url = positionals[2];
      const remoteUrlError = getRemoteUrlSupportError(url);
      if (remoteUrlError) {
        return failure(remoteUrlError, 1);
      }
      const remotes = await git.listRemotes({ fs: gitFs, dir });
      if (remotes.some((entry) => entry.remote === remote)) {
        return failure(`error: remote ${remote} already exists.`, 3);
      }

      await git.addRemote({ fs: gitFs, dir, remote, url });
      return success('');
    }
    case 'remove':
    case 'rm': {
      if (verbose) {
        return failure(`git remote ${action}: unsupported option '-v'`, 2);
      }
      if (positionals.length !== 2) {
        return failure(`usage: git remote ${action} <name>`, 2);
      }

      const remote = positionals[1];
      const remotes = await git.listRemotes({ fs: gitFs, dir });
      if (!remotes.some((entry) => entry.remote === remote)) {
        return failure(`error: No such remote: '${remote}'`, 2);
      }

      await git.deleteRemote({ fs: gitFs, dir, remote });
      return success('');
    }
    case 'get-url': {
      if (verbose) {
        return failure('git remote get-url: unsupported option \'-v\'', 2);
      }
      if (positionals.length !== 2) {
        return failure('usage: git remote get-url <name>', 2);
      }

      const remote = positionals[1];
      const remotes = await git.listRemotes({ fs: gitFs, dir });
      const match = remotes.find((entry) => entry.remote === remote);
      if (!match) {
        return failure(`error: No such remote: '${remote}'`, 2);
      }

      return success(`${match.url}\n`);
    }
    case 'set-url': {
      if (verbose) {
        return failure('git remote set-url: unsupported option \'-v\'', 2);
      }
      if (positionals.length !== 3) {
        return failure('usage: git remote set-url <name> <newurl>', 2);
      }

      const remote = positionals[1];
      const url = positionals[2];
      const remoteUrlError = getRemoteUrlSupportError(url);
      if (remoteUrlError) {
        return failure(remoteUrlError, 1);
      }
      const remotes = await git.listRemotes({ fs: gitFs, dir });
      if (!remotes.some((entry) => entry.remote === remote)) {
        return failure(`error: No such remote: '${remote}'`, 2);
      }

      await git.setConfig({
        fs: gitFs,
        dir,
        path: `remote.${remote}.url`,
        value: url,
      });
      return success('');
    }
    case 'rename': {
      if (verbose) {
        return failure('git remote rename: unsupported option \'-v\'', 2);
      }
      if (positionals.length !== 3) {
        return failure('usage: git remote rename <old> <new>', 2);
      }

      const oldName = positionals[1];
      const newName = positionals[2];
      const remotes = await git.listRemotes({ fs: gitFs, dir });
      const existing = remotes.find((entry) => entry.remote === oldName);
      if (!existing) {
        return failure(`error: No such remote: '${oldName}'`, 2);
      }
      if (remotes.some((entry) => entry.remote === newName)) {
        return failure(`error: remote ${newName} already exists.`, 3);
      }

      await git.addRemote({ fs: gitFs, dir, remote: newName, url: existing.url });
      await git.deleteRemote({ fs: gitFs, dir, remote: oldName });
      return success('');
    }
    default:
      return failure(`git remote: unsupported subcommand '${action}'`, 2);
  }
}

async function handleDiff(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  let staged = false;
  let nameOnly = false;
  const refs: string[] = [];
  const pathspecs: string[] = [];
  let sawDoubleDash = false;

  for (const arg of args) {
    if (!sawDoubleDash && arg === '--') {
      sawDoubleDash = true;
      continue;
    }
    if (!sawDoubleDash && (arg === '--staged' || arg === '--cached')) {
      staged = true;
      continue;
    }
    if (!sawDoubleDash && arg === '--name-only') {
      nameOnly = true;
      continue;
    }
    if (!sawDoubleDash && arg.startsWith('-')) {
      return failure(`git diff: unsupported option '${arg}'`, 2);
    }
    if (sawDoubleDash) {
      pathspecs.push(arg);
      continue;
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
  await ensureIndexInitialized(vfs, dir);

  let entries: DiffEntry[];

  if (refs.length === 2) {
    entries = await collectRefDiff(vfs, dir, refs[0], refs[1]);
  } else if (staged) {
    entries = await collectStagedDiff(vfs, dir);
  } else {
    entries = collectUnstagedDiff(vfs, dir);
  }

  entries = filterDiffEntries(entries, dir, ctx.cwd, pathspecs);
  entries = entries.sort((a, b) => a.filepath.localeCompare(b.filepath));

  if (nameOnly) {
    return success(entries.length === 0 ? '' : `${entries.map((e) => e.filepath).join('\n')}\n`);
  }

  const patchText = entries.map((entry) => formatDiffEntry(entry)).join('');
  return success(patchText);
}

async function handleReset(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  let mode: 'soft' | 'mixed' | 'hard' = 'mixed';
  const positionals: string[] = [];

  for (const arg of args) {
    if (arg === '--soft') {
      mode = 'soft';
      continue;
    }
    if (arg === '--mixed') {
      mode = 'mixed';
      continue;
    }
    if (arg === '--hard') {
      mode = 'hard';
      continue;
    }
    if (arg.startsWith('-')) {
      return failure(`git reset: unsupported option '${arg}'`, 2);
    }
    positionals.push(arg);
  }

  if (positionals.length > 1) {
    return failure('git reset: too many revision arguments', 2);
  }

  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  const gitFs = createGitFs(vfs);
  const currentBranch = await git.currentBranch({ fs: gitFs, dir, fullname: false }) || readHeadRef(vfs, dir);
  const ref = positionals[0] || 'HEAD';
  const targetSha = await resolveToSha(vfs, dir, ref);

  if (!targetSha) {
    return failure(`fatal: unknown revision '${ref}'`, 128);
  }

  if (mode === 'hard') {
    await restoreTree(vfs, dir, targetSha);
  }

  setRefSha(vfs, dir, currentBranch, targetSha);

  if (mode !== 'soft') {
    await syncIndexToHead(vfs, dir);
  }

  return success('');
}

async function handleRevParse(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  const dir = findGitRootOrThrow(vfs, ctx.cwd);

  if (args.length === 0) {
    return failure('git rev-parse: missing arguments', 2);
  }

  if (args.length === 1) {
    switch (args[0]) {
      case '--git-dir':
      case '--git-common-dir':
        return success(`${relativizeGitPath(ctx.cwd, normalizePath(path.join(dir, '.git')))}\n`);
      case '--show-toplevel':
        return success(`${dir}\n`);
      case '--is-inside-work-tree':
        return success('true\n');
      default:
        break;
    }
  }

  if (args.length === 2 && args[0] === '--abbrev-ref' && args[1] === 'HEAD') {
    return success(`${readHeadRef(vfs, dir)}\n`);
  }

  return failure(`git rev-parse: unsupported arguments '${args.join(' ')}'`, 2);
}

async function handleRevList(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  let maxParents: number | null = null;
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--max-parents' && index + 1 < args.length) {
      maxParents = Number(args[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--max-parents=')) {
      maxParents = Number(arg.slice('--max-parents='.length));
      continue;
    }
    if (arg.startsWith('-')) {
      return failure(`git rev-list: unsupported option '${arg}'`, 2);
    }
    positionals.push(arg);
  }

  if (maxParents !== 0 || positionals.length !== 1 || positionals[0] !== 'HEAD') {
    return failure(`git rev-list: unsupported arguments '${args.join(' ')}'`, 2);
  }

  const dir = findGitRootOrThrow(vfs, ctx.cwd);
  let current = getHeadCommitSha(vfs, dir);
  if (!current) {
    return failure("fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.", 128);
  }

  while (true) {
    const commit = await readCommitAsync(vfs, dir, current);
    if (!commit?.parent) {
      return success(`${current}\n`);
    }
    current = commit.parent;
  }
}

async function handleRebase(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
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

  const upstreamSha = await resolveToSha(vfs, dir, upstreamRef);
  if (!upstreamSha) {
    return failure(`fatal: unknown revision '${upstreamRef}'`, 1);
  }

  const [mergeBase] = await git.findMergeBase({
    fs: createGitFs(vfs),
    dir,
    oids: [originalHead, upstreamSha],
  });
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
    await git.checkout({
      fs: createGitFs(vfs),
      dir,
      ref: currentBranch,
      force: true,
    });
    await syncIndexToHead(vfs, dir);
    return success(`Successfully rebased and fast-forwarded '${currentBranch}'.\n`);
  }

  // Collect commits to replay (from current branch, since merge base)
  const replay: Array<{ oid: string; commit: SimpleCommit }> = [];
  let walk: string | null = originalHead;
  while (walk && walk !== mergeBase) {
    const commit = await readCommitAsync(vfs, dir, walk);
    if (!commit) break;
    replay.push({ oid: walk, commit });
    walk = commit.parent;
  }
  replay.reverse();

  if (replay.length === 0) {
    return success(`Current branch '${currentBranch}' is already up to date.\n`);
  }

  // Check for conflicts and replay
  const mergeBaseCommit = await readCommitAsync(vfs, dir, mergeBase);
  const mergeBaseTree = mergeBaseCommit?.tree ?? {};
  const upstreamCommit = await readCommitAsync(vfs, dir, upstreamSha);
  const upstreamTree = upstreamCommit?.tree ?? {};

  let currentParentSha = upstreamSha;
  let currentTree = { ...upstreamTree };

  for (const entry of replay) {
    const parentTree = entry.commit.parent
      ? ((await readCommitAsync(vfs, dir, entry.commit.parent))?.tree ?? {})
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
        await git.checkout({
          fs: createGitFs(vfs),
          dir,
          ref: currentBranch,
          force: true,
        });
        await syncIndexToHead(vfs, dir);
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

    currentParentSha = await writeCommitAsync(vfs, dir, newCommit);
  }

  // Update branch ref and restore working tree
  setRefSha(vfs, dir, currentBranch, currentParentSha);
  await git.checkout({
    fs: createGitFs(vfs),
    dir,
    ref: currentBranch,
    force: true,
  });
  await syncIndexToHead(vfs, dir);

  return success(`Successfully rebased '${currentBranch}' onto '${upstreamRef}'.\n`);
}

async function restoreTree(vfs: VirtualFS, dir: string, sha: string): Promise<void> {
  const commit = await readCommitAsync(vfs, dir, sha);
  const tree = commit?.tree ?? {};

  // Get current HEAD tree to remove stale files
  const oldTree = await getHeadTreeAsync(vfs, dir);

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

function filterDiffEntries(entries: DiffEntry[], dir: string, cwd: string, pathspecs: string[]): DiffEntry[] {
  if (pathspecs.length === 0) {
    return entries;
  }

  const repoPathspecs = pathspecs.map((pathspec) => toRepoRelativePath(dir, resolvePath(cwd, pathspec)));
  return entries.filter((entry) => repoPathspecs.some((pathspec) => matchesDiffPathspec(entry.filepath, pathspec)));
}

function matchesDiffPathspec(filepath: string, pathspec: string): boolean {
  if (pathspec === '.') {
    return true;
  }

  return filepath === pathspec || filepath.startsWith(`${pathspec}/`);
}

async function collectStagedDiff(vfs: VirtualFS, dir: string): Promise<DiffEntry[]> {
  const headTree = await getHeadTreeAsync(vfs, dir);
  const index = await ensureIndexInitialized(vfs, dir);
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

async function collectRefDiff(vfs: VirtualFS, dir: string, leftRef: string, rightRef: string): Promise<DiffEntry[]> {
  const leftSha = await resolveToSha(vfs, dir, leftRef);
  const rightSha = await resolveToSha(vfs, dir, rightRef);

  const leftTree = leftSha ? ((await readCommitAsync(vfs, dir, leftSha))?.tree ?? {}) : {};
  const rightTree = rightSha ? ((await readCommitAsync(vfs, dir, rightSha))?.tree ?? {}) : {};

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
  const remoteUrlError = getRemoteUrlSupportError(url);
  if (remoteUrlError) {
    return failure(remoteUrlError, 1);
  }

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
  await syncIndexToHead(vfs, dir);

  return success(`Cloned ${url} into ${dir}\n`);
}

async function handleFetch(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  let depth: number | undefined;
  let singleBranch = false;
  let prune = false;
  const positionals: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--single-branch') {
      singleBranch = true;
      continue;
    }
    if (arg === '--prune' || arg === '-p') {
      prune = true;
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
  const remoteValidation = await validateRemoteTarget(gitFs, dir, remote);
  if (remoteValidation.error) {
    return failure(remoteValidation.error, remoteValidation.exitCode);
  }
  const remoteLooksLikeUrl = remoteValidation.remoteLooksLikeUrl;

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
    prune,
    onAuth: () => resolveGitAuth(gitEnv),
  });

  return success(`Fetched from ${remote}\n`);
}

async function handlePull(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  const positionals: string[] = [];
  let fastForwardOnly = false;
  let rebase = false;

  for (const arg of args) {
    if (arg === '--ff-only') {
      fastForwardOnly = true;
      continue;
    }
    if (arg === '--rebase') {
      rebase = true;
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
  const remoteValidation = await validateRemoteTarget(gitFs, dir, remote);
  if (remoteValidation.error) {
    return failure(remoteValidation.error, remoteValidation.exitCode);
  }
  const remoteLooksLikeUrl = remoteValidation.remoteLooksLikeUrl;

  if (rebase) {
    if (remoteLooksLikeUrl) {
      return failure('git pull --rebase: remote URLs are not supported; use a named remote', 2);
    }

    const proxiedHttp = createProxiedHttp(gitEnv.corsProxy);
    await git.fetch({
      fs: gitFs,
      http: proxiedHttp,
      dir,
      remote,
      ref: remoteRef,
      singleBranch: true,
      onAuth: () => resolveGitAuth(gitEnv),
    });

    return handleRebase([`${remote}/${remoteRef}`], ctx, vfs);
  }

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
  await syncIndexToHead(vfs, dir);

  return success(`Pulled ${remote}/${remoteRef} into ${localRef}\n`);
}

async function handlePush(args: string[], ctx: CommandContext, vfs: VirtualFS): Promise<JustBashExecResult> {
  const positionals: string[] = [];
  let force = false;
  let setUpstream = false;

  for (const arg of args) {
    if (arg === '--force' || arg === '-f') {
      force = true;
      continue;
    }
    if (arg === '--force-with-lease') {
      force = true;
      continue;
    }
    if (arg === '--set-upstream' || arg === '-u') {
      setUpstream = true;
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
  const refSpec = positionals[1] || current;
  const remoteValidation = await validateRemoteTarget(gitFs, dir, remote);
  if (remoteValidation.error) {
    return failure(remoteValidation.error, remoteValidation.exitCode);
  }
  const [sourceRefRaw, remoteRefRaw] = refSpec.includes(':')
    ? refSpec.split(':', 2)
    : [refSpec, refSpec];
  const ref = !sourceRefRaw || sourceRefRaw === 'HEAD' ? current : sourceRefRaw;
  const remoteRef = remoteRefRaw || ref;
  const sourceSha = ref === current
    ? getHeadCommitSha(vfs, dir)
    : await resolveToSha(vfs, dir, ref);

  if (!sourceSha) {
    return failure(`error: src refspec '${ref}' does not match any (repository has no commits yet)`, 1);
  }

  const proxiedHttp = createProxiedHttp(gitEnv.corsProxy);
  await git.push({
    fs: gitFs,
    http: proxiedHttp,
    dir,
    remote,
    ref,
    remoteRef,
    force,
    onAuth: () => resolveGitAuth(gitEnv),
  });
  if (setUpstream) {
    await git.setConfig({
      fs: gitFs,
      dir,
      path: `branch.${current}.remote`,
      value: remote,
    });
    await git.setConfig({
      fs: gitFs,
      dir,
      path: `branch.${current}.merge`,
      value: `refs/heads/${remoteRef}`,
    });
  }

  return success(`Pushed ${remoteRef} to ${remote}\n`);
}

// ── Utilities ───────────────────────────────────────────────────────────────

function resolveGitEnv(
  env: Map<string, string> | Record<string, string> | undefined,
  vfs?: VirtualFS,
): GitEnv {
  const envRecord = toEnvRecord(env);
  let token = envRecord.GIT_TOKEN || envRecord.GITHUB_TOKEN || undefined;
  let ghUsername: string | undefined;

  // Fall back to stored gh auth token
  if (!token && vfs) {
    const ghConfig = readGhToken(vfs);
    if (ghConfig?.oauth_token) {
      token = ghConfig.oauth_token;
      ghUsername = ghConfig.user || undefined;
    }
  }
  const username = envRecord.GIT_USERNAME || ghUsername || undefined;
  const password = envRecord.GIT_PASSWORD || undefined;

  return {
    token,
    username,
    password,
    corsProxy: envRecord.GIT_CORS_PROXY || DEFAULT_CORS_PROXY,
    authorName: envRecord.GIT_AUTHOR_NAME || envRecord.GIT_COMMITTER_NAME || 'almostnode',
    authorEmail: envRecord.GIT_AUTHOR_EMAIL || envRecord.GIT_COMMITTER_EMAIL || 'almostnode@example.com',
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

export function shouldRetryDirectGitHttp(statusCode: number): boolean {
  return statusCode === 404 || statusCode === 502 || statusCode === 503 || statusCode === 504;
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

function isSshUrlLike(value: string): boolean {
  return /^ssh:\/\//i.test(value);
}

function isScpLikeUrl(value: string): boolean {
  return /^[^/@\s][^:\s]*@[^:\s]+:.+$/.test(value);
}

function inferHttpsSuggestion(url: string): string | null {
  const scpMatch = url.match(/^(?:[^@\s]+@)?([^:\s]+):(.+)$/);
  if (scpMatch) {
    const host = scpMatch[1].toLowerCase();
    const repoPath = scpMatch[2].replace(/^\/+/, '');
    if (host === 'github.com') {
      return `https://github.com/${repoPath}`;
    }
  }

  const sshMatch = url.match(/^ssh:\/\/(?:[^@\s/]+@)?([^/:\s]+)(?::\d+)?\/(.+)$/i);
  if (sshMatch) {
    const host = sshMatch[1].toLowerCase();
    const repoPath = sshMatch[2].replace(/^\/+/, '');
    if (host === 'github.com') {
      return `https://github.com/${repoPath}`;
    }
  }

  return null;
}

function getRemoteUrlSupportError(url: string, remoteName?: string): string | null {
  if (isUrlLike(url)) {
    return null;
  }

  const subject = remoteName ? `remote '${remoteName}'` : 'remote URL';

  if (isSshUrlLike(url) || isScpLikeUrl(url)) {
    const suggestion = inferHttpsSuggestion(url);
    if (suggestion) {
      return [
        `git: ${subject} uses SSH, which is not supported in this browser runtime.`,
        'Use HTTPS instead:',
        `  ${suggestion}`,
      ].join('\n');
    }
    return `git: ${subject} uses SSH, which is not supported in this browser runtime. Use an https:// remote URL instead.`;
  }

  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) {
    return `git: ${subject} uses an unsupported protocol in this browser runtime: ${url}`;
  }

  return null;
}

function isUrlLike(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

async function validateRemoteTarget(
  gitFs: ReturnType<typeof createGitFs>,
  dir: string,
  remoteOrUrl: string,
): Promise<{ remoteLooksLikeUrl: boolean; error: string | null; exitCode: number }> {
  const directError = getRemoteUrlSupportError(remoteOrUrl);
  if (directError) {
    return {
      remoteLooksLikeUrl: false,
      error: directError,
      exitCode: 1,
    };
  }
  if (isUrlLike(remoteOrUrl)) {
    return {
      remoteLooksLikeUrl: true,
      error: null,
      exitCode: 0,
    };
  }

  const remotes = await git.listRemotes({ fs: gitFs, dir });
  const match = remotes.find((entry) => entry.remote === remoteOrUrl);
  if (!match) {
    return {
      remoteLooksLikeUrl: false,
      error: `error: No such remote: '${remoteOrUrl}'`,
      exitCode: 2,
    };
  }

  return {
    remoteLooksLikeUrl: false,
    error: getRemoteUrlSupportError(match.url, remoteOrUrl),
    exitCode: 1,
  };
}

async function moveBranchConfig(
  gitFs: ReturnType<typeof createGitFs>,
  dir: string,
  oldref: string,
  ref: string,
): Promise<void> {
  if (oldref === ref) {
    return;
  }

  const configKeys = ['remote', 'merge', 'rebase', 'pushRemote', 'description'];
  for (const key of configKeys) {
    const oldPath = `branch.${oldref}.${key}`;
    const value = await git.getConfig({ fs: gitFs, dir, path: oldPath });
    if (value === undefined) {
      continue;
    }
    await git.setConfig({
      fs: gitFs,
      dir,
      path: `branch.${ref}.${key}`,
      value,
    });
    await git.setConfig({
      fs: gitFs,
      dir,
      path: oldPath,
      value: undefined,
    });
  }
}

async function clearBranchConfig(
  gitFs: ReturnType<typeof createGitFs>,
  dir: string,
  ref: string,
): Promise<void> {
  const configKeys = ['remote', 'merge', 'rebase', 'pushRemote', 'description'];
  for (const key of configKeys) {
    await git.setConfig({
      fs: gitFs,
      dir,
      path: `branch.${ref}.${key}`,
      value: undefined,
    });
  }
}

async function listRemotes(
  dir: string,
  gitFs: ReturnType<typeof createGitFs>,
  verbose: boolean,
): Promise<JustBashExecResult> {
  const remotes = (await git.listRemotes({ fs: gitFs, dir }))
    .sort((left, right) => left.remote.localeCompare(right.remote));

  if (remotes.length === 0) {
    return success('');
  }

  if (!verbose) {
    return success(`${remotes.map((entry) => entry.remote).join('\n')}\n`);
  }

  const lines = remotes.flatMap((entry) => [
    `${entry.remote}\t${entry.url} (fetch)`,
    `${entry.remote}\t${entry.url} (push)`,
  ]);
  return success(`${lines.join('\n')}\n`);
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
  if (lower.includes('could not find head')) {
    return failure('error: src refspec does not match any (repository has no commits yet)', 1);
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
