import { describe, expect, it } from "vitest";
import { createContainer } from "../src";
import {
  DEFAULT_FILE,
  WORKSPACE_ROOT,
  seedWorkspace,
} from "../src/webide/workspace-seed";

describe("webide workspace seed", () => {
  it("creates a seeded project with workspace settings", () => {
    const container = createContainer();

    seedWorkspace(container);

    expect(container.vfs.existsSync(DEFAULT_FILE)).toBe(true);
    expect(container.vfs.existsSync(`${WORKSPACE_ROOT}/index.html`)).toBe(true);
    expect(
      container.vfs.existsSync(
        `${WORKSPACE_ROOT}/src/components/ui/button.tsx`,
      ),
    ).toBe(true);

    const pkg = JSON.parse(
      container.vfs.readFileSync(`${WORKSPACE_ROOT}/package.json`, "utf8"),
    ) as {
      scripts?: Record<string, string>;
    };

    const settings = JSON.parse(
      container.vfs.readFileSync(
        `${WORKSPACE_ROOT}/.vscode/settings.json`,
        "utf8",
      ),
    ) as Record<string, unknown>;

    expect(pkg.scripts?.dev).toBe("vite --port 3000");
    expect(settings["files.autoSave"]).toBe("afterDelay");
    expect(settings["editor.minimap.enabled"]).toBe(false);
    expect(settings["workbench.colorTheme"]).toBe("Default Dark Modern");
  });
});
