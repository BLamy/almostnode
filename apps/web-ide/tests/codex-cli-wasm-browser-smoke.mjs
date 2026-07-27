import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  decompress as zstdDecompress,
  init as initZstd,
} from "@bokuweb/zstd-wasm";
import { chromium } from "playwright";

await initZstd();

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const baseUrl = process.env.CODEX_CLI_WASM_BASE_URL ?? "http://127.0.0.1:5173";
const almostnodeModuleUrl = `/@fs/${resolve(repoRoot, "packages/almostnode/src/browser.ts")}`;
const codexSessionModuleUrl = "/src/features/codex-cli-browser-session.ts";

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const responseRequests = [];
  const nativeAppServerResponseRequests = [];
  const nativeAppServerAssistantText = "browser tui ok";
  const handleResponsesRoute = async (route) => {
    const request = route.request();
    const targetUrl = extractTargetUrl(request.url());
    if (request.method() === "GET" && /\/models(?:\?|$)/.test(targetUrl)) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"models":[]}',
      });
      return;
    }
    if (
      request.method() === "GET" &&
      /\/ps\/plugins\/suggested(?:\?|$)/.test(targetUrl)
    ) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: '{"enabled":true,"plugins":[]}',
      });
      return;
    }
    if (request.method() !== "POST") {
      await route.fulfill({ status: 204, body: "" });
      return;
    }
    const body = decodeRequestBody(request);
    const prompt = extractResponsePrompt(body);
    if (prompt.includes("hello tui")) {
      nativeAppServerResponseRequests.push(body);
      const hasToolOutput = responseHasToolOutput(body);
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: hasToolOutput
          ? codexResponseSse(nativeAppServerAssistantText)
          : codexToolCallSse({
              callId: "browser_tui_shell_call",
              name: "shell_command",
              arguments: {
                command: "printf browser-tui-tool-call",
                workdir: "/project",
                timeout_ms: 1000,
                login: false,
              },
            }),
      });
      return;
    }

    responseRequests.push(body);
    const hasToolOutput = responseHasToolOutput(body);
    let response;

    if (prompt.includes("inspect browser")) {
      response = hasToolOutput
        ? {
            output_text: "browser playwright tool ok",
          }
        : {
            output: [
              {
                type: "function_call",
                call_id: "browser_playwright_call",
                name: "playwright_cli",
                arguments: JSON.stringify({
                  command: "help",
                  timeout_ms: 1000,
                }),
              },
            ],
          };
    } else {
      response = hasToolOutput
        ? {
            output_text: "browser shell tool ok",
          }
        : {
            output: [
              {
                type: "function_call",
                call_id: "browser_shell_call",
                name: "shell_command",
                arguments: JSON.stringify({
                  command: "pwd",
                  workdir: "/project",
                  timeout_ms: 1000,
                  login: false,
                }),
              },
            ],
          };
    }

    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(response),
    });
  };
  await page.route("https://api.openai.com/v1/responses", handleResponsesRoute);
  await page.route(
    "https://chatgpt.com/backend-api/codex/responses",
    handleResponsesRoute,
  );
  await page.route("https://api.openai.com/v1/models*", handleResponsesRoute);
  await page.route(
    "https://chatgpt.com/backend-api/codex/models*",
    handleResponsesRoute,
  );
  await page.route(
    "https://chatgpt.com/backend-api/codex/ps/plugins/suggested*",
    handleResponsesRoute,
  );
  await page.route("**/__api/cors-proxy?url=*", handleResponsesRoute);

  const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200);

  const result = await page.evaluate(
    async ({ almostnodeModuleUrl, codexSessionModuleUrl }) => {
      async function waitFor(predicate, label = "condition", debug = () => "") {
        const startedAt = Date.now();
        while (!predicate()) {
          if (Date.now() - startedAt > 5000) {
            throw new Error(
              `Timed out waiting for browser codex smoke ${label}\n${debug()}`,
            );
          }
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
      }
      const tick = () => new Promise((resolve) => setTimeout(resolve, 25));

      const module = await import("/codex-wasm/codex_wasm.js");
      const wasm = await fetch("/codex-wasm/codex_wasm_bg.wasm");
      const wasmBytes = await wasm.arrayBuffer();
      await module.default({ module_or_path: wasmBytes });

      const cli = module.createCodexCliWasm();
      cli.start(undefined);
      const help = cli.run(["--help"], {});
      const version = cli.run(["--version"], {});
      const unauthenticatedTui = cli.run(["debug", "browser-tui-start"], {
        cwd: "/project",
        terminalSize: { columns: 119, rows: 30 },
      });
      cli.run(["debug", "browser-tui-input", "--input", "hey"], {
        cwd: "/project",
        terminalSize: { columns: 119, rows: 30 },
      });
      const unauthenticatedSubmit = cli.run(["debug", "browser-tui-submit"], {
        cwd: "/project",
        terminalSize: { columns: 119, rows: 30 },
      });
      const directDeviceLogin = cli.run(["login"], {});
      const explicitDeviceLogin = cli.run(["login", "--device-auth"], {});
      const unauthenticatedInteractiveCli = module.createCodexCliWasm();
      unauthenticatedInteractiveCli.start(undefined);
      const unauthenticatedInteractive = unauthenticatedInteractiveCli.run([], {
        cwd: "/project",
        terminalSize: { columns: 80, rows: 24 },
      });
      unauthenticatedInteractiveCli.dispose();
      const directLogin = cli.run(["login", "--with-api-key"], {
        stdin: "sk-browser-login\n",
      });
      const authenticated = cli.run(["login", "status"], {
        env: { CODEX_API_KEY: "test-key" },
      });
      const tuiStart = cli.run(["debug", "browser-tui-start"], {
        cwd: "/project",
        terminalSize: { columns: 119, rows: 30 },
      });
      const planUpdate = cli.run(
        [
          "debug",
          "browser-tui-plan-update",
          "--explanation",
          "Browser wasm plan update",
          "--step",
          "completed:Compile the forked Codex TUI renderer for wasm",
          "--step",
          "inProgress:Route browser terminal input through the wasm frame loop",
        ],
        {
          cwd: "/project",
          terminalSize: { columns: 119, rows: 30 },
        },
      );
      const agentMessage = cli.run(
        [
          "debug",
          "browser-tui-agent-message",
          "--text",
          "**Native assistant message**\n\n- rendered by Codex markdown",
        ],
        {
          cwd: "/project",
          terminalSize: { columns: 119, rows: 30 },
        },
      );
      const directExec = cli.run(["exec", "hello"], {
        cwd: "/workspace",
      });
      cli.dispose();

      const [{ createContainer }, { registerWebIdeCodexCliShellCommand }] =
        await Promise.all([
          import(almostnodeModuleUrl),
          import(codexSessionModuleUrl),
        ]);
      const container = createContainer({
        cwd: "/project",
        network: {
          corsProxy: `${location.origin}/__api/cors-proxy?url=`,
        },
      });
      registerWebIdeCodexCliShellCommand(container, { cwd: "/project" });
      const shellHelp = await container.run("codex --help", {
        cwd: "/project",
      });
      const shellVersion = await container.run("codex --version", {
        cwd: "/project",
      });
      const shellLogin = await container.run("codex login status", {
        cwd: "/project",
        env: { CODEX_API_KEY: "test-key" },
      });
      const shellExec = await container.run(
        "codex exec --output-last-message /project/.codex-last-message.txt hello",
        {
          cwd: "/project",
          env: {
            OPENAI_API_KEY: "test-key",
            CODEX_BROWSER_EXEC_MOCK_RESPONSE: "browser exec ok",
          },
        },
      );
      const shellLastMessage = container.vfs.readFileSync(
        "/project/.codex-last-message.txt",
        "utf8",
      );
      const shellExecJson = await container.run("codex exec --json hello", {
        cwd: "/project",
        env: {
          OPENAI_API_KEY: "test-key",
          CODEX_BROWSER_EXEC_MOCK_RESPONSE: "browser exec json ok",
        },
      });
      const shellPrompt = await container.run("codex summarize workspace", {
        cwd: "/project",
        env: {
          OPENAI_API_KEY: "test-key",
          CODEX_BROWSER_EXEC_MOCK_RESPONSE: "browser prompt ok",
        },
      });
      const shellExecTool = await container.run(
        "codex exec --json inspect shell",
        {
          cwd: "/project",
          env: {
            CODEX_API_KEY: "test-key",
          },
        },
      );
      const shellPlaywrightTool = await container.run(
        "codex exec --json inspect browser",
        {
          cwd: "/project",
          env: {
            CODEX_API_KEY: "test-key",
          },
        },
      );
      const shellInteractiveOutput = [];
      const shellInteractiveSession = container.createTerminalSession({
        cwd: "/project",
        env: {
          OPENAI_API_KEY: "test-key",
        },
      });
      const shellInteractiveRun = shellInteractiveSession.run("codex", {
        interactive: true,
        onStdout: (chunk) => shellInteractiveOutput.push(chunk),
        onStderr: (chunk) => shellInteractiveOutput.push(chunk),
      });
      await waitFor(() =>
        shellInteractiveOutput.join("").includes("OpenAI Codex"),
      );
      shellInteractiveSession.sendInput("!pwd\r");
      await waitFor(
        () => shellInteractiveOutput.join("").includes("/project"),
        "!pwd output",
        () => shellInteractiveOutput.join(""),
      );
      await tick();
      shellInteractiveSession.sendInput("/experimental\r");
      await waitFor(
        () =>
          shellInteractiveOutput
            .join("")
            .includes("Toggle experimental features"),
        "native /experimental output",
        () => shellInteractiveOutput.join(""),
      );
      shellInteractiveSession.sendInput("\x1b");
      await tick();
      shellInteractiveSession.sendInput("hello tui\r");
      await waitFor(
        () => shellInteractiveOutput.join("").includes("browser tui ok"),
        "post-bang model response",
        () => shellInteractiveOutput.join(""),
      );
      shellInteractiveSession.sendInput("/exit\r");
      const shellInteractive = await shellInteractiveRun;
      shellInteractiveSession.dispose();

      function probeTerminalSurface(className) {
        const terminalProbe = document.createElement("div");
        terminalProbe.className = className;
        const xtermProbe = document.createElement("div");
        xtermProbe.className = "xterm";
        const xtermViewportProbe = document.createElement("div");
        xtermViewportProbe.className = "xterm-viewport";
        const xtermScreenProbe = document.createElement("div");
        xtermScreenProbe.className = "xterm-screen";
        xtermProbe.append(xtermViewportProbe, xtermScreenProbe);
        terminalProbe.append(xtermProbe);
        document.body.append(terminalProbe);
        const result = {
          terminalBackground: getComputedStyle(terminalProbe).backgroundColor,
          terminalForeground: getComputedStyle(terminalProbe).color,
          xtermBackground: getComputedStyle(xtermProbe).backgroundColor,
          viewportBackground:
            getComputedStyle(xtermViewportProbe).backgroundColor,
          screenBackground: getComputedStyle(xtermScreenProbe).backgroundColor,
        };
        terminalProbe.remove();
        return result;
      }

      const terminalStyleProbe = probeTerminalSurface(
        "almostnode-terminal-surface__terminal",
      );
      const aiTerminalStyleProbe = probeTerminalSurface(
        "almostnode-opencode-surface__terminal",
      );

      return {
        help,
        version,
        unauthenticatedTui,
        unauthenticatedSubmit,
        directDeviceLogin,
        explicitDeviceLogin,
        unauthenticatedInteractive,
        directLogin,
        authenticated,
        tuiStart,
        planUpdate,
        agentMessage,
        directExec,
        shellHelp,
        shellVersion,
        shellLogin,
        shellExec,
        shellLastMessage,
        shellExecJson,
        shellPrompt,
        shellExecTool,
        shellPlaywrightTool,
        shellInteractive,
        shellInteractiveOutput: shellInteractiveOutput.join(""),
        terminalStyleProbe,
        aiTerminalStyleProbe,
        wasmStatus: wasm.status,
      };
    },
    { almostnodeModuleUrl, codexSessionModuleUrl },
  );

  assert.equal(result.wasmStatus, 200);
  assert.equal(result.help.exitCode, 0);
  assert.match(result.help.stdout, /Codex CLI/);
  assert.match(result.help.stdout, /exec/);
  assert.equal(result.version.exitCode, 0);
  assert.equal(result.version.stdout, "codex 0.145.0\n");
  assert.equal(result.unauthenticatedTui.exitCode, 0);
  assert.equal(result.unauthenticatedTui.browserTui.action.type, "login");
  assert.doesNotMatch(
    result.unauthenticatedTui.browserTui.ansi,
    /Sign in to Codex/,
  );
  assert.doesNotMatch(
    result.unauthenticatedTui.browserTui.ansi,
    /codex exec exited with code 1/,
  );
  assert.equal(result.unauthenticatedSubmit.exitCode, 0);
  assert.equal(result.unauthenticatedSubmit.browserTui.action.type, "login");
  assert.doesNotMatch(
    result.unauthenticatedSubmit.browserTui.ansi,
    /Sign in to Codex/,
  );
  assert.doesNotMatch(
    result.unauthenticatedSubmit.browserTui.ansi,
    /codex exec exited with code 1/,
  );
  assert.equal(result.directDeviceLogin.exitCode, 0);
  assert.equal(result.directDeviceLogin.browserLogin?.type, "deviceCode");
  assert.doesNotMatch(result.directDeviceLogin.stdout, /Commands:/);
  assert.equal(result.explicitDeviceLogin.exitCode, 0);
  assert.equal(result.explicitDeviceLogin.browserLogin?.type, "deviceCode");
  assert.equal(result.unauthenticatedInteractive.exitCode, 0);
  assert.match(
    result.unauthenticatedInteractive.browserTui.ansi,
    /OpenAI Codex/,
  );
  assert.equal(
    result.unauthenticatedInteractive.browserTui.action.type,
    "login",
  );
  assert.equal(result.directLogin.exitCode, 0);
  assert.match(result.directLogin.stdout, /Stored OpenAI API key/);
  assert.equal(result.directLogin.env.OPENAI_API_KEY, "sk-browser-login");
  assert.equal(result.directLogin.env.CODEX_API_KEY, "sk-browser-login");
  assert.equal(result.authenticated.exitCode, 0);
  assert.match(result.authenticated.stdout, /browser session/);
  assert.equal(result.tuiStart.exitCode, 0);
  assert.match(result.tuiStart.browserTui.ansi, /OpenAI Codex/);
  assert.match(result.tuiStart.browserTui.ansi, /v0\.145\.0/);
  assert.match(result.tuiStart.browserTui.ansi, /model:/);
  assert.match(result.tuiStart.browserTui.ansi, /gpt-5\.5/);
  assert.match(result.tuiStart.browserTui.ansi, /directory:/);
  assert.equal(result.planUpdate.exitCode, 0);
  assert.match(result.planUpdate.browserTui.ansi, /Updated Plan/);
  assert.match(
    result.planUpdate.browserTui.ansi,
    /Compile the forked Codex TUI renderer for wasm/,
  );
  assert.match(
    result.planUpdate.browserTui.ansi,
    /Route browser terminal input through the wasm frame loop/,
  );
  assert.equal(result.agentMessage.exitCode, 0);
  assert.match(result.agentMessage.browserTui.ansi, /Native assistant message/);
  assert.match(
    result.agentMessage.browserTui.ansi,
    /rendered by Codex markdown/,
  );
  assert.equal(result.directExec.exitCode, 0);
  assert.equal(result.directExec.browserExec?.prompt, "hello");
  assert.match(
    result.directExec.browserExec?.instructions ?? "",
    /You are Codex/,
  );
  assert.equal(result.directExec.browserExec?.toolChoice, "auto");
  assert.equal(result.directExec.browserExec?.parallelToolCalls, false);
  assert.equal(result.directExec.browserExec?.store, false);
  assert.equal(result.directExec.browserExec?.stream, true);
  assert.equal(result.directExec.browserExec?.cwd, "/workspace");
  assert.equal(result.shellHelp.exitCode, 0);
  assert.match(result.shellHelp.stdout, /Codex CLI/);
  assert.equal(result.shellVersion.exitCode, 0);
  assert.equal(result.shellVersion.stdout, "codex 0.145.0\n");
  assert.equal(result.shellLogin.exitCode, 0);
  assert.match(result.shellLogin.stdout, /CODEX_API_KEY/);
  assert.equal(result.shellExec.exitCode, 0);
  assert.match(result.shellExec.stdout, /browser exec ok/);
  assert.equal(result.shellLastMessage, "browser exec ok");
  assert.equal(result.shellExecJson.exitCode, 0);
  assert.match(result.shellExecJson.stdout, /browser_exec.completed/);
  assert.equal(result.shellPrompt.exitCode, 0);
  assert.match(result.shellPrompt.stdout, /browser prompt ok/);
  assert.equal(result.shellExecTool.exitCode, 0);
  assert.match(result.shellExecTool.stdout, /browser_exec.tool_call/);
  assert.match(result.shellExecTool.stdout, /browser shell tool ok/);
  assert.equal(result.shellPlaywrightTool.exitCode, 0);
  assert.match(result.shellPlaywrightTool.stdout, /browser_exec.tool_call/);
  assert.match(result.shellPlaywrightTool.stdout, /browser playwright tool ok/);
  assert.equal(result.shellInteractive.exitCode, 0);
  const shellInteractiveText = stripAnsi(result.shellInteractiveOutput);
  assert.match(shellInteractiveText, /OpenAI Codex/);
  assert.match(shellInteractiveText, /model:/);
  assert.match(shellInteractiveText, /gpt-5\.5/);
  assert.match(shellInteractiveText, /directory:/);
  assert.match(shellInteractiveText, /Shell mode/);
  assert.match(shellInteractiveText, /!\s*pwd/);
  assert.match(shellInteractiveText, /\/project/);
  assert.match(shellInteractiveText, /Toggle experimental features/);
  assert.doesNotMatch(shellInteractiveText, /not wired/i);
  assert.match(shellInteractiveText, /hello tui/);
  assert.match(shellInteractiveText, /browser-tui-tool-call/);
  assert.match(shellInteractiveText, /browser tui ok/);
  assert.equal(result.terminalStyleProbe.terminalBackground, "rgb(5, 8, 18)");
  assert.equal(result.terminalStyleProbe.xtermBackground, "rgb(5, 8, 18)");
  assert.equal(result.terminalStyleProbe.viewportBackground, "rgb(5, 8, 18)");
  assert.equal(result.terminalStyleProbe.screenBackground, "rgb(5, 8, 18)");
  assert.equal(
    result.terminalStyleProbe.terminalForeground,
    "rgb(220, 229, 243)",
  );
  assert.equal(result.aiTerminalStyleProbe.terminalBackground, "rgb(5, 8, 18)");
  assert.equal(result.aiTerminalStyleProbe.xtermBackground, "rgb(5, 8, 18)");
  assert.equal(result.aiTerminalStyleProbe.viewportBackground, "rgb(5, 8, 18)");
  assert.equal(result.aiTerminalStyleProbe.screenBackground, "rgb(5, 8, 18)");
  assert.equal(
    result.aiTerminalStyleProbe.terminalForeground,
    "rgb(220, 229, 243)",
  );
  assert.equal(responseRequests.length, 4);
  for (const request of responseRequests) {
    assert.match(request.instructions ?? "", /You are Codex/);
    assert.equal(request.tool_choice, "auto");
    assert.equal(request.parallel_tool_calls, false);
    assert.equal(request.store, false);
    assert.equal(request.stream, true);
  }
  assert.equal(responseRequests[0].tools?.[0]?.name, "shell_command");
  assert.match(
    responseRequests[1].input?.[2]?.output ?? "",
    /^Exit code: 0\nWall time: [0-9]+(?:\.[0-9]+)? seconds\nOutput:\n\/project\n?$/,
  );
  assert.equal(responseRequests[2].tools?.[1]?.name, "playwright_cli");
  assert.match(
    responseRequests[3].input?.[2]?.output ?? "",
    /Exit code: 0\nWall time: [0-9]+(?:\.[0-9]+)? seconds\nOutput:\n[\s\S]*playwright-cli/,
  );
  assert.equal(nativeAppServerResponseRequests.length, 2);
  assert.equal(nativeAppServerResponseRequests[0].stream, true);
  assert.equal(nativeAppServerResponseRequests[0].store, false);
  assert.equal(Array.isArray(nativeAppServerResponseRequests[0].tools), true);
  assert.equal(nativeAppServerResponseRequests[1].stream, true);
  assert.equal(nativeAppServerResponseRequests[1].store, false);
  assert.equal(responseHasToolOutput(nativeAppServerResponseRequests[1]), true);
} finally {
  await browser.close();
}

