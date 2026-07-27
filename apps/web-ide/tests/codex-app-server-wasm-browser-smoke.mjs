import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const baseUrl =
  process.env.CODEX_APP_SERVER_WASM_BASE_URL ?? "http://127.0.0.1:5173";
const almostnodeModuleUrl = `/@fs/${resolve(repoRoot, "packages/almostnode/src/browser.ts")}`;
const codexSessionModuleUrl = "/src/features/codex-browser-session.ts";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200);

  const result = await page.evaluate(
    async ({ almostnodeModuleUrl, codexSessionModuleUrl }) => {
      const request = (port, message) =>
        new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            cleanup();
            reject(
              new Error(`Timed out waiting for response to ${message.method}`),
            );
          }, 5000);
          const onMessage = (event) => {
            if (event.data?.id !== message.id) return;
            cleanup();
            resolve(event.data);
          };
          const cleanup = () => {
            clearTimeout(timeout);
            port.removeEventListener("message", onMessage);
          };
          port.addEventListener("message", onMessage);
          port.postMessage(message);
          port.start();
        });
      const waitFor = (predicate, label) =>
        new Promise((resolve, reject) => {
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
            setTimeout(poll, 25);
          };
          poll();
        });
      globalThis.__almostnodeCodexHostRequest = async (op, params = {}) => {
        switch (op) {
          case "auth/env":
            return {
              env: {
                OPENAI_API_KEY: "sk-test-browser-codex-smoke",
              },
            };
          case "fs/readDirectory":
            return { entries: [] };
          case "fs/getMetadata":
          case "fs/readFile":
            throw Object.assign(new Error(`ENOENT: ${params.path}`), {
              code: "ENOENT",
            });
          default:
            throw new Error(`Unexpected direct Codex host op: ${op}`);
        }
      };

      const module = await import("/codex-wasm/codex_wasm.js");
      const wasm = await fetch("/codex-wasm/codex_wasm_bg.wasm");
      const wasmBytes = await wasm.arrayBuffer();
      await module.default({ module_or_path: wasmBytes });

      const server = module.createCodexAppServerWasm();
      const directChannel = new MessageChannel();
      server.start(directChannel.port2, {
        clientInfo: {
          name: "agent_wasm_browser_smoke",
          title: "agent-wasm Browser Smoke",
          version: "0.1.0",
        },
      });
      const directThreadNotifications = [];
      directChannel.port1.addEventListener("message", (event) => {
        if (event.data?.method === "thread/started") {
          directThreadNotifications.push(event.data);
        }
      });
      directChannel.port2.start();
      const directInitialize = await request(directChannel.port1, {
        id: 1,
        method: "initialize",
        params: {
          clientInfo: {
            name: "agent_wasm_browser_smoke",
            title: "agent-wasm Browser Smoke",
            version: "0.1.0",
          },
        },
      });
      directChannel.port1.postMessage({ method: "initialized", params: {} });
      const directStatus = await request(directChannel.port1, {
        id: 2,
        method: "appServer/status",
      });
      const directThreads = await request(directChannel.port1, {
        id: 3,
        method: "thread/list",
        params: {},
      });
      const directThreadStart = await request(directChannel.port1, {
        id: 4,
        method: "thread/start",
        params: {
          model: "gpt-5.4",
          cwd: "/project",
          approvalPolicy: "on-request",
          approvalsReviewer: "user",
          sandbox: "danger-full-access",
          ephemeral: true,
        },
      });
      await waitFor(
        () => directThreadNotifications.length === 1,
        "direct thread started notification",
      );
      const directLoadedThreads = await request(directChannel.port1, {
        id: 5,
        method: "thread/loaded/list",
        params: {},
      });
      const directThreadRead = await request(directChannel.port1, {
        id: 6,
        method: "thread/read",
        params: {
          threadId: directThreadStart.result.thread.id,
          includeTurns: true,
        },
      });
      server.dispose();
      directChannel.port1.close();
      directChannel.port2.close();

      const [{ createContainer }, { createWebIdeCodexBrowserSession }] =
        await Promise.all([
          import(almostnodeModuleUrl),
          import(codexSessionModuleUrl),
        ]);
      const container = createContainer({ cwd: "/project" });
      const session = createWebIdeCodexBrowserSession({
        container,
        cwd: "/project",
        env: {
          OPENAI_API_KEY: "sk-test-browser-codex-smoke",
        },
      });
      await session.ready;
      const sessionInitialize = await session.peer.initialize({
        clientInfo: {
          name: "agent_wasm_browser_smoke",
          title: "agent-wasm Browser Smoke",
          version: "0.1.0",
        },
      });
      const sessionStatus = await session.peer.request("appServer/status");
      const sessionThreads = await session.peer.request("thread/list", {});
      const sessionThreadNotifications = [];
      const unsubscribeSessionThreadNotifications = session.peer.onNotification(
        (notification) => {
          if (notification.method === "thread/started") {
            sessionThreadNotifications.push(notification);
          }
        },
      );
      const sessionThreadStart = await session.peer.request("thread/start", {
        model: "gpt-5.4",
        cwd: "/project",
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: "workspace-write",
        ephemeral: true,
      });
      await waitFor(
        () => sessionThreadNotifications.length === 1,
        "session thread started notification",
      );
      const sessionLoadedThreads = await session.peer.request(
        "thread/loaded/list",
        {},
      );
      const sessionThreadRead = await session.peer.request("thread/read", {
        threadId: sessionThreadStart.thread.id,
        includeTurns: true,
      });
      const sessionThreadsAfterStart = await session.peer.request(
        "thread/list",
        {},
      );
      const sessionFileData = btoa("browser vfs bridge ok\n");
      const sessionMkdir = await session.peer.request("fs/createDirectory", {
        path: "/project/codex",
        recursive: true,
      });
      const sessionWrite = await session.peer.request("fs/writeFile", {
        path: "/project/codex/notes.txt",
        dataBase64: sessionFileData,
      });
      const sessionRead = await session.peer.request("fs/readFile", {
        path: "/project/codex/notes.txt",
      });
      const sessionMetadata = await session.peer.request("fs/getMetadata", {
        path: "/project/codex/notes.txt",
      });
      const sessionDirectory = await session.peer.request("fs/readDirectory", {
        path: "/project/codex",
      });
      const sessionCommand = await session.peer.request("command/exec", {
        command: ["pwd"],
        cwd: "/project",
      });
      const sessionStreamNotifications = [];
      const sessionProcessNotifications = [];
      const unsubscribeStreamNotifications = session.peer.onNotification(
        (notification) => {
          if (notification.method === "command/exec/outputDelta") {
            sessionStreamNotifications.push(notification);
          }
          if (
            notification.method === "process/outputDelta" ||
            notification.method === "process/exited"
          ) {
            sessionProcessNotifications.push(notification);
          }
        },
      );
      await session.peer.request("fs/writeFile", {
        path: "/project/codex/interactive.js",
        dataBase64: btoa(`
process.stdin.setEncoding('utf8');
process.stdout.write('ready\\n');
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
  if (input.includes('\\n')) {
    process.stdout.write('got:' + input.trim() + '\\n');
    process.exit(0);
  }
});
setTimeout(() => {
  process.stderr.write('timeout\\n');
  process.exit(2);
}, 2000);
`),
      });
      const sessionStreamCommandPromise = session.peer.request("command/exec", {
        processId: "browser_stream_proc",
        command: ["node", "/project/codex/interactive.js"],
        cwd: "/project",
        streamStdin: true,
        streamStdoutStderr: true,
        size: {
          cols: 100,
          rows: 30,
        },
      });
      await waitFor(
        () =>
          sessionStreamNotifications.some((notification) =>
            atob(notification.params.deltaBase64).includes("ready"),
          ),
        "streamed command ready output",
      );
      const sessionStreamResize = await session.peer.request(
        "command/exec/resize",
        {
          processId: "browser_stream_proc",
          size: {
            cols: 90,
            rows: 22,
          },
        },
      );
      const sessionStreamWrite = await session.peer.request(
        "command/exec/write",
        {
          processId: "browser_stream_proc",
          deltaBase64: btoa("ping\n"),
        },
      );
      const sessionStreamCommand = await sessionStreamCommandPromise;

      await session.peer.request("fs/writeFile", {
        path: "/project/codex/spawned-process.js",
        dataBase64: btoa(`
process.stdin.setEncoding('utf8');
process.stdout.write('process-ready\\n');
let input = '';
process.stdin.on('data', (chunk) => {
  input += chunk;
  if (input.includes('\\n')) {
    process.stdout.write('process-got:' + input.trim() + '\\n');
    process.exit(0);
  }
});
setTimeout(() => {
  process.stderr.write('process-timeout\\n');
  process.exit(2);
}, 2000);
`),
      });
      const sessionProcessSpawn = await session.peer.request("process/spawn", {
        processHandle: "browser_process_proc",
        command: ["node", "/project/codex/spawned-process.js"],
        cwd: "/project",
        tty: true,
        streamStdin: true,
        streamStdoutStderr: true,
        size: {
          cols: 100,
          rows: 30,
        },
      });
      await waitFor(
        () =>
          sessionProcessNotifications.some(
            (notification) =>
              notification.method === "process/outputDelta" &&
              atob(notification.params.deltaBase64).includes("process-ready"),
          ),
        "spawned process ready output",
      );
      const sessionProcessResize = await session.peer.request(
        "process/resizePty",
        {
          processHandle: "browser_process_proc",
          size: {
            cols: 92,
            rows: 24,
          },
        },
      );
      const sessionProcessWrite = await session.peer.request(
        "process/writeStdin",
        {
          processHandle: "browser_process_proc",
          deltaBase64: btoa("pong\n"),
        },
      );
      await waitFor(
        () =>
          sessionProcessNotifications.some(
            (notification) => notification.method === "process/exited",
          ),
        "spawned process exit notification",
      );
      unsubscribeSessionThreadNotifications();
      unsubscribeStreamNotifications();
      session.dispose();

      return {
        wasmStatus: wasm.status,
        directInitialize,
        directStatus,
        directThreads,
        directThreadStart,
        directThreadNotifications,
        directLoadedThreads,
        directThreadRead,
        sessionInitialize,
        sessionStatus,
        sessionThreads,
        sessionThreadStart,
        sessionThreadNotifications,
        sessionLoadedThreads,
        sessionThreadRead,
        sessionThreadsAfterStart,
        sessionFileData,
        sessionMkdir,
        sessionWrite,
        sessionRead,
        sessionMetadata,
        sessionDirectory,
        sessionCommand,
        sessionStreamNotifications,
        sessionStreamResize,
        sessionStreamWrite,
        sessionStreamCommand,
        sessionProcessNotifications,
        sessionProcessSpawn,
        sessionProcessResize,
        sessionProcessWrite,
      };
    },
    { almostnodeModuleUrl, codexSessionModuleUrl },
  );

  assert.equal(result.wasmStatus, 200);
  assert.match(
    result.directInitialize.result.userAgent,
    /^almostnode-codex-wasm\//,
  );
  assert.equal(result.directStatus.result.status, "ready");
  assert.equal(result.directStatus.result.runtime, "browser-wasm");
  assert.equal(result.directStatus.result.realCodexLinked, true);
  assert.equal(result.directStatus.result.protocolBackedReads, true);
  assert.equal(result.directStatus.result.initialized, true);
  assert.deepEqual(result.directThreads.result, {
    data: [],
    nextCursor: null,
    backwardsCursor: null,
  });
  assert.match(result.directThreadStart.result.thread.id, /^[0-9a-fA-F-]{36}$/);
  assert.equal(result.directThreadStart.result.thread.cwd, "/project");
  assert.equal(result.directThreadStart.result.thread.source, "appServer");
  assert.deepEqual(result.directThreadStart.result.thread.status, {
    type: "idle",
  });
  assert.deepEqual(result.directThreadNotifications, [
    {
      method: "thread/started",
      params: {
        thread: result.directThreadStart.result.thread,
      },
    },
  ]);
  assert.deepEqual(result.directLoadedThreads.result, {
    data: [result.directThreadStart.result.thread.id],
    nextCursor: null,
  });
  assert.deepEqual(result.directThreadRead.result, {
    thread: result.directThreadStart.result.thread,
  });
  assert.match(result.sessionInitialize.userAgent, /^almostnode-codex-wasm\//);
  assert.equal(result.sessionStatus.status, "ready");
  assert.equal(result.sessionStatus.runtime, "browser-wasm");
  assert.equal(result.sessionStatus.realCodexLinked, true);
  assert.equal(result.sessionStatus.protocolBackedReads, true);
  assert.equal(result.sessionStatus.initialized, true);
  assert.equal(result.sessionStatus.hostBridgeRequestsInFlight, 0);
  assert.deepEqual(result.sessionThreads, {
    data: [],
    nextCursor: null,
    backwardsCursor: null,
  });
  assert.match(result.sessionThreadStart.thread.id, /^[0-9a-fA-F-]{36}$/);
  assert.equal(result.sessionThreadStart.thread.cwd, "/project");
  assert.equal(result.sessionThreadStart.thread.source, "appServer");
  assert.deepEqual(result.sessionThreadStart.thread.status, {
    type: "idle",
  });
  assert.deepEqual(result.sessionThreadNotifications, [
    {
      method: "thread/started",
      params: {
        thread: result.sessionThreadStart.thread,
      },
    },
  ]);
  assert.deepEqual(result.sessionLoadedThreads, {
    data: [result.sessionThreadStart.thread.id],
    nextCursor: null,
  });
  assert.deepEqual(result.sessionThreadRead, {
    thread: result.sessionThreadStart.thread,
  });
  assert.deepEqual(result.sessionThreadsAfterStart, {
    data: [result.sessionThreadStart.thread],
    nextCursor: null,
    backwardsCursor: "0",
  });
  assert.deepEqual(result.sessionMkdir, {});
  assert.deepEqual(result.sessionWrite, {});
  assert.deepEqual(result.sessionRead, { dataBase64: result.sessionFileData });
  assert.equal(result.sessionMetadata.isFile, true);
  assert.equal(result.sessionMetadata.isDirectory, false);
  assert.deepEqual(result.sessionDirectory.entries, [
    {
      fileName: "notes.txt",
      isDirectory: false,
      isFile: true,
    },
  ]);
  assert.equal(result.sessionCommand.exitCode, 0);
  assert.match(result.sessionCommand.stdout, /^\/project\n?$/);
  assert.equal(result.sessionCommand.stderr, "");
  assert.deepEqual(result.sessionStreamResize, {});
  assert.deepEqual(result.sessionStreamWrite, {});
  assert.equal(result.sessionStreamCommand.exitCode, 0);
  assert.equal(result.sessionStreamCommand.stdout, "");
  assert.equal(result.sessionStreamCommand.stderr, "");
  const streamOutput = result.sessionStreamNotifications
    .map((notification) =>
      Buffer.from(notification.params.deltaBase64, "base64").toString("utf8"),
    )
    .join("");
  assert.match(streamOutput, /ready/);
  assert.match(streamOutput, /got:ping/);
  assert.deepEqual(result.sessionProcessSpawn, {});
  assert.deepEqual(result.sessionProcessResize, {});
  assert.deepEqual(result.sessionProcessWrite, {});
  const processOutput = result.sessionProcessNotifications
    .filter((notification) => notification.method === "process/outputDelta")
    .map((notification) =>
      Buffer.from(notification.params.deltaBase64, "base64").toString("utf8"),
    )
    .join("");
  assert.match(processOutput, /process-ready/);
  assert.match(processOutput, /process-got:pong/);
  assert.deepEqual(
    result.sessionProcessNotifications.find(
      (notification) => notification.method === "process/exited",
    )?.params,
    {
      processHandle: "browser_process_proc",
      exitCode: 0,
      stdout: "",
      stdoutCapReached: false,
      stderr: "",
      stderrCapReached: false,
    },
  );
} finally {
  await browser.close();
}
