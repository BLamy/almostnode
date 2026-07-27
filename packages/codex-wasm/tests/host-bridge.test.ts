import { MessageChannel } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import {
  createCodexHostBridge,
  type CodexHostEvent,
  type CodexHostRequest,
  type CodexHostResponse,
  type CodexHostRunResult,
  type CodexHostTerminalSession,
} from "../src/host-bridge";
import type { MessagePortLike } from "../src/message-port-transport";

describe("CodexHostBridge", () => {
  it("serves VFS operations through host bridge requests", async () => {
    const vfs = new FakeVfs();
    const bridge = createCodexHostBridge({
      container: {
        vfs,
        createTerminalSession: createFakeTerminalSession,
      },
    });
    const channel = new MessageChannel();
    const clientPort = channel.port2 as unknown as MessagePortLike;
    bridge.attach(channel.port1 as unknown as MessagePortLike);

    await requestHost(clientPort, {
      type: "codex/host/request",
      id: "mkdir",
      op: "fs/createDirectory",
      params: { path: "/workspace/src" },
    });
    await requestHost(clientPort, {
      type: "codex/host/request",
      id: "write",
      op: "fs/writeFile",
      params: { path: "/workspace/src/index.ts", content: "export {};\n" },
    });

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "read",
        op: "fs/readFile",
        params: { path: "/workspace/src/index.ts" },
      }),
    ).resolves.toMatchObject({
      result: { content: "export {};\n", encoding: "utf8" },
    });

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "list",
        op: "fs/readDirectory",
        params: { path: "/workspace/src" },
      }),
    ).resolves.toMatchObject({
      result: {
        entries: [
          {
            name: "index.ts",
            path: "/workspace/src/index.ts",
            type: "file",
          },
        ],
      },
    });

    bridge.dispose();
    channel.port2.close();
  });

  it("applies Codex patches through the host filesystem bridge", async () => {
    const vfs = new FakeVfs();
    const bridge = createCodexHostBridge({
      container: {
        vfs,
        createTerminalSession: createFakeTerminalSession,
      },
    });
    const channel = new MessageChannel();
    const clientPort = channel.port2 as unknown as MessagePortLike;
    bridge.attach(channel.port1 as unknown as MessagePortLike);

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "patch-add",
        op: "fs/applyPatch",
        params: {
          cwd: "/workspace",
          patch:
            "*** Begin Patch\n*** Add File: src/index.ts\n+export const value = 1;\n*** End Patch\n",
        },
      }),
    ).resolves.toMatchObject({
      result: {
        exitCode: 0,
        stdout:
          "Success. Updated the following files:\nA src/index.ts\n",
      },
    });
    expect(vfs.readFileSync("/workspace/src/index.ts", "utf8")).toBe(
      "export const value = 1;\n",
    );

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "patch-update",
        op: "fs/applyPatch",
        params: {
          cwd: "/workspace",
          patch:
            "*** Begin Patch\n*** Update File: src/index.ts\n@@\n-export const value = 1;\n+export const value = 2;\n*** End Patch\n",
        },
      }),
    ).resolves.toMatchObject({
      result: {
        exitCode: 0,
        stdout:
          "Success. Updated the following files:\nM src/index.ts\n",
      },
    });
    expect(vfs.readFileSync("/workspace/src/index.ts", "utf8")).toBe(
      "export const value = 2;\n",
    );

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "patch-delete",
        op: "fs/applyPatch",
        params: {
          cwd: "/workspace",
          patch:
            "*** Begin Patch\n*** Delete File: src/index.ts\n*** End Patch\n",
        },
      }),
    ).resolves.toMatchObject({
      result: {
        exitCode: 0,
        stdout:
          "Success. Updated the following files:\nD src/index.ts\n",
      },
    });
    expect(() => vfs.readFileSync("/workspace/src/index.ts", "utf8")).toThrow(
      "ENOENT",
    );

    bridge.dispose();
    channel.port2.close();
  });

  it("Add File overwrites an existing file (codex-rs parity)", async () => {
    const vfs = new FakeVfs();
    const bridge = createCodexHostBridge({
      container: {
        vfs,
        createTerminalSession: createFakeTerminalSession,
      },
    });
    const channel = new MessageChannel();
    const clientPort = channel.port2 as unknown as MessagePortLike;
    bridge.attach(channel.port1 as unknown as MessagePortLike);

    vfs.writeFileSync("/workspace/src/pages/Home.tsx", "old content\n");

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "patch-add-overwrite",
        op: "fs/applyPatch",
        params: {
          cwd: "/workspace",
          patch:
            "*** Begin Patch\n*** Add File: src/pages/Home.tsx\n+new homepage\n*** End Patch\n",
        },
      }),
    ).resolves.toMatchObject({
      result: {
        exitCode: 0,
        stdout: "Success. Updated the following files:\nA src/pages/Home.tsx\n",
      },
    });
    expect(vfs.readFileSync("/workspace/src/pages/Home.tsx", "utf8")).toBe(
      "new homepage\n",
    );

    bridge.dispose();
    channel.port2.close();
  });

  it("runs commands through TerminalSession and streams output deltas", async () => {
    const vfs = new FakeVfs();
    const bridge = createCodexHostBridge({
      container: {
        vfs,
        createTerminalSession: createFakeTerminalSession,
      },
    });
    const channel = new MessageChannel();
    const clientPort = channel.port2 as unknown as MessagePortLike;
    const events: CodexHostEvent[] = [];
    channel.port2.addEventListener("message", (event) => {
      const message = event.data as CodexHostEvent;
      if (message?.type === "codex/host/event") {
        events.push(message);
      }
    });
    channel.port2.start();
    bridge.attach(channel.port1 as unknown as MessagePortLike);

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "exec",
        op: "command/exec",
        params: {
          processId: "proc_1",
          command: ["npm", "test", "--", "one file.ts"],
          streamStdoutStderr: true,
        },
      }),
    ).resolves.toMatchObject({
      result: {
        processId: "proc_1",
        exitCode: 0,
        stdout: "ran npm test -- 'one file.ts'\n",
        stderr: "",
      },
    });

    expect(events).toMatchObject([
      {
        type: "codex/host/event",
        event: "command/outputDelta",
        params: {
          processId: "proc_1",
          stream: "stdout",
          deltaBase64: Buffer.from("ran npm test -- 'one file.ts'\n").toString(
            "base64",
          ),
        },
      },
    ]);

    bridge.dispose();
    channel.port2.close();
  });

  it("routes command/exec follow-up controls to the active session", async () => {
    const vfs = new FakeVfs();
    const session = new ControlledTerminalSession();
    const bridge = createCodexHostBridge({
      container: {
        vfs,
        createTerminalSession: () => session,
      },
    });
    const channel = new MessageChannel();
    const clientPort = channel.port2 as unknown as MessagePortLike;
    bridge.attach(channel.port1 as unknown as MessagePortLike);

    const execPromise = requestHost(clientPort, {
      type: "codex/host/request",
      id: "exec",
      op: "command/exec",
      params: {
        processId: "proc_2",
        command: ["node", "/interactive.js"],
        streamStdin: true,
        streamStdoutStderr: true,
      },
    });

    await waitFor(() => session.running);

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "resize",
        op: "command/resize",
        params: {
          processId: "proc_2",
          cols: 120,
          rows: 40,
        },
      }),
    ).resolves.toMatchObject({
      result: {
        processId: "proc_2",
        cols: 120,
        rows: 40,
      },
    });

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "write",
        op: "command/write",
        params: {
          processId: "proc_2",
          deltaBase64: Buffer.from("hello\n").toString("base64"),
        },
      }),
    ).resolves.toMatchObject({
      result: {
        processId: "proc_2",
      },
    });

    await expect(execPromise).resolves.toMatchObject({
      result: {
        processId: "proc_2",
        exitCode: 0,
        stdout: "done\n",
        stderr: "",
      },
    });
    expect(session.inputs).toEqual(["hello\n"]);
    expect(session.sizes).toEqual([{ cols: 120, rows: 40 }]);
    expect(session.disposed).toBe(true);

    bridge.dispose();
    channel.port2.close();
  });

  it("routes network/fetch through the container network controller", async () => {
    const vfs = new FakeVfs();
    const networkRequests: unknown[] = [];
    const bridge = createCodexHostBridge({
      container: {
        vfs,
        network: {
          async fetch(request) {
            networkRequests.push(request);
            return {
              url: request.url,
              status: 200,
              statusText: "OK",
              headers: { "content-type": "text/plain" },
              bodyBase64: Buffer.from("network ok").toString("base64"),
            };
          },
        },
        createTerminalSession: createFakeTerminalSession,
      },
    });
    const channel = new MessageChannel();
    const clientPort = channel.port2 as unknown as MessagePortLike;
    bridge.attach(channel.port1 as unknown as MessagePortLike);

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "network",
        op: "network/fetch",
        params: {
          url: "https://api.openai.com/v1/responses",
          method: "POST",
          headers: {
            authorization: "Bearer test-key",
            "content-type": "application/json",
          },
          bodyBase64: Buffer.from('{"stream":true}').toString("base64"),
          redirect: "follow",
          credentials: "same-origin",
          retryOnTailscaleRecovery: true,
        },
      }),
    ).resolves.toMatchObject({
      result: {
        url: "https://api.openai.com/v1/responses",
        status: 200,
        statusText: "OK",
        headers: { "content-type": "text/plain" },
        bodyBase64: Buffer.from("network ok").toString("base64"),
      },
    });

    expect(networkRequests).toEqual([
      {
        url: "https://api.openai.com/v1/responses",
        method: "POST",
        headers: {
          authorization: "Bearer test-key",
          "content-type": "application/json",
        },
        bodyBase64: Buffer.from('{"stream":true}').toString("base64"),
        redirect: "follow",
        credentials: "same-origin",
        retryOnTailscaleRecovery: true,
      },
    ]);

    bridge.dispose();
    channel.port2.close();
  });

  it("exposes each network stream chunk before the response body completes", async () => {
    const vfs = new FakeVfs();
    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        bodyController = controller;
        controller.enqueue(new TextEncoder().encode("first"));
      },
    });
    const bridge = createCodexHostBridge({
      container: {
        vfs,
        network: {
          async fetch() {
            throw new Error("buffered fetch must not be used");
          },
          async fetchStream(request) {
            return {
              url: request.url,
              status: 200,
              statusText: "OK",
              headers: { "content-type": "text/event-stream" },
              body,
            };
          },
        },
        createTerminalSession: createFakeTerminalSession,
      },
    });
    const channel = new MessageChannel();
    const clientPort = channel.port2 as unknown as MessagePortLike;
    bridge.attach(channel.port1 as unknown as MessagePortLike);

    const opened = await requestHost(clientPort, {
      type: "codex/host/request",
      id: "stream-open",
      op: "network/fetchStreamOpen",
      params: {
        url: "https://api.openai.com/v1/responses",
        method: "POST",
      },
    });
    expect(opened.result).toMatchObject({
      streamId: "codex-network-1",
      status: 200,
      headers: { "content-type": "text/event-stream" },
    });

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "stream-read-first",
        op: "network/fetchStreamRead",
        params: { streamId: "codex-network-1" },
      }),
    ).resolves.toMatchObject({
      result: {
        chunkBase64: Buffer.from("first").toString("base64"),
        done: false,
      },
    });

    let secondReadSettled = false;
    const secondRead = requestHost(clientPort, {
      type: "codex/host/request",
      id: "stream-read-second",
      op: "network/fetchStreamRead",
      params: { streamId: "codex-network-1" },
    }).finally(() => {
      secondReadSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondReadSettled).toBe(false);

    bodyController.enqueue(new TextEncoder().encode("second"));
    await expect(secondRead).resolves.toMatchObject({
      result: {
        chunkBase64: Buffer.from("second").toString("base64"),
        done: false,
      },
    });

    bodyController.close();
    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "stream-read-done",
        op: "network/fetchStreamRead",
        params: { streamId: "codex-network-1" },
      }),
    ).resolves.toMatchObject({
      result: { chunkBase64: "", done: true },
    });
    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "stream-read-after-done",
        op: "network/fetchStreamRead",
        params: { streamId: "codex-network-1" },
      }),
    ).resolves.toMatchObject({
      error: {
        code: "ENOENT",
        message: "Unknown Codex network stream: codex-network-1",
      },
    });

    bridge.dispose();
    channel.port2.close();
  });

  it("adapts legacy buffered network controllers into a one-chunk stream", async () => {
    const bridge = createCodexHostBridge({
      container: {
        vfs: new FakeVfs(),
        network: {
          async fetch(request) {
            return {
              url: request.url,
              status: 200,
              statusText: "OK",
              headers: { "content-type": "text/plain" },
              bodyBase64: Buffer.from("legacy").toString("base64"),
            };
          },
        },
        createTerminalSession: createFakeTerminalSession,
      },
    });
    const channel = new MessageChannel();
    const clientPort = channel.port2 as unknown as MessagePortLike;
    bridge.attach(channel.port1 as unknown as MessagePortLike);

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "legacy-stream-open",
        op: "network/fetchStreamOpen",
        params: { url: "https://example.com/legacy" },
      }),
    ).resolves.toMatchObject({
      result: {
        streamId: "codex-network-1",
        status: 200,
      },
    });
    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "legacy-stream-read",
        op: "network/fetchStreamRead",
        params: { streamId: "codex-network-1" },
      }),
    ).resolves.toMatchObject({
      result: {
        chunkBase64: Buffer.from("legacy").toString("base64"),
        done: false,
      },
    });
    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "legacy-stream-done",
        op: "network/fetchStreamRead",
        params: { streamId: "codex-network-1" },
      }),
    ).resolves.toMatchObject({
      result: { chunkBase64: "", done: true },
    });

    bridge.dispose();
    channel.port2.close();
  });

  it("cancels and forgets network streams on cancel and dispose", async () => {
    const vfs = new FakeVfs();
    const cancelled: number[] = [];
    let streamNumber = 0;
    const bridge = createCodexHostBridge({
      container: {
        vfs,
        network: {
          async fetch() {
            throw new Error("buffered fetch must not be used");
          },
          async fetchStream(request) {
            const currentStream = ++streamNumber;
            return {
              url: request.url,
              status: 200,
              statusText: "OK",
              headers: {},
              body: new ReadableStream<Uint8Array>({
                cancel() {
                  cancelled.push(currentStream);
                },
              }),
            };
          },
        },
        createTerminalSession: createFakeTerminalSession,
      },
    });
    const channel = new MessageChannel();
    const clientPort = channel.port2 as unknown as MessagePortLike;
    bridge.attach(channel.port1 as unknown as MessagePortLike);

    for (const id of ["first", "second"]) {
      await requestHost(clientPort, {
        type: "codex/host/request",
        id: `stream-open-${id}`,
        op: "network/fetchStreamOpen",
        params: { url: `https://example.com/${id}` },
      });
    }

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "stream-cancel",
        op: "network/fetchStreamCancel",
        params: { streamId: "codex-network-1" },
      }),
    ).resolves.toMatchObject({
      result: {
        streamId: "codex-network-1",
        cancelled: true,
      },
    });
    expect(cancelled).toEqual([1]);
    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "stream-cancel-again",
        op: "network/fetchStreamCancel",
        params: { streamId: "codex-network-1" },
      }),
    ).resolves.toMatchObject({
      error: { code: "ENOENT" },
    });

    bridge.dispose();
    await waitFor(() => cancelled.includes(2));
    expect(cancelled).toEqual([1, 2]);
    channel.port2.close();
  });

  it("spawns process sessions and emits process lifecycle events", async () => {
    const vfs = new FakeVfs();
    const session = new ControlledTerminalSession();
    const bridge = createCodexHostBridge({
      container: {
        vfs,
        createTerminalSession: () => session,
      },
    });
    const channel = new MessageChannel();
    const clientPort = channel.port2 as unknown as MessagePortLike;
    const events: CodexHostEvent[] = [];
    channel.port2.addEventListener("message", (event) => {
      const message = event.data as CodexHostEvent;
      if (message?.type === "codex/host/event") {
        events.push(message);
      }
    });
    channel.port2.start();
    bridge.attach(channel.port1 as unknown as MessagePortLike);

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "spawn",
        op: "process/spawn",
        params: {
          processHandle: "process_1",
          command: ["node", "/process.js"],
          cwd: "/workspace",
          tty: true,
          streamStdin: true,
          streamStdoutStderr: true,
          size: {
            cols: 100,
            rows: 30,
          },
        },
      }),
    ).resolves.toMatchObject({
      result: {
        processHandle: "process_1",
      },
    });

    await waitFor(() => session.running);
    expect(session.sizes).toEqual([{ cols: 100, rows: 30 }]);

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "resize",
        op: "process/resizePty",
        params: {
          processHandle: "process_1",
          cols: 120,
          rows: 42,
        },
      }),
    ).resolves.toMatchObject({
      result: {
        processHandle: "process_1",
        cols: 120,
        rows: 42,
      },
    });

    await expect(
      requestHost(clientPort, {
        type: "codex/host/request",
        id: "write",
        op: "process/writeStdin",
        params: {
          processHandle: "process_1",
          deltaBase64: Buffer.from("hello process\n").toString("base64"),
        },
      }),
    ).resolves.toMatchObject({
      result: {
        processHandle: "process_1",
      },
    });

    await waitFor(() =>
      events.some((event) => event.event === "process/exited"),
    );

    expect(session.inputs).toEqual(["hello process\n"]);
    expect(session.sizes).toEqual([
      { cols: 100, rows: 30 },
      { cols: 120, rows: 42 },
    ]);
    expect(events).toEqual([
      {
        type: "codex/host/event",
        event: "process/outputDelta",
        params: {
          processHandle: "process_1",
          stream: "stdout",
          deltaBase64: Buffer.from("ready\n").toString("base64"),
        },
      },
      {
        type: "codex/host/event",
        event: "process/outputDelta",
        params: {
          processHandle: "process_1",
          stream: "stdout",
          deltaBase64: Buffer.from("got:hello process\n").toString("base64"),
        },
      },
      {
        type: "codex/host/event",
        event: "process/exited",
        params: {
          processHandle: "process_1",
          exitCode: 0,
          stdout: "",
          stdoutCapReached: false,
          stderr: "",
          stderrCapReached: false,
        },
      },
    ]);
    expect(session.disposed).toBe(true);

    bridge.dispose();
    channel.port2.close();
  });
});

