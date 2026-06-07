import type { CodexHostOperation } from "./host-bridge";
import type {
  CodexCliBrowserExecPlan,
  CodexCliRunOptions,
  CodexCliRunResult,
} from "./types";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
const DEFAULT_CHATGPT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const MAX_BROWSER_TOOL_ROUNDS = 8;

export interface BrowserExecHost {
  request(op: CodexHostOperation, params?: unknown): Promise<unknown>;
}

interface ParsedBrowserExec extends CodexCliBrowserExecPlan {}

interface BrowserExecRun {
  outputText: string;
  toolEvents: BrowserExecToolEvent[];
}

interface BrowserExecToolEvent {
  type: "browser_exec.tool_call";
  name: string;
  call_id: string;
  command: string;
  exit_code: number;
}

interface BrowserResponsesToolCall {
  callId: string;
  name: string;
  inputItem: Record<string, unknown>;
  request: BrowserToolRequest;
}

type BrowserToolRequest =
  | {
      type: "shell_command";
      command: string;
      cwd?: string;
      timeoutMs?: number;
    }
  | {
      type: "playwright_cli";
      command: string;
      timeoutMs?: number;
    }
  | {
      type: "local_shell_call";
      command: string[];
    };

interface BrowserCommandExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface BrowserExecCredential {
  mode: "api-key" | "chatgpt";
  token: string;
  baseUrl: string;
  accountId?: string;
  isFedrampAccount: boolean;
}

export async function runBrowserExecPlan(
  command: CodexCliBrowserExecPlan,
  options: CodexCliRunOptions,
  host?: BrowserExecHost,
): Promise<CodexCliRunResult> {
  const effectiveOptions = {
    ...options,
    cwd: command.cwd ?? options.cwd,
  };

  const credential = browserExecCredential(effectiveOptions.env);
  if (!credential) {
    return {
      stdout: "",
      stderr:
        "codex exec in the browser requires Codex auth. Connect Codex in Keychain or set OPENAI_API_KEY, CODEX_API_KEY, or CODEX_ACCESS_TOKEN in the browser shell environment.\n",
      exitCode: 1,
    };
  }

  const execRun = await runBrowserResponsesRequest(
    command,
    effectiveOptions,
    credential,
    host,
  );
  if (command.outputLastMessagePath) {
    if (!host) {
      return {
        stdout: "",
        stderr:
          "codex exec --output-last-message requires the browser host filesystem bridge.\n",
        exitCode: 78,
      };
    }

    await host.request("fs/writeFile", {
      path: resolveBrowserPath(
        command.outputLastMessagePath,
        effectiveOptions.cwd ?? "/",
      ),
      content: execRun.outputText,
      encoding: "utf8",
    });
  }

  return {
    stdout: command.json
      ? renderBrowserExecJson(command, execRun)
      : ensureTrailingNewline(execRun.outputText),
    stderr: command.warnings.map((warning) => `${warning}\n`).join(""),
    exitCode: 0,
  };
}

async function runBrowserResponsesRequest(
  command: ParsedBrowserExec,
  options: CodexCliRunOptions,
  credential: BrowserExecCredential,
  host?: BrowserExecHost,
): Promise<BrowserExecRun> {
  const mockResponse = options.env?.CODEX_BROWSER_EXEC_MOCK_RESPONSE;
  if (mockResponse != null) return { outputText: mockResponse, toolEvents: [] };

  const toolsEnabled =
    Boolean(host) && options.env?.CODEX_BROWSER_EXEC_ENABLE_TOOLS !== "0";
  const input: unknown[] = [
    {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: command.prompt }],
    },
  ];
  const toolEvents: BrowserExecToolEvent[] = [];
  let toolRounds = 0;

  while (true) {
    const payload = await fetchBrowserResponses(command, options, credential, {
      input: input.length === 1 && !toolsEnabled ? command.prompt : input,
      toolsEnabled,
    }, host);

    const toolCalls = toolsEnabled ? extractResponsesToolCalls(payload) : [];
    if (toolCalls.length === 0) {
      return {
        outputText: extractResponsesOutputText(payload),
        toolEvents,
      };
    }

    if (!host) {
      throw new Error(
        "OpenAI Responses API requested browser tools, but no host bridge is attached.",
      );
    }

    if (toolRounds >= MAX_BROWSER_TOOL_ROUNDS) {
      throw new Error(
        `OpenAI Responses API requested more than ${MAX_BROWSER_TOOL_ROUNDS} browser tool rounds.`,
      );
    }

    for (const toolCall of toolCalls) {
      const toolResult = await runBrowserToolCall(toolCall, options, host);
      input.push(toolCall.inputItem, {
        type: "function_call_output",
        call_id: toolCall.callId,
        output: toolResult.output,
      });
      toolEvents.push({
        type: "browser_exec.tool_call",
        name: toolCall.name,
        call_id: toolCall.callId,
        command: toolResult.command,
        exit_code: toolResult.exitCode,
      });
    }
    toolRounds += 1;
  }
}

