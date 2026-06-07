import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { MessageChannel, MessagePort } from "node:worker_threads";

globalThis.MessagePort ??= MessagePort;
globalThis.__ALMOSTNODE_CODEX_WASM_TRACE = true;

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, "../dist/pkg");
const moduleUrl = pathToFileURL(
  resolve(pkgDir, "codex_wasm.js"),
).href;
const wasmBytes = readFileSync(
  resolve(pkgDir, "codex_wasm_bg.wasm"),
);

const module = await import(moduleUrl);
await module.default({ module_or_path: wasmBytes });

const server = module.createCodexAppServerWasm();
const channel = new MessageChannel();
const hostFiles = new Map();
const hostDirectories = new Set([
  "/",
  "/home",
  "/home/user",
  "/home/user/.codex",
  "/project",
]);
const commandNotifications = [];
const hostCommandWrites = [];
const hostCommandResizes = [];
const hostCommandTerminates = [];
const threadNotifications = [];
const turnNotifications = [];
const processNotifications = [];
const hostNetworkRequests = [];
const hostProcessSpawns = [];
const hostProcessWrites = [];
const hostProcessResizes = [];
const hostProcessKills = [];
const assistantText =
  "Browser Codex is wired through the upstream core runtime.";
const execCommandCallId = "wasm_exec_command_call";
const processOutput = "process output\n";
globalThis.__almostnodeCodexHostRequest = (op, params = {}) =>
  new Promise((resolve, reject) => {
    try {
      resolve(handleHostRequest(channel.port1, op, params));
    } catch (error) {
      reject({
        code: error && typeof error === "object" ? error.code : undefined,
        message: `${
          error instanceof Error ? error.message : String(error)
        } while handling ${op} ${JSON.stringify(params)}`,
      });
    }
  });
channel.port1.on("message", (message) => {
  if (message?.method === "thread/started") {
    threadNotifications.push(message);
    return;
  }
  if (
    typeof message?.method === "string" &&
    (message.method.startsWith("turn/") ||
      message.method.startsWith("item/") ||
      message.method === "thread/status/changed")
  ) {
    turnNotifications.push(message);
    return;
  }
  if (message?.method === "command/exec/outputDelta") {
    commandNotifications.push(message);
    return;
  }
  if (
    message?.method === "process/outputDelta" ||
    message?.method === "process/exited"
  ) {
    processNotifications.push(message);
    return;
  }
  if (message?.type === "codex/host/request") {
    respondToHostRequest(channel.port1, message);
  }
});
server.start(channel.port2, {
  clientInfo: {
    name: "agent_wasm_smoke",
    title: "agent-wasm Smoke",
    version: "0.1.0",
  },
});
channel.port2.start();

const initialize = await request(channel.port1, {
  id: 1,
  method: "initialize",
  params: {
    clientInfo: {
      name: "agent_wasm_smoke",
      title: "agent-wasm Smoke",
      version: "0.1.0",
    },
  },
});
assert.match(
  initialize.result.userAgent,
  /^almostnode-codex-wasm\//,
);
assert.equal(initialize.result.codexHome, "/codex-browser-home");
assert.equal(initialize.result.platformFamily, "wasm");
assert.equal(initialize.result.platformOs, "browser");
channel.port1.postMessage({ method: "initialized", params: {} });

const status = await request(channel.port1, {
  id: 2,
  method: "appServer/status",
});
assert.equal(status.result.status, "ready");
assert.equal(status.result.runtime, "browser-wasm");
assert.equal(status.result.realCodexLinked, true);
assert.equal(status.result.nativeMessageProcessor, false);
assert.equal(status.result.coreThreadRuntime, true);
assert.equal(status.result.protocolBackedReads, true);
assert.equal(status.result.hostBridgeRequestsInFlight, 0);
assert.equal(status.result.initializeSeen, true);
assert.equal(status.result.initialized, true);

const threads = await request(channel.port1, {
  id: 3,
  method: "thread/list",
  params: {},
});
assert.deepEqual(threads.result, {
  data: [],
  nextCursor: null,
  backwardsCursor: null,
});