class FakeVfs {
  private readonly files = new Map<string, Uint8Array>();
  private readonly directories = new Set<string>(["/"]);
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  readFileSync(path: string): Uint8Array;
  readFileSync(path: string, encoding: "utf8" | "utf-8"): string;
  readFileSync(path: string, encoding?: "utf8" | "utf-8"): Uint8Array | string {
    const content = this.files.get(path);
    if (!content) throw new Error(`ENOENT: ${path}`);
    return encoding ? this.decoder.decode(content) : content;
  }

  writeFileSync(path: string, data: string | Uint8Array): void {
    this.mkdirSync(parentPath(path), { recursive: true });
    this.files.set(
      path,
      typeof data === "string" ? this.encoder.encode(data) : data,
    );
  }

  unlinkSync(path: string): void {
    if (!this.files.delete(path)) {
      throw new Error(`ENOENT: ${path}`);
    }
  }

  mkdirSync(path: string, options?: { recursive?: boolean }): void {
    if (options?.recursive) {
      const parts = path.split("/").filter(Boolean);
      let current = "";
      for (const part of parts) {
        current += `/${part}`;
        this.directories.add(current);
      }
      return;
    }
    this.directories.add(path);
  }

  readdirSync(path: string): string[] {
    const prefix = path === "/" ? "/" : `${path}/`;
    const names = new Set<string>();
    for (const directory of this.directories) {
      if (directory.startsWith(prefix) && directory !== path) {
        const rest = directory.slice(prefix.length);
        const first = rest.split("/")[0];
        if (first) names.add(first);
      }
    }
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) {
        const rest = file.slice(prefix.length);
        const first = rest.split("/")[0];
        if (first) names.add(first);
      }
    }
    return Array.from(names);
  }

  statSync(path: string) {
    const file = this.files.get(path);
    if (file) {
      return {
        isDirectory: () => false,
        size: file.byteLength,
        mtimeMs: 0,
        mode: 0o644,
      };
    }
    if (this.directories.has(path)) {
      return {
        isDirectory: () => true,
        size: 0,
        mtimeMs: 0,
        mode: 0o755,
      };
    }
    throw new Error(`ENOENT: ${path}`);
  }
}

