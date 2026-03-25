import { _vfs_getFile, _vfs_isDir, _vfs_listAll } from "../../../../vendor/opencode/packages/browser/src/shims/fs.browser.ts";

export interface BrowserRipgrepFile {
  absolutePath: string;
  relativePath: string;
  content: string;
}

export interface BrowserRipgrepSearchMatch {
  absolutePath: string;
  relativePath: string;
  lineNumber: number;
  lineText: string;
  absoluteOffset: number;
  submatches: Array<{
    text: string;
    start: number;
    end: number;
  }>;
}

interface BrowserRipgrepFileOptions {
  cwd: string;
  glob?: string[];
  hidden?: boolean;
  maxDepth?: number;
}

interface BrowserRipgrepSearchOptions extends BrowserRipgrepFileOptions {
  pattern: string;
  limit?: number;
}

function normalizePath(input: string): string {
  const parts = input.replace(/\\/g, "/").split("/");
  const resolved: string[] = [];

  for (const part of parts) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }

  if (resolved.length === 0) {
    return "/";
  }

  return `/${resolved.join("/")}`;
}

function toRelativePath(root: string, filePath: string): string {
  if (root === "/") {
    return filePath.slice(1);
  }
  return filePath.slice(root.length + 1);
}

function ensureDirectory(path: string): void {
  if (_vfs_isDir(path)) {
    return;
  }

  const error = Object.assign(new Error(`No such file or directory: '${path}'`), {
    code: "ENOENT",
    errno: -2,
    path,
  });
  throw error;
}

function hasHiddenSegment(relativePath: string): boolean {
  return relativePath.split("/").some((segment) => segment.startsWith(".") && segment.length > 1);
}

function splitBraceOptions(input: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  for (const char of input) {
    if (char === "," && depth === 0) {
      parts.push(current);
      current = "";
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
    }
    current += char;
  }

  parts.push(current);
  return parts;
}

function expandBraces(pattern: string): string[] {
  const start = pattern.indexOf("{");
  if (start < 0) {
    return [pattern];
  }

  let depth = 0;
  let end = -1;
  for (let index = start; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        end = index;
        break;
      }
    }
  }

  if (end < 0) {
    return [pattern];
  }

  const prefix = pattern.slice(0, start);
  const suffix = pattern.slice(end + 1);
  const options = splitBraceOptions(pattern.slice(start + 1, end));

  return options.flatMap((option) => expandBraces(`${prefix}${option}${suffix}`));
}

function escapeRegex(char: string): string {
  return /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char;
}

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replace(/\\/g, "/").replace(/^\/+/, "");
  let output = "^";

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];

    if (char === "*" && next === "*") {
      const after = normalized[index + 2];
      if (after === "/") {
        output += "(?:.*/)?";
        index += 2;
        continue;
      }
      output += ".*";
      index += 1;
      continue;
    }

    if (char === "*") {
      output += "[^/]*";
      continue;
    }

    if (char === "?") {
      output += "[^/]";
      continue;
    }

    output += escapeRegex(char);
  }

  output += "$";
  return new RegExp(output);
}

function matchesGlob(relativePath: string, pattern: string): boolean {
  const expanded = expandBraces(pattern);
  const basename = relativePath.split("/").at(-1) ?? relativePath;

  return expanded.some((entry) => {
    const matcher = globToRegExp(entry);
    return matcher.test(relativePath) || (!entry.includes("/") && matcher.test(basename));
  });
}

function matchesGlobs(relativePath: string, patterns: string[] | undefined): boolean {
  const entries = patterns?.filter(Boolean) ?? [];
  const include = entries.filter((entry) => !entry.startsWith("!"));
  const exclude = entries.filter((entry) => entry.startsWith("!")).map((entry) => entry.slice(1));

  if (include.length > 0 && !include.some((entry) => matchesGlob(relativePath, entry))) {
    return false;
  }

  return !exclude.some((entry) => matchesGlob(relativePath, entry));
}

function depthWithinRoot(relativePath: string): number {
  if (!relativePath) {
    return 0;
  }
  return Math.max(relativePath.split("/").length - 1, 0);
}

function listAllFiles(root: string): BrowserRipgrepFile[] {
  const files: BrowserRipgrepFile[] = [];

  for (const [filePath] of _vfs_listAll()) {
    if (filePath === root || !filePath.startsWith(`${root}/`)) {
      continue;
    }

    const content = _vfs_getFile(filePath);
    if (content === undefined) {
      continue;
    }

    files.push({
      absolutePath: filePath,
      relativePath: toRelativePath(root, filePath),
      content,
    });
  }

  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return files;
}

export function listWorkspaceFiles(input: BrowserRipgrepFileOptions): BrowserRipgrepFile[] {
  const cwd = normalizePath(input.cwd);
  ensureDirectory(cwd);

  return listAllFiles(cwd).filter((file) => {
    if (file.relativePath.startsWith(".git/")) {
      return false;
    }
    if (input.hidden === false && hasHiddenSegment(file.relativePath)) {
      return false;
    }
    if (input.maxDepth !== undefined && depthWithinRoot(file.relativePath) > input.maxDepth) {
      return false;
    }
    return matchesGlobs(file.relativePath, input.glob);
  });
}

export function searchWorkspaceFiles(input: BrowserRipgrepSearchOptions): BrowserRipgrepSearchMatch[] {
  const matcher = new RegExp(input.pattern, "g");
  const matches: BrowserRipgrepSearchMatch[] = [];

  for (const file of listWorkspaceFiles(input)) {
    const lines = file.content.split(/\r?\n/);
    let fileOffset = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const lineText = lines[index];
      matcher.lastIndex = 0;
      const submatches: BrowserRipgrepSearchMatch["submatches"] = [];
      let result: RegExpExecArray | null;

      while ((result = matcher.exec(lineText)) !== null) {
        const matchText = result[0] ?? "";
        submatches.push({
          text: matchText,
          start: result.index,
          end: result.index + matchText.length,
        });

        if (matchText.length === 0) {
          matcher.lastIndex += 1;
        }
      }

      if (submatches.length > 0) {
        matches.push({
          absolutePath: file.absolutePath,
          relativePath: file.relativePath,
          lineNumber: index + 1,
          lineText,
          absoluteOffset: fileOffset,
          submatches,
        });

        if (input.limit !== undefined && matches.length >= input.limit) {
          return matches;
        }
      }

      fileOffset += lineText.length + 1;
    }
  }

  return matches;
}