async function fetchBrowserResponses(
  command: ParsedBrowserExec,
  options: CodexCliRunOptions,
  credential: BrowserExecCredential,
  request: { input: unknown; toolsEnabled: boolean },
  host?: BrowserExecHost,
): Promise<unknown> {
  const body: Record<string, unknown> = {
    model: command.model,
    instructions: command.instructions,
    tool_choice: command.toolChoice,
    parallel_tool_calls: command.parallelToolCalls,
    store: command.store,
    stream: command.stream,
    input: request.input,
  };
  if (request.toolsEnabled) {
    body.tools = browserHostTools();
  }

  const response = await fetchBrowserResponsesTransport(browserResponsesUrl(credential), {
    method: "POST",
    headers: browserResponsesHeaders(credential, options.env),
    body: JSON.stringify(body),
  }, host);

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    const payload = contentType.includes("application/json")
      ? await response.json()
      : await response.text();
    const message =
      typeof payload === "string"
        ? payload
        : extractOpenAiErrorMessage(payload);
    throw new Error(
      `OpenAI Responses API request failed with HTTP ${response.status}: ${message}`,
    );
  }

  return readBrowserResponsesPayload(response);
}

async function fetchBrowserResponsesTransport(
  url: string,
  init: RequestInit,
  host?: BrowserExecHost,
): Promise<Response> {
  if (!host) {
    return fetch(url, init);
  }

  try {
    const result = await host.request(
      "network/fetch",
      await serializeBrowserFetchRequest(url, init),
    );
    return responseFromBrowserNetworkFetch(result);
  } catch (error) {
    if (isUnsupportedNetworkFetchError(error)) {
      return fetch(url, init);
    }
    throw error;
  }
}

async function serializeBrowserFetchRequest(
  url: string,
  init: RequestInit,
): Promise<Record<string, unknown>> {
  return {
    url,
    method: init.method ?? "GET",
    headers: headersToStringRecord(new Headers(init.headers)),
    bodyBase64: await requestBodyToBase64(init.body),
    redirect: init.redirect ?? "follow",
    credentials: init.credentials ?? "same-origin",
    retryOnTailscaleRecovery: true,
  };
}

function responseFromBrowserNetworkFetch(value: unknown): Response {
  if (!value || typeof value !== "object") {
    throw new Error("network/fetch host result must be an object.");
  }

  const record = value as Record<string, unknown>;
  if (
    typeof record.status !== "number" ||
    typeof record.statusText !== "string" ||
    typeof record.bodyBase64 !== "string"
  ) {
    throw new Error("network/fetch host result must include status, statusText, and bodyBase64.");
  }

  const response = new Response(toArrayBuffer(base64ToBytes(record.bodyBase64)), {
    status: record.status,
    statusText: record.statusText,
    headers: normalizeHeaderRecord(record.headers),
  });

  if (typeof record.url === "string") {
    try {
      Object.defineProperty(response, "url", {
        configurable: true,
        value: record.url,
      });
    } catch {
      // Some Response implementations expose a non-configurable url.
    }
  }

  return response;
}

function isUnsupportedNetworkFetchError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("does not expose network/fetch")
  );
}

function headersToStringRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function normalizeHeaderRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const record: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string") {
      record[key] = entry;
    }
  }
  return record;
}