function createFakeTerminalSession(): CodexHostTerminalSession {
  let running = false;
  return {
    async run(command, options): Promise<CodexHostRunResult> {
      running = true;
      const stdout = `ran ${command}\n`;
      options?.onStdout?.(stdout);
      running = false;
      return { stdout, stderr: "", exitCode: 0 };
    },
    sendInput() {},
    resize() {},
    abort() {},
    dispose() {},
  };
}

class ControlledTerminalSession implements CodexHostTerminalSession {
  inputs: string[] = [];
  sizes: Array<{ cols: number; rows: number }> = [];
  running = false;
  disposed = false;
  private runOptions:
    | {
        onStdout?: (data: string) => void;
        onStderr?: (data: string) => void;
      }
    | undefined;
  private finish: ((result: CodexHostRunResult) => void) | null = null;

  run(
    _command?: string,
    options?: {
      onStdout?: (data: string) => void;
      onStderr?: (data: string) => void;
    },
  ): Promise<CodexHostRunResult> {
    this.running = true;
    this.runOptions = options;
    options?.onStdout?.("ready\n");
    return new Promise((resolve) => {
      this.finish = (result) => {
        this.running = false;
        resolve(result);
      };
    });
  }

  sendInput(data: string): void {
    this.inputs.push(data);
    this.runOptions?.onStdout?.(`got:${data}`);
    this.finish?.({ stdout: "done\n", stderr: "", exitCode: 0 });
  }

