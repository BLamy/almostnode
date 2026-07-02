/**
 * Agent/terminal surface for executor.sh: the `executor` shell command
 * (mirrors the real executor CLI's `tools` / `call` verbs) and the
 * `window.almostOS.executor` bridge the AI drawer uses for code mode.
 */

import type { ContainerInstance } from "@agent-wasm/core";
import { getExecutorStore } from "./executor-store";

export function installExecutorBridge(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { almostOS?: Record<string, unknown> };
  w.almostOS = {
    ...(w.almostOS ?? {}),
    executor: {
      /** Run model-written TypeScript in the code-mode sandbox. */
      execute: (code: string) => getExecutorStore().execute(code),
      /** Direct single-tool invocation (policy-gated like code mode). */
      invoke: (path: string, args: unknown) => getExecutorStore().invokeTool(path, args),
      search: (query: string) => getExecutorStore().searchTools({ query }),
      describe: (path: string) => getExecutorStore().describeTool(path),
      sources: () => getExecutorStore().listSourcesInfo(),
    },
  };
}

const HELP = `executor — call any connected OpenAPI/MCP tool

Usage:
  executor sources                 List connected sources
  executor tools [query]           Search the tool catalog
  executor describe <path>         Show a tool's TypeScript signature
  executor call <path> ['{json}']  Invoke one tool with JSON args
  executor run <file.ts>           Run a code-mode script from the VFS
`;

export function registerExecutorCommands(container: ContainerInstance): void {
  installExecutorBridge();

  container.registerShellCommand({
    name: "executor",
    execute: async (args, context) => {
      const store = getExecutorStore();
      const [verb, ...rest] = args;
      try {
        switch (verb) {
          case "sources": {
            const sources = store.listSourcesInfo();
            if (sources.length === 0) {
              return { stdout: "No sources — add one in the executor.sh app.\n", stderr: "", exitCode: 0 };
            }
            const lines = sources.map((source) =>
              `${source.id.padEnd(20)} ${source.kind.padEnd(8)} ${String(source.toolCount).padStart(4)} tools  ${source.connected ? "connected" : "no connection"}`);
            return { stdout: `${lines.join("\n")}\n`, stderr: "", exitCode: 0 };
          }
          case "tools": {
            const results = store.searchTools({ query: rest.join(" "), limit: 50 });
            if (results.length === 0) {
              return { stdout: "No matching tools.\n", stderr: "", exitCode: 0 };
            }
            const lines = results.map((tool) =>
              `${tool.address}${tool.description ? `  — ${tool.description}` : ""}`);
            return { stdout: `${lines.join("\n")}\n`, stderr: "", exitCode: 0 };
          }
          case "describe": {
            if (!rest[0]) return { stdout: "", stderr: "usage: executor describe <source.tool>\n", exitCode: 1 };
            const described = store.describeTool(rest[0]);
            if ("error" in described) {
              return { stdout: "", stderr: `${described.error}\n`, exitCode: 1 };
            }
            return { stdout: `${described.typescript}\n`, stderr: "", exitCode: 0 };
          }
          case "call": {
            if (!rest[0]) return { stdout: "", stderr: "usage: executor call <source.tool> ['{json}']\n", exitCode: 1 };
            let parsed: unknown;
            if (rest[1]) {
              try {
                parsed = JSON.parse(rest.slice(1).join(" "));
              } catch {
                return { stdout: "", stderr: "Arguments must be valid JSON.\n", exitCode: 1 };
              }
            }
            const result = await store.invokeTool(rest[0], parsed);
            return {
              stdout: `${JSON.stringify(result, null, 2)}\n`,
              stderr: "",
              exitCode: result.ok ? 0 : 1,
            };
          }
          case "run": {
            if (!rest[0]) return { stdout: "", stderr: "usage: executor run <file.ts>\n", exitCode: 1 };
            const path = rest[0].startsWith("/")
              ? rest[0]
              : `${context.cwd.replace(/\/$/, "")}/${rest[0]}`;
            if (!context.vfs.existsSync(path)) {
              return { stdout: "", stderr: `No such file: ${path}\n`, exitCode: 1 };
            }
            const code = context.vfs.readFileSync(path, "utf8");
            const run = await store.execute(code);
            const logs = run.logs.map((entry) => `[${entry.level}] ${entry.text}`).join("\n");
            const body = run.status === "ok"
              ? `${logs ? `${logs}\n` : ""}${run.resultPreview}\n`
              : `${logs ? `${logs}\n` : ""}`;
            return {
              stdout: body,
              stderr: run.status === "error" ? `${run.errorMessage ?? "run failed"}\n` : "",
              exitCode: run.status === "ok" ? 0 : 1,
            };
          }
          default:
            return { stdout: HELP, stderr: "", exitCode: verb ? 1 : 0 };
        }
      } catch (error) {
        return {
          stdout: "",
          stderr: `executor: ${error instanceof Error ? error.message : String(error)}\n`,
          exitCode: 1,
        };
      }
    },
  });
}
