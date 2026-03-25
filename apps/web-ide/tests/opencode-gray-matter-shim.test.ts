// @vitest-environment node
import { describe, expect, it } from "vitest";
import matter from "../../../vendor/opencode/packages/browser/src/shims/gray-matter.browser";

describe("OpenCode browser gray-matter shim", () => {
  it("parses YAML frontmatter into structured data", () => {
    const parsed = matter(`---
name: frontend-engineer
description: Implement UI changes
enabled: false
tools:
  bash: false
---
Prompt body
`);

    expect(parsed.data).toEqual({
      name: "frontend-engineer",
      description: "Implement UI changes",
      enabled: false,
      tools: {
        bash: false,
      },
    });
    expect(parsed.content).toBe("Prompt body\n");
  });

  it("returns empty metadata when a file has no frontmatter", () => {
    const parsed = matter("# Plain markdown\n");

    expect(parsed.data).toEqual({});
    expect(parsed.content).toBe("# Plain markdown\n");
  });
});