async function requestBodyToBase64(
  body: BodyInit | null | undefined,
): Promise<string | undefined> {
  if (body == null) return undefined;
  if (typeof body === "string") {
    return bytesToBase64(new TextEncoder().encode(body));
  }
  if (body instanceof URLSearchParams) {
    return bytesToBase64(new TextEncoder().encode(body.toString()));
  }
  if (body instanceof Blob) {
    return bytesToBase64(new Uint8Array(await body.arrayBuffer()));
  }
  if (body instanceof ArrayBuffer) {
    return bytesToBase64(new Uint8Array(body));
  }
  if (ArrayBuffer.isView(body)) {
    return bytesToBase64(
      new Uint8Array(body.buffer, body.byteOffset, body.byteLength),
    );
  }
  throw new Error("network/fetch request body type is not supported.");
}

function bytesToBase64(bytes: Uint8Array): string {
  const bufferCtor = (
    globalThis as typeof globalThis & { Buffer?: typeof Buffer }
  ).Buffer;
  if (bufferCtor) return bufferCtor.from(bytes).toString("base64");

  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const bufferCtor = (
    globalThis as typeof globalThis & { Buffer?: typeof Buffer }
  ).Buffer;
  if (bufferCtor) return new Uint8Array(bufferCtor.from(value, "base64"));

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function readBrowserResponsesPayload(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }
  if (!response.body) {
    throw new Error("OpenAI Responses API stream response did not include a body.");
  }
  return collectBrowserResponsesStream(response.body);
}

async function collectBrowserResponsesStream(
  body: ReadableStream<Uint8Array>,
): Promise<unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const outputItemsByIndex = new Map<number, Record<string, unknown>>();
  const unindexedOutputItems: Record<string, unknown>[] = [];
  const outputText: string[] = [];
  let finalResponse: unknown;
  let buffer = "";
  let dataLines: string[] = [];

  const outputItems = () => [
    ...[...outputItemsByIndex.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, item]) => item),
    ...unindexedOutputItems,
  ];

  const dispatch = () => {
    if (dataLines.length === 0) return;
    const data = dataLines.join("\n");
    dataLines = [];
    if (!data || data === "[DONE]") return;

    const payload = JSON.parse(data) as unknown;
    if (!payload || typeof payload !== "object") return;
    const record = payload as Record<string, unknown>;
    const type = record.type;

    if (type === "response.completed" && record.response) {
      finalResponse = record.response;
      return;
    }
    if (type === "response.failed" || type === "response.incomplete") {
      throw new Error(extractOpenAiErrorMessage(record.response ?? record));
    }
    if (type === "error") {
      throw new Error(extractOpenAiErrorMessage(record));
    }
    if (type === "response.output_item.added" && record.item) {
      setStreamedOutputItem(record, false);
      return;
    }
    if (type === "response.output_item.done" && record.item) {
      setStreamedOutputItem(record, true);
      return;
    }
    if (
      type === "response.function_call_arguments.delta" &&
      typeof record.delta === "string"
    ) {
      const item = streamedOutputItemFor(record);
      if (item) {
        item.arguments = `${typeof item.arguments === "string" ? item.arguments : ""}${record.delta}`;
      }
      return;
    }
    if (
      type === "response.function_call_arguments.done" &&
      typeof record.arguments === "string"
    ) {
      const item = streamedOutputItemFor(record);
      if (item) {
        item.arguments = record.arguments;
      }
      return;
    }
    if (type === "response.output_text.delta" && typeof record.delta === "string") {
      outputText.push(record.delta);
    }
  };

  const setStreamedOutputItem = (
    record: Record<string, unknown>,
    replaceExisting: boolean,
  ) => {
    const item = cloneStreamedOutputItem(record.item);
    if (!item) return;

    const outputIndex = record.output_index;
    if (typeof outputIndex === "number" && Number.isInteger(outputIndex)) {
      const existing = outputItemsByIndex.get(outputIndex);
      outputItemsByIndex.set(outputIndex, {
        ...(replaceExisting ? {} : existing),
        ...item,
      });
      return;
    }

    unindexedOutputItems.push(item);
  };

  const streamedOutputItemFor = (
    record: Record<string, unknown>,
  ): Record<string, unknown> | undefined => {
    const outputIndex = record.output_index;
    if (typeof outputIndex === "number" && Number.isInteger(outputIndex)) {
      let item = outputItemsByIndex.get(outputIndex);
      if (!item) {
        item = { type: "function_call", arguments: "" };
        outputItemsByIndex.set(outputIndex, item);
      }
      return item;
    }

    const itemId = record.item_id;
    if (typeof itemId === "string") {
      return (
        [...outputItemsByIndex.values(), ...unindexedOutputItems].find(
          (item) => item.id === itemId,
        ) ?? undefined
      );
    }

    return undefined;
  };

  const processLine = (rawLine: string) => {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
    if (line === "") {
      dispatch();
      return;
    }
    if (!line.startsWith("data:")) return;
    const data = line.slice(5);
    dataLines.push(data.startsWith(" ") ? data.slice(1) : data);
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex >= 0) {
      processLine(buffer.slice(0, newlineIndex));
      buffer = buffer.slice(newlineIndex + 1);
      newlineIndex = buffer.indexOf("\n");
    }
  }

  buffer += decoder.decode();
  if (buffer) processLine(buffer);
  dispatch();

  const streamedOutputItems = outputItems();
  if (finalResponse) {
    return responseWithStreamFallbackText(
      finalResponse,
      streamedOutputItems,
      outputText.join(""),
    );
  }
  if (streamedOutputItems.length > 0) {
    return {
      output: streamedOutputItems,
      output_text: outputText.join(""),
    };
  }
  if (outputText.length > 0) {
    return { output_text: outputText.join("") };
  }

  throw new Error("OpenAI Responses API stream ended without response.completed.");
}

