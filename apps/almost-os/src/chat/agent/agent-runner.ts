/**
 * The real AI drawer agent: a manual Claude tool-use loop that drives the
 * desktop through the {@link AGENT_TOOLS} surface (os-driver, executor,
 * app-authoring, workspace files, terminal).
 *
 * Runs entirely in the browser via `@anthropic-ai/sdk` with
 * `dangerouslyAllowBrowser` (the user supplies their own key) and a custom
 * `fetch` that goes through the app's direct-then-CORS-proxy path. The loop
 * is non-streaming per turn (each turn is bounded, so it stays under the HTTP
 * timeout) and reports progress through callbacks — assistant text, tool
 * calls, and tool results appear incrementally in the drawer.
 */

import Anthropic from "@anthropic-ai/sdk";
import { oauthFetch } from "@agent-wasm/keychain/oauth";
import type { WorkspaceController } from "@agent-wasm/sdk";
import { agentWasmCredentialPaths } from "@agent-wasm/sdk/auth";
import type { SystemActions } from "../../os/system";
import {
  AGENT_TOOLS,
  runAgentTool,
  type ToolResultContent,
} from "./agent-tools";

export const AGENT_MODEL = "claude-opus-4-8";
const API_KEY_STORAGE_KEY = "almostos:anthropic-api-key";
const MAX_TURNS = 16;

const SYSTEM_PROMPT = `You are the AlmostOS assistant — an AI with full understanding of and control over a macOS-style desktop that runs entirely in the browser.

You can inspect and drive open apps (list_apps, snapshot_app, screenshot_app, act_on_app), open built-in apps (open_app), scaffold and launch brand-new Electron apps that appear in the dock (create_app), call authenticated external services through the executor.sh code-mode sandbox (executor_search, executor_run — secrets stay host-side), and read/write workspace files and run terminal commands.

Guidance:
- To act on an app, snapshot_app it first to get element refs, then act_on_app with a ref.
- Prefer executor_run for anything touching connected APIs — write TypeScript that calls tools.<source>.<tool>() and returns a value.
- Be concise. Lead with the outcome. Take reversible actions that follow from the request without asking; only surface a question when you're genuinely blocked.
- When you finish, briefly say what you did.`;

/** Read the user's Anthropic API key from localStorage or the keychain file. */
export function readAnthropicApiKey(workspace?: WorkspaceController): string | null {
  if (typeof window !== "undefined") {
    const stored = window.localStorage.getItem(API_KEY_STORAGE_KEY);
    if (stored && stored.trim()) return stored.trim();
  }
  // Fall back to a raw key stored in the Claude Code credentials file.
  if (workspace) {
    try {
      const raw = workspace.readFile(agentWasmCredentialPaths.claudeCredentials);
      const parsed = JSON.parse(raw) as { apiKey?: string; api_key?: string };
      const key = parsed.apiKey ?? parsed.api_key;
      if (typeof key === "string" && key.startsWith("sk-")) return key;
    } catch {
      // No file, or not a raw-key credentials file — that's fine.
    }
  }
  return null;
}

export function storeAnthropicApiKey(key: string): void {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
  }
}

export function hasAnthropicApiKey(workspace?: WorkspaceController): boolean {
  return readAnthropicApiKey(workspace) !== null;
}

let client: Anthropic | null = null;
let clientKey: string | null = null;

function getClient(apiKey: string): Anthropic {
  if (client && clientKey === apiKey) return client;
  client = new Anthropic({
    apiKey,
    dangerouslyAllowBrowser: true,
    // Route through the app's direct-then-CORS-proxy path.
    fetch: (url: RequestInfo | URL, init?: RequestInit) =>
      oauthFetch(typeof url === "string" ? url : url.toString(), init ?? {}, {}),
    maxRetries: 1,
  });
  clientKey = apiKey;
  return client;
}

export interface AgentEvents {
  /** A completed assistant text turn. */
  onText?: (text: string) => void;
  /** The model is calling a tool. */
  onToolUse?: (name: string, input: unknown) => void;
  /** A tool call finished. */
  onToolResult?: (name: string, ok: boolean) => void;
}

export interface RunAgentOptions {
  apiKey: string;
  workspace: WorkspaceController;
  system: SystemActions;
  /** Prior turns + the new user message (Anthropic message params). */
  messages: Anthropic.MessageParam[];
  requestApproval: (summary: string) => Promise<boolean>;
  events?: AgentEvents;
  signal?: AbortSignal;
  /** Override the Messages API call (tests inject a fake). */
  createMessage?: (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Anthropic.Message>;
}

export interface RunAgentResult {
  /** The final assistant text (concatenated across text blocks). */
  text: string;
  /** The full message history including this turn, for the next call. */
  messages: Anthropic.MessageParam[];
}

/** Run the agent loop until it stops calling tools (or hits the turn cap). */
export async function runAgent(options: RunAgentOptions): Promise<RunAgentResult> {
  const createMessage =
    options.createMessage
    ?? ((params: Anthropic.MessageCreateParamsNonStreaming) =>
      getClient(options.apiKey).messages.create(params, { signal: options.signal }));
  const messages: Anthropic.MessageParam[] = [...options.messages];
  let finalText = "";

  for (let turn = 0; turn < MAX_TURNS; turn += 1) {
    if (options.signal?.aborted) throw new Error("Aborted");

    const response = await createMessage({
      model: AGENT_MODEL,
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      tools: AGENT_TOOLS.map((tool) => ({
        name: tool.name,
        description: tool.description,
        input_schema: tool.input_schema as Anthropic.Tool.InputSchema,
      })),
      messages,
    });

    // Echo the assistant content back verbatim (preserves any thinking blocks).
    messages.push({ role: "assistant", content: response.content });

    const turnText = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("");
    if (turnText) {
      finalText = turnText;
      options.events?.onText?.(turnText);
    }

    const toolUses = response.content.filter(
      (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
    );
    if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
      break;
    }

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const toolUse of toolUses) {
      options.events?.onToolUse?.(toolUse.name, toolUse.input);
      const result = await runAgentTool(
        toolUse.name,
        (toolUse.input ?? {}) as Record<string, unknown>,
        {
          workspace: options.workspace,
          system: options.system,
          requestApproval: options.requestApproval,
        },
      );
      options.events?.onToolResult?.(toolUse.name, !result.isError);
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolUse.id,
        content: toToolResultBlocks(result.content),
        is_error: result.isError,
      });
    }
    messages.push({ role: "user", content: toolResults });
  }

  return { text: finalText || "(done)", messages };
}

function toToolResultBlocks(
  content: ToolResultContent,
): string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam> {
  if (typeof content === "string") return content;
  return content.map((block) =>
    block.type === "image"
      ? ({ type: "image", source: block.source } as Anthropic.ImageBlockParam)
      : ({ type: "text", text: block.text } as Anthropic.TextBlockParam),
  );
}
