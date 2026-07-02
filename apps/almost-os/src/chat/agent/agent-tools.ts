/**
 * The tool surface the AI drawer's agent can call — this is what lets the AI
 * "understand and control the computer." Each tool maps to an already-built
 * capability:
 *   - os-driver   (list/snapshot/screenshot/act on open apps)
 *   - executor    (code-mode sandbox, tool search/describe)
 *   - app-authoring (scaffold + launch a new app)
 *   - workspace   (read/write/list files in /project)
 *   - system      (open an app, run a terminal command)
 *
 * Mutating tools are gated by the OS approval policy: in "ask" mode every
 * side-effecting call routes through an approval callback (the drawer renders
 * a prompt); "full" runs everything. Read-only tools never prompt.
 */

import type { WorkspaceController } from "@agent-wasm/sdk";
import type { SystemActions } from "../../os/system";
import { getApprovalMode } from "../../os/approval-store";
import { createApp } from "../../os/app-authoring";
import {
  act,
  listApps,
  renderTree,
  screenshot,
  snapshot,
  type OsAction,
} from "../../os/os-driver";
import { getExecutorStore } from "../../apps/executor/executor-store";

export interface AgentToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  /** Side-effecting tools prompt for approval in "ask" mode. */
  mutating: boolean;
}

export const AGENT_TOOLS: AgentToolDef[] = [
  {
    name: "list_apps",
    description: "List the currently open desktop app windows (id, title, focus state).",
    input_schema: { type: "object", properties: {} },
    mutating: false,
  },
  {
    name: "snapshot_app",
    description:
      "Get an accessibility ref-tree of an open app's UI. Refs (e1, e2, …) are used by act_on_app. Call this before acting on an app.",
    input_schema: {
      type: "object",
      properties: { appId: { type: "string", description: "The app id from list_apps." } },
      required: ["appId"],
    },
    mutating: false,
  },
  {
    name: "screenshot_app",
    description: "Capture a PNG screenshot of an open app's painted content. Returns an image.",
    input_schema: {
      type: "object",
      properties: { appId: { type: "string" } },
      required: ["appId"],
    },
    mutating: false,
  },
  {
    name: "act_on_app",
    description:
      "Click, focus, fill, or type into an element of an open app, identified by a ref from snapshot_app.",
    input_schema: {
      type: "object",
      properties: {
        appId: { type: "string" },
        ref: { type: "string", description: "A ref like e5 from the app's snapshot." },
        action: { type: "string", enum: ["click", "focus", "fill", "type"] },
        value: { type: "string", description: "Text for fill/type actions." },
      },
      required: ["appId", "ref", "action"],
    },
    mutating: true,
  },
  {
    name: "open_app",
    description: "Open (or focus) a built-in app by id: finder, terminal, executor, keychain, etc.",
    input_schema: {
      type: "object",
      properties: { appId: { type: "string" } },
      required: ["appId"],
    },
    mutating: true,
  },
  {
    name: "create_app",
    description:
      "Scaffold and launch a brand-new Electron app that appears in the dock immediately. Provide a name and optional full HTML for the window body.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        html: { type: "string", description: "Optional complete HTML document for the app window." },
      },
      required: ["name"],
    },
    mutating: true,
  },
  {
    name: "executor_search",
    description: "Search the executor.sh tool catalog (connected OpenAPI/MCP tools) by keyword.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
    },
    mutating: false,
  },
  {
    name: "executor_run",
    description:
      "Run TypeScript in the executor.sh code-mode sandbox. Call connected tools as `await tools.<source>.<tool>({...})`; `return` a value. Secrets stay host-side; fetch is disabled.",
    input_schema: {
      type: "object",
      properties: { code: { type: "string", description: "The TypeScript program to run." } },
      required: ["code"],
    },
    mutating: true,
  },
  {
    name: "debug_replay",
    description:
      "Stop the background desktop recording and upload it to Replay.io for time-travel debugging. Returns a recording URL. Use this after an app misbehaves or crashes.",
    input_schema: { type: "object", properties: {} },
    mutating: true,
  },
  {
    name: "list_files",
    description: "List files under /project in the workspace.",
    input_schema: { type: "object", properties: {} },
    mutating: false,
  },
  {
    name: "read_file",
    description: "Read a file from the workspace (path relative to /project or absolute).",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
    },
    mutating: false,
  },
  {
    name: "write_file",
    description: "Write a file in the workspace (path relative to /project or absolute).",
    input_schema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" } },
      required: ["path", "content"],
    },
    mutating: true,
  },
  {
    name: "run_terminal",
    description: "Run a shell command in the workspace terminal and return its output.",
    input_schema: {
      type: "object",
      properties: { command: { type: "string" } },
      required: ["command"],
    },
    mutating: true,
  },
];

export interface ToolContext {
  workspace: WorkspaceController;
  system: SystemActions;
  /** Prompt the user to approve a mutating call; resolves true to proceed. */
  requestApproval: (summary: string) => Promise<boolean>;
}

