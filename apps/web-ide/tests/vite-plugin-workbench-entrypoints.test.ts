import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildWorkbenchEntrypointsVirtualModule } from "../src/plugins/vite-plugin-workbench-entrypoints";

let tempDir: string | null = null;

afterEach(() => {
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
  }
});

describe("workbench entrypoints plugin", () => {
  it("builds a virtual module from discovered entrypoint files", () => {
    tempDir = mkdtempSync(join(tmpdir(), "workbench-entrypoints-"));
    mkdirSync(join(tempDir, "nested"), { recursive: true });
    writeFileSync(join(tempDir, "alpha.entrypoint.ts"), "export default {};\n");
    writeFileSync(
      join(tempDir, "nested", "beta.entrypoint.ts"),
      "export default {};\n",
    );
    writeFileSync(join(tempDir, "ignore.ts"), "export default {};\n");

    const source = buildWorkbenchEntrypointsVirtualModule(tempDir);

    expect(source).toContain("alpha.entrypoint.ts");
    expect(source).toContain("nested/beta.entrypoint.ts");
    expect(source).not.toContain("ignore.ts");
    expect(source).toContain("export default [entrypoint0, entrypoint1];");
  });
});
