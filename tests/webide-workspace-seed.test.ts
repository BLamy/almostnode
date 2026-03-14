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
    expect(container.vfs.existsSync(`${WORKSPACE_ROOT}/components.json`)).toBe(
      true,
    );
    expect(
      container.vfs.existsSync(`${WORKSPACE_ROOT}/tailwind.config.ts`),
    ).toBe(true);
    expect(container.vfs.existsSync(`${WORKSPACE_ROOT}/src/lib/utils.ts`)).toBe(
      true,
    );

    const pkg = JSON.parse(
      container.vfs.readFileSync(`${WORKSPACE_ROOT}/package.json`, "utf8"),
    ) as {
      name?: string;
      scripts?: Record<string, string>;
    };
    const componentsConfig = JSON.parse(
      container.vfs.readFileSync(`${WORKSPACE_ROOT}/components.json`, "utf8"),
    ) as {
      aliases?: Record<string, string>;
      tailwind?: {
        config?: string;
        css?: string;
      };
    };

    const settings = JSON.parse(
      container.vfs.readFileSync(
        `${WORKSPACE_ROOT}/.vscode/settings.json`,
        "utf8",
      ),
    ) as Record<string, unknown>;
    const appSource = container.vfs.readFileSync(DEFAULT_FILE, "utf8");
    const readme = container.vfs.readFileSync(
      `${WORKSPACE_ROOT}/README.md`,
      "utf8",
    );

    expect(pkg.name).toBe("almostnode-webide-tailwind-starter");
    expect(pkg.scripts?.dev).toBe("vite --port 3000");
    expect(componentsConfig.tailwind?.config).toBe("tailwind.config.ts");
    expect(componentsConfig.tailwind?.css).toBe("src/index.css");
    expect(componentsConfig.aliases?.ui).toBe("@/components/ui");
    expect(settings["files.autoSave"]).toBe("onFocusChange");
    expect(settings["editor.minimap.enabled"]).toBe(false);
    expect(settings["workbench.colorTheme"]).toBe("Islands Dark");
    expect(appSource).toContain("Tailwind + shadcn starter");
    expect(appSource).toContain("import { Button } from '@/components/ui/button';");
    expect(readme).toContain("npx shadcn@latest add dropdown-menu");
  });
});
