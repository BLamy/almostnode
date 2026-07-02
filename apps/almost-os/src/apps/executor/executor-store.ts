/**
 * executor.sh control plane — the host-side singleton that owns the source
 * catalog, connections, policy gate, tool invocation, and code-mode runs.
 *
 * Follows the almost-os store idiom: hand-rolled module singleton +
 * `useSyncExternalStore` hooks. Non-secret state persists under
 * `app:executor:*` (the App-Store uninstall convention); secrets live only
 * in keychain-managed VFS files.
 *
 * The class takes its environment via {@link ExecutorStoreDeps} so unit
 * tests can run it headless with a fake VFS/fetch; `getExecutorStore()`
 * wires the real workspace/keychain/orchestrator.
 */

import { useSyncExternalStore } from "react";
import { oauthFetch } from "@agent-wasm/keychain/oauth";
import type { VirtualFS } from "@agent-wasm/core";
import { getOAuthOrchestrator } from "../../keychain/oauth-runtime";
import { getApprovalMode, type ApprovalMode } from "../../os/approval-store";
import { getWorkspace } from "../../runtime/runtime";
import { executeCodeMode } from "./codemode-sandbox";
import { resolveOAuthHeaders, ExecutorAuthError } from "./executor-auth";
import {
  deleteApiKeySecret,
  readApiKeySecret,
  EXECUTOR_STATE_STORAGE_KEY,
} from "./executor-secrets";
import {
  dedupeIdentifier,
  sanitizeIdentifier,
  type ExecutorConnection,
  type ExecutorConnectionStatus,
  type ExecutorPolicy,
  type ExecutorRun,
  type ExecutorRunToolCall,
  type ExecutorSource,
  type ExecutorToolDef,
  type ExecutorToolResult,
} from "./executor-types";
import { McpAuthRequiredError, McpError, McpHttpClient } from "./mcp-client";
import {
  extractOpenApiTools,
  invokeOpenApiTool,
  parseOpenApiDocument,
} from "./openapi-tools";
import { renderToolPreview } from "./schema-ts";

export const EXECUTOR_TOOLS_STORAGE_KEY = "app:executor:tools.v1";
export const EXECUTOR_RUNS_STORAGE_KEY = "app:executor:runs.v1";

const MAX_PERSISTED_RUNS = 20;
const MAX_RESULT_PREVIEW = 4_096;
const MAX_ARGS_PREVIEW = 512;

export interface ExecutorState {
  sources: ExecutorSource[];
  connections: ExecutorConnection[];
  toolsBySource: Record<string, ExecutorToolDef[]>;
  runs: ExecutorRun[];
  /** Source ids with a sync in flight. */
  syncing: Record<string, boolean>;
  executing: boolean;
}

