import { afterEach, describe, expect, it, vi } from "vitest";
import { runBrowserExecPlan, type BrowserExecHost } from "../src/browser-exec";
import type { CodexCliBrowserExecPlan } from "../src/types";

describe("runBrowserExecPlan", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("runs a mocked browser exec and writes the last message through the host bridge", async () => {
    const writes: unknown[] = [];
    const result = await runBrowserExecPlan(
      execPlan({
        cwd: "/workspace",
        model: "test-model",
        outputLastMessagePath: "last.txt",
      }),
      {
        cwd: "/workspace",
        env: {
          OPENAI_API_KEY: "test-key",
          CODEX_BROWSER_EXEC_MOCK_RESPONSE: "browser exec ok",
        },
      },
      createHost(writes),
    );

    expect(result).toEqual({
      stdout: "browser exec ok\n",
      stderr: "",
      exitCode: 0,
    });
    expect(writes).toEqual([
      {
        op: "fs/writeFile",
        params: {
          path: "/workspace/last.txt",
          content: "browser exec ok",
          encoding: "utf8",
        },
      },
    ]);
  });

  it("prints JSONL events for --json", async () => {
    const result = await runBrowserExecPlan(
      execPlan({ json: true }),
      {
        env: {
          OPENAI_API_KEY: "test-key",
          CODEX_BROWSER_EXEC_MOCK_RESPONSE: "json ok",
        },
      },
      createHost(),
    );

    expect(result?.exitCode).toBe(0);
    const events = result?.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toEqual([
      {
        type: "browser_exec.started",
        model: "gpt-5.5",
      },
      {
        type: "browser_exec.completed",
        output_text: "json ok",
      },
    ]);
  });

  it("calls the Responses API when no mock response is configured", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(
        JSON.stringify({
          output: [
            {
              content: [{ text: "real response" }],
            },
          ],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await runBrowserExecPlan(
      execPlan({
        cwd: "/project",
        model: "config-model",
      }),
      {
        env: {
          OPENAI_API_KEY: "test-key",
          OPENAI_ORGANIZATION: "org_123",
        },
      },
      createHost(),
    );

    expect(result).toEqual({
      stdout: "real response\n",
      stderr: "",
      exitCode: 0,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init).toBeDefined();
    const body = JSON.parse(String(init!.body));
    expect(body).toMatchObject({
      model: "config-model",
      instructions: expect.stringContaining("You are Codex"),
      tool_choice: "auto",
      parallel_tool_calls: false,
      store: false,
      stream: true,
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "hello" }],
        },
      ],
    });
    expect(body.tools).toEqual([
      expect.objectContaining({
        type: "function",
        name: "shell_command",
      }),
      expect.objectContaining({
        type: "function",
        name: "playwright_cli",
      }),
    ]);
    const headers = new Headers(init!.headers);
    expect(headers.get("Authorization")).toBe("Bearer test-key");
    expect(headers.get("OpenAI-Organization")).toBe("org_123");
  });

  it("collects streaming Responses API events", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      sseResponse([
        {
          type: "response.output_text.delta",
          delta: "stream ",
        },
        {
          type: "response.output_text.delta",
          delta: "ok",
        },
        {
          type: "response.completed",
          response: {
            output_text: "stream ok",
            output: [
              {
                type: "message",
                content: [{ type: "output_text", text: "stream ok" }],
              },
            ],
          },
        },
      ]),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await runBrowserExecPlan(
      execPlan(),
      { env: { OPENAI_API_KEY: "test-key" } },
      createHost(),
    );

    expect(result).toEqual({
      stdout: "stream ok\n",
      stderr: "",
      exitCode: 0,
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const body = JSON.parse(String(init!.body));
    expect(body.stream).toBe(true);
  });

  it("uses streamed deltas when response.completed omits output text", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      sseResponse([
        {
          type: "response.output_text.delta",
          item_id: "msg_1",
          output_index: 1,
          content_index: 0,
          delta: "delta ",
        },
        {
          type: "response.output_text.delta",
          item_id: "msg_1",
          output_index: 1,
          content_index: 0,
          delta: "text",
        },
        {
          type: "response.completed",
          response: {
            id: "resp_delta",
            status: "completed",
          },
        },
      ]),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await runBrowserExecPlan(
      execPlan(),
      { env: { OPENAI_API_KEY: "test-key" } },
      createHost(),
    );

    expect(result).toEqual({
      stdout: "delta text\n",
      stderr: "",
      exitCode: 0,
    });
  });

  it("uses streamed tool-call items when response.completed has empty output", async () => {
    let responseIndex = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      if (responseIndex++ > 0) {
        return new Response(JSON.stringify({ output_text: "server started" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      return sseResponse([
        {
          type: "response.output_item.added",
          output_index: 0,
          item: {
            id: "rs_1",
            type: "reasoning",
            content: [],
            summary: [],
          },
        },
        {
          type: "response.output_item.done",
          output_index: 0,
          item: {
            id: "rs_1",
            type: "reasoning",
            content: [],
            summary: [],
          },
        },
        {
          type: "response.output_item.added",
          output_index: 1,
          item: {
            id: "fc_1",
            type: "function_call",
            status: "in_progress",
            arguments: "",
            call_id: "call_streamed",
            name: "shell_command",
          },
        },
        {
          type: "response.function_call_arguments.delta",
          output_index: 1,
          item_id: "fc_1",
          delta: "{\"command\":\"pwd\",",
        },
        {
          type: "response.function_call_arguments.delta",
          output_index: 1,
          item_id: "fc_1",
          delta: "\"workdir\":\".\"}",
        },
        {
          type: "response.function_call_arguments.done",
          output_index: 1,
          item_id: "fc_1",
          arguments: "{\"command\":\"pwd\",\"workdir\":\".\"}",
        },
        {
          type: "response.output_item.done",
          output_index: 1,
          item: {
            id: "fc_1",
            type: "function_call",
            status: "completed",
            arguments: "{\"command\":\"pwd\",\"workdir\":\".\"}",
            call_id: "call_streamed",
            name: "shell_command",
          },
        },
        {
          type: "response.completed",
          response: {
            id: "resp_streamed_tool",
            status: "completed",
            output: [],
          },
        },
      ]);
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const hostCalls: unknown[] = [];
    const result = await runBrowserExecPlan(
      execPlan({ cwd: "/workspace", prompt: "start the app" }),
      { cwd: "/workspace", env: { OPENAI_API_KEY: "test-key" } },
      createHost(hostCalls, async () => ({
        stdout: "/workspace\n",
        stderr: "",
        exitCode: 0,
      })),
    );

    expect(result).toEqual({
      stdout: "server started\n",
      stderr: "",
      exitCode: 0,
    });
    expect(hostCalls).toEqual([
      {
        op: "command/exec",
        params: {
          command: ["sh", "-lc", "pwd"],
          cwd: "/workspace",
          env: {
            OPENAI_API_KEY: "test-key",
          },
          timeoutMs: undefined,
          streamStdoutStderr: false,
        },
      },
    ]);
  });

  it("routes host-backed Responses API requests through network/fetch", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ output_text: "network ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const hostCalls: unknown[] = [];
    const result = await runBrowserExecPlan(
      execPlan({ model: "gpt-network" }),
      { env: { OPENAI_API_KEY: "test-key" } },
      createHost(hostCalls, undefined, { recordNetworkFetch: true }),
    );

    expect(result).toEqual({
      stdout: "network ok\n",
      stderr: "",
      exitCode: 0,
    });
    expect(hostCalls).toHaveLength(1);
    expect(hostCalls[0]).toMatchObject({
      op: "network/fetch",
      params: {
        url: "https://api.openai.com/v1/responses",
        method: "POST",
        redirect: "follow",
        credentials: "same-origin",
        retryOnTailscaleRecovery: true,
      },
    });
    const params = (hostCalls[0] as { params: Record<string, unknown> }).params;
    expect(params.headers).toMatchObject({
      authorization: "Bearer test-key",
      "content-type": "application/json",
    });
    const body = JSON.parse(
      Buffer.from(String(params.bodyBase64), "base64").toString("utf8"),
    );
    expect(body).toMatchObject({
      model: "gpt-network",
      tool_choice: "auto",
      parallel_tool_calls: false,
      store: false,
      stream: true,
    });
  });

  it("accepts CODEX_API_KEY as the direct browser exec API key", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ output_text: "codex key ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await runBrowserExecPlan(
      execPlan(),
      {
        env: {
          CODEX_API_KEY: "codex-test-key",
        },
      },
      createHost(),
    );

    expect(result).toEqual({
      stdout: "codex key ok\n",
      stderr: "",
      exitCode: 0,
    });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init).toBeDefined();
    const headers = new Headers(init!.headers);
    expect(headers.get("Authorization")).toBe("Bearer codex-test-key");
  });

  it("services shell_command tool calls through the browser host bridge", async () => {
    const toolCall = {
      type: "function_call",
      call_id: "call_1",
      name: "shell_command",
      arguments: JSON.stringify({
        command: "echo hello",
        workdir: "subdir",
        timeout_ms: 2500,
        login: false,
      }),
    };
    let responseIndex = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      const response =
        responseIndex++ === 0
          ? { id: "resp_1", output: [toolCall] }
          : { id: "resp_2", output_text: "done" };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const hostCalls: unknown[] = [];
    const result = await runBrowserExecPlan(
      execPlan({ cwd: "/workspace", prompt: "inspect workspace" }),
      {
        cwd: "/workspace",
        env: {
          OPENAI_API_KEY: "test-key",
        },
      },
      createHost(hostCalls, async (op) => {
        if (op !== "command/exec") return {};
        return {
          stdout: "hello\n",
          stderr: "",
          exitCode: 0,
        };
      }),
    );

    expect(result).toEqual({
      stdout: "done\n",
      stderr: "",
      exitCode: 0,
    });
    expect(hostCalls).toEqual([
      {
        op: "command/exec",
        params: {
          command: ["sh", "-lc", "echo hello"],
          cwd: "/workspace/subdir",
          env: {
            OPENAI_API_KEY: "test-key",
          },
          timeoutMs: 2500,
          streamStdoutStderr: false,
        },
      },
    ]);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstBody = JSON.parse(
      String((fetchMock.mock.calls[0]?.[1] as RequestInit).body),
    );
    expect(firstBody).toMatchObject({
      tool_choice: "auto",
      parallel_tool_calls: false,
      store: false,
      stream: true,
    });
    expect(firstBody.tools).toEqual([
      expect.objectContaining({
        type: "function",
        name: "shell_command",
      }),
      expect.objectContaining({
        type: "function",
        name: "playwright_cli",
      }),
    ]);

    const secondBody = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body),
    );
    expect(secondBody).toMatchObject({
      tool_choice: "auto",
      parallel_tool_calls: false,
      store: false,
      stream: true,
    });
    expect(secondBody.input).toEqual([
      {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "inspect workspace" }],
      },
      toolCall,
      {
        type: "function_call_output",
        call_id: "call_1",
        output: expect.stringMatching(
          /^Exit code: 0\nWall time: [0-9]+(?:\.[0-9]+)? seconds\nOutput:\nhello\n?$/,
        ),
      },
    ]);
  });

  it("services playwright_cli tool calls through the browser Playwright shim", async () => {
    const toolCall = {
      type: "function_call",
      call_id: "call_playwright",
      name: "playwright_cli",
      arguments: JSON.stringify({
        command: "snapshot",
        timeout_ms: 3000,
      }),
    };
    let responseIndex = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      const response =
        responseIndex++ === 0
          ? { id: "resp_1", output: [toolCall] }
          : { id: "resp_2", output_text: "saw page" };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const hostCalls: unknown[] = [];
    const result = await runBrowserExecPlan(
      execPlan({ cwd: "/workspace", prompt: "inspect the preview" }),
      {
        cwd: "/workspace",
        env: {
          OPENAI_API_KEY: "test-key",
        },
      },
      createHost(hostCalls, async (op) => {
        if (op !== "command/exec") return {};
        return {
          stdout: '- button "Save" [ref=e1]\n',
          stderr: "",
          exitCode: 0,
        };
      }),
    );

    expect(result).toEqual({
      stdout: "saw page\n",
      stderr: "",
      exitCode: 0,
    });
    expect(hostCalls).toEqual([
      {
        op: "command/exec",
        params: {
          command: ["sh", "-lc", "playwright-cli snapshot"],
          cwd: "/workspace",
          env: {
            OPENAI_API_KEY: "test-key",
          },
          timeoutMs: 3000,
          streamStdoutStderr: false,
        },
      },
    ]);
  });

  it("prints shell tool events for --json browser exec", async () => {
    let responseIndex = 0;
    const fetchMock = vi.fn<typeof fetch>(async () => {
      const response =
        responseIndex++ === 0
          ? {
              output: [
                {
                  type: "function_call",
                  call_id: "call_json",
                  name: "shell_command",
                  arguments: JSON.stringify({ command: "pwd" }),
                },
              ],
            }
          : { output_text: "json done" };
      return new Response(JSON.stringify(response), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await runBrowserExecPlan(
      execPlan({ cwd: "/workspace", json: true, prompt: "where am I?" }),
      { cwd: "/workspace", env: { OPENAI_API_KEY: "test-key" } },
      createHost([], async () => ({
        stdout: "/workspace\n",
        stderr: "",
        exitCode: 0,
      })),
    );

    const events = result?.stdout
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events).toEqual([
      {
        type: "browser_exec.started",
        model: "gpt-5.5",
      },
      {
        type: "browser_exec.tool_call",
        name: "shell_command",
        call_id: "call_json",
        command: "pwd",
        exit_code: 0,
      },
      {
        type: "browser_exec.completed",
        output_text: "json done",
      },
    ]);
  });

  it("uses the ChatGPT Codex backend for CODEX_ACCESS_TOKEN browser exec", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      return new Response(JSON.stringify({ output_text: "chatgpt ok" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await runBrowserExecPlan(execPlan(), {
      env: {
        CODEX_ACCESS_TOKEN: "chatgpt-token",
        CODEX_CHATGPT_ACCOUNT_ID: "account-123",
        OPENAI_ORGANIZATION: "org_ignored_for_chatgpt",
      },
    });

    expect(result).toEqual({
      stdout: "chatgpt ok\n",
      stderr: "",
      exitCode: 0,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://chatgpt.com/backend-api/codex/responses",
      expect.objectContaining({
        method: "POST",
      }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init).toBeDefined();
    const headers = init!.headers as Headers;
    expect(headers.get("Authorization")).toBe("Bearer chatgpt-token");
    expect(headers.get("ChatGPT-Account-ID")).toBe("account-123");
    expect(headers.get("OpenAI-Organization")).toBeNull();
    const body = JSON.parse(String(init!.body));
    expect(body.instructions).toContain("You are Codex");
    expect(body).toMatchObject({
      tool_choice: "auto",
      parallel_tool_calls: false,
      store: false,
      stream: true,
    });
  });

  it("requires Codex auth for browser exec", async () => {
    const result = await runBrowserExecPlan(
      execPlan(),
      { env: {} },
      createHost(),
    );

    expect(result?.exitCode).toBe(1);
    expect(result?.stderr).toContain("OPENAI_API_KEY");
    expect(result?.stderr).toContain("CODEX_API_KEY");
    expect(result?.stderr).toContain("CODEX_ACCESS_TOKEN");
    expect(result?.stderr).toContain("Keychain");
  });
});

function execPlan(
  overrides: Partial<CodexCliBrowserExecPlan> = {},
): CodexCliBrowserExecPlan {
  return {
    prompt: "hello",
    model: "gpt-5.5",
    instructions: "You are Codex, based on GPT-5.",
    toolChoice: "auto",
    parallelToolCalls: false,
    store: false,
    stream: true,
    json: false,
    warnings: [],
    ...overrides,
  };
}

function sseResponse(events: unknown[]): Response {
  const body = events
    .map((event) => `data: ${JSON.stringify(event)}\n\n`)
    .join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

function createHost(
  writes: unknown[] = [],
  handler?: BrowserExecHost["request"],
  options: { recordNetworkFetch?: boolean } = {},
): BrowserExecHost {
  return {
    async request(op, params) {
      if (op === "network/fetch") {
        if (options.recordNetworkFetch) {
          writes.push({ op, params });
        }
        return runNetworkFetch(params);
      }

      writes.push({ op, params });
      return handler ? handler(op, params) : {};
    },
  };
}

async function runNetworkFetch(params: unknown): Promise<unknown> {
  if (!params || typeof params !== "object") {
    throw new Error("network/fetch params must be an object");
  }

  const record = params as Record<string, unknown>;
  const body =
    typeof record.bodyBase64 === "string"
      ? Buffer.from(record.bodyBase64, "base64")
      : undefined;
  const response = await fetch(String(record.url), {
    method: typeof record.method === "string" ? record.method : "GET",
    headers:
      record.headers && typeof record.headers === "object"
        ? (record.headers as Record<string, string>)
        : undefined,
    body,
    redirect:
      typeof record.redirect === "string"
        ? (record.redirect as RequestRedirect)
        : undefined,
    credentials:
      typeof record.credentials === "string"
        ? (record.credentials as RequestCredentials)
        : undefined,
  });

  return {
    url: response.url,
    status: response.status,
    statusText: response.statusText,
    headers: headersToRecord(response.headers),
    bodyBase64: Buffer.from(await response.arrayBuffer()).toString("base64"),
  };
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}
