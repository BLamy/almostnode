// Claude Code IDE bridge — the reusable, host-agnostic half: the MCP-over-SSE
// JSON-RPC server (ClaudeIdeVirtualServer) plus protocol DTOs, the MCP config
// builder, and pure encoders. The server takes injected handlers (an
// EditorStateProvider) so the Monaco editor-state reads stay in the host — see
// ClaudeIdeBridge in the web-ide demo.

/** Minimal structural view of a VS Code/Monaco URI (no monaco-vscode-api dep). */
export interface UriLike {
  readonly scheme?: string;
  readonly path?: string;
  toString(skipEncoding?: boolean): string;
}
export const CLAUDE_IDE_SERVER_NAME = 'ide';
export const CLAUDE_IDE_TRANSPORT_TYPE = 'sse-ide';
export const CLAUDE_IDE_NAME = 'agent-wasm Web IDE';

export const CLAUDE_IDE_DEFAULT_PORT = 43127;
const CLAUDE_IDE_PROTOCOL_VERSION = '2024-11-05';
const CLAUDE_IDE_SERVER_VERSION = '1.0.0';
const JSON_RPC_VERSION = '2.0';
export const SSE_PATH = '/sse';
const MESSAGE_PATH = '/message';
const TOOL_OPEN_FILE = 'openFile';
const TOOL_GET_DIAGNOSTICS = 'getDiagnostics';
const TOOL_CLOSE_ALL_DIFF_TABS = 'closeAllDiffTabs';
const NOTIFICATION_SELECTION_CHANGED = 'selection_changed';
const NOTIFICATION_IDE_CONNECTED = 'ide_connected';
const NOTIFICATION_FILE_UPDATED = 'file_updated';
const NOTIFICATION_EXPERIMENT_GATES = 'experiment_gates';

export interface ClaudeIdeSelectionPoint {
  line: number;
  character: number;
}

export interface ClaudeIdeSelectionRange {
  start: ClaudeIdeSelectionPoint;
  end: ClaudeIdeSelectionPoint;
}

export interface ClaudeIdeSelectionChangedParams {
  filePath: string;
  text: string;
  selection: ClaudeIdeSelectionRange;
}

export interface ClaudeIdeDiagnostic {
  message: string;
  severity: 'Error' | 'Warning' | 'Info' | 'Hint';
  range: ClaudeIdeSelectionRange;
  source?: string;
  code?: string;
}

export interface ClaudeIdeDiagnosticFile {
  uri: string;
  diagnostics: ClaudeIdeDiagnostic[];
}

export interface ClaudeIdeOpenFileParams {
  filePath?: string;
  preview?: boolean;
  startText?: string;
  endText?: string;
  selectToEndOfLine?: boolean;
  makeFrontmost?: boolean;
  selection?: ClaudeIdeSelectionRange | null;
}

export interface ClaudeIdeFileUpdatedParams {
  filePath?: string;
  oldContent?: string | null;
  newContent?: string | null;
}

interface JsonRpcRequest {
  jsonrpc?: string;
  id?: number | string | null;
  method?: string;
  params?: unknown;
}

interface JsonRpcSuccessResponse {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: number | string | null;
  result: unknown;
}

interface JsonRpcErrorResponse {
  jsonrpc: typeof JSON_RPC_VERSION;
  id: number | string | null;
  error: {
    code: number;
    message: string;
  };
}

interface ClaudeIdeToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface TextSelectionLike {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}

export interface TextModelLike {
  readonly uri?: {
    readonly scheme?: string;
    readonly path?: string;
    toString(skipEncoding?: boolean): string;
  };
  getValueInRange?(range: TextSelectionLike): string;
  getValue?(): string;
  setValue?(value: string): void;
}

export interface CodeEditorLike {
  getModel?(): TextModelLike | null;
  getSelection?(): TextSelectionLike | null;
  getPosition?(): { lineNumber: number; column: number } | null;
  onDidChangeCursorSelection?(listener: () => void): { dispose(): void };
  onDidFocusEditorText?(listener: () => void): { dispose(): void };
  onDidChangeModel?(listener: () => void): { dispose(): void };
}

