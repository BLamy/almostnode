import { describe, expect, it, vi } from "vitest";
import { renderSchemaType, renderToolPreview } from "./schema-ts";
import {
  deriveOperationId,
  extractOpenApiTools,
  invokeOpenApiTool,
  parseOpenApiDocument,
  resolveServerUrl,
} from "./openapi-tools";
import { parseSseJsonRpc } from "./mcp-client";
import { runDeviceCodeFlow } from "./device-code";
import { sanitizeIdentifier, dedupeIdentifier, type ExecutorToolDef } from "./executor-types";

describe("schema-ts", () => {
  it("renders objects with required/optional and descriptions", () => {
    const ts = renderSchemaType({
      type: "object",
      properties: {
        name: { type: "string", description: "the name" },
        count: { type: "integer" },
      },
      required: ["name"],
    });
    expect(ts).toContain("name: string;");
    expect(ts).toContain("count?: number;");
    expect(ts).toContain("/** the name */");
  });

  it("renders enums, arrays, and nullable", () => {
    expect(renderSchemaType({ enum: ["a", "b"] })).toBe('"a" | "b"');
    expect(renderSchemaType({ type: "array", items: { type: "string" } })).toBe("string[]");
    expect(renderSchemaType({ type: "string", nullable: true })).toBe("string | null");
  });

  it("resolves $ref against a root document", () => {
    const root = { $defs: { Id: { type: "string" } } };
    const ts = renderSchemaType({ $ref: "#/$defs/Id" }, { refRoot: root });
    expect(ts).toBe("string");
  });

  it("stops on ref cycles without throwing", () => {
    const root: Record<string, unknown> = {};
    (root as { $defs?: unknown }).$defs = { Node: { $ref: "#/$defs/Node" } };
    const ts = renderSchemaType({ $ref: "#/$defs/Node" }, { refRoot: root });
    expect(ts).toBe("unknown");
  });

  it("renders a full tool preview signature", () => {
    const preview = renderToolPreview({
      address: "gh.createIssue",
      description: "Create an issue",
      inputSchema: { type: "object", properties: { title: { type: "string" } }, required: ["title"] },
      outputSchema: { type: "object", properties: { id: { type: "number" } } },
    });
    expect(preview).toContain("tools.gh.createIssue: (input:");
    expect(preview).toContain("ok: true; data:");
  });
});