function responseWithStreamFallbackText(
  response: unknown,
  outputItems: unknown[],
  outputText: string,
): unknown {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return outputText ? { output_text: outputText } : response;
  }

  const record = response as Record<string, unknown>;
  if (
    typeof record.output_text === "string" ||
    textFromOutputItems(record.output)
  ) {
    return response;
  }
  const shouldUseStreamedOutput =
    outputItems.length > 0 &&
    (!Array.isArray(record.output) || record.output.length === 0);

  return {
    ...record,
    ...(shouldUseStreamedOutput ? { output: outputItems } : {}),
    ...(outputText ? { output_text: outputText } : {}),
  };
}

function cloneStreamedOutputItem(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return { ...(value as Record<string, unknown>) };
}

function browserHostTools(): Record<string, unknown>[] {
  return [browserShellCommandTool(), browserPlaywrightCliTool()];
}

function browserShellCommandTool(): Record<string, unknown> {
  return {
    type: "function",
    name: "shell_command",
    description:
      "Runs a shell command and returns its output.\n- Always set the `workdir` param when using the shell_command function. Do not use `cd` unless absolutely necessary.\n- Use the `playwright_cli` tool for browser preview interactions instead of shelling out to playwright-cli manually.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Shell script to run in the user's default shell.",
        },
        workdir: {
          type: "string",
          description:
            "Working directory for the command. Defaults to the turn cwd.",
        },
        timeout_ms: {
          type: "number",
          description: "Maximum command runtime. Defaults to 10000 ms.",
        },
        login: {
          type: "boolean",
          description:
            "True runs with login shell semantics; false disables them. Defaults to true.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  };
}

function browserPlaywrightCliTool(): Record<string, unknown> {
  return {
    type: "function",
    name: "playwright_cli",
    description:
      "Interact with the browser preview iframe through almostnode's Playwright shim. Commands include: open <url>, snapshot, click <ref>, fill <ref> <text>, type <text>, press <key>, hover <ref>, eval <expression>, console, network, resize <width> <height>, screenshot [path]. Run snapshot first to get element refs before click/fill/hover.",
    strict: false,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description:
            "Arguments to pass after `playwright-cli`, for example `snapshot`, `open http://localhost:3000`, or `click e3`.",
        },
        timeout_ms: {
          type: "number",
          description: "Maximum command runtime. Defaults to 10000 ms.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  };
}

function extractResponsesToolCalls(
  payload: unknown,
): BrowserResponsesToolCall[] {
  if (!payload || typeof payload !== "object") return [];
  const output = (payload as Record<string, unknown>).output;
  if (!Array.isArray(output)) return [];

  const toolCalls: BrowserResponsesToolCall[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const type = record.type;
    const callId =
      typeof record.call_id === "string" ? record.call_id : undefined;
    if (!callId) continue;

    if (type === "function_call" && record.name === "shell_command") {
      const request = parseShellCommandToolCall(record.arguments);
      toolCalls.push({
        callId,
        name: "shell_command",
        inputItem: record,
        request,
      });
      continue;
    }

    if (type === "function_call" && record.name === "playwright_cli") {
      const request = parsePlaywrightCliToolCall(record.arguments);
      toolCalls.push({
        callId,
        name: "playwright_cli",
        inputItem: record,
        request,
      });
      continue;
    }

    if (type === "local_shell_call") {
      const request = parseLocalShellCall(record);
      if (!request) continue;
      toolCalls.push({
        callId,
        name: "local_shell_call",
        inputItem: record,
        request,
      });
    }
  }

  return toolCalls;
}

function parsePlaywrightCliToolCall(
  argumentsValue: unknown,
): BrowserToolRequest {
  if (typeof argumentsValue !== "string") {
    throw new Error(
      "playwright_cli tool call arguments must be a JSON string.",
    );
  }

  const parsed = JSON.parse(argumentsValue) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "playwright_cli tool call arguments must be a JSON object.",
    );
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.command !== "string" || !record.command.trim()) {
    throw new Error("playwright_cli tool call requires a non-empty command.");
  }

  return {
    type: "playwright_cli",
    command: record.command,
    timeoutMs: optionalPositiveNumber(record.timeout_ms ?? record.timeout),
  };
}

