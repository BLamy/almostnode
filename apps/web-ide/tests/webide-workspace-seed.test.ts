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
    expect(container.vfs.existsSync(`${WORKSPACE_ROOT}/AGENTS.md`)).toBe(true);
    expect(container.vfs.existsSync(`${WORKSPACE_ROOT}/CLAUDE.md`)).toBe(true);
    expect(container.vfs.existsSync(`${WORKSPACE_ROOT}/.claude/settings.json`)).toBe(true);
    expect(container.vfs.existsSync(`${WORKSPACE_ROOT}/.claude-plugin/plugin.json`)).toBe(true);
    expect(container.vfs.existsSync(`${WORKSPACE_ROOT}/.claude-plugin/.lsp.json`)).toBe(true);
    expect(container.vfs.existsSync(`${WORKSPACE_ROOT}/.claude/hooks/task-git.sh`)).toBe(true);
    expect(container.vfs.existsSync(`${WORKSPACE_ROOT}/.opencode/opencode.jsonc`)).toBe(true);
    expect(container.vfs.existsSync(`${WORKSPACE_ROOT}/.opencode/plugins/task-git.js`)).toBe(true);
    expect(container.vfs.existsSync(`${WORKSPACE_TEST_E2E_ROOT}/todo-crud.spec.ts`)).toBe(true);
    expect(container.vfs.existsSync(WORKSPACE_TEST_METADATA_PATH)).toBe(true);

    const pkg = JSON.parse(
      container.vfs.readFileSync(`${WORKSPACE_ROOT}/package.json`, "utf8"),
    ) as {
      name?: string;
      scripts?: Record<string, string>;
      devDependencies?: Record<string, string>;
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
    const claudeSettings = JSON.parse(
      container.vfs.readFileSync(
        `${WORKSPACE_ROOT}/.claude/settings.json`,
        "utf8",
      ),
    ) as {
      hooks?: {
        TaskCompleted?: Array<{
          hooks?: Array<{
            command?: string;
          }>;
        }>;
      };
      permissions?: {
        allow?: string[];
      };
    };
    const claudePlugin = JSON.parse(
      container.vfs.readFileSync(
        `${WORKSPACE_ROOT}/.claude-plugin/.lsp.json`,
        "utf8",
      ),
    ) as Record<string, { command?: string; args?: string[] }>;
    const opencodeConfig = container.vfs.readFileSync(
      `${WORKSPACE_ROOT}/.opencode/opencode.jsonc`,
      "utf8",
    );
    const appSource = container.vfs.readFileSync(DEFAULT_FILE, "utf8");
    const claudeGitHook = container.vfs.readFileSync(
      `${WORKSPACE_ROOT}/.claude/hooks/task-git.sh`,
      "utf8",
    );
    const homeSource = container.vfs.readFileSync(
      `${WORKSPACE_ROOT}/src/pages/Home.tsx`,
      "utf8",
    );
    const readme = container.vfs.readFileSync(
      `${WORKSPACE_ROOT}/README.md`,
      "utf8",
    );
    const agentsGuide = container.vfs.readFileSync(
      `${WORKSPACE_ROOT}/AGENTS.md`,
      "utf8",
    );
    const claudeGuide = container.vfs.readFileSync(
      `${WORKSPACE_ROOT}/CLAUDE.md`,
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
    expect(pkg.scripts?.typecheck).toBe("tsc --noEmit && npx --yes tsgo-wasm --noEmit");
    expect(pkg.scripts?.lint).toBe("oxlint .");
    expect(pkg.scripts?.format).toBe("oxfmt .");
    expect(pkg.devDependencies?.oxfmt).toBe("^0.43.0");
    expect(pkg.devDependencies?.oxlint).toBe("^1.58.0");
    expect(pkg.devDependencies?.["tsgo-wasm"]).toBe("^2026.4.2");
    expect(pkg.devDependencies?.["@typescript/native-preview"]).toBe("^7.0.0-dev.20260401.1");
    expect(componentsConfig.tailwind?.config).toBe("tailwind.config.ts");
    expect(componentsConfig.tailwind?.css).toBe("src/index.css");
    expect(componentsConfig.aliases?.ui).toBe("@/components/ui");
    expect(settings["files.autoSave"]).toBe("onFocusChange");
    expect(settings["editor.minimap.enabled"]).toBe(false);
    expect(settings["workbench.colorTheme"]).toBe("Islands Dark");
    expect(settings["javascript.format.enable"]).toBe(false);
    expect(settings["typescript.format.enable"]).toBe(false);
    expect(settings["eslint.validate"]).toEqual([]);
    expect(settings["editor.codeActionsOnSave"]).toEqual({
      "source.fixAll.eslint": "never",
    });
    expect(
      claudeSettings.hooks?.TaskCompleted?.[0]?.hooks?.[0]?.command,
    ).toContain(".claude/hooks/task-git.sh");
    expect(claudeSettings.permissions?.allow).toContain("Bash(almostnode-lsp-bridge *)");
    expect(claudeSettings.permissions?.allow).toContain("Bash(oxfmt *)");
    expect(claudePlugin.oxlint?.command).toBe("almostnode-lsp-bridge");
    expect(claudePlugin.oxlint?.args).toEqual(["oxlint"]);
    expect(claudePlugin.tsgo?.args).toEqual(["tsgo"]);
    expect(opencodeConfig).toContain('"command": ["oxfmt", "$FILE"]');
    expect(opencodeConfig).toContain('"command": ["almostnode-lsp-bridge", "oxlint"]');
    expect(opencodeConfig).toContain('"command": ["almostnode-lsp-bridge", "tsgo"]');
    expect(claudeGitHook).toContain("git add .");
    expect(claudeGitHook).toContain('git commit -m "Complete task"');
    expect(claudeGitHook).toContain('git push -u origin "$BRANCH"');
    expect(appSource).toContain("react-router-dom");
    expect(homeSource).toContain("Tailwind + shadcn starter");
    expect(homeSource).toContain("import { Button } from '@/components/ui/button';");
    expect(readme).toContain("npx shadcn@latest add dropdown-menu");
    expect(agentsGuide).toContain("OpenCode uses `AGENTS.md` and `.opencode/agent/`");
    expect(claudeGuide).toContain("Claude Code uses `CLAUDE.md` and `.claude/`");
    expect(gitignore).toContain(".claude/settings.local.json");
    expect(gitignore.split("\n")).not.toContain(".claude/");
    expect(gitignore).toContain("node_modules/");
    expect(envDecl.trim()).toBe('/// <reference types="vite/client" />');
    expect(envDecl).not.toContain("declare module 'react'");
    expect(tsconfig.compilerOptions?.baseUrl).toBeUndefined();
  });

  it("wires vite template npm lint and format scripts to the OXC shell commands", async () => {
    const container = createContainer({ cwd: WORKSPACE_ROOT });

    seedWorkspace(container, "vite");
    container.vfs.writeFileSync(
      `${WORKSPACE_ROOT}/src/App.tsx`,
      'export    default   function App( ){return <div>hi</div>}\nasdf\n',
    );

    const formatResult = await container.run("npm run format", { cwd: WORKSPACE_ROOT });
    const formattedSource = container.vfs.readFileSync(`${WORKSPACE_ROOT}/src/App.tsx`, "utf8");
    const lintResult = await container.run("npm run lint", { cwd: WORKSPACE_ROOT });

    expect(formatResult.exitCode).toBe(0);
    expect(formattedSource).toContain("export default function App()");
    expect(formattedSource).toContain("asdf;");
    expect(lintResult.exitCode).toBe(1);
    expect(lintResult.stdout).toContain("src/App.tsx:4:1:");
  }, 60_000);

  it("seeds the app-building template without vite demo tests", () => {
    const container = createContainer();

    seedWorkspace(container, "app-building");

    expect(
      container.vfs.existsSync(`${WORKSPACE_ROOT}/src/lib/app-building-dashboard.ts`),
    ).toBe(true);
    expect(
      container.vfs.readFileSync(`${WORKSPACE_ROOT}/.almostnode/project.json`, "utf8"),
    ).toContain('"templateId": "app-building"');

    const pkg = JSON.parse(
      container.vfs.readFileSync(`${WORKSPACE_ROOT}/package.json`, "utf8"),
    ) as { name?: string };
    expect(pkg.name).toBe("almostnode-app-building-control-plane");
    expect(container.vfs.existsSync(`${WORKSPACE_TEST_E2E_ROOT}/todo-crud.spec.ts`)).toBe(false);
  });

  it("wires vite template npm typecheck to both tsc and tsgo-wasm", async () => {
    const container = createContainer({ cwd: WORKSPACE_ROOT });

    seedWorkspace(container, "vite");
    container.vfs.mkdirSync(`${WORKSPACE_ROOT}/node_modules/typescript/bin`, { recursive: true });
    container.vfs.mkdirSync(`${WORKSPACE_ROOT}/node_modules/tsgo-wasm`, { recursive: true });

    container.vfs.writeFileSync(
      `${WORKSPACE_ROOT}/node_modules/typescript/bin/tsc`,
      `require("fs").writeFileSync("/project/.tsc-ran", process.argv.slice(2).join(" ") + "\\n");\n`,
    );
    container.vfs.writeFileSync(
      `${WORKSPACE_ROOT}/node_modules/tsgo-wasm/package.json`,
      JSON.stringify({
        name: "tsgo-wasm",
        version: "2026.4.2",
        bin: {
          "tsgo-wasm": "tsgo-wasm",
        },
      }),
    );
    container.vfs.writeFileSync(
      `${WORKSPACE_ROOT}/node_modules/tsgo-wasm/tsgo-wasm`,
      `require("fs").writeFileSync("/project/.tsgo-wasm-ran", process.argv.slice(2).join(" ") + "\\n");\n`,
    );

    const typecheckResult = await container.run("npm run typecheck", { cwd: WORKSPACE_ROOT });

    expect(typecheckResult.exitCode).toBe(0);
    expect(container.vfs.readFileSync(`${WORKSPACE_ROOT}/.tsc-ran`, "utf8").trim()).toBe("--noEmit");
    expect(container.vfs.readFileSync(`${WORKSPACE_ROOT}/.tsgo-wasm-ran`, "utf8").trim()).toBe("--noEmit");
  }, 60_000);

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
    expect(result.stdout).toContain(".claude/settings.json");
    expect(result.stdout).toContain(".claude/hooks/task-git.sh");
    expect(result.stdout).toContain(".opencode/plugins/task-git.js");
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

  it("seeds git automation hooks for both Claude and OpenCode", () => {
    const container = createContainer();

    seedWorkspace(container);

    const claudeGitHook = container.vfs.readFileSync(
      `${WORKSPACE_ROOT}/.claude/hooks/task-git.sh`,
      "utf8",
    );
    const opencodeGitHook = container.vfs.readFileSync(
      `${WORKSPACE_ROOT}/.opencode/plugins/task-git.js`,
      "utf8",
    );

    expect(claudeGitHook).toContain("git add .");
    expect(claudeGitHook).toContain('git commit -m "Complete task"');
    expect(opencodeGitHook).toContain('input.tool !== "todowrite"');
    expect(opencodeGitHook).toContain("git add .");
    expect(opencodeGitHook).toContain("git push -u origin");
  });
});
