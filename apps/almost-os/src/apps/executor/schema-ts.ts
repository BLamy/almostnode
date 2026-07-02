/**
 * Lightweight JSON Schema → TypeScript renderer.
 *
 * executor.sh follows the executor/Cloudflare "code mode" pattern: tool
 * schemas never sit in the model's context — the sandbox's
 * `tools.describe.tool({ path })` compiles the one tool being inspected into
 * a TypeScript preview on demand. This is a pragmatic renderer (objects,
 * arrays, enums, unions, `$ref`s), not a full compiler; unknown constructs
 * degrade to `unknown` rather than failing.
 */

interface JsonSchemaObject {
  type?: string | string[];
  properties?: Record<string, unknown>;
  required?: string[];
  items?: unknown;
  enum?: unknown[];
  const?: unknown;
  oneOf?: unknown[];
  anyOf?: unknown[];
  allOf?: unknown[];
  additionalProperties?: unknown;
  description?: string;
  format?: string;
  $ref?: string;
  $defs?: Record<string, unknown>;
  definitions?: Record<string, unknown>;
  nullable?: boolean;
}

export interface RenderSchemaOptions {
  /**
   * Root document used to resolve `$ref` pointers (`#/$defs/X`,
   * `#/definitions/X`, `#/components/schemas/X`).
   */
  refRoot?: unknown;
  /** Depth cap; beyond it (or on a `$ref` cycle) render `unknown`. */
  maxDepth?: number;
}

function isSchemaObject(value: unknown): value is JsonSchemaObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function resolvePointer(root: unknown, ref: string): unknown {
  if (!ref.startsWith("#/")) return undefined;
  let cursor: unknown = root;
  for (const rawSegment of ref.slice(2).split("/")) {
    const segment = rawSegment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (!isSchemaObject(cursor) && !Array.isArray(cursor)) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

const IDENTIFIER_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function renderPropertyKey(key: string): string {
  return IDENTIFIER_RE.test(key) ? key : JSON.stringify(key);
}

function renderLiteral(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value === null) return "null";
  return "unknown";
}

function indentBlock(text: string): string {
  return text
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

interface RenderContext {
  refRoot: unknown;
  maxDepth: number;
  seenRefs: Set<string>;
}

function render(schema: unknown, depth: number, ctx: RenderContext): string {
  if (schema === true || schema === undefined || schema === null) return "unknown";
  if (schema === false) return "never";
  if (!isSchemaObject(schema)) return "unknown";
  if (depth > ctx.maxDepth) return "unknown";

  if (typeof schema.$ref === "string") {
    if (ctx.seenRefs.has(schema.$ref)) return "unknown";
    const resolved = resolvePointer(ctx.refRoot ?? schema, schema.$ref);
    if (resolved === undefined) return "unknown";
    ctx.seenRefs.add(schema.$ref);
    const rendered = render(resolved, depth + 1, ctx);
    ctx.seenRefs.delete(schema.$ref);
    return rendered;
  }

  if (schema.const !== undefined) return renderLiteral(schema.const);
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    return schema.enum.map(renderLiteral).join(" | ");
  }

  if (Array.isArray(schema.allOf) && schema.allOf.length > 0) {
    const parts = schema.allOf.map((entry) => render(entry, depth + 1, ctx));
    return parts.filter((part) => part !== "unknown").join(" & ") || "unknown";
  }
  const unionBranches = Array.isArray(schema.oneOf) && schema.oneOf.length > 0
    ? schema.oneOf
    : Array.isArray(schema.anyOf) && schema.anyOf.length > 0
      ? schema.anyOf
      : null;
  if (unionBranches) {
    const parts = [...new Set(unionBranches.map((entry) => render(entry, depth + 1, ctx)))];
    return parts.join(" | ");
  }

  const types = Array.isArray(schema.type)
    ? schema.type
    : typeof schema.type === "string"
      ? [schema.type]
      : [];
  // OpenAPI 3.0-style nullability.
  const nullable = schema.nullable === true || types.includes("null");

  const renderSingle = (type: string): string => {
    switch (type) {
      case "string":
        return "string";
      case "number":
      case "integer":
        return "number";
      case "boolean":
        return "boolean";
      case "null":
        return "null";
      case "array": {
        const item = render(schema.items, depth + 1, ctx);
        return /[|&\s]/.test(item) ? `Array<${item}>` : `${item}[]`;
      }
      case "object":
        return renderObject(schema, depth, ctx);
      default:
        return "unknown";
    }
  };

  let rendered: string;
  const concrete = types.filter((type) => type !== "null");
  if (concrete.length === 1) {
    rendered = renderSingle(concrete[0]!);
  } else if (concrete.length > 1) {
    rendered = [...new Set(concrete.map(renderSingle))].join(" | ");
  } else if (schema.properties || schema.additionalProperties !== undefined) {
    rendered = renderObject(schema, depth, ctx);
  } else if (schema.items !== undefined) {
    rendered = renderSingle("array");
  } else {
    rendered = "unknown";
  }

  if (nullable && rendered !== "unknown" && !rendered.split("|").some((p) => p.trim() === "null")) {
    rendered = `${rendered} | null`;
  }
  return rendered;
}

function renderObject(schema: JsonSchemaObject, depth: number, ctx: RenderContext): string {
  const properties = isSchemaObject(schema.properties) ? schema.properties : undefined;
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const lines: string[] = [];

  if (properties) {
    for (const [key, propSchema] of Object.entries(properties)) {
      const description = isSchemaObject(propSchema) && typeof propSchema.description === "string"
        ? propSchema.description.trim()
        : undefined;
      if (description) {
        lines.push(`/** ${description.replace(/\*\//g, "*\\/").replace(/\s+/g, " ")} */`);
      }
      const optional = required.has(key) ? "" : "?";
      lines.push(`${renderPropertyKey(key)}${optional}: ${render(propSchema, depth + 1, ctx)};`);
    }
  }

  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    const valueType = schema.additionalProperties === true
      ? "unknown"
      : render(schema.additionalProperties, depth + 1, ctx);
    lines.push(`[key: string]: ${valueType};`);
  }

  if (lines.length === 0) {
    return properties ? "{}" : "Record<string, unknown>";
  }
  return `{\n${indentBlock(lines.join("\n"))}\n}`;
}

