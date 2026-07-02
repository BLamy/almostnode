// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AGENT_TOOLS, runAgentTool } from "./agent-tools";
import { runAgent } from "./agent-runner";
import { getApprovalMode, setApprovalMode } from "../../os/approval-store";

afterEach(() => {
  document.body.innerHTML = "";
  setApprovalMode("full");
});

function textResponse(text: string): Anthropic.Message {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-8",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 } as Anthropic.Usage,
    content: [{ type: "text", text }],
  } as Anthropic.Message;
}

function toolResponse(name: string, input: unknown): Anthropic.Message {
  return {
    id: "msg_2",
    type: "message",
    role: "assistant",
    model: "claude-opus-4-8",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 } as Anthropic.Usage,
    content: [
      { type: "text", text: "Let me check." },
      { type: "tool_use", id: "tu_1", name, input },
    ],
  } as Anthropic.Message;
}

const writeFileMock = vi.fn();
const fakeWorkspace = {
  listFiles: () => ["/project/a.txt"],
  readFile: () => "hello",
  writeFile: writeFileMock,
} as never;

const fakeSystem = { openApp: vi.fn() } as never;

type CreateMessage = (
  params: Anthropic.MessageCreateParamsNonStreaming,
) => Promise<Anthropic.Message>;

describe("agent-tools", () => {
  it("exposes computer-control tools with schemas", () => {
    const names = AGENT_TOOLS.map((t) => t.name);
    expect(names).toContain("list_apps");
    expect(names).toContain("snapshot_app");
    expect(names).toContain("create_app");
    expect(names).toContain("executor_run");
    for (const tool of AGENT_TOOLS) {
      expect(tool.input_schema).toHaveProperty("type", "object");
    }
  });

  it("routes list_apps to the os-driver", async () => {
    const win = document.createElement("div");
    win.className = "os-window is-focused";
    win.setAttribute("data-app-id", "finder");
    win.setAttribute("data-window-id", "finder-1");
    win.setAttribute("aria-label", "Finder");
    document.body.appendChild(win);

    const result = await runAgentTool(
      "list_apps",
      {},
      { workspace: fakeWorkspace, system: fakeSystem, requestApproval: async () => true },
    );
    expect(result.isError).toBe(false);
    expect(String(result.content)).toContain("finder");
  });

  it("gates mutating tools behind approval in ask mode", async () => {
    setApprovalMode("ask");
    expect(getApprovalMode()).toBe("ask");
    const denied = await runAgentTool(
      "write_file",
      { path: "x.txt", content: "hi" },
      { workspace: fakeWorkspace, system: fakeSystem, requestApproval: async () => false },
    );
    expect(denied.isError).toBe(true);
    expect(String(denied.content)).toMatch(/denied/);
    expect(writeFileMock).not.toHaveBeenCalled();
  });

  it("read-only tools never prompt for approval", async () => {
    setApprovalMode("ask");
    const approve = vi.fn(async () => true);
    await runAgentTool(
      "list_files",
      {},
      { workspace: fakeWorkspace, system: fakeSystem, requestApproval: approve },
    );
    expect(approve).not.toHaveBeenCalled();
  });
});

describe("runAgent loop", () => {
  it("returns text directly when the model doesn't call a tool", async () => {
    const createMessage = vi.fn<CreateMessage>(async () => textResponse("Hello there."));
    const result = await runAgent({
      apiKey: "sk-test",
      workspace: fakeWorkspace,
      system: fakeSystem,
      messages: [{ role: "user", content: "hi" }],
      requestApproval: async () => true,
      createMessage,
    });
    expect(result.text).toBe("Hello there.");
    expect(createMessage).toHaveBeenCalledOnce();
  });

  it("executes a tool call then feeds the result back and finishes", async () => {
    const win = document.createElement("div");
    win.className = "os-window is-focused";
    win.setAttribute("data-app-id", "terminal");
    win.setAttribute("data-window-id", "terminal-1");
    win.setAttribute("aria-label", "Terminal");
    document.body.appendChild(win);

    const responses = [toolResponse("list_apps", {}), textResponse("You have Terminal open.")];
    let call = 0;
    const createMessage = vi.fn<CreateMessage>(async () => responses[call++]!);
    const onToolUse = vi.fn();
    const onToolResult = vi.fn();

    const result = await runAgent({
      apiKey: "sk-test",
      workspace: fakeWorkspace,
      system: fakeSystem,
      messages: [{ role: "user", content: "what's open?" }],
      requestApproval: async () => true,
      events: { onToolUse, onToolResult },
      createMessage,
    });

    expect(createMessage).toHaveBeenCalledTimes(2);
    expect(onToolUse).toHaveBeenCalledWith("list_apps", {});
    expect(onToolResult).toHaveBeenCalledWith("list_apps", true);
    expect(result.text).toBe("You have Terminal open.");
    // The second call's message history must include the tool_result turn.
    const secondCallMessages = createMessage.mock.calls[1]![0].messages;
    expect(JSON.stringify(secondCallMessages)).toContain("tool_result");
    expect(JSON.stringify(secondCallMessages)).toContain("tu_1");
  });
});
