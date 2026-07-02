/**
 * OpenAPI 3.x source plugin: spec document → normalized tool manifest →
 * HTTP invocation.
 *
 * Mirrors executor's `plugin-openapi`: every path × method becomes one tool
 * whose single object argument folds path/query/header parameters together
 * with an optional `body` property. Invocation rebuilds the HTTP request
 * host-side (auth headers are attached by the caller — never inside the
 * sandbox).
 */

import { parse as parseYaml } from "yaml";
import {
  dedupeIdentifier,
  sanitizeIdentifier,
  type ExecutorHttpBinding,
  type ExecutorToolDef,
  type ExecutorToolResult,
  type OpenApiParamLocation,
} from "./executor-types";

const HTTP_METHODS = ["get", "put", "post", "delete", "patch", "head", "options"] as const;

interface OpenApiParameter {
  name?: string;
  in?: string;
  required?: boolean;
  description?: string;
  schema?: unknown;
  $ref?: string;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: OpenApiParameter[];
  requestBody?: {
    required?: boolean;
    description?: string;
    content?: Record<string, { schema?: unknown }>;
    $ref?: string;
  };
  responses?: Record<string, { description?: string; content?: Record<string, { schema?: unknown }> }>;
  deprecated?: boolean;
}

export interface OpenApiDocument {
  openapi?: string;
  swagger?: string;
  info?: { title?: string; version?: string };
  servers?: Array<{ url?: string }>;
  paths?: Record<string, Record<string, unknown>>;
  components?: Record<string, unknown>;
}

export class OpenApiParseError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "OpenApiParseError";
  }
}

/** Parse an OpenAPI document from JSON or YAML text. Requires OpenAPI 3.x. */
export function parseOpenApiDocument(text: string): OpenApiDocument {
  let doc: unknown;
  const trimmed = text.trim();
  try {
    doc = trimmed.startsWith("{") ? JSON.parse(trimmed) : parseYaml(trimmed);
  } catch (cause) {
    throw new OpenApiParseError("Could not parse the document as JSON or YAML.", cause);
  }
  if (typeof doc !== "object" || doc === null) {
    throw new OpenApiParseError("The document is not an object.");
  }
  const parsed = doc as OpenApiDocument;
  if (parsed.swagger) {
    throw new OpenApiParseError(
      "Swagger 2.x specs are not supported — convert to OpenAPI 3.x first.",
    );
  }
  if (typeof parsed.openapi !== "string" || !parsed.openapi.startsWith("3")) {
    throw new OpenApiParseError("Expected an OpenAPI 3.x document (missing `openapi: 3.x`).");
  }
  if (typeof parsed.paths !== "object" || parsed.paths === null) {
    throw new OpenApiParseError("The document has no `paths`.");
  }
  return parsed;
}

function resolveRef<T>(doc: OpenApiDocument, value: T | { $ref?: string }): T {
  const ref = (value as { $ref?: string })?.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/")) return value as T;
  let cursor: unknown = doc;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (typeof cursor !== "object" || cursor === null) return value as T;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return (cursor ?? value) as T;
}

/** `GET /repos/{owner}/{repo}/issues` → `getReposOwnerRepoIssues`. */
export function deriveOperationId(method: string, pathTemplate: string): string {
  const segments = pathTemplate
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      const param = segment.match(/^\{(.+)\}$/);
      const word = param ? `by_${param[1]}` : segment;
      return word.replace(/[^A-Za-z0-9]+/g, "_");
    });
  const joined = segments
    .flatMap((segment) => segment.split("_"))
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join("");
  return sanitizeIdentifier(`${method.toLowerCase()}${joined}`);
}

function pickJsonContent(
  content: Record<string, { schema?: unknown }> | undefined,
): { schema?: unknown } | undefined {
  if (!content) return undefined;
  for (const [mediaType, entry] of Object.entries(content)) {
    if (/json/i.test(mediaType)) return entry;
  }
  const first = Object.values(content)[0];
  return first;
}

function pickSuccessResponseSchema(doc: OpenApiDocument, operation: OpenApiOperation): unknown {
  const responses = operation.responses ?? {};
  const codes = Object.keys(responses).filter((code) => /^2\d\d$/.test(code)).sort();
  const chosen = codes[0] ?? (responses.default ? "default" : undefined);
  if (!chosen) return undefined;
  const response = resolveRef(doc, responses[chosen] as Record<string, unknown>) as {
    content?: Record<string, { schema?: unknown }>;
  };
  return pickJsonContent(response?.content)?.schema;
}

export interface ExtractOpenApiOptions {
  sourceId: string;
  /** Overrides the spec's `servers[0].url`. */
  serverUrl?: string;
  /** Absolute URL the spec was fetched from — resolves relative servers. */
  specUrl?: string;
}

export function resolveServerUrl(doc: OpenApiDocument, options: ExtractOpenApiOptions): string {
  if (options.serverUrl) return options.serverUrl.replace(/\/$/, "");
  const raw = doc.servers?.[0]?.url;
  if (typeof raw === "string" && raw.length > 0) {
    try {
      return new URL(raw, options.specUrl).toString().replace(/\/$/, "");
    } catch {
      return raw.replace(/\/$/, "");
    }
  }
  if (options.specUrl) {
    try {
      return new URL(options.specUrl).origin;
    } catch {
      /* fall through */
    }
  }
  throw new OpenApiParseError(
    "The spec has no `servers[0].url` — set a base URL for this source.",
  );
}

/**
 * Walk every path × method and produce the normalized tool manifest. Folds
 * parameters + request body into one input JSON Schema, executor-style.
 */