export interface EditorServiceLike {
  readonly activeEditor?: unknown;
  readonly activeTextEditorControl?: unknown;
  onDidActiveEditorChange(listener: () => void): { dispose(): void };
  onDidVisibleEditorsChange(listener: () => void): { dispose(): void };
  openEditor(input: {
    resource: UriLike;
    options?: {
      pinned?: boolean;
      preserveFocus?: boolean;
      selection?: TextSelectionLike;
    };
  }): Promise<unknown>;
}

export interface EditorGroupsServiceLike {
  readonly activeGroup?: {
    readonly activeEditor?: unknown;
  };
}

export interface CodeEditorServiceLike {
  listCodeEditors(): readonly unknown[];
  onCodeEditorAdd(listener: (editor: unknown) => void): { dispose(): void };
  onCodeEditorRemove(listener: (editor: unknown) => void): { dispose(): void };
  getActiveCodeEditor(): unknown;
}

export interface MarkerServiceLike {
  read(filter?: { resource?: UriLike }): Array<{
    resource: { scheme?: string; toString(skipEncoding?: boolean): string };
    severity?: number;
    message: string;
    source?: string;
    code?: string | { value: string };
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }>;
}

export interface ClaudeIdeSession {
  id: string;
  ideConnected: boolean;
  send(event: string, data: string): void;
  sendJsonRpc(message: JsonRpcRequest | JsonRpcSuccessResponse | JsonRpcErrorResponse): void;
  close(): void;
}

function bufferFromText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function stripVirtualPrefix(pathname: string): string {
  const match = pathname.match(/^\/__virtual__\/\d+/);
  return match ? pathname.slice(match[0].length) || '/' : pathname;
}

function parseRequestPath(url: string): URL {
  const parsed = new URL(url, 'http://localhost');
  return new URL(
    `${parsed.origin}${stripVirtualPrefix(parsed.pathname)}${parsed.search}`,
  );
}

function isJsonRpcRequest(value: unknown): value is JsonRpcRequest {
  return !!value && typeof value === 'object';
}

export function isSelectionEmpty(selection: TextSelectionLike): boolean {
  return (
    selection.startLineNumber === selection.endLineNumber &&
    selection.startColumn === selection.endColumn
  );
}

export function isCodeEditorLike(value: unknown): value is CodeEditorLike {
  return !!value && typeof value === 'object' && 'getModel' in value;
}

export function resolveCodeEditorFromControl(control: unknown): CodeEditorLike | null {
  if (
    control &&
    typeof control === 'object' &&
    'getModifiedEditor' in control &&
    typeof (control as { getModifiedEditor?: () => unknown }).getModifiedEditor
      === 'function'
  ) {
    const modifiedEditor = (
      control as { getModifiedEditor: () => unknown }
    ).getModifiedEditor();
    if (isCodeEditorLike(modifiedEditor)) {
      return modifiedEditor;
    }
  }

  return isCodeEditorLike(control) ? control : null;
}

function normalizeDiagnosticSeverity(
  severity: number | undefined,
): ClaudeIdeDiagnostic['severity'] {
  switch (severity) {
    case 8:
      return 'Error';
    case 4:
      return 'Warning';
    case 2:
      return 'Info';
    case 1:
    default:
      return 'Hint';
  }
}

function createJsonRpcSuccess(
  id: number | string | null,
  result: unknown,
): JsonRpcSuccessResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    result,
  };
}

function createJsonRpcError(
  id: number | string | null,
  code: number,
  message: string,
): JsonRpcErrorResponse {
  return {
    jsonrpc: JSON_RPC_VERSION,
    id,
    error: { code, message },
  };
}

function createSseEvent(event: string, data: string): string {
  return `event: ${event}\ndata: ${data}\n\n`;
}

function createEmptyToolResult(): ClaudeIdeToolResult {
  return {
    content: [{ type: 'text', text: '' }],
  };
}

function resolveMarkerCode(
  code: string | { value: string } | undefined,
): string | undefined {
  if (typeof code === 'string') {
    return code;
  }

  return code?.value;
}