  resize(cols: number, rows: number): void {
    this.sizes.push({ cols, rows });
  }

  abort(): void {
    this.finish?.({ stdout: "", stderr: "", exitCode: 130 });
  }

  dispose(): void {
    this.disposed = true;
  }
}

function requestHost(
  port: MessagePortLike,
  request: CodexHostRequest,
): Promise<CodexHostResponse> {
  const target = port as MessagePortLike & {
    addEventListener: NonNullable<MessagePortLike["addEventListener"]>;
    removeEventListener: NonNullable<MessagePortLike["removeEventListener"]>;
    start: NonNullable<MessagePortLike["start"]>;
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${request.id}`));
    }, 500);

    const onMessage = (event: MessageEvent<unknown>) => {
      const response = event.data as CodexHostResponse;
      if (
        response?.type !== "codex/host/response" ||
        response.id !== request.id
      ) {
        return;
      }
      cleanup();
      resolve(response);
    };

    const cleanup = () => {
      clearTimeout(timer);
      target.removeEventListener("message", onMessage);
    };

    target.addEventListener("message", onMessage);
    target.start();
    target.postMessage(request);
  });
}

function waitFor(predicate: () => boolean): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > 500) {
        reject(new Error("Timed out waiting for condition"));
        return;
      }
      setTimeout(poll, 0);
    };
    poll();
  });
}

function parentPath(path: string): string {
  const index = path.lastIndexOf("/");
  if (index <= 0) return "/";
  return path.slice(0, index);
}
