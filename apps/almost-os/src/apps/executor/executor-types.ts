/**
 * executor.sh — data model.
 *
 * Mirrors the primitives of RhysSullivan/executor, browser-sized:
 *
 *  - Source       — an integration produced from a spec (MCP server or
 *                   OpenAPI document). Owns a normalized tool manifest.
 *  - Connection   — a credential bound to a source. Secrets never live in
 *                   this record: OAuth tokens are keychain-encrypted files at
 *                   `/home/user/.config/oauth/{serviceId}.json`, API keys at
 *                   `/home/user/.config/executor/secrets/{connectionId}.json`.
 *  - Tool         — one callable operation with JSON-Schema I/O, addressed
 *                   `<source>.<tool>` inside the code-mode sandbox
 *                   (`tools.github.createIssue(...)`).
 *  - Run          — audit record of one code-mode execution.
 *
 * Non-secret state persists in localStorage under `app:executor:*` so the
 * App Store uninstall convention wipes it cleanly.
 */

export type ExecutorSourceKind = "mcp" | "openapi";

/**
 * How a connection authenticates. The five OAuth-ish methods all converge on
 * the shared `@agent-wasm/keychain/oauth` machinery (an `OAuthServiceConfig`
 * in the registry + an encrypted token file + the refresh orchestrator):
 *
 *  - `oauth-dcr`    — RFC 7591 Dynamic Client Registration, then PKCE popup.
 *  - `oauth-cimd`   — Client ID Metadata Document: `client_id` IS a URL to a
 *                     JSON metadata doc we host; no registration round-trip.
 *  - `oauth-client` — generic OAuth: user-pasted client_id (+ optional
 *                     secret), PKCE popup.
 *  - `oauth-device` — RFC 8628 device authorization grant ("CLI auth"):
 *                     user code + verification URI + token polling.
 *  - `oidc`         — OpenID Connect: code flow with `openid` scopes; the
 *                     id_token claims give the connection an identity.
 */
export type ExecutorAuthMethod =
  | "none"
  | "api-key"
  | "oauth-dcr"
  | "oauth-cimd"
  | "oauth-client"
  | "oauth-device"
  | "oidc";

/** Per-source execution policy, most-restrictive-wins at call time. */
export type ExecutorPolicy = "allow" | "require_approval" | "block";

export interface ExecutorSource {
  /** Slug used as the sandbox namespace: `tools.<id>.<tool>`. */
  id: string;
  kind: ExecutorSourceKind;
  /** Display label. */
  label: string;
  /** MCP endpoint URL, or the OpenAPI document URL. */
  url: string;
  /** OpenAPI only — overrides the spec's `servers[0].url` when set. */
  serverUrl?: string;
  policy: ExecutorPolicy;
  addedAt: string;
  /** ISO timestamp of the last successful tool sync. */
  lastSyncAt?: string;
  /** Sticky error from the last sync attempt, for the UI. */
  syncError?: string;
}

export interface ExecutorApiKeyPlacement {
  /** Header the key is sent in, e.g. `Authorization` or `X-Api-Key`. */
  headerName: string;
  /** Optional value prefix, e.g. `Bearer ` or `token `. */
  prefix?: string;
}

export interface ExecutorConnection {
  id: string;
  sourceId: string;
  /** Human name distinguishing multiple connections (`default`, `work`). */
  name: string;
  method: ExecutorAuthMethod;
  /**
   * OAuth methods — id of the `OAuthServiceConfig` in the shared
   * `OAuthServiceRegistry`; the token file lives at
   * `tokenFilePathForService(oauthServiceId)`.
   */
  oauthServiceId?: string;
  /** `api-key` method — where the key goes. The key itself is in the VFS. */
  apiKey?: ExecutorApiKeyPlacement;
  /** `oidc` — identity claims parsed from the id_token (display only). */
  identity?: { sub?: string; email?: string; name?: string };
  addedAt: string;
}

/** Computed connection state for the UI. */
export type ExecutorConnectionStatus =
  | "connected"
  | "pending"
  | "needs-reauth"
  | "error";

/** OpenAPI parameter placement, needed to rebuild the HTTP request. */
export type OpenApiParamLocation = "path" | "query" | "header";

export interface ExecutorHttpBinding {
  method: string;
  /** e.g. `/repos/{owner}/{repo}/issues` */
  pathTemplate: string;
  /** Resolved server base URL. */
  serverUrl: string;
  /** Where each named input property goes. Unlisted props → body. */
  paramLocations: Record<string, OpenApiParamLocation>;
  /** True when the operation declared a request body (input prop `body`). */
  hasBody: boolean;
}

export interface ExecutorToolDef {
  /** `<sourceId>.<name>` — the sandbox call path minus the `tools.` root. */
  address: string;
  sourceId: string;
  /** Sanitized identifier, unique within the source. */
  name: string;
  title?: string;
  description?: string;
  /** JSON Schema for the single object argument. */
  inputSchema?: unknown;
  /** JSON Schema of the success payload, when advertised. */
  outputSchema?: unknown;
  /** MCP only — the wire-level tool name (pre-sanitization). */
  mcpToolName?: string;
  /** OpenAPI only — how to build the HTTP request. */
  http?: ExecutorHttpBinding;
}

/** Structured, secret-free failure shape returned into the sandbox. */
export interface ExecutorToolError {
  code: string;
  message: string;
  status?: number;
  details?: unknown;
  retryable?: boolean;
}

export type ExecutorToolResult =
  | { ok: true; data: unknown; http?: { status: number } }
  | { ok: false; error: ExecutorToolError };

export interface ExecutorRunToolCall {
  path: string;
  /** JSON preview of the args, truncated — args may contain user data. */
  argsPreview: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export interface ExecutorRunLogEntry {
  level: "log" | "warn" | "error";
  text: string;
}

export interface ExecutorRun {
  id: string;
  code: string;
  startedAt: string;
  durationMs: number;
  status: "ok" | "error";
  /** JSON of the returned value (truncated for persistence). */
  resultPreview: string;
  errorMessage?: string;
  logs: ExecutorRunLogEntry[];
  toolCalls: ExecutorRunToolCall[];
}

/** Sanitize an arbitrary name into a JS-identifier-safe tool/source id. */
export function sanitizeIdentifier(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9_$]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^(\d)/, "_$1");
  return cleaned || "tool";
}

/** De-duplicate `name` against `taken`, appending `_2`, `_3`, … */
export function dedupeIdentifier(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  let i = 2;
  while (taken.has(`${name}_${i}`)) i += 1;
  return `${name}_${i}`;
}
