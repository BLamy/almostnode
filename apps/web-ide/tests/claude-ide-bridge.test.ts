import { describe, expect, it, vi } from 'vitest';

vi.mock('@codingame/monaco-vscode-api', () => ({
  getService: vi.fn(),
  ICodeEditorService: class {},
}));
vi.mock('@codingame/monaco-vscode-api/services', () => ({
  IEditorGroupsService: class {},
  IEditorService: class {},
  IMarkerService: class {},
}));
vi.mock('@codingame/monaco-vscode-api/vscode/vs/base/common/uri', () => ({
  URI: {
    parse(value: string) {
      if (value.startsWith('file://')) {
        const url = new URL(value);
        return {
          scheme: 'file',
          path: url.pathname,
          toString: () => value,
        };
      }

      return {
        scheme: 'file',
        path: value,
        toString: () => value,
      };
    },
    file(path: string) {
      return {
        scheme: 'file',
        path,
        toString: () => `file://${path}`,
      };
    },
  },
}));
vi.mock('@codingame/monaco-vscode-api/vscode/vs/workbench/common/editor', () => ({
  EditorResourceAccessor: {
    getCanonicalUri: vi.fn(),
  },
  SideBySideEditor: {
    PRIMARY: 1,
  },
}));

import {
  buildClaudeIdeMcpConfig,
  ClaudeIdeVirtualServer,
  createClaudeIdeDiagnosticFiles,
  createClaudeIdeSelectionChangedParams,
  normalizeClaudeIdeFilePath,
  serializeClaudeIdeDiagnosticsResult,
} from '../src/features/claude-ide-bridge';

function readSseEventData(chunks: string[], event: string): string[] {
  const text = chunks.join('');
  const pattern = new RegExp(`event: ${event}\\ndata: ([^\\n]*)\\n\\n`, 'g');
  return [...text.matchAll(pattern)].map((match) => match[1] ?? '');
}

describe('Claude IDE bridge helpers', () => {
  it('builds the Claude IDE MCP config payload', () => {
    expect(
      JSON.parse(
        buildClaudeIdeMcpConfig(
          'http://localhost/__virtual__/43127/sse',
        ),
      ),
    ).toEqual({
      mcpServers: {
        ide: {
          type: 'sse-ide',
          url: 'http://localhost/__virtual__/43127/sse',
          ideName: 'almostnode Web IDE',
        },
      },
    });
  });

  it('serializes selection_changed payloads for both selected text and cursor-only states', () => {
    expect(
      createClaudeIdeSelectionChangedParams(
        '/project/src/app.ts',
        {
          startLineNumber: 4,
          startColumn: 3,
          endLineNumber: 6,
          endColumn: 8,
        },
        'selected text',
      ),
    ).toEqual({
      filePath: '/project/src/app.ts',
      text: 'selected text',
      selection: {
        start: { line: 3, character: 2 },
        end: { line: 5, character: 7 },
      },
    });

    expect(
      createClaudeIdeSelectionChangedParams(
        '/project/src/app.ts',
        {
          startLineNumber: 12,
          startColumn: 1,
          endLineNumber: 12,
          endColumn: 1,
        },
        '',
      ),
    ).toEqual({
      filePath: '/project/src/app.ts',
      text: '',
      selection: {
        start: { line: 11, character: 0 },
        end: { line: 11, character: 0 },
      },
    });
  });

  it('normalizes bare paths and file URIs', () => {
    expect(normalizeClaudeIdeFilePath('/project/src/app.ts')).toBe(
      '/project/src/app.ts',
    );
    expect(
      normalizeClaudeIdeFilePath('file:///project/src/app.ts'),
    ).toBe('/project/src/app.ts');
  });

  it('returns diagnostics as one JSON text block with file URIs and 0-based ranges', () => {
    const diagnostics = createClaudeIdeDiagnosticFiles([
      {
        resource: {
          scheme: 'file',
          toString: () => 'file:///project/src/app.ts',
        },
        severity: 8,
        message: 'Broken import',
        source: 'ts',
        code: { value: '2307' },
        startLineNumber: 2,
        startColumn: 5,
        endLineNumber: 2,
        endColumn: 12,
      },
    ]);

    expect(serializeClaudeIdeDiagnosticsResult(diagnostics)).toEqual({
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            {
              uri: 'file:///project/src/app.ts',
              diagnostics: [
                {
                  message: 'Broken import',
                  severity: 'Error',
                  source: 'ts',
                  code: '2307',
                  range: {
                    start: { line: 1, character: 4 },
                    end: { line: 1, character: 11 },
                  },
                },
              ],
            },
          ]),
        },
      ],
    });
  });
});

