import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgDir = resolve(__dirname, "../dist/pkg");
const moduleUrl = pathToFileURL(resolve(pkgDir, "codex_wasm.js")).href;
const wasmBytes = readFileSync(resolve(pkgDir, "codex_wasm_bg.wasm"));
const stripAnsi = (value) => value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");

const module = await import(moduleUrl);
await module.default({ module_or_path: wasmBytes });

const cli = module.createCodexCliWasm();
cli.start(undefined);

const codexReleaseEnv = { CODEX_CLI_VERSION: "0.137.0" };
const authenticatedCodexEnv = {
  ...codexReleaseEnv,
  CODEX_API_KEY: "test-key",
};

const help = cli.run(["--help"], {});
assert.equal(help.exitCode, 0);
assert.match(help.stdout, /Codex CLI/);
assert.match(help.stdout, /exec/);

const version = cli.run(["--version"], {
  env: codexReleaseEnv,
});
assert.equal(version.exitCode, 0);
assert.equal(version.stdout, "codex 0.137.0\n");

const unauthenticated = cli.run(["login", "status"], {
  env: {},
});
assert.equal(unauthenticated.exitCode, 1);
assert.match(unauthenticated.stderr, /Not logged in/);

const deviceLogin = cli.run(["login"], {});
assert.equal(deviceLogin.exitCode, 0);
assert.equal(deviceLogin.browserLogin?.type, "deviceCode");
assert.doesNotMatch(deviceLogin.stdout, /Commands:/);

const explicitDeviceLogin = cli.run(["login", "--device-auth"], {});
assert.equal(explicitDeviceLogin.exitCode, 0);
assert.equal(explicitDeviceLogin.browserLogin?.type, "deviceCode");

const unauthenticatedTui = cli.run(["debug", "browser-tui-start"], {
  cwd: "/workspace",
  env: codexReleaseEnv,
  terminalSize: { columns: 119, rows: 30 },
});
assert.equal(unauthenticatedTui.exitCode, 0);
assert.equal(unauthenticatedTui.browserTui.action.type, "login");
assert.doesNotMatch(stripAnsi(unauthenticatedTui.browserTui.ansi), /Sign in to Codex/);
assert.doesNotMatch(
  stripAnsi(unauthenticatedTui.browserTui.ansi),
  /codex exec exited with code 1/,
);
cli.run(["debug", "browser-tui-input", "--input", "hey"], {
  cwd: "/workspace",
  env: codexReleaseEnv,
  terminalSize: { columns: 119, rows: 30 },
});
const unauthenticatedSubmit = cli.run(["debug", "browser-tui-submit"], {
  cwd: "/workspace",
  env: codexReleaseEnv,
  terminalSize: { columns: 119, rows: 30 },
});
assert.equal(unauthenticatedSubmit.exitCode, 0);
assert.equal(unauthenticatedSubmit.browserTui.action.type, "login");
assert.doesNotMatch(
  stripAnsi(unauthenticatedSubmit.browserTui.ansi),
  /Sign in to Codex/,
);
assert.doesNotMatch(
  stripAnsi(unauthenticatedSubmit.browserTui.ansi),
  /codex exec exited with code 1/,
);

const unauthenticatedInteractiveCli = module.createCodexCliWasm();
unauthenticatedInteractiveCli.start(undefined);
const interactive = unauthenticatedInteractiveCli.run([], {
  cwd: "/workspace",
  env: codexReleaseEnv,
  terminalSize: { columns: 80, rows: 24 },
});
assert.equal(interactive.exitCode, 0);
assert.match(interactive.browserTui.ansi, /OpenAI Codex/);
assert.equal(interactive.browserTui.action.type, "login");

const login = cli.run(["login", "--with-api-key"], {
  stdin: "sk-browser-login\n",
});
assert.equal(login.exitCode, 0);
assert.match(login.stdout, /Stored OpenAI API key/);
assert.equal(login.env.OPENAI_API_KEY, "sk-browser-login");
assert.equal(login.env.CODEX_API_KEY, "sk-browser-login");