export function extractOpenApiTools(
  doc: OpenApiDocument,
  options: ExtractOpenApiOptions,
): ExecutorToolDef[] {
  const serverUrl = resolveServerUrl(doc, options);
  const tools: ExecutorToolDef[] = [];
  const taken = new Set<string>();

  for (const [pathTemplate, rawPathItem] of Object.entries(doc.paths ?? {})) {
    const pathItem = resolveRef(doc, rawPathItem) as Record<string, unknown>;
    const pathLevelParams = Array.isArray(pathItem.parameters)
      ? (pathItem.parameters as OpenApiParameter[])
      : [];

    for (const method of HTTP_METHODS) {
      const rawOperation = pathItem[method];
      if (typeof rawOperation !== "object" || rawOperation === null) continue;
      const operation = rawOperation as OpenApiOperation;

      const parameters = [...pathLevelParams, ...(operation.parameters ?? [])]
        .map((param) => resolveRef(doc, param))
        .filter((param): param is OpenApiParameter =>
          typeof param?.name === "string"
          && (param.in === "path" || param.in === "query" || param.in === "header"),
        );

      const properties: Record<string, unknown> = {};
      const required: string[] = [];
      const paramLocations: Record<string, OpenApiParamLocation> = {};
      for (const param of parameters) {
        const name = param.name!;
        const schema = param.schema !== undefined
          ? resolveRef(doc, param.schema)
          : { type: "string" };
        properties[name] = param.description && typeof schema === "object" && schema !== null
          ? { description: param.description, ...(schema as Record<string, unknown>) }
          : schema;
        paramLocations[name] = param.in as OpenApiParamLocation;
        if (param.in === "path" || param.required) required.push(name);
      }

      const requestBody = operation.requestBody
        ? resolveRef(doc, operation.requestBody)
        : undefined;
      const hasBody = Boolean(requestBody?.content && Object.keys(requestBody.content).length > 0);
      if (hasBody) {
        const bodySchema = pickJsonContent(requestBody!.content)?.schema;
        properties.body = bodySchema !== undefined
          ? resolveRef(doc, bodySchema)
          : { type: "object" };
        if (requestBody!.required) required.push("body");
      }

      const baseName = sanitizeIdentifier(
        operation.operationId ?? deriveOperationId(method, pathTemplate),
      );
      const name = dedupeIdentifier(baseName, taken);
      taken.add(name);

      const http: ExecutorHttpBinding = {
        method: method.toUpperCase(),
        pathTemplate,
        serverUrl,
        paramLocations,
        hasBody,
      };

      tools.push({
        address: `${options.sourceId}.${name}`,
        sourceId: options.sourceId,
        name,
        title: operation.summary,
        description: [operation.summary, operation.description]
          .filter(Boolean)
          .join("\n") || `${method.toUpperCase()} ${pathTemplate}`,
        inputSchema: {
          type: "object",
          properties,
          ...(required.length > 0 ? { required } : {}),
        },
        outputSchema: pickSuccessResponseSchema(doc, operation),
        http,
      });
    }
  }

  return tools;
}

export interface InvokeOpenApiOptions {
  /** Auth headers resolved host-side from the source's connection. */
  authHeaders?: Record<string, string>;
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
}

/**
 * Rebuild and send the HTTP request for one OpenAPI tool call. Args are the
 * sandbox-supplied input object; secrets arrive only via `authHeaders`.
 */
export async function invokeOpenApiTool(
  tool: ExecutorToolDef,
  args: Record<string, unknown> | undefined,
  options: InvokeOpenApiOptions,
): Promise<ExecutorToolResult> {
  const http = tool.http;
  if (!http) {
    return {
      ok: false,
      error: { code: "not_openapi_tool", message: `${tool.address} has no HTTP binding.` },
    };
  }
  const input = args ?? {};

  let path = http.pathTemplate;
  const query = new URLSearchParams();
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...options.authHeaders,
  };

  for (const [name, location] of Object.entries(http.paramLocations)) {
    const value = input[name];
    if (value === undefined || value === null) {
      if (location === "path") {
        return {
          ok: false,
          error: {
            code: "invalid_tool_arguments",
            message: `Missing required path parameter "${name}".`,
          },
        };
      }
      continue;
    }
    const serialized = typeof value === "string" ? value : JSON.stringify(value);
    if (location === "path") {
      path = path.replaceAll(`{${name}}`, encodeURIComponent(serialized));
    } else if (location === "query") {
      if (Array.isArray(value)) {
        for (const entry of value) query.append(name, String(entry));
      } else {
        query.set(name, typeof value === "string" ? value : String(value));
      }
    } else {
      headers[name] = serialized;
    }
  }

  const url = `${http.serverUrl}${path}${query.size > 0 ? `?${query.toString()}` : ""}`;
  const init: RequestInit = { method: http.method, headers };
  if (http.hasBody && input.body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(input.body);
  }

  let response: Response;
  try {
    response = await options.fetchImpl(url, init);
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: "network_error",
        message: `Request to ${http.method} ${path} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
        retryable: true,
      },
    };
  }

  const text = await response.text();
  let data: unknown = text;
  const contentType = response.headers.get("content-type") ?? "";
  if (text && (contentType.includes("json") || text.startsWith("{") || text.startsWith("["))) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    return {
      ok: false,
      error: {
        code: `http_${response.status}`,
        message: `${http.method} ${path} returned ${response.status}.`,
        status: response.status,
        details: data,
        retryable: response.status === 429 || response.status >= 500,
      },
    };
  }

  return { ok: true, data, http: { status: response.status } };
}