/** Render a JSON Schema as an inline TypeScript type expression. */
export function renderSchemaType(schema: unknown, options: RenderSchemaOptions = {}): string {
  return render(schema, 0, {
    refRoot: options.refRoot ?? schema,
    maxDepth: options.maxDepth ?? 14,
    seenRefs: new Set(),
  });
}

/**
 * Render the full `tools.describe.tool` preview for a tool: doc comment plus
 * a typed function signature, with the executor-style result union.
 */
export function renderToolPreview(tool: {
  address: string;
  description?: string;
  inputSchema?: unknown;
  outputSchema?: unknown;
  refRoot?: unknown;
}): string {
  const input = tool.inputSchema
    ? renderSchemaType(tool.inputSchema, { refRoot: tool.refRoot ?? tool.inputSchema })
    : "Record<string, never>";
  const output = tool.outputSchema
    ? renderSchemaType(tool.outputSchema, { refRoot: tool.refRoot ?? tool.outputSchema })
    : "unknown";
  const docLines = [
    ...(tool.description ? tool.description.trim().split("\n") : []),
  ];
  const doc = docLines.length > 0
    ? `/**\n${docLines.map((line) => ` * ${line.replace(/\*\//g, "*\\/")}`).join("\n")}\n */\n`
    : "";
  const result = `Promise<{ ok: true; data: ${output}; http?: { status: number } } | { ok: false; error: { code: string; message: string; status?: number; retryable?: boolean } }>`;
  return `${doc}tools.${tool.address}: (input: ${input}) => ${result}`;
}
