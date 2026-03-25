// @vitest-environment node
import { describe, expect, it } from "vitest";
import { _vfs_addDir, _vfs_setFile } from "../../../vendor/opencode/packages/browser/src/shims/fs.browser";
import { globSync } from "../../../vendor/opencode/packages/browser/src/shims/glob.browser";

describe("OpenCode browser glob shim", () => {
  const root = `/workspace/__webide-glob-${Date.now()}`;

  _vfs_addDir(root);
  _vfs_addDir(`${root}/.claude`);
  _vfs_addDir(`${root}/.claude/skills`);
  _vfs_addDir(`${root}/.claude/skills/playwright`);
  _vfs_addDir(`${root}/.opencode`);
  _vfs_addDir(`${root}/.opencode/agent`);

  _vfs_setFile(
    `${root}/.claude/skills/playwright/SKILL.md`,
    "---\nname: playwright\ndescription: Test skill\n---\nBody\n",
  );
  _vfs_setFile(
    `${root}/.opencode/agent/frontend-engineer.md`,
    "---\ndescription: Test agent\nmode: subagent\n---\nPrompt\n",
  );

  it("matches project-local Claude skills from a hidden .claude directory", () => {
    expect(
      globSync("skills/**/SKILL.md", {
        cwd: `${root}/.claude`,
        absolute: true,
        dot: true,
      }),
    ).toEqual([
      `${root}/.claude/skills/playwright/SKILL.md`,
    ]);
  });

  it("matches brace-based .opencode agent patterns", () => {
    expect(
      globSync("{agent,agents}/**/*.md", {
        cwd: `${root}/.opencode`,
        absolute: true,
        dot: true,
      }),
    ).toEqual([
      `${root}/.opencode/agent/frontend-engineer.md`,
    ]);
  });
});