const threadStart = await request(channel.port1, {
  id: "thread-start",
  method: "thread/start",
  params: {
    model: "gpt-5.4",
    cwd: "/project",
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    sandbox: "workspace-write",
    ephemeral: true,
  },
});
assert.ifError(threadStart.error);
const threadId = threadStart.result.thread.id;
assert.match(threadId, /^[0-9a-fA-F-]{36}$/);
assert.match(threadStart.result.thread.sessionId, /^[0-9a-fA-F-]{36}$/);
assert.equal(threadStart.result.thread.cwd, "/project");
assert.equal(threadStart.result.thread.ephemeral, true);
assert.equal(threadStart.result.thread.source, "appServer");
assert.deepEqual(threadStart.result.thread.status, { type: "idle" });
assert.deepEqual(threadStart.result.thread.turns, []);
assert.equal(threadStart.result.model, "gpt-5.4");
assert.equal(threadStart.result.modelProvider, "openai");
assert.equal(threadStart.result.cwd, "/project");
assert.deepEqual(threadStart.result.sandbox, {
  type: "workspaceWrite",
  writableRoots: [],
  networkAccess: false,
  excludeTmpdirEnvVar: false,
  excludeSlashTmp: false,
});
await waitFor(() => threadNotifications.length === 1, "thread started");
assert.deepEqual(threadNotifications[0], {
  method: "thread/started",
  params: {
    thread: threadStart.result.thread,
  },
});

const loadedThreads = await request(channel.port1, {
  id: "thread-loaded-list",
  method: "thread/loaded/list",
  params: {},
});
assert.ifError(loadedThreads.error);
assert.deepEqual(loadedThreads.result, {
  data: [threadId],
  nextCursor: null,
});

const readThread = await request(channel.port1, {
  id: "thread-read",
  method: "thread/read",
  params: {
    threadId,
    includeTurns: true,
  },
});
assert.ifError(readThread.error);
assert.deepEqual(readThread.result, {
  thread: threadStart.result.thread,
});

const listedThreads = await request(channel.port1, {
  id: "thread-list-after-start",
  method: "thread/list",
  params: {},
});
assert.ifError(listedThreads.error);
assert.deepEqual(listedThreads.result, {
  data: [threadStart.result.thread],
  nextCursor: null,
  backwardsCursor: null,
});

