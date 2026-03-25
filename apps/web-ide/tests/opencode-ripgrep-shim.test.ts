// @vitest-environment node
import { describe, expect, it } from "vitest";
import { _vfs_addDir, _vfs_setFile } from "../../../vendor/opencode/packages/browser/src/shims/fs.browser";
import { runBrowserCommand } from "../src/shims/opencode-child-process";
import { Ripgrep } from "../src/shims/opencode-ripgrep";

async function collectFiles(input: Parameters<typeof Ripgrep.files>[0]): Promise<string[]> {
  const results: string[] = [];
  for await (const file of Ripgrep.files(input)) {
    results.push(file);
  }
  return results;
}

describe("OpenCode browser ripgrep shims", () => {
  const root = `/workspace/__webide-rg-${Date.now()}`;

  _vfs_addDir(root);
  _vfs_addDir(`${root}/src`);
  _vfs_addDir(`${root}/src/nested`);
  _vfs_setFile(`${root}/src/App.tsx`, "export const App = () => null;\n");
  _vfs_setFile(`${root}/src/nested/util.ts`, "export const util = 'App util';\n");
  _vfs_setFile(`${root}/src/styles.css`, ".app { color: red; }\n");
  _vfs_setFile(`${root}/README.md`, "App docs live here.\n");

  it("matches brace globs the same way OpenCode expects", async () => {
    const files = await collectFiles({
      cwd: root,
      glob: ["src/**/*.{tsx,ts}"],
    });

    expect(files).toEqual([
      "src/App.tsx",
      "src/nested/util.ts",
    ]);
  });

  it("supports rg include globs through the browser child_process shim", async () => {
    const result = await runBrowserCommand({
      command: "rg",
      args: [
        "-nH",
        "--hidden",
        "--field-match-separator=|",
        "--regexp",
        "App",
        "--glob",
        "src/**/*.{tsx,ts}",
        root,
      ],
      cwd: root,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`${root}/src/App.tsx|1|export const App = () => null;`);
    expect(result.stdout).toContain(`${root}/src/nested/util.ts|1|export const util = 'App util';`);
    expect(result.stdout).not.toContain(`${root}/README.md`);
  });
});