const authenticated = cli.run(["login", "status"], {
  env: { CODEX_API_KEY: "test-key" },
});
assert.equal(authenticated.exitCode, 0);
assert.match(authenticated.stdout, /browser session/);

const tuiStart = cli.run(["debug", "browser-tui-start"], {
  cwd: "/workspace",
  env: authenticatedCodexEnv,
  terminalSize: { columns: 119, rows: 30 },
});
assert.equal(tuiStart.exitCode, 0);
assert.match(tuiStart.browserTui.ansi, /OpenAI Codex/);
assert.doesNotMatch(tuiStart.browserTui.ansi, /v0\.0\.0/);
assert.match(tuiStart.browserTui.ansi, /v0\.137\.0/);
assert.match(tuiStart.browserTui.ansi, /model:/);
assert.match(tuiStart.browserTui.ansi, /gpt-5\.5/);
assert.match(tuiStart.browserTui.ansi, /directory:/);

cli.run(["debug", "browser-tui-input", "--input", "/experimental"], {
  cwd: "/workspace",
  env: authenticatedCodexEnv,
  terminalSize: { columns: 119, rows: 30 },
});
const experimental = cli.run(["debug", "browser-tui-submit"], {
  cwd: "/workspace",
  env: authenticatedCodexEnv,
  terminalSize: { columns: 119, rows: 30 },
});
const experimentalText = stripAnsi(experimental.browserTui.ansi);
assert.equal(experimental.exitCode, 0);
assert.equal(experimental.browserTui.action.type, "none");
assert.match(experimentalText, /Toggle experimental features/);
assert.doesNotMatch(experimentalText, /not wired/i);

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
    cwd: "/workspace",
    terminalSize: { columns: 119, rows: 30 },
  },
);
assert.equal(planUpdate.exitCode, 0);
assert.match(stripAnsi(planUpdate.browserTui.ansi), /Updated Plan/);
assert.match(
  stripAnsi(planUpdate.browserTui.ansi),
  /Compile the forked Codex TUI renderer for wasm/,
);
assert.match(
  stripAnsi(planUpdate.browserTui.ansi),
  /Route browser terminal input through the wasm frame loop/,
);

const agentMessage = cli.run(
  [
    "debug",
    "browser-tui-agent-message",
    "--text",
    "**Native assistant message**\n\n- rendered by Codex markdown",
  ],
  {
    cwd: "/workspace",
    terminalSize: { columns: 119, rows: 30 },
  },
);
assert.equal(agentMessage.exitCode, 0);
assert.match(
  stripAnsi(agentMessage.browserTui.ansi),
  /Native assistant message/,
);
assert.match(
  stripAnsi(agentMessage.browserTui.ansi),
  /rendered by Codex markdown/,
);

const interactiveWithSessionAuth = cli.run([], {
  cwd: "/workspace",
  terminalSize: { columns: 80, rows: 24 },
});
assert.equal(interactiveWithSessionAuth.exitCode, 0);
assert.match(interactiveWithSessionAuth.browserTui.ansi, /OpenAI Codex/);
assert.equal(interactiveWithSessionAuth.browserTui.action.type, "none");

const typedShell = cli.run(["debug", "browser-tui-input", "--input", "!ls"], {
  cwd: "/workspace",
  terminalSize: { columns: 80, rows: 24 },
});
assert.equal(typedShell.exitCode, 0);
assert.match(stripAnsi(typedShell.browserTui.ansi), /!\s*ls/);
assert.match(stripAnsi(typedShell.browserTui.ansi), /Shell mode/);

const submittedShell = cli.run(["debug", "browser-tui-submit"], {
  cwd: "/workspace",
  terminalSize: { columns: 80, rows: 24 },
});
assert.equal(submittedShell.exitCode, 0);
assert.equal(submittedShell.browserTui.action.type, "shell");
assert.equal(submittedShell.browserTui.action.command, "ls");