function parseShellCommandToolCall(
  argumentsValue: unknown,
): BrowserToolRequest {
  if (typeof argumentsValue !== "string") {
    throw new Error("shell_command tool call arguments must be a JSON string.");
  }

  const parsed = JSON.parse(argumentsValue) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("shell_command tool call arguments must be a JSON object.");
  }

  const record = parsed as Record<string, unknown>;
  if (typeof record.command !== "string" || !record.command.trim()) {
    throw new Error("shell_command tool call requires a non-empty command.");
  }

  return {
    type: "shell_command",
    command: record.command,
    cwd: typeof record.workdir === "string" ? record.workdir : undefined,
    timeoutMs: optionalPositiveNumber(record.timeout_ms ?? record.timeout),
  };
}

function parseLocalShellCall(
  record: Record<string, unknown>,
): BrowserToolRequest | null {
  const action = record.action;
  if (!action || typeof action !== "object") return null;
  const actionRecord = action as Record<string, unknown>;
  if (actionRecord.type !== "exec") return null;
  const command = actionRecord.command;
  if (
    !Array.isArray(command) ||
    command.some((entry) => typeof entry !== "string")
  ) {
    return null;
  }

  return {
    type: "local_shell_call",
    command: command as string[],
  };
}

async function runBrowserToolCall(
  toolCall: BrowserResponsesToolCall,
  options: CodexCliRunOptions,
  host: BrowserExecHost,
): Promise<{ command: string; exitCode: number; output: string }> {
  const startedAt = Date.now();
  const params = browserToolCallExecParams(toolCall.request, options);
  const result = normalizeCommandExecResult(
    await host.request("command/exec", params),
  );
  const durationSeconds = (Date.now() - startedAt) / 1000;

  return {
    command: commandForDisplay(toolCall.request),
    exitCode: result.exitCode,
    output: formatBrowserShellOutput(result, durationSeconds),
  };
}

function browserToolCallExecParams(
  request: BrowserToolRequest,
  options: CodexCliRunOptions,
): Record<string, unknown> {
  if (request.type === "playwright_cli") {
    return {
      command: ["sh", "-lc", playwrightShimCommand(request.command)],
      cwd: options.cwd,
      env: options.env,
      timeoutMs: request.timeoutMs,
      streamStdoutStderr: false,
    };
  }

  if (request.type === "local_shell_call") {
    return {
      command: request.command,
      cwd: options.cwd,
      env: options.env,
      streamStdoutStderr: false,
    };
  }

  return {
    command: ["sh", "-lc", request.command],
    cwd: request.cwd
      ? resolveBrowserPath(request.cwd, options.cwd ?? "/")
      : options.cwd,
    env: options.env,
    timeoutMs: request.timeoutMs,
    streamStdoutStderr: false,
  };
}