export interface ApprovalRequest {
  kind: "tool-call" | "execute";
  path: string;
  argsPreview: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface ExecutorStoreDeps {
  storage: StorageLike | null;
  /** External HTTP (spec fetches, MCP, API calls) — direct-then-CORS-proxy. */
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>;
  getVfs: () => VirtualFS;
  /** Orchestrator refresh for OAuth-backed connections. */
  refreshIfNeeded: (serviceId: string) => Promise<void>;
  /** Forget an OAuth service (registry entry + token file). */
  removeOAuthService: (serviceId: string) => void;
  getApprovalMode: () => ApprovalMode;
  now: () => Date;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function safeJson(value: unknown, max: number): string {
  let json: string;
  try {
    json = JSON.stringify(value) ?? "undefined";
  } catch {
    json = String(value);
  }
  return truncate(json, max);
}

let runCounter = 0;

export class ExecutorStore {
  private deps: ExecutorStoreDeps;
  private state: ExecutorState;
  private listeners = new Set<() => void>();
  private mcpClients = new Map<string, McpHttpClient>();
  private approvalHandler: ((request: ApprovalRequest) => Promise<boolean>) | null = null;

  constructor(deps: ExecutorStoreDeps) {
    this.deps = deps;
    this.state = {
      sources: [],
      connections: [],
      toolsBySource: {},
      runs: [],
      syncing: {},
      executing: false,
    };
    this.load();
  }

  // ── state plumbing ───────────────────────────────────────────────────────

  getState(): ExecutorState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(partial: Partial<ExecutorState>): void {
    this.state = { ...this.state, ...partial };
    for (const listener of this.listeners) listener();
  }

  private load(): void {
    const storage = this.deps.storage;
    if (!storage) return;
    try {
      const raw = storage.getItem(EXECUTOR_STATE_STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as {
          sources?: ExecutorSource[];
          connections?: ExecutorConnection[];
        };
        this.state.sources = Array.isArray(parsed.sources) ? parsed.sources : [];
        this.state.connections = Array.isArray(parsed.connections) ? parsed.connections : [];
      }
      const tools = storage.getItem(EXECUTOR_TOOLS_STORAGE_KEY);
      if (tools) {
        this.state.toolsBySource = JSON.parse(tools) as Record<string, ExecutorToolDef[]>;
      }
      const runs = storage.getItem(EXECUTOR_RUNS_STORAGE_KEY);
      if (runs) {
        this.state.runs = JSON.parse(runs) as ExecutorRun[];
      }
    } catch {
      // Corrupt persisted state — start clean rather than crash the app.
    }
  }

  private persist(): void {
    const storage = this.deps.storage;
    if (!storage) return;
    try {
      storage.setItem(
        EXECUTOR_STATE_STORAGE_KEY,
        JSON.stringify({
          sources: this.state.sources,
          connections: this.state.connections,
        }),
      );
      storage.setItem(EXECUTOR_TOOLS_STORAGE_KEY, JSON.stringify(this.state.toolsBySource));
      storage.setItem(
        EXECUTOR_RUNS_STORAGE_KEY,
        JSON.stringify(this.state.runs.slice(0, MAX_PERSISTED_RUNS)),
      );
    } catch {
      // Quota exceeded — drop the tools cache and retry the small pieces.
      try {
        storage.removeItem(EXECUTOR_TOOLS_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    }
  }

  // ── sources ──────────────────────────────────────────────────────────────

  private nextSourceId(label: string): string {
    const taken = new Set(this.state.sources.map((source) => source.id));
    return dedupeIdentifier(sanitizeIdentifier(label).toLowerCase(), taken);
  }

  addSource(params: {
    kind: ExecutorSource["kind"];
    label: string;
    url: string;
    serverUrl?: string;
  }): ExecutorSource {
    const source: ExecutorSource = {
      id: this.nextSourceId(params.label),
      kind: params.kind,
      label: params.label.trim() || params.url,
      url: params.url.trim(),
      serverUrl: params.serverUrl?.trim() || undefined,
      policy: "allow",
      addedAt: this.deps.now().toISOString(),
    };
    this.emit({ sources: [...this.state.sources, source] });
    this.persist();
    void this.syncSource(source.id);
    return source;
  }

  removeSource(sourceId: string): void {
    for (const connection of this.state.connections.filter((c) => c.sourceId === sourceId)) {
      this.removeConnection(connection.id);
    }
    const toolsBySource = { ...this.state.toolsBySource };
    delete toolsBySource[sourceId];
    this.mcpClients.delete(sourceId);
    this.emit({
      sources: this.state.sources.filter((source) => source.id !== sourceId),
      toolsBySource,
    });
    this.persist();
  }

  setSourcePolicy(sourceId: string, policy: ExecutorPolicy): void {
    this.emit({
      sources: this.state.sources.map((source) =>
        source.id === sourceId ? { ...source, policy } : source,
      ),
    });
    this.persist();
  }

  private patchSource(sourceId: string, partial: Partial<ExecutorSource>): void {
    this.emit({
      sources: this.state.sources.map((source) =>
        source.id === sourceId ? { ...source, ...partial } : source,
      ),
    });
  }

  /** Re-resolve the source's tool manifest (MCP `tools/list` / spec fetch). */
  async syncSource(sourceId: string): Promise<void> {
    const source = this.state.sources.find((entry) => entry.id === sourceId);
    if (!source || this.state.syncing[sourceId]) return;
    this.emit({ syncing: { ...this.state.syncing, [sourceId]: true } });
    try {
      let tools: ExecutorToolDef[];
      if (source.kind === "mcp") {
        tools = await this.syncMcpSource(source);
      } else {
        tools = await this.syncOpenApiSource(source);
      }
      this.emit({ toolsBySource: { ...this.state.toolsBySource, [sourceId]: tools } });
      this.patchSource(sourceId, {
        lastSyncAt: this.deps.now().toISOString(),
        syncError: undefined,
      });
    } catch (error) {
      const message = error instanceof McpAuthRequiredError
        ? "Authorization required — add a connection, then sync again."
        : error instanceof Error
          ? error.message
          : String(error);
      this.patchSource(sourceId, { syncError: message });
    } finally {
      const syncing = { ...this.state.syncing };
      delete syncing[sourceId];
      this.emit({ syncing });
      this.persist();
    }
  }

  private mcpClient(source: ExecutorSource): McpHttpClient {
    const cached = this.mcpClients.get(source.id);
    if (cached) return cached;
    const client = new McpHttpClient({
      url: source.url,
      fetchImpl: this.deps.fetchImpl,
      getAuthHeaders: () => this.resolveHeaders(source),
    });
    this.mcpClients.set(source.id, client);
    return client;
  }

  private async syncMcpSource(source: ExecutorSource): Promise<ExecutorToolDef[]> {
    const listings = await this.mcpClient(source).listTools();
    const taken = new Set<string>();
    return listings.map((listing) => {
      const name = dedupeIdentifier(sanitizeIdentifier(listing.name), taken);
      taken.add(name);
      return {
        address: `${source.id}.${name}`,
        sourceId: source.id,
        name,
        title: listing.title,
        description: listing.description,
        inputSchema: listing.inputSchema,
        outputSchema: listing.outputSchema,
        mcpToolName: listing.name,
      } satisfies ExecutorToolDef;
    });
  }

  private async syncOpenApiSource(source: ExecutorSource): Promise<ExecutorToolDef[]> {
    const response = await this.deps.fetchImpl(source.url, {
      method: "GET",
      headers: { Accept: "application/json, application/yaml, text/yaml, */*" },
    });
    if (!response.ok) {
      throw new Error(`Fetching the OpenAPI spec returned HTTP ${response.status}.`);
    }
    const doc = parseOpenApiDocument(await response.text());
    return extractOpenApiTools(doc, {
      sourceId: source.id,
      serverUrl: source.serverUrl,
      specUrl: source.url,
    });
  }

  // ── connections ──────────────────────────────────────────────────────────

  addConnection(connection: ExecutorConnection): void {
    // v1: one connection per source — replace any existing one.
    for (const existing of this.state.connections.filter(
      (entry) => entry.sourceId === connection.sourceId,
    )) {
      this.removeConnection(existing.id);
    }
    this.mcpClients.delete(connection.sourceId);
    this.emit({ connections: [...this.state.connections, connection] });
    this.persist();
  }

  removeConnection(connectionId: string): void {
    const connection = this.state.connections.find((entry) => entry.id === connectionId);
    if (!connection) return;
    if (connection.oauthServiceId) {
      try {
        this.deps.removeOAuthService(connection.oauthServiceId);
      } catch {
        /* registry may already be clean */
      }
    }
    if (connection.method === "api-key") {
      try {
        deleteApiKeySecret(this.deps.getVfs(), connection.id);
      } catch {
        /* vault may be locked; file reconciles on next unlock */
      }
    }
    this.mcpClients.delete(connection.sourceId);
    this.emit({
      connections: this.state.connections.filter((entry) => entry.id !== connectionId),
    });
    this.persist();
  }

  connectionForSource(sourceId: string): ExecutorConnection | undefined {
    return this.state.connections.find((entry) => entry.sourceId === sourceId);
  }

  connectionStatus(connection: ExecutorConnection): ExecutorConnectionStatus {
    try {
      const vfs = this.deps.getVfs();
      if (connection.method === "api-key") {
        return readApiKeySecret(vfs, connection.id) ? "connected" : "pending";
      }
      if (connection.oauthServiceId) {
        const path = `/home/user/.config/oauth/${connection.oauthServiceId}.json`;
        return vfs.existsSync(path) ? "connected" : "pending";
      }
      return "connected";
    } catch {
      return "error";
    }
  }

  /** Host-side auth resolution — secrets never cross into the sandbox. */
  private async resolveHeaders(source: ExecutorSource): Promise<Record<string, string>> {
    const connection = this.connectionForSource(source.id);
    if (!connection || connection.method === "none") return {};
    if (connection.method === "api-key") {
      const secret = readApiKeySecret(this.deps.getVfs(), connection.id);
      if (!secret) {
        throw new ExecutorAuthError(
          "API key is not available — unlock the keychain vault or reconnect.",
          "needs_auth",
        );
      }
      return { [secret.headerName]: `${secret.prefix ?? ""}${secret.key}` };
    }
    if (!connection.oauthServiceId) {
      throw new ExecutorAuthError("Connection has no OAuth service bound.", "needs_auth");
    }
    return resolveOAuthHeaders(connection.oauthServiceId, {
      vfs: this.deps.getVfs(),
      refreshIfNeeded: this.deps.refreshIfNeeded,
    });
  }

  // ── policy + approval ────────────────────────────────────────────────────

  setApprovalHandler(
    handler: ((request: ApprovalRequest) => Promise<boolean>) | null,
  ): void {
    this.approvalHandler = handler;
  }

  private effectivePolicy(source: ExecutorSource): ExecutorPolicy {
    if (source.policy === "block") return "block";
    // "Ask for approval" mode escalates allow → require_approval; the
    // per-source policy can only tighten, never loosen, the OS mode.
    if (this.deps.getApprovalMode() === "ask") return "require_approval";
    return source.policy;
  }

  private async requestApproval(request: ApprovalRequest): Promise<boolean> {
    if (!this.approvalHandler) return false;
    try {
      return await this.approvalHandler(request);
    } catch {
      return false;
    }
  }

  // ── invocation ───────────────────────────────────────────────────────────

  findTool(path: string): ExecutorToolDef | undefined {
    const [sourceId, ...rest] = path.split(".");
    if (!sourceId || rest.length === 0) return undefined;
    const name = rest.join(".");
    return this.state.toolsBySource[sourceId]?.find((tool) => tool.name === name);
  }

  async invokeTool(path: string, args: unknown): Promise<ExecutorToolResult> {
    const tool = this.findTool(path);
    if (!tool) {
      return {
        ok: false,
        error: {
          code: "tool_not_found",
          message: `No tool at "${path}". Use tools.search({ query }) to find tools.`,
        },
      };
    }
    const source = this.state.sources.find((entry) => entry.id === tool.sourceId)!;

    const policy = this.effectivePolicy(source);
    if (policy === "block") {
      return {
        ok: false,
        error: { code: "tool_blocked", message: `Policy blocks ${path}.` },
      };
    }
    if (policy === "require_approval") {
      const approved = await this.requestApproval({
        kind: "tool-call",
        path,
        argsPreview: safeJson(args, MAX_ARGS_PREVIEW),
      });
      if (!approved) {
        return {
          ok: false,
          error: { code: "approval_denied", message: `The user declined ${path}.` },
        };
      }
    }

    const record = typeof args === "object" && args !== null && !Array.isArray(args)
      ? (args as Record<string, unknown>)
      : undefined;

    try {
      if (source.kind === "openapi") {
        return await invokeOpenApiTool(tool, record, {
          fetchImpl: this.deps.fetchImpl,
          authHeaders: await this.resolveHeaders(source),
        });
      }
      const result = await this.mcpClient(source).callTool(tool.mcpToolName ?? tool.name, record);
      if (result.isError) {
        return {
          ok: false,
          error: {
            code: "tool_error",
            message: typeof result.data === "string" ? result.data : safeJson(result.data, 1_000),
          },
        };
      }
      return { ok: true, data: result.data };
    } catch (error) {
      if (error instanceof ExecutorAuthError) {
        return { ok: false, error: { code: error.code, message: error.message } };
      }
      if (error instanceof McpAuthRequiredError) {
        return {
          ok: false,
          error: {
            code: "needs_auth",
            message: "The MCP server rejected the call (401) — reconnect this source.",
          },
        };
      }
      if (error instanceof McpError) {
        return { ok: false, error: { code: "mcp_error", message: error.message } };
      }
      // Unexpected failure: scrub it — internal messages could carry URLs or
      // tokens. Full cause goes to the host console with a correlation id.
      const correlationId = Math.random().toString(36).slice(2, 10);
      console.error(`[executor] tool dispatch failed [${correlationId}]`, path, error);
      return {
        ok: false,
        error: { code: "internal_error", message: `Internal tool error [${correlationId}]` },
      };
    }
  }

  // ── code-mode built-ins (progressive disclosure) ─────────────────────────

  searchTools(args: unknown): Array<{ address: string; description?: string }> {
    const query = typeof args === "object" && args !== null
      ? String((args as Record<string, unknown>).query ?? "")
      : "";
    const limit = typeof args === "object" && args !== null
      && typeof (args as Record<string, unknown>).limit === "number"
      ? Math.max(1, Math.min(100, (args as { limit: number }).limit))
      : 25;
    const needle = query.trim().toLowerCase();
    const all = Object.values(this.state.toolsBySource).flat();
    const matches = needle
      ? all.filter((tool) =>
          tool.address.toLowerCase().includes(needle)
          || (tool.description ?? "").toLowerCase().includes(needle))
      : all;
    return matches.slice(0, limit).map((tool) => ({
      address: tool.address,
      description: tool.description?.split("\n")[0],
    }));
  }

  describeTool(path: unknown): { address: string; typescript: string } | { error: string } {
    if (typeof path !== "string" || !path) {
      return { error: "describe.tool needs { path: \"<source>.<tool>\" }." };
    }
    const tool = this.findTool(path);
    if (!tool) return { error: `No tool at "${path}".` };
    return {
      address: tool.address,
      typescript: renderToolPreview({
        address: tool.address,
        description: tool.description,
        inputSchema: tool.inputSchema,
        outputSchema: tool.outputSchema,
      }),
    };
  }

  listSourcesInfo(): Array<{
    id: string;
    kind: string;
    label: string;
    toolCount: number;
    connected: boolean;
  }> {
    return this.state.sources.map((source) => {
      const connection = this.connectionForSource(source.id);
      return {
        id: source.id,
        kind: source.kind,
        label: source.label,
        toolCount: this.state.toolsBySource[source.id]?.length ?? 0,
        connected: connection ? this.connectionStatus(connection) === "connected" : false,
      };
    });
  }

  // ── code mode ────────────────────────────────────────────────────────────

  async execute(code: string): Promise<ExecutorRun> {
    const startedAt = this.deps.now();
    const toolCalls: ExecutorRunToolCall[] = [];
    this.emit({ executing: true });

    const invoker = async (path: string, args: unknown): Promise<unknown> => {
      if (path === "search") return this.searchTools(args);
      if (path === "describe.tool") {
        const record = typeof args === "object" && args !== null
          ? (args as Record<string, unknown>)
          : {};
        return this.describeTool(record.path);
      }
      if (path === "executor.sources.list") return this.listSourcesInfo();

      const callStart = Date.now();
      const result = await this.invokeTool(path, args);
      toolCalls.push({
        path,
        argsPreview: safeJson(args, MAX_ARGS_PREVIEW),
        ok: result.ok,
        durationMs: Date.now() - callStart,
        error: result.ok ? undefined : result.error.message,
      });
      return result;
    };

    // Expose every known tool + the discovery built-ins as concrete paths.
    const toolPaths = [
      "search",
      "describe.tool",
      "executor.sources.list",
      ...Object.values(this.state.toolsBySource).flat().map((tool) => tool.address),
    ];

    try {
      const result = await executeCodeMode({ code, invokeTool: invoker, toolPaths });
      const run: ExecutorRun = {
        id: `run_${Date.now().toString(36)}_${(runCounter++).toString(36)}`,
        code: truncate(code, 10_000),
        startedAt: startedAt.toISOString(),
        durationMs: Date.now() - startedAt.getTime(),
        status: result.ok ? "ok" : "error",
        resultPreview: result.ok ? safeJson(result.value, MAX_RESULT_PREVIEW) : "",
        errorMessage: result.error,
        logs: result.logs,
        toolCalls,
      };
      this.emit({ runs: [run, ...this.state.runs].slice(0, MAX_PERSISTED_RUNS) });
      this.persist();
      return run;
    } finally {
      this.emit({ executing: false });
    }
  }
}

// ── singleton + hooks ────────────────────────────────────────────────────────

let storeSingleton: ExecutorStore | null = null;

export function getExecutorStore(): ExecutorStore {
  if (typeof window === "undefined") {
    throw new Error("Executor store is browser-only");
  }
  if (!storeSingleton) {
    storeSingleton = new ExecutorStore({
      storage: window.localStorage,
      fetchImpl: (url, init) => oauthFetch(url, init, {}),
      getVfs: () => getWorkspace().vfs as unknown as VirtualFS,
      refreshIfNeeded: (serviceId) => getOAuthOrchestrator().refreshIfNeeded(serviceId),
      removeOAuthService: (serviceId) => getOAuthOrchestrator().removeService(serviceId),
      getApprovalMode,
      now: () => new Date(),
    });
  }
  return storeSingleton;
}

export function useExecutorState(): ExecutorState {
  const store = getExecutorStore();
  return useSyncExternalStore(
    (callback) => store.subscribe(callback),
    () => store.getState(),
    () => store.getState(),
  );
}
