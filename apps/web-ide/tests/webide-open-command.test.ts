import { describe, expect, it } from "vitest";

import {
  parseWebIdeOpenTarget,
  resolveWebIdeOpenPath,
} from "../src/features/webide-open-command";

describe("webide-open command helpers", () => {
  it("parses project-relative paths with line and column", () => {
    expect(parseWebIdeOpenTarget("src/app.tsx:12:4")).toEqual({
      path: "src/app.tsx",
      line: 12,
      column: 4,
    });
  });

  it("parses a single trailing line number without stripping other colons", () => {
    expect(parseWebIdeOpenTarget("notes:design.md:9")).toEqual({
      path: "notes:design.md",
      line: 9,
    });
  });

  it("rejects malformed line and column values", () => {
    expect(() => parseWebIdeOpenTarget("src/app.tsx:0")).toThrow(
      "Invalid line: 0.",
    );
    expect(() => parseWebIdeOpenTarget("src/app.tsx:12:0")).toThrow(
      "Invalid column: 0.",
    );
  });

  it("resolves relative paths against the active workspace cwd", () => {
    expect(
      resolveWebIdeOpenPath("utils/math.ts", "/project/src", "/project"),
    ).toBe("/project/src/utils/math.ts");
  });

  it("falls back to the workspace root when cwd is outside the project", () => {
    expect(resolveWebIdeOpenPath("src/main.ts", "/", "/project")).toBe(
      "/project/src/main.ts",
    );
  });

  it("rejects traversals outside the workspace", () => {
    expect(() =>
      resolveWebIdeOpenPath("../../secrets.txt", "/project/src", "/project"),
    ).toThrow("webide-open only supports files inside /project.");
  });
});