const turnStart = await request(channel.port1, {
  id: "turn-start",
  method: "turn/start",
  params: {
    threadId,
    clientUserMessageId: "browser-user-message-1",
    input: [
      {
        type: "text",
        text: "Explain this workspace in the browser",
      },
    ],
  },
});
assert.ifError(turnStart.error);
const turnId = turnStart.result.turn.id;
assert.match(turnId, /^[0-9a-fA-F-]{36}$/);
assert.equal(turnStart.result.turn.status, "inProgress");
assert.equal(turnStart.result.turn.itemsView, "notLoaded");
assert.deepEqual(turnStart.result.turn.items, []);
await waitFor(
  () => turnNotifications.some((message) => message.method === "turn/started"),
  "turn started",
);
const turnStartedNotification = turnNotifications.find(
  (message) => message.method === "turn/started",
)?.params;
assert.equal(turnStartedNotification.threadId, threadId);
assert.equal(turnStartedNotification.turn.id, turnId);
assert.equal(turnStartedNotification.turn.status, "inProgress");
assert.equal(turnStartedNotification.turn.itemsView, "full");
assert.deepEqual(turnStartedNotification.turn.items, []);
assert.deepEqual(
  turnNotifications.find((message) => message.method === "thread/status/changed")?.params,
  {
    threadId,
    status: {
      type: "active",
      activeFlags: [],
    },
  },
);
await waitFor(
  () => hostNetworkRequests.length >= 1,
  "upstream Codex network request",
);
const upstreamRequest = hostNetworkRequests[0];
assert.match(upstreamRequest.url, /\/responses$/);
assert.equal(upstreamRequest.method, "POST");
const upstreamBody = JSON.parse(
  Buffer.from(upstreamRequest.bodyBase64, "base64").toString("utf8"),
);
assert.equal(upstreamBody.model, "gpt-5.4");
assert.equal(upstreamBody.stream, true);
assert.equal(upstreamBody.store, false);
assert.equal(Array.isArray(upstreamBody.input), true);
assert.equal(Array.isArray(upstreamBody.tools), true);
await waitFor(
  () => hostNetworkRequests.length === 2,
  "upstream Codex follow-up request after exec_command",
);
const followUpBody = JSON.parse(
  Buffer.from(hostNetworkRequests[1].bodyBase64, "base64").toString("utf8"),
);
await waitFor(
  () => hostProcessSpawns.some((spawn) => spawn.command?.join(" ")?.includes("npm run dev")),
  "upstream unified exec process spawn",
);
const unifiedExecSpawn = hostProcessSpawns.find((spawn) =>
  spawn.command?.join(" ")?.includes("npm run dev"),
);
assert.ok(unifiedExecSpawn);
assert.equal(unifiedExecSpawn.cwd, "/project");
assert.equal(unifiedExecSpawn.tty, false);
assert.equal(unifiedExecSpawn.streamStdin, false);
assert.equal(unifiedExecSpawn.streamStdoutStderr, true);
assert.equal(unifiedExecSpawn.timeoutMs, undefined);
const functionCallOutput = findFunctionCallOutput(
  followUpBody.input,
  execCommandCallId,
);
assert.ok(functionCallOutput, "expected exec_command function_call_output");
assert.match(JSON.stringify(functionCallOutput), /Process running with session ID \d+/);
assert.doesNotMatch(JSON.stringify(functionCallOutput), /Timed out|exited with code 1/);
await waitFor(
  () => turnNotifications.some((message) => message.method === "turn/completed"),
  "turn completed",
);
const completedTurn = turnNotifications.find(
  (message) => message.method === "turn/completed",
)?.params.turn;
assert.equal(completedTurn.id, turnId);
assert.equal(completedTurn.status, "completed");
assert.equal(completedTurn.items.length, 3);
assert.equal(completedTurn.items[0].type, "userMessage");
assert.equal(completedTurn.items[1].type, "commandExecution");
assert.equal(completedTurn.items[1].aggregatedOutput, null);
assert.equal(completedTurn.items[1].status, "inProgress");
assert.match(completedTurn.items[1].processId, /^\d+$/);
assert.equal(completedTurn.items[2].type, "agentMessage");
assert.equal(completedTurn.items[2].text, assistantText);

const readThreadWithTurns = await request(channel.port1, {
  id: "thread-read-with-turns",
  method: "thread/read",
  params: {
    threadId,
    includeTurns: true,
  },
});
assert.ifError(readThreadWithTurns.error);
assert.equal(readThreadWithTurns.result.thread.status.type, "idle");
assert.equal(readThreadWithTurns.result.thread.turns.length, 1);
assert.equal(readThreadWithTurns.result.thread.turns[0].id, turnId);
assert.equal(readThreadWithTurns.result.thread.turns[0].status, "completed");

const turnsList = await request(channel.port1, {
  id: "thread-turns-list",
  method: "thread/turns/list",
  params: {
    threadId,
  },
});
assert.ifError(turnsList.error);
assert.equal(turnsList.result.data.length, 1);
assert.equal(turnsList.result.data[0].id, turnId);

const turnItems = await request(channel.port1, {
  id: "thread-turns-items-list",
  method: "thread/turns/items/list",
  params: {
    threadId,
    turnId,
  },
});
assert.ifError(turnItems.error);
assert.deepEqual(turnItems.result.data, readThreadWithTurns.result.thread.turns[0].items);

const createDirectory = await request(channel.port1, {
  id: 4,
  method: "fs/createDirectory",
  params: {
    path: "/project",
    recursive: true,
  },
});
assert.deepEqual(createDirectory.result, {});

const dataBase64 = Buffer.from(
  "hello from codex app-server wasm\n",
  "utf8",
).toString("base64");
const writeFile = await request(channel.port1, {
  id: 5,
  method: "fs/writeFile",
  params: {
    path: "/project/notes.txt",
    dataBase64,
  },
});
assert.deepEqual(writeFile.result, {});

const readFile = await request(channel.port1, {
  id: 6,
  method: "fs/readFile",
  params: {
    path: "/project/notes.txt",
  },
});
assert.deepEqual(readFile.result, { dataBase64 });

