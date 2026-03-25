// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import matter from "../../../vendor/opencode/packages/browser/src/shims/gray-matter.browser";

describe("Vite template skills", () => {
  it("declare name and description frontmatter for every skill", () => {
    const skillsRoot = path.resolve(__dirname, "../src/templates/content/vite/.claude/skills");
    const skillDirs = fs.readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());

    for (const entry of skillDirs) {
      const skillPath = path.join(skillsRoot, entry.name, "SKILL.md");
      const parsed = matter(fs.readFileSync(skillPath, "utf8"));

      expect(parsed.data.name, `${entry.name} is missing a skill name`).toEqual(expect.any(String));
      expect(parsed.data.description, `${entry.name} is missing a skill description`).toEqual(expect.any(String));
    }
  });
});