function playwrightShimCommand(command: string): string {
  const trimmed = command.trim();
  return trimmed ? `playwright-cli ${trimmed}` : "playwright-cli";
}

function normalizeCommandExecResult(value: unknown): BrowserCommandExecResult {
  if (!value || typeof value !== "object") {
    throw new Error("browser command/exec host result must be an object.");
  }

  const record = value as Record<string, unknown>;
  return {
    stdout: typeof record.stdout === "string" ? record.stdout : "",
    stderr: typeof record.stderr === "string" ? record.stderr : "",
    exitCode: typeof record.exitCode === "number" ? record.exitCode : 1,
  };
}

function formatBrowserShellOutput(
  result: BrowserCommandExecResult,
  durationSeconds: number,
): string {
  return [
    `Exit code: ${result.exitCode}`,
    `Wall time: ${formatBrowserDuration(durationSeconds)} seconds`,
    "Output:",
    `${result.stdout}${result.stderr}`,
  ].join("\n");
}

function formatBrowserDuration(durationSeconds: number): string {
  const rounded = Math.round(durationSeconds * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function commandForDisplay(request: BrowserToolRequest): string {
  if (request.type === "local_shell_call") {
    return request.command.join(" ");
  }
  if (request.type === "playwright_cli") {
    return `playwright-cli ${request.command}`;
  }
  return request.command;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }
  return value;
}

function browserResponsesHeaders(
  credential: BrowserExecCredential,
  env: Record<string, string> | undefined,
): Headers {
  const headers = new Headers({
    Authorization: `Bearer ${credential.token}`,
    "Content-Type": "application/json",
  });

  if (credential.mode === "chatgpt") {
    if (credential.accountId) {
      headers.set("ChatGPT-Account-ID", credential.accountId);
    }
    if (credential.isFedrampAccount) {
      headers.set("X-OpenAI-Fedramp", "true");
    }
    return headers;
  }

  if (env?.OPENAI_ORGANIZATION) {
    headers.set("OpenAI-Organization", env.OPENAI_ORGANIZATION);
  }
  if (env?.OPENAI_PROJECT) {
    headers.set("OpenAI-Project", env.OPENAI_PROJECT);
  }

  return headers;
}

function browserExecCredential(
  env: Record<string, string> | undefined,
): BrowserExecCredential | null {
  const apiKey =
    envValue(env, "OPENAI_API_KEY") ?? envValue(env, "CODEX_API_KEY");
  if (apiKey) {
    return {
      mode: "api-key",
      token: apiKey,
      baseUrl:
        envValue(env, "CODEX_OPENAI_BASE_URL") ??
        envValue(env, "OPENAI_BASE_URL") ??
        DEFAULT_OPENAI_BASE_URL,
      isFedrampAccount: false,
    };
  }

  const accessToken = envValue(env, "CODEX_ACCESS_TOKEN");
  if (!accessToken) return null;

  const tokenClaims = parseJwtClaims(accessToken);
  return {
    mode: "chatgpt",
    token: accessToken,
    baseUrl:
      envValue(env, "CODEX_CHATGPT_CODEX_BASE_URL") ??
      envValue(env, "CHATGPT_CODEX_BASE_URL") ??
      envValue(env, "CODEX_CHATGPT_BASE_URL") ??
      envValue(env, "CHATGPT_BASE_URL") ??
      DEFAULT_CHATGPT_CODEX_BASE_URL,
    accountId:
      envValue(env, "CODEX_CHATGPT_ACCOUNT_ID") ??
      envValue(env, "CHATGPT_ACCOUNT_ID") ??
      envValue(env, "CODEX_ACCOUNT_ID") ??
      jwtStringClaim(tokenClaims, "account_id") ??
      jwtStringClaim(tokenClaims, "chatgpt_account_id") ??
      jwtStringClaim(tokenClaims, [
        "https://api.openai.com/auth",
        "chatgpt_account_id",
      ]),
    isFedrampAccount:
      envBoolean(env, "CODEX_CHATGPT_ACCOUNT_IS_FEDRAMP") ??
      envBoolean(env, "CHATGPT_ACCOUNT_IS_FEDRAMP") ??
      jwtBooleanClaim(tokenClaims, "chatgpt_account_is_fedramp") ??
      jwtBooleanClaim(tokenClaims, [
        "https://api.openai.com/auth",
        "chatgpt_account_is_fedramp",
      ]) ??
      false,
  };
}

function browserResponsesUrl(credential: BrowserExecCredential): string {
  const baseUrl =
    credential.mode === "chatgpt"
      ? normalizeChatGptCodexBaseUrl(credential.baseUrl)
      : normalizeOpenAiBaseUrl(credential.baseUrl);
  return `${baseUrl}/responses`;
}

function normalizeOpenAiBaseUrl(rawBaseUrl: string): string {
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  return baseUrl.endsWith("/v1") ? baseUrl : `${baseUrl}/v1`;
}

function normalizeChatGptCodexBaseUrl(rawBaseUrl: string): string {
  const baseUrl = rawBaseUrl.replace(/\/+$/, "");
  if (baseUrl.endsWith("/backend-api/codex")) return baseUrl;
  if (baseUrl.endsWith("/backend-api")) return `${baseUrl}/codex`;

  try {
    const parsed = new URL(baseUrl);
    if (parsed.pathname === "" || parsed.pathname === "/") {
      parsed.pathname = "/backend-api/codex";
      return parsed.toString().replace(/\/+$/, "");
    }
  } catch {
    // Fall through and treat the configured value as the Codex backend root.
  }

  return baseUrl;
}

function envValue(
  env: Record<string, string> | undefined,
  name: string,
): string | undefined {
  const value = env?.[name]?.trim();
  return value ? value : undefined;
}

function envBoolean(
  env: Record<string, string> | undefined,
  name: string,
): boolean | undefined {
  const value = envValue(env, name);
  if (!value) return undefined;
  if (/^(1|true|yes)$/i.test(value)) return true;
  if (/^(0|false|no)$/i.test(value)) return false;
  return undefined;
}

function parseJwtClaims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length < 2 || !parts[1]) return null;

  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function jwtStringClaim(
  claims: Record<string, unknown> | null,
  path: string | readonly string[],
): string | undefined {
  const value = jwtClaim(claims, path);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function jwtBooleanClaim(
  claims: Record<string, unknown> | null,
  path: string | readonly string[],
): boolean | undefined {
  const value = jwtClaim(claims, path);
  return typeof value === "boolean" ? value : undefined;
}

function jwtClaim(
  claims: Record<string, unknown> | null,
  path: string | readonly string[],
): unknown {
  if (!claims) return undefined;
  const parts = typeof path === "string" ? [path] : path;
  let current: unknown = claims;
  for (const part of parts) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function renderBrowserExecJson(
  command: ParsedBrowserExec,
  execRun: BrowserExecRun,
): string {
  return [
    {
      type: "browser_exec.started",
      model: command.model,
    },
    ...execRun.toolEvents,
    {
      type: "browser_exec.completed",
      output_text: execRun.outputText,
    },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n")
    .concat("\n");
}

function extractResponsesOutputText(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    if (typeof record.output_text === "string") return record.output_text;

    const fromOutput = textFromOutputItems(record.output);
    if (fromOutput) return fromOutput;
  }

  throw new Error("OpenAI Responses API response did not include output text.");
}

function textFromOutputItems(output: unknown): string | null {
  if (!Array.isArray(output)) return null;

  const text: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const content = record.content;
    if (!Array.isArray(content)) continue;

    for (const entry of content) {
      if (!entry || typeof entry !== "object") continue;
      const contentRecord = entry as Record<string, unknown>;
      if (typeof contentRecord.text === "string") {
        text.push(contentRecord.text);
      }
    }
  }

  return text.length > 0 ? text.join("") : null;
}

function extractOpenAiErrorMessage(payload: unknown): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === "object") {
      const message = (error as Record<string, unknown>).message;
      if (typeof message === "string") return message;
    }
    const message = record.message;
    if (typeof message === "string") return message;
  }

  return JSON.stringify(payload);
}

function resolveBrowserPath(path: string, cwd: string): string {
  const base = cwd.startsWith("/") ? cwd : `/${cwd}`;
  const normalizedBase = base.replace(/\/+$/, "") || "/";
  if (path.startsWith("/")) return path;
  if (path === "." || path === "./") return normalizedBase;
  return `${normalizedBase}/${path.replace(/^\.\//, "")}`;
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
