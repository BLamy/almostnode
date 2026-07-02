import type { WorkspaceController } from "@agent-wasm/sdk";
import type Anthropic from "@anthropic-ai/sdk";
import type { SystemActions } from "../os/system";
import {
  hasAnthropicApiKey,
  readAnthropicApiKey,
  runAgent,
  type AgentEvents,
} from "./agent/agent-runner";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
}

export interface RespondHandlers extends AgentEvents {
  /** Prompt the user to approve a mutating tool call (in "ask" mode). */
  requestApproval?: (summary: string) => Promise<boolean>;
  signal?: AbortSignal;
}

export interface OpenCodeAdapter {
  /** True when a real Anthropic key is available (the agent can run). */
  authed: boolean;
  respond: (input: string, handlers?: RespondHandlers) => Promise<string>;
}

/**
 * The AI drawer adapter. When an Anthropic API key is available it runs the
 * REAL agent ({@link runAgent}) — a Claude tool-use loop that drives the
 * desktop (os-driver, executor, app-authoring, files, terminal) with a
 * persistent conversation. Without a key it falls back to a local,
 * capability-aware preview responder so the drawer is still useful offline.
 */
export function createOpenCodeChatAdapter(opts: {
  authed: boolean;
  workspace: WorkspaceController;
  system?: SystemActions;
}): OpenCodeAdapter {
  const { workspace } = opts;
  const history: Anthropic.MessageParam[] = [];

  return {
    authed: opts.authed || hasAnthropicApiKey(workspace),
    async respond(input, handlers = {}) {
      const q = input.trim();
      const apiKey = readAnthropicApiKey(workspace);

      // ── Real agent path ──────────────────────────────────────────────────
      if (apiKey && opts.system) {
        history.push({ role: "user", content: q });
        try {
          const result = await runAgent({
            apiKey,
            workspace,
            system: opts.system,
            messages: history,
            requestApproval: handlers.requestApproval ?? (async () => true),
            events: handlers,
            signal: handlers.signal,
          });
          // Persist the full turn (assistant + any tool exchanges) for context.
          history.length = 0;
          history.push(...result.messages);
          return result.text;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (message === "Aborted") return "(stopped)";
          return `The agent hit an error: ${message}`;
        }
      }

      // ── Local preview path (no key) ──────────────────────────────────────
      const lower = q.toLowerCase();
      const capabilityReply = await runCapability(q, lower);
      if (capabilityReply) return capabilityReply;

      if (/\b(ls|list|files|directory|what.*files)\b/.test(lower)) {
        const files = workspace.listFiles("/project").map((f) => f.replace("/project/", ""));
        return files.length
          ? `Files in /project:\n${files.map((f) => `• ${f}`).join("\n")}`
          : "The /project folder is empty.";
      }

      const readMatch = q.match(/(?:read|open|show|cat)\s+(\S+)/i);
      if (readMatch) {
        const rel = readMatch[1].replace(/^\.?\//, "");
        const path = rel.startsWith("/") ? rel : `/project/${rel}`;
        try {
          return `${path}:\n\n${workspace.readFile(path).slice(0, 1400)}`;
        } catch {
          return `I couldn't read \`${path}\`.`;
        }
      }

      return `Add an Anthropic API key (below) to unlock the full agent — it can drive apps, run code mode, and author new apps.\n\nYou said: "${q}"\nWithout a key I can still: "list apps", "snapshot <app>", "make an app called <name>", "list tools", or run a \`\`\`code block\`\`\`.`;
    },
  };
}

interface AlmostOsBridges {
  os?: {
    listApps: () => Array<{ appId: string; title: string; focused: boolean }>;
    snapshot: (appId: string) => { text?: string; error?: string };
    createApp: (spec: { name: string }) => Promise<{ id: string; name: string; dir: string }>;
  };
  executor?: {
    sources: () => Array<{ id: string; kind: string; toolCount: number; connected: boolean }>;
    execute: (code: string) => Promise<{
      status: string;
      resultPreview: string;
      errorMessage?: string;
      logs: Array<{ level: string; text: string }>;
    }>;
  };
}

function bridges(): AlmostOsBridges {
  return ((globalThis as { almostOS?: AlmostOsBridges }).almostOS ?? {}) as AlmostOsBridges;
}

/** Route a few explicit desktop/executor requests to the live bridges (no-key mode). */
async function runCapability(input: string, lower: string): Promise<string | null> {
  const { os, executor } = bridges();

  if (/\b(list|what|which|show)\b.*\bapps?\b/.test(lower) || lower === "apps") {
    const apps = os?.listApps() ?? [];
    return apps.length
      ? `Open apps:\n${apps.map((a) => `• ${a.appId}${a.focused ? " (focused)" : ""} — ${a.title}`).join("\n")}`
      : "No app windows are open right now.";
  }

  const snap = input.match(/\bsnapshot\s+(\S+)/i);
  if (snap && os) {
    const result = os.snapshot(snap[1]);
    return result.error ? result.error : `Snapshot of ${snap[1]}:\n\n${result.text}`;
  }

  const make = input.match(/\b(?:make|create|build|scaffold)\s+(?:an?\s+)?app\s+(?:called\s+)?["“]?([^"”]+?)["”]?$/i);
  if (make && os?.createApp) {
    const created = await os.createApp({ name: make[1].trim() });
    return `Created and launched **${created.name}** (\`${created.id}\`) at \`${created.dir}\` — it's in the dock now.`;
  }

  if (/\b(list|show)\b.*\b(tools|sources|integrations)\b/.test(lower)) {
    const sources = executor?.sources() ?? [];
    if (sources.length === 0) return "No executor sources yet. Open **executor.sh** and add an OpenAPI spec or MCP server.";
    return `Executor sources:\n${sources
      .map((s) => `• ${s.id} (${s.kind}) — ${s.toolCount} tools, ${s.connected ? "connected" : "no connection"}`)
      .join("\n")}`;
  }

  const fence = input.match(/```(?:ts|js|typescript|javascript)?\n?([\s\S]*?)```/);
  if (fence && executor?.execute) {
    const run = await executor.execute(fence[1]);
    const logs = run.logs.map((l) => `[${l.level}] ${l.text}`).join("\n");
    return run.status === "ok"
      ? `Ran in the executor sandbox:\n${logs ? `${logs}\n` : ""}\n\`\`\`json\n${run.resultPreview}\n\`\`\``
      : `Sandbox error: ${run.errorMessage ?? "unknown"}${logs ? `\n${logs}` : ""}`;
  }

  return null;
}