describe('Claude IDE virtual transport', () => {
  it('exposes the SSE endpoint and sends selection_changed after ide_connected', async () => {
    const server = new ClaudeIdeVirtualServer(43127, {
      getSelection: vi.fn(async () => ({
        filePath: '/project/src/app.ts',
        text: '',
        selection: {
          start: { line: 10, character: 0 },
          end: { line: 10, character: 0 },
        },
      })),
      openFile: vi.fn(async () => undefined),
      getDiagnostics: vi.fn(async () => []),
      handleFileUpdated: vi.fn(async () => undefined),
    });

    const chunks: string[] = [];
    const streamPromise = server.handleStreamingRequest(
      'GET',
      'http://localhost/__virtual__/43127/sse',
      {},
      undefined,
      () => undefined,
      (chunk) => {
        chunks.push(
          typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk),
        );
      },
      () => undefined,
    );

    await Promise.resolve();
    const [endpoint] = readSseEventData(chunks, 'endpoint');
    expect(endpoint).toMatch(/^\/message\?sessionId=/);

    await server.handleRequest(
      'POST',
      `http://localhost/__virtual__/43127${endpoint}`,
      { 'content-type': 'application/json' },
      new TextEncoder().encode(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: { protocolVersion: '2024-11-05' },
        }),
      ),
    );

    await server.handleRequest(
      'POST',
      `http://localhost/__virtual__/43127${endpoint}`,
      { 'content-type': 'application/json' },
      new TextEncoder().encode(
        JSON.stringify({
          jsonrpc: '2.0',
          method: 'ide_connected',
          params: { pid: 12345 },
        }),
      ),
    );

    const messages = readSseEventData(chunks, 'message').map((payload) =>
      JSON.parse(payload),
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 1,
          result: expect.objectContaining({
            serverInfo: expect.objectContaining({
              name: 'almostnode Web IDE',
            }),
          }),
        }),
        expect.objectContaining({
          method: 'selection_changed',
          params: {
            filePath: '/project/src/app.ts',
            text: '',
            selection: {
              start: { line: 10, character: 0 },
              end: { line: 10, character: 0 },
            },
          },
        }),
      ]),
    );

    server.dispose();
    await streamPromise;
  });

  it('routes openFile and getDiagnostics tool calls through the virtual server', async () => {
    const openFile = vi.fn(async () => undefined);
    const getDiagnostics = vi.fn(async () => [
      {
        uri: 'file:///project/src/app.ts',
        diagnostics: [
          {
            message: 'Broken import',
            severity: 'Error' as const,
            range: {
              start: { line: 1, character: 4 },
              end: { line: 1, character: 11 },
            },
          },
        ],
      },
    ]);

    const server = new ClaudeIdeVirtualServer(43127, {
      getSelection: vi.fn(async () => null),
      openFile,
      getDiagnostics,
      handleFileUpdated: vi.fn(async () => undefined),
    });

    const chunks: string[] = [];
    const streamPromise = server.handleStreamingRequest(
      'GET',
      'http://localhost/__virtual__/43127/sse',
      {},
      undefined,
      () => undefined,
      (chunk) => {
        chunks.push(
          typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk),
        );
      },
      () => undefined,
    );

    await Promise.resolve();
    const [endpoint] = readSseEventData(chunks, 'endpoint');

    await server.handleRequest(
      'POST',
      `http://localhost/__virtual__/43127${endpoint}`,
      { 'content-type': 'application/json' },
      new TextEncoder().encode(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'openFile',
            arguments: {
              filePath: 'file:///project/src/app.ts',
              makeFrontmost: false,
            },
          },
        }),
      ),
    );

    await server.handleRequest(
      'POST',
      `http://localhost/__virtual__/43127${endpoint}`,
      { 'content-type': 'application/json' },
      new TextEncoder().encode(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: {
            name: 'getDiagnostics',
            arguments: {
              uri: 'file:///project/src/app.ts',
            },
          },
        }),
      ),
    );

    expect(openFile).toHaveBeenCalledWith({
      filePath: 'file:///project/src/app.ts',
      makeFrontmost: false,
    });
    expect(getDiagnostics).toHaveBeenCalledWith('file:///project/src/app.ts');

    const messages = readSseEventData(chunks, 'message').map((payload) =>
      JSON.parse(payload),
    );
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 2,
          result: {
            content: [{ type: 'text', text: '' }],
          },
        }),
        expect.objectContaining({
          id: 3,
          result: {
            content: [
              {
                type: 'text',
                text: JSON.stringify([
                  {
                    uri: 'file:///project/src/app.ts',
                    diagnostics: [
                      {
                        message: 'Broken import',
                        severity: 'Error',
                        range: {
                          start: { line: 1, character: 4 },
                          end: { line: 1, character: 11 },
                        },
                      },
                    ],
                  },
                ]),
              },
            ],
          },
        }),
      ]),
    );

    server.dispose();
    await streamPromise;
  });
});