export function buildClaudeIdeMcpConfig(sseUrl: string): string {
  return JSON.stringify({
    mcpServers: {
      [CLAUDE_IDE_SERVER_NAME]: {
        type: CLAUDE_IDE_TRANSPORT_TYPE,
        url: sseUrl,
        ideName: CLAUDE_IDE_NAME,
      },
    },
  });
}

export function normalizeClaudeIdeFilePath(filePath: string): string {
  const trimmed = filePath.trim();
  if (!trimmed.startsWith('file://')) {
    return trimmed;
  }

  try {
    return new URL(trimmed).pathname || trimmed;
  } catch {
    return trimmed.replace(/^file:\/\//, "");
  }
}

export function createClaudeIdeSelectionChangedParams(
  filePath: string,
  selection: TextSelectionLike,
  text: string,
): ClaudeIdeSelectionChangedParams {
  return {
    filePath,
    text,
    selection: {
      start: {
        line: Math.max(selection.startLineNumber - 1, 0),
        character: Math.max(selection.startColumn - 1, 0),
      },
      end: {
        line: Math.max(selection.endLineNumber - 1, 0),
        character: Math.max(selection.endColumn - 1, 0),
      },
    },
  };
}

export function createClaudeIdeDiagnosticFiles(
  markers: Array<{
    resource: { scheme?: string; toString(skipEncoding?: boolean): string };
    severity?: number;
    message: string;
    source?: string;
    code?: string | { value: string };
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  }>,
): ClaudeIdeDiagnosticFile[] {
  const grouped = new Map<string, ClaudeIdeDiagnostic[]>();

  for (const marker of markers) {
    const resourceUri = marker.resource.toString();
    if (!resourceUri.startsWith('file://')) {
      continue;
    }

    const fileDiagnostics = grouped.get(resourceUri) ?? [];
    fileDiagnostics.push({
      message: marker.message,
      severity: normalizeDiagnosticSeverity(marker.severity),
      source: marker.source,
      code: resolveMarkerCode(marker.code),
      range: {
        start: {
          line: Math.max(marker.startLineNumber - 1, 0),
          character: Math.max(marker.startColumn - 1, 0),
        },
        end: {
          line: Math.max(marker.endLineNumber - 1, 0),
          character: Math.max(marker.endColumn - 1, 0),
        },
      },
    });
    grouped.set(resourceUri, fileDiagnostics);
  }

  return [...grouped.entries()].map(([uri, diagnostics]) => ({
    uri,
    diagnostics,
  }));
}

export function serializeClaudeIdeDiagnosticsResult(
  diagnostics: ClaudeIdeDiagnosticFile[],
): ClaudeIdeToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(diagnostics) }],
  };
}

export class ClaudeIdeVirtualServer {
  listening = true;

  private readonly sessions = new Map<string, ClaudeIdeSession>();

  constructor(
    private readonly port: number,
    private readonly handlers: {
      getSelection: () => Promise<ClaudeIdeSelectionChangedParams | null>;
      openFile: (params: ClaudeIdeOpenFileParams) => Promise<void>;
      getDiagnostics: (uri?: string) => Promise<ClaudeIdeDiagnosticFile[]>;
      handleFileUpdated: (params: ClaudeIdeFileUpdatedParams) => Promise<void>;
      onClientInitialized?: () => void;
    },
  ) {}

  address(): { port: number; address: string; family: string } {
    return {
      port: this.port,
      address: '0.0.0.0',
      family: 'IPv4',
    };
  }

  async handleRequest(
    method: string,
    url: string,
    _headers: Record<string, string>,
    body?: Uint8Array | string,
  ) {
    const parsedUrl = parseRequestPath(url);

    if (method === 'POST' && parsedUrl.pathname === MESSAGE_PATH) {
      return this.handleMessagePost(parsedUrl, body);
    }

    if (method === 'GET' && parsedUrl.pathname === SSE_PATH) {
      return {
        statusCode: 400,
        statusMessage: 'Bad Request',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: bufferFromText('Use an EventSource request for SSE.'),
      };
    }

    return {
      statusCode: 404,
      statusMessage: 'Not Found',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: bufferFromText('Not Found'),
    };
  }