const metadata = await request(channel.port1, {
  id: 7,
  method: "fs/getMetadata",
  params: {
    path: "/project/notes.txt",
  },
});
assert.equal(metadata.result.isFile, true);
assert.equal(metadata.result.isDirectory, false);
assert.equal(metadata.result.modifiedAtMs, 1234);

const directory = await request(channel.port1, {
  id: 8,
  method: "fs/readDirectory",
  params: {
    path: "/project",
  },
});
assert.deepEqual(directory.result, {
  entries: [
    {
      fileName: "notes.txt",
      isDirectory: false,
      isFile: true,
    },
  ],
});

const commandExec = await request(channel.port1, {
  id: 9,
  method: "command/exec",
  params: {
    command: ["echo", "codex app-server command bridge"],
    cwd: "/project",
  },
});
assert.ifError(commandExec.error);
assert.deepEqual(commandExec.result, {
  exitCode: 0,
  stdout: "ran echo 'codex app-server command bridge'\n",
  stderr: "",
});

const streamedCommand = await request(channel.port1, {
  id: 10,
  method: "command/exec",
  params: {
    processId: "streamed_proc",
    command: ["node", "/project/streamed.js"],
    cwd: "/project",
    streamStdoutStderr: true,
  },
});
assert.ifError(streamedCommand.error);
assert.deepEqual(streamedCommand.result, {
  exitCode: 0,
  stdout: "",
  stderr: "",
});
assert.deepEqual(commandNotifications, [
  {
    method: "command/exec/outputDelta",
    params: {
      processId: "streamed_proc",
      stream: "stdout",
      deltaBase64: Buffer.from("streamed output\n").toString("base64"),
      capReached: false,
    },
  },
]);

const commandWrite = await request(channel.port1, {
  id: 11,
  method: "command/exec/write",
  params: {
    processId: "streamed_proc",
    deltaBase64: Buffer.from("stdin payload\n").toString("base64"),
  },
});
assert.ifError(commandWrite.error);
assert.deepEqual(commandWrite.result, {});
assert.deepEqual(hostCommandWrites, [
  {
    processId: "streamed_proc",
    deltaBase64: Buffer.from("stdin payload\n").toString("base64"),
  },
]);

const commandResize = await request(channel.port1, {
  id: 12,
  method: "command/exec/resize",
  params: {
    processId: "streamed_proc",
    size: {
      cols: 132,
      rows: 43,
    },
  },
});
assert.ifError(commandResize.error);
assert.deepEqual(commandResize.result, {});
assert.deepEqual(hostCommandResizes, [
  {
    processId: "streamed_proc",
    cols: 132,
    rows: 43,
  },
]);

const commandTerminate = await request(channel.port1, {
  id: 13,
  method: "command/exec/terminate",
  params: {
    processId: "streamed_proc",
  },
});
assert.ifError(commandTerminate.error);
assert.deepEqual(commandTerminate.result, {});
assert.deepEqual(hostCommandTerminates, [{ processId: "streamed_proc" }]);

const processSpawn = await request(channel.port1, {
  id: 14,
  method: "process/spawn",
  params: {
    processHandle: "process_proc",
    command: ["node", "/project/process.js"],
    cwd: "/project",
    streamStdin: true,
    streamStdoutStderr: true,
  },
});
assert.ifError(processSpawn.error);
assert.deepEqual(processSpawn.result, {});
assert.deepEqual(
  hostProcessSpawns.filter((spawn) => spawn.processHandle === "process_proc"),
  [
    {
      processHandle: "process_proc",
      command: ["node", "/project/process.js"],
      cwd: "/project",
      streamStdin: true,
      streamStdoutStderr: true,
    },
  ],
);
await waitFor(() => processNotifications.length === 2, "process notifications");
assert.deepEqual(processNotifications, [
  {
    method: "process/outputDelta",
    params: {
      processHandle: "process_proc",
      stream: "stdout",
      deltaBase64: Buffer.from("process output\n").toString("base64"),
      capReached: false,
    },
  },
  {
    method: "process/exited",
    params: {
      processHandle: "process_proc",
      exitCode: 0,
      stdout: "",
      stdoutCapReached: false,
      stderr: "",
      stderrCapReached: false,
    },
  },
]);