cli.run(["debug", "browser-tui-start"], {
  cwd: "/workspace",
  terminalSize: { columns: 80, rows: 24 },
});
for (const text of ["!", "p", "w", "d"]) {
  const keyResult = cli.run(
    [
      "debug",
      "browser-tui-event",
      "--type",
      "key",
      "--name",
      "char",
      "--text",
      text,
    ],
    {
      cwd: "/workspace",
      terminalSize: { columns: 80, rows: 24 },
    },
  );
  assert.equal(keyResult.exitCode, 0);
}
const eventSubmittedShell = cli.run(
  ["debug", "browser-tui-event", "--type", "key", "--name", "return"],
  {
    cwd: "/workspace",
    terminalSize: { columns: 80, rows: 24 },
  },
);
assert.equal(eventSubmittedShell.exitCode, 0);
assert.equal(eventSubmittedShell.browserTui.action.type, "shell");
assert.equal(eventSubmittedShell.browserTui.action.command, "pwd");

cli.run(["debug", "browser-tui-start"], {
  cwd: "/workspace",
  terminalSize: { columns: 100, rows: 28 },
});
const typedStatus = cli.run(
  ["debug", "browser-tui-input", "--input", "/status"],
  {
    cwd: "/workspace",
    terminalSize: { columns: 100, rows: 28 },
  },
);
assert.equal(typedStatus.exitCode, 0);
const submittedStatus = cli.run(["debug", "browser-tui-submit"], {
  cwd: "/workspace",
  terminalSize: { columns: 100, rows: 28 },
});
assert.equal(submittedStatus.exitCode, 0);
assert.equal(submittedStatus.browserTui.action.type, "none");
const statusAnsi = stripAnsi(submittedStatus.browserTui.ansi);
assert.match(statusAnsi, /OpenAI Codex/);
assert.match(statusAnsi, /Model:\s+gpt-5\.5/);
assert.match(statusAnsi, /Permissions:/);
assert.match(statusAnsi, /Token usage:/);

cli.run(["debug", "browser-tui-start"], {
  cwd: "/workspace",
  env: authenticatedCodexEnv,
  terminalSize: { columns: 100, rows: 28 },
});
const typedInit = cli.run(["debug", "browser-tui-input", "--input", "/init"], {
  cwd: "/workspace",
  env: authenticatedCodexEnv,
  terminalSize: { columns: 100, rows: 28 },
});
assert.equal(typedInit.exitCode, 0);
const submittedInit = cli.run(["debug", "browser-tui-submit"], {
  cwd: "/workspace",
  env: authenticatedCodexEnv,
  terminalSize: { columns: 100, rows: 28 },
});
assert.equal(submittedInit.exitCode, 0);
assert.equal(submittedInit.browserTui.action.type, "exec");
assert.match(
  submittedInit.browserTui.action.prompt,
  /Generate a file named AGENTS\.md/,
);

const appendedExec = cli.run(
  [
    "debug",
    "browser-tui-result",
    "--kind",
    "exec",
    "--stdout",
    "**Browser exec markdown**\n\n- native cell",
    "--stderr",
    "",
    "--exit-code",
    "0",
  ],
  {
    cwd: "/workspace",
    terminalSize: { columns: 100, rows: 28 },
  },
);
assert.equal(appendedExec.exitCode, 0);
assert.match(stripAnsi(appendedExec.browserTui.ansi), /Browser exec markdown/);
assert.match(stripAnsi(appendedExec.browserTui.ansi), /native cell/);

const execPlan = cli.run(["exec", "-m", "test-model", "hello"], {
  cwd: "/workspace",
});
assert.equal(execPlan.exitCode, 0);
assert.equal(execPlan.stderr, "");
assert.equal(execPlan.browserExec.prompt, "hello");
assert.equal(execPlan.browserExec.model, "test-model");
assert.match(execPlan.browserExec.instructions, /You are Codex/);
assert.equal(execPlan.browserExec.toolChoice, "auto");
assert.equal(execPlan.browserExec.parallelToolCalls, false);
assert.equal(execPlan.browserExec.store, false);
assert.equal(execPlan.browserExec.stream, true);
assert.equal(execPlan.browserExec.cwd, "/workspace");

cli.dispose();