  async handleStreamingRequest(
    method: string,
    url: string,
    _headers: Record<string, string>,
    _body: Uint8Array | string | undefined,
    onStart: (
      statusCode: number,
      statusMessage: string,
      headers: Record<string, string>,
    ) => void,
    onChunk: (chunk: string | Uint8Array) => void,
    onEnd: () => void,
  ): Promise<void> {
    const parsedUrl = parseRequestPath(url);
    if (method !== 'GET' || parsedUrl.pathname !== SSE_PATH) {
      onStart(405, 'Method Not Allowed', {
        'Content-Type': 'text/plain; charset=utf-8',
      });
      onChunk('Method Not Allowed');
      onEnd();
      return;
    }

    onStart(200, 'OK', {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    await new Promise<void>((resolve) => {
      const sessionId = crypto.randomUUID();
      let closed = false;
      const session: ClaudeIdeSession = {
        id: sessionId,
        ideConnected: false,
        send: (event, data) => {
          if (closed) {
            return;
          }
          onChunk(createSseEvent(event, data));
        },
        sendJsonRpc: (message) => {
          session.send('message', JSON.stringify(message));
        },
        close: () => {
          if (closed) {
            return;
          }
          closed = true;
          this.sessions.delete(sessionId);
          onEnd();
          resolve();
        },
      };

      this.sessions.set(sessionId, session);
      session.send(
        'endpoint',
        `${MESSAGE_PATH}?sessionId=${encodeURIComponent(sessionId)}`,
      );
    });
  }

  async broadcastSelectionChanged(
    selection: ClaudeIdeSelectionChangedParams | null,
  ): Promise<void> {
    if (!selection) {
      return;
    }

    const notification = {
      jsonrpc: JSON_RPC_VERSION,
      method: NOTIFICATION_SELECTION_CHANGED,
      params: selection,
    };

    for (const session of this.sessions.values()) {
      if (!session.ideConnected) {
        continue;
      }

      session.sendJsonRpc(notification);
    }
  }

  dispose(): void {
    this.listening = false;
    for (const session of [...this.sessions.values()]) {
      session.close();
    }
  }

  private async handleMessagePost(
    parsedUrl: URL,
    body?: Uint8Array | string,
  ) {
    const sessionId = parsedUrl.searchParams.get('sessionId');
    if (!sessionId) {
      return {
        statusCode: 400,
        statusMessage: 'Bad Request',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: bufferFromText(
          JSON.stringify(
            createJsonRpcError(null, -32602, 'Missing sessionId query parameter'),
          ),
        ),
      };
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        statusCode: 404,
        statusMessage: 'Not Found',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: bufferFromText(
          JSON.stringify(createJsonRpcError(null, -32001, 'Session not found')),
        ),
      };
    }

    let parsedBody: unknown;
    try {
      const rawBody = typeof body === 'string'
        ? body
        : body
          ? new TextDecoder().decode(body)
          : '';
      parsedBody = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      return {
        statusCode: 400,
        statusMessage: 'Bad Request',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: bufferFromText(
          JSON.stringify(createJsonRpcError(null, -32700, 'Parse error')),
        ),
      };
    }

    const messages = Array.isArray(parsedBody) ? parsedBody : [parsedBody];
    for (const message of messages) {
      if (!isJsonRpcRequest(message)) {
        continue;
      }

      const response = await this.handleJsonRpcMessage(session, message);
      if (response) {
        session.sendJsonRpc(response);
      }
    }

    return {
      statusCode: 202,
      statusMessage: 'Accepted',
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: bufferFromText('Accepted'),
    };
  }

  private async handleJsonRpcMessage(
    session: ClaudeIdeSession,
    message: JsonRpcRequest,
  ): Promise<JsonRpcSuccessResponse | JsonRpcErrorResponse | null> {
    const id = message.id ?? null;
    const method = message.method;
    if (!method) {
      return id === null
        ? null
        : createJsonRpcError(id, -32600, 'Invalid request');
    }

    switch (method) {
      case 'initialize':
        this.handlers.onClientInitialized?.();
        return createJsonRpcSuccess(id, {
          protocolVersion:
            typeof (message.params as { protocolVersion?: unknown } | undefined)
              ?.protocolVersion === 'string'
              ? (message.params as { protocolVersion: string }).protocolVersion
              : CLAUDE_IDE_PROTOCOL_VERSION,
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: CLAUDE_IDE_NAME,
            version: CLAUDE_IDE_SERVER_VERSION,
          },
        });
      case 'notifications/initialized':
        return null;
      case 'ping':
        return createJsonRpcSuccess(id, {});
      case 'tools/list':
        return createJsonRpcSuccess(id, {
          tools: [
            {
              name: TOOL_OPEN_FILE,
              description: 'Open a file in the IDE.',
              inputSchema: {
                type: 'object',
                properties: {
                  filePath: { type: 'string' },
                  preview: { type: 'boolean' },
                  startText: { type: 'string' },
                  endText: { type: 'string' },
                  selectToEndOfLine: { type: 'boolean' },
                  makeFrontmost: { type: 'boolean' },
                  selection: {
                    type: 'object',
                    properties: {
                      start: {
                        type: 'object',
                        properties: {
                          line: { type: 'number' },
                          character: { type: 'number' },
                        },
                      },
                      end: {
                        type: 'object',
                        properties: {
                          line: { type: 'number' },
                          character: { type: 'number' },
                        },
                      },
                    },
                  },
                },
                required: ['filePath'],
              },
            },
            {
              name: TOOL_GET_DIAGNOSTICS,
              description: 'Get diagnostics for one file or the entire workspace.',
              inputSchema: {
                type: 'object',
                properties: {
                  uri: { type: 'string' },
                },
              },
            },
            {
              name: TOOL_CLOSE_ALL_DIFF_TABS,
              description: 'Close all diff tabs in the IDE.',
              inputSchema: {
                type: 'object',
                properties: {},
              },
            },
          ],
        });
      case 'tools/call':
        return this.handleToolCall(id, message.params);
      case NOTIFICATION_IDE_CONNECTED:
        session.ideConnected = true;
        await this.broadcastSelectionChanged(await this.handlers.getSelection());
        return null;
      case NOTIFICATION_FILE_UPDATED:
        await this.handlers.handleFileUpdated(
          (message.params ?? {}) as ClaudeIdeFileUpdatedParams,
        );
        return null;
      case NOTIFICATION_EXPERIMENT_GATES:
        return null;
      default:
        return id === null
          ? null
          : createJsonRpcError(id, -32601, `Method not found: ${method}`);
    }
  }