const processWrite = await request(channel.port1, {
  id: 15,
  method: "process/writeStdin",
  params: {
    processHandle: "process_proc",
    deltaBase64: Buffer.from("process stdin\n").toString("base64"),
  },
});
assert.ifError(processWrite.error);
assert.deepEqual(processWrite.result, {});
assert.deepEqual(hostProcessWrites, [
  {
    processHandle: "process_proc",
    deltaBase64: Buffer.from("process stdin\n").toString("base64"),
  },
]);

const processResize = await request(channel.port1, {
  id: 16,
  method: "process/resizePty",
  params: {
    processHandle: "process_proc",
    size: {
      cols: 120,
      rows: 31,
    },
  },
});
assert.ifError(processResize.error);
assert.deepEqual(processResize.result, {});
assert.deepEqual(hostProcessResizes, [
  {
    processHandle: "process_proc",
    cols: 120,
    rows: 31,
  },
]);

const processKill = await request(channel.port1, {
  id: 17,
  method: "process/kill",
  params: {
    processHandle: "process_proc",
  },
});
assert.ifError(processKill.error);
assert.deepEqual(processKill.result, {});
assert.deepEqual(hostProcessKills, [{ processHandle: "process_proc" }]);

const missing = await request(channel.port1, {
  id: 18,
  method: "config/mcpServer/reload",
});
assert.equal(missing.error.code, -32601);
assert.match(
  missing.error.message,
  /native in-process MessageProcessor|host-bridge runtime/,
);

server.dispose();
channel.port1.close();
channel.port2.close();

