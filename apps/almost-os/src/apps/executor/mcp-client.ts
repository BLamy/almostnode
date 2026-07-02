/**
 * Minimal MCP client over Streamable HTTP.
 *
 * Speaks JSON-RPC 2.0 to a single MCP endpoint URL: `initialize` →
 * `notifications/initialized` → paginated `tools/list` → `tools/call`.
 * Responses may come back as plain JSON or as an SSE stream (the transport
 * allows either) — both are handled. Auth headers are injected host-side by
 * the caller; a 401 surfaces as {@link McpAuthRequiredError} so the UI can
 * kick off OAuth discovery against the endpoint (RFC 9728).
 */

export const MCP_PROTOCOL_VERSION = "2025-06-18";

export class McpError extends Error {
  constructor(message: string, readonly code?: number, readonly data?: unknown) {
    super(message);
    this.name = "McpError";
  }
}

export class McpAuthRequiredError extends Error {
  constructor(readonly endpoint: string, readonly wwwAuthenticate?: string) {
    super(`The MCP server at ${endpoint} requires authorization (HTTP 401).`);
    this.name = "McpAuthRequiredError";
  }
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface McpToolListing {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
}

export interface McpCallResult {
  /** `structuredContent` when present, else concatenated text content. */
  data: unknown;
  isError: boolean;
}

export interface McpClientOptions {
  url: string;
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  /** Resolved fresh per request so mid-session refreshes are picked up. */
  getAuthHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
  clientInfo?: { name: string; version: string };
}

/** Extract JSON-RPC payloads from an SSE body (`data: {...}` lines). */
export function parseSseJsonRpc(body: string): JsonRpcResponse[] {
  const messages: JsonRpcResponse[] = [];
  for (const event of body.split(/\n\n/)) {
    const dataLines = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim());
    if (dataLines.length === 0) continue;
    try {
      const parsed = JSON.parse(dataLines.join("\n")) as JsonRpcResponse;
      messages.push(parsed);
    } catch {
      // Ignore non-JSON events (comments, keep-alives).
    }
  }
  return messages;
}

export class McpHttpClient {
  private nextId = 1;
  private sessionId: string | null = null;
  private protocolVersion: string = MCP_PROTOCOL_VERSION;
  private initialized: Promise<void> | null = null;
  private readonly options: McpClientOptions;

  constructor(options: McpClientOptions) {
    this.options = options;
  }

  serverSessionId(): string | null {
    return this.sessionId;
  }

  private async buildHeaders(extra?: Record<string, string>): Promise<Record<string, string>> {
    const auth = this.options.getAuthHeaders ? await this.options.getAuthHeaders() : {};
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": this.protocolVersion,
      ...auth,
      ...extra,
    };
    if (this.sessionId) headers["Mcp-Session-Id"] = this.sessionId;
    return headers;
  }

  private async post(payload: unknown): Promise<Response> {
    const response = await this.options.fetchImpl(this.options.url, {
      method: "POST",
      headers: await this.buildHeaders(),
      body: JSON.stringify(payload),
    });
    if (response.status === 401) {
      throw new McpAuthRequiredError(
        this.options.url,
        response.headers.get("www-authenticate") ?? undefined,
      );
    }
    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    return response;
  }

  private async readRpcResult(response: Response, id: number): Promise<unknown> {
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new McpError(
        `MCP endpoint returned HTTP ${response.status}${text ? ` — ${text.slice(0, 300)}` : ""}.`,
      );
    }
    const contentType = response.headers.get("content-type") ?? "";
    const text = await response.text();
    const candidates: JsonRpcResponse[] = contentType.includes("text/event-stream")
      ? parseSseJsonRpc(text)
      : [(() => {
          try {
            return JSON.parse(text) as JsonRpcResponse;
          } catch {
            throw new McpError("MCP response was not valid JSON.");
          }
        })()];
    const match = candidates.find((message) => message.id === id);
    if (!match) {
      throw new McpError("MCP response did not include a reply to the request.");
    }
    if (match.error) {
      throw new McpError(match.error.message, match.error.code, match.error.data);
    }
    return match.result;
  }

  private async request(method: string, params?: unknown): Promise<unknown> {
    const id = this.nextId++;
    const response = await this.post({ jsonrpc: "2.0", id, method, params });
    return this.readRpcResult(response, id);
  }

  private async notify(method: string, params?: unknown): Promise<void> {
    try {
      await this.post({ jsonrpc: "2.0", method, params });
    } catch (error) {
      if (error instanceof McpAuthRequiredError) throw error;
      // Some servers reject bare notifications — non-fatal.
    }
  }

  /** Run `initialize` + `notifications/initialized` once. */
  ensureInitialized(): Promise<void> {
    if (!this.initialized) {
      this.initialized = (async () => {
        const result = (await this.request("initialize", {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: this.options.clientInfo ?? {
            name: "almost-os-executor",
            version: "0.1.0",
          },
        })) as { protocolVersion?: string } | undefined;
        if (typeof result?.protocolVersion === "string") {
          this.protocolVersion = result.protocolVersion;
        }
        await this.notify("notifications/initialized");
      })().catch((error) => {
        // Allow a retry after a failed handshake (e.g. once auth is added).
        this.initialized = null;
        throw error;
      });
    }
    return this.initialized;
  }

  /** Full paginated `tools/list`. */
  async listTools(): Promise<McpToolListing[]> {
    await this.ensureInitialized();
    const tools: McpToolListing[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const result = (await this.request(
        "tools/list",
        cursor ? { cursor } : {},
      )) as { tools?: unknown[]; nextCursor?: string } | undefined;
      for (const entry of result?.tools ?? []) {
        if (typeof entry !== "object" || entry === null) continue;
        const tool = entry as Record<string, unknown>;
        if (typeof tool.name !== "string") continue;
        tools.push({
          name: tool.name,
          title: typeof tool.title === "string" ? tool.title : undefined,
          description: typeof tool.description === "string" ? tool.description : undefined,
          inputSchema: tool.inputSchema ?? (tool as { parameters?: unknown }).parameters,
          outputSchema: tool.outputSchema,
        });
      }
      cursor = typeof result?.nextCursor === "string" && result.nextCursor.length > 0
        ? result.nextCursor
        : undefined;
      if (!cursor) break;
    }
    return tools;
  }

  /** `tools/call` — returns structured content when the server provides it. */
  async callTool(name: string, args: Record<string, unknown> | undefined): Promise<McpCallResult> {
    await this.ensureInitialized();
    const result = (await this.request("tools/call", {
      name,
      arguments: args ?? {},
    })) as {
      content?: Array<{ type?: string; text?: string }>;
      structuredContent?: unknown;
      isError?: boolean;
    } | undefined;

    if (result?.structuredContent !== undefined) {
      return { data: result.structuredContent, isError: result?.isError === true };
    }
    const text = (result?.content ?? [])
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n");
    let data: unknown = text;
    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { data, isError: result?.isError === true };
  }
}