  private async handleToolCall(
    id: number | string | null,
    params: unknown,
  ): Promise<JsonRpcSuccessResponse | JsonRpcErrorResponse> {
    const request = (params ?? {}) as {
      name?: string;
      arguments?: unknown;
    };
    const toolName = request.name;
    if (!toolName) {
      return createJsonRpcError(id, -32602, 'Tool name is required');
    }

    try {
      switch (toolName) {
        case TOOL_OPEN_FILE:
          await this.handlers.openFile(
            (request.arguments ?? {}) as ClaudeIdeOpenFileParams,
          );
          return createJsonRpcSuccess(id, createEmptyToolResult());
        case TOOL_GET_DIAGNOSTICS:
          return createJsonRpcSuccess(
            id,
            serializeClaudeIdeDiagnosticsResult(
              await this.handlers.getDiagnostics(
                typeof (request.arguments as { uri?: unknown } | undefined)?.uri
                  === 'string'
                  ? ((request.arguments as { uri: string }).uri)
                  : undefined,
              ),
            ),
          );
        case TOOL_CLOSE_ALL_DIFF_TABS:
          return createJsonRpcSuccess(id, createEmptyToolResult());
        default:
          return createJsonRpcError(id, -32601, `Unknown tool: ${toolName}`);
      }
    } catch (error) {
      return createJsonRpcSuccess(id, {
        content: [
          {
            type: 'text',
            text: error instanceof Error ? error.message : String(error),
          },
        ],
        isError: true,
      });
    }
  }
}