function request(port, message) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for response to ${message.method}`));
    }, 5000);
    const onMessage = (response) => {
      if (response?.type === "codex/host/request") return;
      if (response?.id !== message.id) return;
      cleanup();
      resolve(response);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      port.off("message", onMessage);
    };
    port.on("message", onMessage);
    port.postMessage(message);
    port.start();
  });
}

function waitFor(predicate, label) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const poll = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - started > 5000) {
        reject(new Error(`Timed out waiting for ${label}`));
        return;
      }
      setTimeout(poll, 10);
    };
    poll();
  });
}

function respondToHostRequest(port, request) {
  try {
    port.postMessage({
      type: "codex/host/response",
      id: request.id,
      result: handleHostRequest(port, request.op, request.params ?? {}),
    });
  } catch (error) {
    port.postMessage({
      type: "codex/host/response",
      id: request.id,
      error: {
        code: error && typeof error === "object" ? error.code : undefined,
        message: error instanceof Error ? error.message : String(error),
      },
    });
  }
}

function handleHostRequest(port, op, params) {
  switch (op) {
    case "auth/env":
      return {
        env: {
          OPENAI_API_KEY: "sk-test-browser-codex-smoke",
        },
      };
    case "network/fetch": {
      const requestIndex = hostNetworkRequests.length;
      hostNetworkRequests.push(params);
      const sse =
        requestIndex === 0
          ? execCommandSseResponse()
          : assistantMessageSseResponse();
      return {
        url: params.url,
        status: 200,
        statusText: "OK",
        headers: {
          "content-type": "text/event-stream",
          "x-request-id": "req_smoke",
        },
        bodyBase64: Buffer.from(sse).toString("base64"),
      };
    }
    case "fs/createDirectory": {
      hostDirectories.add(params.path);
      return { path: params.path };
    }
    case "fs/writeFile": {
      hostFiles.set(params.path, params.content);
      hostDirectories.add(parentPath(params.path));
      return { path: params.path };
    }
    case "fs/readFile": {
      const content = hostFiles.get(params.path);
      if (!content) throw Object.assign(new Error(`ENOENT: ${params.path}`), { code: "ENOENT" });
      return { content, encoding: "base64" };
    }
    case "fs/getMetadata": {
      if (hostFiles.has(params.path)) {
        return {
          path: params.path,
          type: "file",
          size: 1,
          mtimeMs: 1234,
          mode: 0o644,
        };
      }
      if (hostDirectories.has(params.path)) {
        return {
          path: params.path,
          type: "directory",
          size: 0,
          mtimeMs: 1234,
          mode: 0o755,
        };
      }
      throw Object.assign(new Error(`ENOENT: ${params.path}`), { code: "ENOENT" });
    }
    case "fs/readDirectory": {
      const prefix = `${params.path.replace(/\/+$/, "")}/`;
      return {
        entries: Array.from(hostFiles.keys())
          .filter((path) => path.startsWith(prefix))
          .map((path) => ({
            name: path.slice(prefix.length).split("/")[0],
            path,
            type: "file",
            size: 1,
            mtimeMs: 1234,
          })),
      };
    }
    case "command/exec": {
      if (params.streamStdoutStderr) {
        port.postMessage({
          type: "codex/host/event",
          event: "command/outputDelta",
          params: {
            processId: params.processId,
            stream: "stdout",
            deltaBase64: Buffer.from("streamed output\n").toString("base64"),
          },
        });
      }
      return {
        processId: params.processId ?? "codex-1",
        exitCode: 0,
        stdout: `ran ${params.command.map(quoteShellArg).join(" ")}\n`,
        stderr: "",
      };
    }
    case "command/write": {
      hostCommandWrites.push(params);
      return { processId: params.processId };
    }
    case "command/resize": {
      hostCommandResizes.push(params);
      return {
        processId: params.processId,
        cols: params.cols,
        rows: params.rows,
      };
    }
    case "command/terminate": {
      hostCommandTerminates.push(params);
      return { processId: params.processId };
    }
    case "process/spawn": {
      hostProcessSpawns.push(params);
      if (!params.command?.join(" ")?.includes("npm run dev")) {
        queueMicrotask(() => {
          port.postMessage({
            type: "codex/host/event",
            event: "process/outputDelta",
            params: {
              processHandle: params.processHandle,
              stream: "stdout",
              deltaBase64: Buffer.from(processOutput).toString("base64"),
            },
          });
          port.postMessage({
            type: "codex/host/event",
            event: "process/exited",
            params: {
              processHandle: params.processHandle,
              exitCode: 0,
              stdout: "",
              stderr: "",
            },
          });
        });
      }
      return { processHandle: params.processHandle };
    }
    case "process/writeStdin": {
      hostProcessWrites.push(params);
      return { processHandle: params.processHandle };
    }
    case "process/resizePty": {
      hostProcessResizes.push(params);
      return {
        processHandle: params.processHandle,
        cols: params.cols,
        rows: params.rows,
      };
    }
    case "process/kill": {
      hostProcessKills.push(params);
      return { processHandle: params.processHandle };
    }
    default:
      throw new Error(`Unexpected host op: ${op}`);
  }
}

function execCommandSseResponse() {
  const argumentsJson = JSON.stringify({
    cmd: "npm run dev",
    workdir: "/project",
    yield_time_ms: 500,
  });
  return sse([
    {
      type: "response.created",
      response: { id: "resp_exec_command" },
    },
    {
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: execCommandCallId,
        name: "exec_command",
        arguments: argumentsJson,
      },
    },
    {
      type: "response.completed",
      response: {
        id: "resp_exec_command",
        usage: {
          input_tokens: 12,
          output_tokens: 8,
          total_tokens: 20,
        },
      },
    },
  ]);
}

function assistantMessageSseResponse() {
  const assistantItem = {
    id: "msg_smoke",
    type: "message",
    role: "assistant",
    content: [
      {
        type: "output_text",
        text: assistantText,
      },
    ],
    phase: "final_answer",
  };
  return sse([
    {
      type: "response.output_item.added",
      item: {
        ...assistantItem,
        content: [],
      },
    },
    {
      type: "response.output_text.delta",
      item_id: "msg_smoke",
      output_index: 0,
      content_index: 0,
      delta: assistantText,
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: assistantItem,
    },
    {
      type: "response.completed",
      response: {
        id: "resp_smoke",
        usage: {
          input_tokens: 12,
          output_tokens: 8,
          total_tokens: 20,
        },
        end_turn: true,
      },
    },
  ]);
}

function sse(events) {
  return events
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

function findFunctionCallOutput(input, callId) {
  if (!Array.isArray(input)) return null;
  return input.find(
    (item) => item?.type === "function_call_output" && item.call_id === callId,
  ) ?? null;
}

function parentPath(path) {
  const index = path.lastIndexOf("/");
  return index <= 0 ? "/" : path.slice(0, index);
}

function quoteShellArg(value) {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}