/** Result content block(s) returned to the model for a tool call. */
export type ToolResultContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
    >;

function resolveWorkspacePath(path: string): string {
  return path.startsWith("/") ? path : `/project/${path.replace(/^\.?\//, "")}`;
}

/** Execute one tool call. Applies the approval gate to mutating tools. */
export async function runAgentTool(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ content: ToolResultContent; isError: boolean }> {
  const def = AGENT_TOOLS.find((tool) => tool.name === name);
  if (!def) {
    return { content: `Unknown tool "${name}".`, isError: true };
  }

  if (def.mutating && getApprovalMode() === "ask") {
    const approved = await ctx.requestApproval(describeCall(name, input));
    if (!approved) {
      return { content: `The user denied the ${name} action.`, isError: true };
    }
  }

  try {
    return await dispatch(name, input, ctx);
  } catch (error) {
    return {
      content: `${name} failed: ${error instanceof Error ? error.message : String(error)}`,
      isError: true,
    };
  }
}

function describeCall(name: string, input: Record<string, unknown>): string {
  const preview = JSON.stringify(input);
  return `${name}(${preview.length > 200 ? `${preview.slice(0, 200)}…` : preview})`;
}

async function dispatch(
  name: string,
  input: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ content: ToolResultContent; isError: boolean }> {
  const store = getExecutorStore();
  switch (name) {
    case "list_apps": {
      const apps = listApps();
      return { content: JSON.stringify(apps, null, 2), isError: false };
    }
    case "snapshot_app": {
      const result = snapshot(String(input.appId));
      if ("error" in result) return { content: result.error, isError: true };
      return { content: result.text || renderTree(result.tree), isError: false };
    }
    case "screenshot_app": {
      const result = await screenshot(String(input.appId));
      if ("error" in result) return { content: result.error, isError: true };
      const base64 = result.dataUrl.slice(result.dataUrl.indexOf(",") + 1);
      return {
        content: [
          { type: "text", text: `Screenshot of ${String(input.appId)}:` },
          { type: "image", source: { type: "base64", media_type: "image/png", data: base64 } },
        ],
        isError: false,
      };
    }
    case "act_on_app": {
      const action = {
        type: String(input.action),
        ...(input.value !== undefined ? { value: String(input.value) } : {}),
      } as OsAction;
      const result = act(String(input.appId), String(input.ref), action);
      return result.ok
        ? { content: result.detail ?? "ok", isError: false }
        : { content: result.error, isError: true };
    }
    case "open_app": {
      ctx.system.openApp(String(input.appId) as never);
      return { content: `Opened ${String(input.appId)}.`, isError: false };
    }
    case "create_app": {
      const created = await createApp({
        name: String(input.name),
        html: typeof input.html === "string" ? input.html : undefined,
      });
      return {
        content: `Created and launched "${created.name}" (${created.id}) at ${created.dir}.`,
        isError: false,
      };
    }
    case "executor_search": {
      const hits = store.searchTools({ query: String(input.query) });
      return { content: JSON.stringify(hits, null, 2), isError: false };
    }
    case "executor_run": {
      const run = await store.execute(String(input.code));
      const logs = run.logs.map((l) => `[${l.level}] ${l.text}`).join("\n");
      const body = run.status === "ok"
        ? `${logs ? `${logs}\n` : ""}result: ${run.resultPreview}`
        : `${logs ? `${logs}\n` : ""}error: ${run.errorMessage ?? "run failed"}`;
      return { content: body, isError: run.status !== "ok" };
    }
    case "debug_replay": {
      const { uploadCurrentRecording } = await import("../../os/register-replay");
      const result = await uploadCurrentRecording();
      return {
        content: result.url
          ? `Uploaded a Replay recording: ${result.url}`
          : `Uploaded (visitDataId ${result.visitDataId}). Connect Replay in the Keychain for a full URL.`,
        isError: false,
      };
    }
    case "list_files": {
      const files = ctx.workspace.listFiles("/project").map((f) => f.replace("/project/", ""));
      return { content: files.join("\n") || "(empty)", isError: false };
    }
    case "read_file": {
      const content = ctx.workspace.readFile(resolveWorkspacePath(String(input.path)));
      return { content, isError: false };
    }
    case "write_file": {
      ctx.workspace.writeFile(resolveWorkspacePath(String(input.path)), String(input.content));
      return { content: `Wrote ${String(input.path)}.`, isError: false };
    }
    case "run_terminal": {
      const session = ctx.workspace.terminals.createSession({ cwd: "/project" });
      let out = "";
      try {
        await session.session.run(String(input.command), {
          onStdout: (chunk: string) => {
            out += chunk;
          },
          onStderr: (chunk: string) => {
            out += chunk;
          },
        });
      } finally {
        session.dispose();
      }
      return { content: out.slice(0, 8000) || "(no output)", isError: false };
    }
    default:
      return { content: `Unhandled tool "${name}".`, isError: true };
  }
}
