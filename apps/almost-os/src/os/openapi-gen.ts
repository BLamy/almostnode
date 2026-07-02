// Generate an OpenAPI 3.1 document from observed HTTP traffic. Pure + testable:
// feed it captured request/response samples, get back a spec that executor's
// OpenAPI source loader (apps/executor/openapi-tools.ts) can ingest — turning a
// running app's live API calls into callable, typed code-mode tools.

export interface CapturedRequest {
  method: string;
  /** Full request URL (may include query string). */
  url: string;
  requestHeaders?: Record<string, string>;
  /** Parsed JSON request body, if any. */
  requestBody?: unknown;
  status?: number;
  /** Parsed JSON response body sample, if any. */
  responseBody?: unknown;
}

// Minimal JSON Schema subset we emit.
type JsonSchema = Record<string, unknown>;

interface OpenApiOperation {
  operationId: string;
  parameters?: Array<Record<string, unknown>>;
  requestBody?: Record<string, unknown>;
  responses: Record<string, unknown>;
}

export interface OpenApiDoc {
  openapi: "3.1.0";
  info: { title: string; version: string };
  servers: Array<{ url: string }>;
  paths: Record<string, Record<string, OpenApiOperation>>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Replace id-like path segments with `{param}` so /users/42 and /users/99 collapse. */
function templatizePath(pathname: string): { template: string; params: string[] } {
  const params: string[] = [];
  const segments = pathname.split("/").map((seg) => {
    if (seg && (/^\d+$/.test(seg) || UUID_RE.test(seg))) {
      const name = params.length === 0 ? "id" : `id${params.length + 1}`;
      params.push(name);
      return `{${name}}`;
    }
    return seg;
  });
  return { template: segments.join("/") || "/", params };
}

/** Infer a JSON Schema from a sample value. */
export function inferSchema(value: unknown): JsonSchema {
  if (value === null || value === undefined) return { type: "null" };
  if (Array.isArray(value)) {
    return {
      type: "array",
      items: value.length ? inferSchema(value[0]) : {},
    };
  }
  switch (typeof value) {
    case "string":
      return { type: "string" };
    case "number":
      return { type: Number.isInteger(value) ? "integer" : "number" };
    case "boolean":
      return { type: "boolean" };
    case "object": {
      const properties: Record<string, JsonSchema> = {};
      for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
        properties[key] = inferSchema(val);
      }
      return { type: "object", properties };
    }
    default:
      return {};
  }
}

function operationIdFor(method: string, template: string): string {
  const parts = template
    .split("/")
    .filter(Boolean)
    .map((seg) => seg.replace(/[{}]/g, "").replace(/[^a-zA-Z0-9]+/g, "_"));
  return `${method.toLowerCase()}_${parts.join("_") || "root"}`;
}

export function generateOpenApi(
  samples: CapturedRequest[],
  opts: { title?: string; version?: string } = {},
): OpenApiDoc {
  const paths: OpenApiDoc["paths"] = {};
  const servers = new Set<string>();

  for (const sample of samples) {
    let parsed: URL;
    try {
      parsed = new URL(sample.url);
    } catch {
      continue;
    }
    servers.add(`${parsed.protocol}//${parsed.host}`);
    const { template, params } = templatizePath(parsed.pathname);
    const method = sample.method.toLowerCase();

    const pathItem = (paths[template] ??= {});
    // Keep the first sample per (path, method); merge nothing fancy.
    if (pathItem[method]) continue;

    const parameters: Array<Record<string, unknown>> = [];
    for (const name of params) {
      parameters.push({ name, in: "path", required: true, schema: { type: "string" } });
    }
    for (const key of new Set(parsed.searchParams.keys())) {
      parameters.push({ name: key, in: "query", required: false, schema: { type: "string" } });
    }

    const operation: OpenApiOperation = {
      operationId: operationIdFor(method, template),
      responses: {
        [String(sample.status ?? 200)]: {
          description: "Captured response",
          ...(sample.responseBody !== undefined
            ? { content: { "application/json": { schema: inferSchema(sample.responseBody) } } }
            : {}),
        },
      },
    };
    if (parameters.length) operation.parameters = parameters;
    if (sample.requestBody !== undefined) {
      operation.requestBody = {
        content: { "application/json": { schema: inferSchema(sample.requestBody) } },
      };
    }
    pathItem[method] = operation;
  }

  return {
    openapi: "3.1.0",
    info: { title: opts.title ?? "Captured API", version: opts.version ?? "1.0.0" },
    servers: [...servers].map((url) => ({ url })),
    paths,
  };
}
