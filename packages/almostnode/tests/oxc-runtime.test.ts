import { describe, expect, it } from "vitest";
import { createContainer } from "../src";
import {
  formatOxcDiagnosticsForTerminal,
  resolveOxcConfigForFile,
  runOxcOnSource,
  type OxcFileAccessor,
} from "../src/oxc/runtime";

function createAccessor(files: Record<string, string>): OxcFileAccessor {
  return {
    exists(targetPath: string) {
      return Object.prototype.hasOwnProperty.call(files, targetPath);
    },
    readText(targetPath: string) {
      return files[targetPath] ?? null;
    },
  };
}

describe("oxc runtime", () => {
  it("resolves formatter and linter config and returns formatted text plus diagnostics", async () => {
    const accessor = createAccessor({
      "/project/.oxfmtrc.json": JSON.stringify({
        semi: false,
        singleQuote: true,
      }),
      "/project/.oxlintrc.json": JSON.stringify({
        rules: {
          "no-console": "error",
        },
      }),
    });
    const filePath = "/project/src/example.ts";
    const sourceText = 'console.log("hello");\n';

    const config = resolveOxcConfigForFile(accessor, filePath);
    expect(config.formatterConfigPath).toBe("/project/.oxfmtrc.json");
    expect(config.linterConfigPath).toBe("/project/.oxlintrc.json");

    const result = await runOxcOnSource({
      filePath,
      sourceText,
      format: true,
      lint: true,
      formatterConfigText: config.formatterConfigText,
      linterConfigText: config.linterConfigText,
    });

    expect(result.formattedText).toBe("console.log('hello')\n");
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.severity).toBe("error");
    expect(result.diagnostics[0]?.message.toLowerCase()).toContain("console");
    expect(
      formatOxcDiagnosticsForTerminal(filePath, sourceText, result.diagnostics),
    ).toContain("/project/src/example.ts:1:1:");
  });
});

describe("oxc shell commands", () => {
  it("formats files in place and prints lint diagnostics", async () => {
    const container = createContainer({ cwd: "/project" });
    container.vfs.mkdirSync("/project/src", { recursive: true });
    container.vfs.writeFileSync(
      "/project/.oxfmtrc.json",
      JSON.stringify({ semi: false, singleQuote: true }),
    );
    container.vfs.writeFileSync(
      "/project/.oxlintrc.json",
      JSON.stringify({
        rules: {
          "no-console": "error",
        },
      }),
    );
    container.vfs.writeFileSync('/project/src/demo.ts', 'console.log("hi");\n');

    const formatResult = await container.run("oxfmt src/demo.ts", { cwd: "/project" });
    const formattedSource = container.vfs.readFileSync("/project/src/demo.ts", "utf8");
    const lintResult = await container.run("oxlint src/demo.ts", { cwd: "/project" });

    expect(formatResult.exitCode).toBe(0);
    expect(formattedSource).toBe("console.log('hi')\n");
    expect(lintResult.exitCode).toBe(1);
    expect(lintResult.stdout).toContain("demo.ts:1:1:");
    expect(lintResult.stdout.toLowerCase()).toContain("console");
  });

  it("supports directory targets for formatting and linting", async () => {
    const container = createContainer({ cwd: "/project" });
    container.vfs.mkdirSync("/project/src/nested", { recursive: true });
    container.vfs.mkdirSync("/project/node_modules/demo", { recursive: true });
    container.vfs.writeFileSync(
      "/project/.oxfmtrc.json",
      JSON.stringify({ semi: false, singleQuote: true }),
    );
    container.vfs.writeFileSync(
      "/project/.oxlintrc.json",
      JSON.stringify({
        rules: {
          "no-console": "error",
        },
      }),
    );
    container.vfs.writeFileSync('/project/src/demo.ts', 'console.log("hi");\n');
    container.vfs.writeFileSync('/project/src/nested/widget.tsx', 'export    const Widget = () => <button>ok</button>;\n');
    container.vfs.writeFileSync('/project/node_modules/demo/ignored.ts', 'console.log("ignore me");\n');

    const formatResult = await container.run("oxfmt .", { cwd: "/project" });
    const lintResult = await container.run("oxlint .", { cwd: "/project" });

    expect(formatResult.exitCode).toBe(0);
    expect(container.vfs.readFileSync("/project/src/demo.ts", "utf8")).toBe("console.log('hi')\n");
    expect(container.vfs.readFileSync("/project/src/nested/widget.tsx", "utf8")).toContain("export const Widget");
    expect(container.vfs.readFileSync("/project/node_modules/demo/ignored.ts", "utf8")).toBe('console.log("ignore me");\n');
    expect(lintResult.exitCode).toBe(1);
    expect(lintResult.stdout).toContain("src/demo.ts:1:1:");
    expect(lintResult.stdout).not.toContain("node_modules/demo/ignored.ts");
  });
});
