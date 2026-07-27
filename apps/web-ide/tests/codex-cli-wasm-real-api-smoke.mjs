import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "../../..");
const baseUrl = process.env.CODEX_CLI_WASM_BASE_URL ?? "http://127.0.0.1:5173";
const apiKey =
  process.env.CODEX_REAL_OPENAI_API_KEY ??
  process.env.OPENAI_API_KEY ??
  process.env.CODEX_API_KEY;
const model = process.env.CODEX_REAL_API_MODEL ?? "gpt-5.5";
const almostnodeModuleUrl = `/@fs/${resolve(repoRoot, "packages/almostnode/src/browser.ts")}`;
const codexSessionModuleUrl = "/src/features/codex-cli-browser-session.ts";

if (!apiKey) {
  console.error(
    "Set CODEX_REAL_OPENAI_API_KEY, OPENAI_API_KEY, or CODEX_API_KEY to run this smoke.",
  );
  process.exit(2);
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const responseRequests = [];
  const responseStatuses = [];

  page.on("request", (request) => {
    if (!isResponsesRequestUrl(request.url())) return;
    if (request.method() !== "POST") return;
    const body = JSON.parse(request.postData() ?? "{}");
    responseRequests.push({
      model: body.model,
      instructions: body.instructions,
      tool_choice: body.tool_choice,
      parallel_tool_calls: body.parallel_tool_calls,
      store: body.store,
      stream: body.stream,
      hasTools: Array.isArray(body.tools),
      inputShape: Array.isArray(body.input) ? "array" : typeof body.input,
    });
  });
  page.on("response", (response) => {
    if (isResponsesRequestUrl(response.url())) {
      responseStatuses.push(response.status());
    }
  });

  const response = await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  assert.equal(response?.status(), 200);

  const result = await page.evaluate(
    async ({ almostnodeModuleUrl, codexSessionModuleUrl, apiKey, model }) => {
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
      return container.run(
        `codex exec --json --model ${model} "Do not call tools. Reply exactly: browser stream ok"`,
        {
          cwd: "/project",
          env: {
            CODEX_API_KEY: apiKey,
            OPENAI_API_KEY: apiKey,
          },
        },
      );
    },
    { almostnodeModuleUrl, codexSessionModuleUrl, apiKey, model },
  );

  assert.ok(responseRequests.length > 0, "expected a Responses API request");
  for (const request of responseRequests) {
    assert.match(request.instructions ?? "", /You are Codex/);
    assert.equal(request.tool_choice, "auto");
    assert.equal(request.parallel_tool_calls, false);
    assert.equal(request.store, false);
    assert.equal(request.stream, true);
    assert.equal(request.hasTools, true);
    assert.equal(request.inputShape, "array");
  }
  assert.equal(
    result.exitCode,
    0,
    redactSecret(JSON.stringify(result, null, 2), apiKey),
  );
  assert.match(result.stdout, /browser stream ok/i);

  console.log(
    JSON.stringify(
      {
        requests: responseRequests.length,
        statuses: responseStatuses,
        model,
        outputMatched: true,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}

function redactSecret(value, secret) {
  return secret ? value.replaceAll(secret, "<redacted>") : value;
}

function isResponsesRequestUrl(url) {
  if (url === "https://api.openai.com/v1/responses") {
    return true;
  }
  if (!url.includes("/__api/cors-proxy?")) {
    return false;
  }
  try {
    return new URL(url).searchParams.get("url") === "https://api.openai.com/v1/responses";
  } catch {
    return false;
  }
}
