import { describe, expect, it } from "vitest";
import { createContainer } from "almostnode";
import {
  DEFAULT_FILE,
  WORKSPACE_ROOT,
  WORKSPACE_TEST_E2E_ROOT,
  WORKSPACE_TEST_METADATA_PATH,
  seedWorkspace,
} from "../src/features/workspace-seed";

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
    expect(container.vfs.existsSync(`${WORKSPACE_ROOT}/.gitignore`)).toBe(true);
    expect(container.vfs.existsSync(`${WORKSPACE_TEST_E2E_ROOT}/todo-crud.spec.ts`)).toBe(true);
    expect(container.vfs.existsSync(WORKSPACE_TEST_METADATA_PATH)).toBe(true);

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
    const homeSource = container.vfs.readFileSync(
      `${WORKSPACE_ROOT}/src/pages/Home.tsx`,
      "utf8",
    );
    const readme = container.vfs.readFileSync(
      `${WORKSPACE_ROOT}/README.md`,
      "utf8",
    );
    const gitignore = container.vfs.readFileSync(
      `${WORKSPACE_ROOT}/.gitignore`,
      "utf8",
    );
    const envDecl = container.vfs.readFileSync(
      `${WORKSPACE_ROOT}/src/env.d.ts`,
      "utf8",
    );
    const tsconfig = JSON.parse(
      container.vfs.readFileSync(`${WORKSPACE_ROOT}/tsconfig.json`, "utf8"),
    ) as {
      compilerOptions?: {
        baseUrl?: string;
      };
    };

    expect(pkg.name).toBe("almostnode-webide-tailwind-starter");
    expect(pkg.scripts?.dev).toBe("vite --port 3000");
    expect(componentsConfig.tailwind?.config).toBe("tailwind.config.ts");
    expect(componentsConfig.tailwind?.css).toBe("src/index.css");
    expect(componentsConfig.aliases?.ui).toBe("@/components/ui");
    expect(settings["files.autoSave"]).toBe("onFocusChange");
    expect(settings["editor.minimap.enabled"]).toBe(false);
    expect(settings["workbench.colorTheme"]).toBe("Islands Dark");
    expect(appSource).toContain("react-router-dom");
    expect(homeSource).toContain("Tailwind + shadcn starter");
    expect(homeSource).toContain("import { Button } from '@/components/ui/button';");
    expect(readme).toContain("npx shadcn@latest add dropdown-menu");
    expect(gitignore).toContain(".claude/");
    expect(gitignore).toContain("node_modules/");
    expect(envDecl.trim()).toBe('/// <reference types="vite/client" />');
    expect(envDecl).not.toContain("declare module 'react'");
    expect(tsconfig.compilerOptions?.baseUrl).toBeUndefined();
  });

  it("keeps template-only files out of git when seeded into /project", async () => {
    const container = createContainer({
      cwd: WORKSPACE_ROOT,
      git: {
        authorName: "Test User",
        authorEmail: "test@example.com",
      },
    });

    seedWorkspace(container);
    container.vfs.writeFileSync(`${WORKSPACE_ROOT}/node_modules/demo/package.json`, '{"name":"demo"}\n');
    container.vfs.writeFileSync(`${WORKSPACE_ROOT}/build/out.txt`, 'build output\n');
    container.vfs.writeFileSync(`${WORKSPACE_ROOT}/tmp/cache.txt`, 'tmp data\n');

    let result = await container.run("git init");
    expect(result.exitCode).toBe(0);

    result = await container.run("git add -A");
    expect(result.exitCode).toBe(0);

    result = await container.run("git status --short");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain(".claude/");
    expect(result.stdout).not.toContain("node_modules/");
    expect(result.stdout).not.toContain("build/");
    expect(result.stdout).not.toContain("tmp/");
  });

  it("uses /project as the default container cwd for git and npm state", async () => {
    const container = createContainer({ cwd: WORKSPACE_ROOT });

    container.vfs.mkdirSync(WORKSPACE_ROOT, { recursive: true });
    container.vfs.writeFileSync(`${WORKSPACE_ROOT}/package.json`, '{"name":"project-root"}\n');
    container.vfs.writeFileSync(`${WORKSPACE_ROOT}/node_modules/project-only/package.json`, '{"name":"project-only","version":"1.0.0"}\n');
    container.vfs.writeFileSync(`/node_modules/root-only/package.json`, '{"name":"root-only","version":"1.0.0"}\n');

    const session = container.createTerminalSession();
    expect(session.getState().cwd).toBe(WORKSPACE_ROOT);

    const pwdResult = await container.run("pwd");
    expect(pwdResult.exitCode).toBe(0);
    expect(pwdResult.stdout.trim()).toBe(WORKSPACE_ROOT);

    const packages = container.npm.list();
    expect(packages["project-only"]).toBe("1.0.0");
    expect(packages["root-only"]).toBeUndefined();

    const gitResult = await container.run("git init");
    expect(gitResult.exitCode).toBe(0);
    expect(container.vfs.existsSync(`${WORKSPACE_ROOT}/.git`)).toBe(true);
    expect(container.vfs.existsSync("/.git")).toBe(false);
  });
});