function codexToolCallSse({ callId, name, arguments: args }) {
  const toolCall = {
    type: "function_call",
    call_id: callId,
    name,
    arguments: JSON.stringify(args),
  };
  return [
    {
      type: "response.created",
      response: {
        id: "resp_browser_tool_call",
      },
    },
    {
      type: "response.output_item.done",
      item: toolCall,
    },
    {
      type: "response.completed",
      response: {
        id: "resp_browser_tool_call",
        usage: {
          input_tokens: 12,
          output_tokens: 4,
          total_tokens: 16,
        },
      },
    },
  ]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

function codexResponseSse(text) {
  const assistantItem = {
    id: "msg_browser_smoke",
    type: "message",
    role: "assistant",
    content: [{ type: "output_text", text }],
    phase: "final_answer",
  };
  return [
    {
      type: "response.output_item.added",
      output_index: 0,
      item: {
        ...assistantItem,
        content: [],
      },
    },
    {
      type: "response.output_text.delta",
      item_id: assistantItem.id,
      output_index: 0,
      content_index: 0,
      delta: text,
    },
    {
      type: "response.output_item.done",
      output_index: 0,
      item: assistantItem,
    },
    {
      type: "response.completed",
      response: {
        id: "resp_browser_smoke",
        usage: {
          input_tokens: 12,
          output_tokens: 4,
          total_tokens: 16,
        },
        end_turn: true,
      },
    },
  ]
    .map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

function extractResponsePrompt(body) {
  const input = body?.input;
  if (typeof input === "string") {
    return input;
  }
  if (!Array.isArray(input)) {
    return "";
  }

  return input
    .filter(
      (item) =>
        item &&
        typeof item === "object" &&
        item.type === "message" &&
        item.role === "user",
    )
    .flatMap((message) => {
      const content = message.content;
      if (typeof content === "string") {
        return [content];
      }
      if (!Array.isArray(content)) {
        return [];
      }
      return content.map((entry) =>
        entry && typeof entry === "object" && typeof entry.text === "string"
          ? entry.text
          : "",
      );
    })
    .join("\n");
}

function responseHasToolOutput(body) {
  return Array.isArray(body?.input)
    ? body.input.some(
        (item) =>
          item &&
          typeof item === "object" &&
          item.type === "function_call_output",
      )
    : false;
}

function extractTargetUrl(requestUrl) {
  const url = new URL(requestUrl);
  return url.pathname === "/__api/cors-proxy"
    ? (url.searchParams.get("url") ?? requestUrl)
    : requestUrl;
}

function decodeRequestBody(request) {
  const encoded = request.postDataBuffer() ?? Buffer.from("{}");
  const decoded =
    request.headers()["content-encoding"] === "zstd"
      ? zstdDecompress(encoded)
      : encoded;
  return JSON.parse(Buffer.from(decoded).toString("utf8"));
}

function stripAnsi(value) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}
