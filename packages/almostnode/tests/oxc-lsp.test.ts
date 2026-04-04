import { describe, expect, it } from "vitest";
import { runOxcLspSession } from "../src/oxc/lsp";
import type { ChildProcessExecutionContext } from "../src/shims/child_process";

function encodeLspMessage(payload: unknown): string {
  const body = JSON.stringify(payload);
  return `Content-Length: ${new TextEncoder().encode(body).length}\r\n\r\n${body}`;
}

function parseLspMessages(output: string): unknown[] {
  const messages: unknown[] = [];
  let cursor = 0;

  while (cursor < output.length) {
    const headerEnd = output.indexOf("\r\n\r\n", cursor);
    if (headerEnd < 0) {
      break;
    }

    const headerText = output.slice(cursor, headerEnd);
    const contentLengthMatch = /Content-Length:\s*(\d+)/i.exec(headerText);
    if (!contentLengthMatch) {
      break;
    }

    const contentLength = Number(contentLengthMatch[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + contentLength;
    messages.push(JSON.parse(output.slice(bodyStart, bodyEnd)) as unknown);
    cursor = bodyEnd;
  }

  return messages;
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for predicate");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("oxc lsp", () => {
  it("handles initialize/shutdown over stdio and publishes diagnostics", async () => {
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const abortController = new AbortController();
    const execution = {
      id: "exec-1",
      controllerId: "controller-1",
      onStdout: (chunk: string) => {
        stdoutChunks.push(chunk);
      },
      onStderr: (chunk: string) => {
        stderrChunks.push(chunk);
      },
      signal: abortController.signal,
      interactive: true,
      activeProcessStdin: null,
      activeProcess: null,
      activeForkedChildren: 0,
      onForkedChildExit: null,
      activeShellChildren: 0,
      outputStreamed: false,
      columns: 80,
      rows: 24,
    } as ChildProcessExecutionContext;

    const sessionPromise = runOxcLspSession({
      execution,
      accessor: {
        exists(targetPath: string) {
          return targetPath === "/project/.oxlintrc.json";
        },
        readText(targetPath: string) {
          if (targetPath !== "/project/.oxlintrc.json") {
            return null;
          }
          return JSON.stringify({
            rules: {
              "no-console": "error",
            },
          });
        },
      },
    });

    await waitFor(() => execution.activeProcessStdin !== null);
    const stdinTarget = execution.activeProcessStdin as {
      __almostnodePushInput?: (chunk: string) => void;
    };

    stdinTarget.__almostnodePushInput?.(
      encodeLspMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }),
    );
    stdinTarget.__almostnodePushInput?.(
      encodeLspMessage({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri: "file:///project/src/example.ts",
            version: 1,
            text: 'console.log("hello");\n',
          },
        },
      }),
    );
    stdinTarget.__almostnodePushInput?.(
      encodeLspMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "shutdown",
        params: null,
      }),
    );
    stdinTarget.__almostnodePushInput?.(
      encodeLspMessage({
        jsonrpc: "2.0",
        method: "exit",
        params: null,
      }),
    );

    const result = await sessionPromise;
    const messages = parseLspMessages(stdoutChunks.join(""));
    const initializeResponse = messages.find((message) => {
      return Boolean(message && typeof message === "object" && (message as { id?: number }).id === 1);
    }) as { result?: { capabilities?: unknown } } | undefined;
    const diagnosticNotification = messages.find((message) => {
      return Boolean(
        message
          && typeof message === "object"
          && (message as { method?: string }).method === "textDocument/publishDiagnostics",
      );
    }) as { params?: { diagnostics?: Array<{ message?: string }> } } | undefined;

    expect(result.exitCode).toBe(0);
    expect(stderrChunks.join("")).toBe("");
    expect(initializeResponse?.result?.capabilities).toBeTruthy();
    expect(diagnosticNotification?.params?.diagnostics?.length).toBe(1);
    expect(
      diagnosticNotification?.params?.diagnostics?.[0]?.message?.toLowerCase(),
    ).toContain("console");
  });
});
