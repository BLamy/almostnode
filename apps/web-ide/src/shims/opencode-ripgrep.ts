import z from "zod";
import { listWorkspaceFiles, searchWorkspaceFiles } from "./opencode-ripgrep-shared.ts";

class BrowserRipgrepError extends Error {
  public readonly data: Record<string, unknown>;

  constructor(name: string, message: string, data: Record<string, unknown>) {
    super(message);
    this.name = name;
    this.data = data;
  }
}

export namespace Ripgrep {
  const Stats = z.object({
    elapsed: z.object({
      secs: z.number(),
      nanos: z.number(),
      human: z.string(),
    }),
    searches: z.number(),
    searches_with_match: z.number(),
    bytes_searched: z.number(),
    bytes_printed: z.number(),
    matched_lines: z.number(),
    matches: z.number(),
  });

  export const Match = z.object({
    type: z.literal("match"),
    data: z.object({
      path: z.object({
        text: z.string(),
      }),
      lines: z.object({
        text: z.string(),
      }),
      line_number: z.number(),
      absolute_offset: z.number(),
      submatches: z.array(
        z.object({
          match: z.object({
            text: z.string(),
          }),
          start: z.number(),
          end: z.number(),
        }),
      ),
    }),
  });

  export type Match = z.infer<typeof Match>;
  export type Result = Match;
  export type Begin = never;
  export type End = never;
  export type Summary = z.infer<typeof Stats>;

  export const ExtractionFailedError = class extends BrowserRipgrepError {
    constructor(data: { filepath: string; stderr: string }) {
      super("RipgrepExtractionFailedError", `Failed to extract ripgrep at ${data.filepath}`, data);
    }
  };

  export const UnsupportedPlatformError = class extends BrowserRipgrepError {
    constructor(data: { platform: string }) {
      super("RipgrepUnsupportedPlatformError", `Unsupported platform: ${data.platform}`, data);
    }
  };

  export const DownloadFailedError = class extends BrowserRipgrepError {
    constructor(data: { url: string; status: number }) {
      super("RipgrepDownloadFailedError", `Failed to download ripgrep from ${data.url}`, data);
    }
  };

  export async function filepath(): Promise<string> {
    return "rg";
  }

  export async function* files(input: {
    cwd: string;
    glob?: string[];
    hidden?: boolean;
    follow?: boolean;
    maxDepth?: number;
    signal?: AbortSignal;
  }) {
    input.signal?.throwIfAborted();

    for (const file of listWorkspaceFiles({
      cwd: input.cwd,
      glob: input.glob,
      hidden: input.hidden,
      maxDepth: input.maxDepth,
    })) {
      input.signal?.throwIfAborted();
      yield file.relativePath;
    }
  }

  export async function tree(input: { cwd: string; limit?: number; signal?: AbortSignal }) {
    input.signal?.throwIfAborted();
    const files = listWorkspaceFiles({
      cwd: input.cwd,
      hidden: true,
    });

    interface Node {
      name: string;
      children: Map<string, Node>;
    }

    function ensureChild(node: Node, name: string): Node {
      const existing = node.children.get(name);
      if (existing) {
        return existing;
      }
      const next = { name, children: new Map<string, Node>() };
      node.children.set(name, next);
      return next;
    }

    const root: Node = { name: "", children: new Map() };
    for (const file of files) {
      input.signal?.throwIfAborted();
      const parts = file.relativePath.split("/").filter(Boolean);
      if (parts.length < 2) {
        continue;
      }

      let node = root;
      for (const part of parts.slice(0, -1)) {
        node = ensureChild(node, part);
      }
    }

    function count(node: Node): number {
      let total = 0;
      for (const child of node.children.values()) {
        total += 1 + count(child);
      }
      return total;
    }

    const total = count(root);
    const limit = input.limit ?? total;
    const lines: string[] = [];
    const queue = Array.from(root.children.values())
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((node) => ({ node, fullPath: node.name }));

    let used = 0;
    for (let index = 0; index < queue.length && used < limit; index += 1) {
      input.signal?.throwIfAborted();
      const { node, fullPath } = queue[index];
      lines.push(fullPath);
      used += 1;

      for (const child of Array.from(node.children.values()).sort((left, right) => left.name.localeCompare(right.name))) {
        queue.push({
          node: child,
          fullPath: `${fullPath}/${child.name}`,
        });
      }
    }

    if (total > used) {
      lines.push(`[${total - used} truncated]`);
    }

    return lines.join("\n");
  }

  export async function search(input: {
    cwd: string;
    pattern: string;
    glob?: string[];
    limit?: number;
    follow?: boolean;
  }) {
    return searchWorkspaceFiles({
      cwd: input.cwd,
      pattern: input.pattern,
      glob: input.glob,
      limit: input.limit,
      hidden: true,
    }).map((match) => ({
      path: { text: match.absolutePath },
      lines: { text: `${match.lineText}\n` },
      line_number: match.lineNumber,
      absolute_offset: match.absoluteOffset,
      submatches: match.submatches.map((entry) => ({
        match: { text: entry.text },
        start: entry.start,
        end: entry.end,
      })),
    }));
  }
}