describe("openapi extraction", () => {
  const doc = {
    openapi: "3.0.0",
    info: { title: "Demo", version: "1" },
    servers: [{ url: "https://api.demo.test/v1" }],
    paths: {
      "/repos/{owner}/{repo}/issues": {
        parameters: [
          { name: "owner", in: "path", required: true, schema: { type: "string" } },
          { name: "repo", in: "path", required: true, schema: { type: "string" } },
        ],
        get: {
          operationId: "listIssues",
          summary: "List issues",
          parameters: [
            { name: "state", in: "query", schema: { type: "string", enum: ["open", "closed"] } },
          ],
          responses: { "200": { description: "ok", content: { "application/json": { schema: { type: "array" } } } } },
        },
        post: {
          summary: "Create issue",
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object", properties: { title: { type: "string" } } } } },
          },
          responses: { "201": { description: "created" } },
        },
      },
    },
  };

  it("parses and rejects swagger 2.x", () => {
    expect(() => parseOpenApiDocument(JSON.stringify({ swagger: "2.0" }))).toThrow(/Swagger 2/);
    expect(parseOpenApiDocument(JSON.stringify(doc)).openapi).toBe("3.0.0");
  });

  it("derives operationIds when missing", () => {
    expect(deriveOperationId("POST", "/repos/{owner}/{repo}/issues")).toBe(
      "postReposByOwnerByRepoIssues",
    );
  });

  it("extracts one tool per path×method with folded params", () => {
    const tools = extractOpenApiTools(doc, { sourceId: "gh", specUrl: "https://api.demo.test/v1/openapi.json" });
    expect(tools.map((t) => t.name).sort()).toEqual(["listIssues", "postReposByOwnerByRepoIssues"]);
    const list = tools.find((t) => t.name === "listIssues")!;
    expect(list.http?.method).toBe("GET");
    expect(list.http?.paramLocations).toMatchObject({ owner: "path", repo: "path", state: "query" });
    const create = tools.find((t) => t.name === "postReposByOwnerByRepoIssues")!;
    expect(create.http?.hasBody).toBe(true);
    expect((create.inputSchema as { required: string[] }).required).toContain("body");
  });

  it("resolves the server url with override precedence", () => {
    expect(resolveServerUrl(doc, { sourceId: "x", serverUrl: "https://override.test/" })).toBe(
      "https://override.test",
    );
    expect(resolveServerUrl(doc, { sourceId: "x" })).toBe("https://api.demo.test/v1");
  });

  it("invokes a tool: fills path params, query, and body", async () => {
    const tools = extractOpenApiTools(doc, { sourceId: "gh" });
    const create = tools.find((t) => t.name === "postReposByOwnerByRepoIssues")!;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("https://api.demo.test/v1/repos/acme/widgets/issues");
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({ title: "Bug" });
      return new Response(JSON.stringify({ id: 7 }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    });
    const result = await invokeOpenApiTool(
      create,
      { owner: "acme", repo: "widgets", body: { title: "Bug" } },
      { fetchImpl, authHeaders: { Authorization: "Bearer x" } },
    );
    expect(result).toEqual({ ok: true, data: { id: 7 }, http: { status: 201 } });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("returns a structured error on missing path params", async () => {
    const tools = extractOpenApiTools(doc, { sourceId: "gh" });
    const list = tools.find((t) => t.name === "listIssues")!;
    const result = await invokeOpenApiTool(list, { owner: "acme" }, {
      fetchImpl: async () => new Response("{}"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalid_tool_arguments");
  });

  it("maps non-2xx to a structured http error", async () => {
    const tools = extractOpenApiTools(doc, { sourceId: "gh" });
    const list = tools.find((t) => t.name === "listIssues")!;
    const result = await invokeOpenApiTool(list, { owner: "a", repo: "b" }, {
      fetchImpl: async () => new Response("nope", { status: 503 }),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("http_503");
      expect(result.error.retryable).toBe(true);
    }
  });
});

describe("mcp SSE parsing", () => {
  it("extracts JSON-RPC payloads from SSE frames", () => {
    const body = "event: message\ndata: {\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\n\n: keep-alive\n\n";
    const messages = parseSseJsonRpc(body);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ id: 1, result: { ok: true } });
  });
});

describe("identifier helpers", () => {
  it("sanitizes and dedupes", () => {
    expect(sanitizeIdentifier("Get Repo!")).toBe("Get_Repo");
    expect(sanitizeIdentifier("123abc")).toBe("_123abc");
    const taken = new Set(["tool"]);
    expect(dedupeIdentifier("tool", taken)).toBe("tool_2");
  });
});

describe("device code flow", () => {
  it("polls through authorization_pending then returns the token", async () => {
    const responses = [
      new Response(
        JSON.stringify({
          device_code: "dev",
          user_code: "WXYZ-1234",
          verification_uri: "https://verify.test",
          expires_in: 900,
          interval: 1,
        }),
        { status: 200 },
      ),
      new Response(JSON.stringify({ error: "authorization_pending" }), { status: 400 }),
      new Response(JSON.stringify({ error: "slow_down" }), { status: 400 }),
      new Response(JSON.stringify({ access_token: "tok", token_type: "Bearer" }), { status: 200 }),
    ];
    let call = 0;
    const fetchImpl = vi.fn(async () => responses[call++]!);
    const onPrompt = vi.fn();
    const token = await runDeviceCodeFlow({
      deviceAuthorizationEndpoint: "https://as.test/device",
      tokenEndpoint: "https://as.test/token",
      clientId: "client",
      fetchImpl,
      onPrompt,
      sleep: async () => undefined,
      now: () => 1_000,
    });
    expect(token.access_token).toBe("tok");
    expect(onPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ userCode: "WXYZ-1234", verificationUri: "https://verify.test" }),
    );
    // device request + 3 token polls
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("throws on access_denied", async () => {
    const responses = [
      new Response(
        JSON.stringify({ device_code: "dev", user_code: "AB", verification_uri: "https://v.test", expires_in: 900 }),
        { status: 200 },
      ),
      new Response(JSON.stringify({ error: "access_denied" }), { status: 400 }),
    ];
    let call = 0;
    await expect(
      runDeviceCodeFlow({
        deviceAuthorizationEndpoint: "https://as.test/device",
        tokenEndpoint: "https://as.test/token",
        clientId: "client",
        fetchImpl: async () => responses[call++]!,
        onPrompt: () => undefined,
        sleep: async () => undefined,
        now: () => 1_000,
      }),
    ).rejects.toThrow(/declined/);
  });
});
