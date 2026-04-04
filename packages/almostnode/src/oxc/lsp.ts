import type { ChildProcessExecutionContext } from "../shims/child_process";
import type { OxcFileAccessor, OxcDiagnostic } from "./runtime";
import {
  resolveOxcConfigForFile,
  runOxcOnSource,
} from "./runtime";

interface LspDocumentState {
  uri: string;
  version: number;
  text: string;
}

interface JsonRpcMessage {
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
}

function createContentLengthMessage(payload: unknown): string {
  const body = JSON.stringify(payload);
  return `Content-Length: ${new TextEncoder().encode(body).length}\r\n\r\n${body}`;
}

function fileUriToPath(uri: string): string {
  if (uri.startsWith("file://")) {
    return decodeURIComponent(uri.slice("file://".length));
  }
  return uri;
}

function diagnosticSeverityToLspSeverity(severity: OxcDiagnostic["severity"]): number {
  switch (severity) {
    case "error":
      return 1;
    case "warning":
      return 2;
    default:
      return 3;
  }
}

function createLineStarts(sourceText: string): number[] {
  const lineStarts = [0];
  for (let index = 0; index < sourceText.length; index += 1) {
    if (sourceText[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }
  return lineStarts;
}

function offsetToLspPosition(
  lineStarts: number[],
  sourceTextLength: number,
  offset: number,
): { line: number; character: number } {
  const safeOffset = Math.max(0, Math.min(offset, sourceTextLength));
  let lineIndex = 0;
  while (lineIndex + 1 < lineStarts.length && lineStarts[lineIndex + 1]! <= safeOffset) {
    lineIndex += 1;
  }
  return {
    line: lineIndex,
    character: safeOffset - lineStarts[lineIndex]!,
  };
}

function applyTextDocumentChanges(
  previousText: string,
  contentChanges: Array<{ text: string }>,
): string {
  if (contentChanges.length === 0) {
    return previousText;
  }
  return contentChanges[contentChanges.length - 1]!.text;
}

export async function runOxcLspSession(options: {
  execution: ChildProcessExecutionContext;
  accessor: OxcFileAccessor;
}): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const { execution, accessor } = options;
  const documents = new Map<string, LspDocumentState>();
  let inputBuffer = "";
  let finished = false;
  let shutdownRequested = false;
  let exitCode = 0;
  let inputQueue = Promise.resolve();

  const sendMessage = (payload: unknown): void => {
    execution.outputStreamed = true;
    execution.onStdout?.(createContentLengthMessage(payload));
  };

  const publishDiagnostics = async (document: LspDocumentState): Promise<void> => {
    const filePath = fileUriToPath(document.uri);
    const config = resolveOxcConfigForFile(accessor, filePath);
    const result = await runOxcOnSource({
      filePath,
      sourceText: document.text,
      format: false,
      lint: true,
      formatterConfigText: config.formatterConfigText,
      linterConfigText: config.linterConfigText,
    });
    const lineStarts = createLineStarts(document.text);

    sendMessage({
      jsonrpc: "2.0",
      method: "textDocument/publishDiagnostics",
      params: {
        uri: document.uri,
        diagnostics: result.diagnostics.map((diagnostic) => ({
          severity: diagnosticSeverityToLspSeverity(diagnostic.severity),
          message: diagnostic.message,
          source: "oxlint",
          range: {
            start: offsetToLspPosition(lineStarts, document.text.length, diagnostic.start),
            end: offsetToLspPosition(lineStarts, document.text.length, diagnostic.end),
          },
        })),
      },
    });
  };

  const handleRequest = async (message: JsonRpcMessage): Promise<void> => {
    switch (message.method) {
      case "initialize":
        sendMessage({
          jsonrpc: "2.0",
          id: message.id ?? null,
          result: {
            capabilities: {
              textDocumentSync: 1,
            },
            serverInfo: {
              name: "almostnode-oxlint",
              version: "0.1.0",
            },
          },
        });
        return;
      case "initialized":
      case "$/setTrace":
      case "workspace/didChangeConfiguration":
        return;
      case "shutdown":
        shutdownRequested = true;
        sendMessage({
          jsonrpc: "2.0",
          id: message.id ?? null,
          result: null,
        });
        return;
      case "exit":
        exitCode = shutdownRequested ? 0 : 1;
        finished = true;
        return;
      case "textDocument/didOpen": {
        const params = message.params as {
          textDocument: { uri: string; version: number; text: string };
        };
        const document = {
          uri: params.textDocument.uri,
          version: params.textDocument.version,
          text: params.textDocument.text,
        } satisfies LspDocumentState;
        documents.set(document.uri, document);
        await publishDiagnostics(document);
        return;
      }
      case "textDocument/didChange": {
        const params = message.params as {
          textDocument: { uri: string; version: number };
          contentChanges: Array<{ text: string }>;
        };
        const previous = documents.get(params.textDocument.uri);
        const nextDocument = {
          uri: params.textDocument.uri,
          version: params.textDocument.version,
          text: applyTextDocumentChanges(previous?.text ?? "", params.contentChanges),
        } satisfies LspDocumentState;
        documents.set(nextDocument.uri, nextDocument);
        await publishDiagnostics(nextDocument);
        return;
      }
      case "textDocument/didSave": {
        const params = message.params as {
          textDocument: { uri: string };
        };
        const existing = documents.get(params.textDocument.uri);
        if (existing) {
          await publishDiagnostics(existing);
        }
        return;
      }
      case "textDocument/didClose": {
        const params = message.params as {
          textDocument: { uri: string };
        };
        documents.delete(params.textDocument.uri);
        sendMessage({
          jsonrpc: "2.0",
          method: "textDocument/publishDiagnostics",
          params: {
            uri: params.textDocument.uri,
            diagnostics: [],
          },
        });
        return;
      }
      default:
        if (message.id !== undefined) {
          sendMessage({
            jsonrpc: "2.0",
            id: message.id,
            result: null,
          });
        }
    }
  };

  const processInput = async (chunk: string): Promise<void> => {
    inputBuffer += chunk;

    while (true) {
      const headerEnd = inputBuffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        return;
      }

      const headerText = inputBuffer.slice(0, headerEnd);
      const contentLengthMatch = /Content-Length:\s*(\d+)/i.exec(headerText);
      if (!contentLengthMatch) {
        inputBuffer = "";
        return;
      }

      const contentLength = Number(contentLengthMatch[1]);
      const bodyStart = headerEnd + 4;
      if (inputBuffer.length < bodyStart + contentLength) {
        return;
      }

      const body = inputBuffer.slice(bodyStart, bodyStart + contentLength);
      inputBuffer = inputBuffer.slice(bodyStart + contentLength);

      try {
        await handleRequest(JSON.parse(body) as JsonRpcMessage);
      } catch (error) {
        execution.outputStreamed = true;
        execution.onStderr?.(
          `[almostnode-oxlint-lsp] ${error instanceof Error ? error.message : String(error)}\n`,
        );
      }
    }
  };

  const stdinTarget = {
    emit() {},
    listenerCount() {
      return 0;
    },
    __almostnodePushInput(data: string) {
      inputQueue = inputQueue
        .then(() => processInput(data))
        .catch((error) => {
          execution.outputStreamed = true;
          execution.onStderr?.(
            `[almostnode-oxlint-lsp] ${error instanceof Error ? error.message : String(error)}\n`,
          );
        });
    },
  };

  execution.activeProcessStdin = stdinTarget as unknown as ChildProcessExecutionContext["activeProcessStdin"];
  execution.outputStreamed = true;

  while (!execution.signal?.aborted && !finished) {
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }

  await inputQueue;
  execution.activeProcessStdin = null;
  return {
    stdout: "",
    stderr: "",
    exitCode: execution.signal?.aborted ? 130 : exitCode,
  };
}
