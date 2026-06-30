import { describe, expect, it } from "vitest";
import {
  PluginRegistry,
  loadPlugins,
  mergePluginManifests,
} from "../src/plugins";

describe("almostnode-sdk plugin registry", () => {
  it("discovers and normalizes Claude, Codex, sidecar, and folder-convention contributions", async () => {
    const registry = await loadPlugins([
      {
        kind: "directory",
        id: "workspace-plugin",
        root: "/project",
        files: {
          "plugin.json": JSON.stringify({
            id: "agent-wasm-root",
            name: "Agent Wasm Root",
            vscode: {
              panels: {
                docs: {
                  title: "Docs",
                  location: "sidebar",
                  module: "./docs-panel.tsx",
                },
              },
              customEditors: [
                {
                  id: "schema-editor",
                  displayName: "Schema Editor",
                  filePatterns: ["**/*.schema.json"],
                  module: "./schema-editor.tsx",
                },
              ],
            },
          }),
          ".claude-plugin/plugin.json": JSON.stringify({
            name: "claude-lsp",
            lspServers: "./.lsp.json",
          }),
          ".claude-plugin/.lsp.json": JSON.stringify({
            oxlint: {
              command: "almostnode-lsp-bridge",
              args: ["oxlint"],
              transport: "stdio",
            },
          }),
          ".codex-plugin/plugin.json": JSON.stringify({
            id: "codex-tools",
            commands: {
              fix: {
                command: "codex fix",
              },
            },
          }),
          ".mcp.json": JSON.stringify({
            mcpServers: {
              ide: {
                type: "sse-ide",
                url: "http://localhost/__virtual__/43127/sse",
              },
            },
          }),
          "settings.json": JSON.stringify({
            "editor.formatOnSave": true,
          }),
          "skills/frontend/SKILL.md": "# Frontend",
          "commands/review.md": "# Review",
          "agents/planner.md": "# Planner",
          "hooks/pre-commit.json": "{}",
          "monitors/watch.json": "{}",
          "bin/replayio": "#!/usr/bin/env bash\n",
        },
      },
    ]);

    expect(registry.manifest.skills.frontend.path).toBe("skills/frontend/SKILL.md");
    expect(registry.manifest.commands.review.path).toBe("commands/review.md");
    expect(registry.manifest.commands.fix.command).toBe("codex fix");
    expect(registry.manifest.agents.planner.path).toBe("agents/planner.md");
    expect(registry.manifest.hooks["pre-commit"].path).toBe("hooks/pre-commit.json");
    expect(registry.manifest.monitors.watch.path).toBe("monitors/watch.json");
    expect(registry.manifest.bin.replayio.command).toBe("replayio");
    expect(registry.manifest.mcpServers.ide.type).toBe("sse-ide");
    expect(registry.manifest.lspServers.oxlint.command).toBe("almostnode-lsp-bridge");
    expect(registry.manifest.settings["editor.formatOnSave"]).toBe(true);
    expect(registry.listPanels()[0]).toMatchObject({
      id: "docs",
      title: "Docs",
      location: "sidebar",
    });
    expect(registry.listCustomEditors()[0]).toMatchObject({
      id: "schema-editor",
      filePatterns: ["**/*.schema.json"],
    });
  });

  it("merges duplicate contribution ids with last-writer-wins diagnostics", () => {
    const result = mergePluginManifests([
      {
        id: "first",
        commands: {
          build: {
            id: "build",
            command: "npm run build",
          },
        },
        settings: {
          theme: "dark",
        },
        vscode: {
          panels: {
            agent: {
              id: "agent",
              title: "Agent",
              location: "sidebar",
            },
          },
        },
      },
      {
        id: "second",
        commands: {
          build: {
            id: "build",
            command: "pnpm build",
          },
        },
        settings: {
          theme: "light",
        },
        vscode: {
          panels: {
            agent: {
              id: "agent",
              title: "Agent Panel",
              location: "panel",
            },
          },
        },
      },
    ]);

    expect(result.manifest.commands.build.command).toBe("pnpm build");
    expect(result.manifest.settings.theme).toBe("light");
    expect(result.manifest.vscode.panels.agent.location).toBe("panel");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "duplicate-contribution",
      "duplicate-contribution",
      "duplicate-setting",
    ]);
  });

  it("creates a registry directly from manifests", () => {
    const registry = PluginRegistry.fromManifests([
      {
        id: "direct",
        auth: {
          openai: {
            provider: "openai",
            scopes: ["codex"],
          },
        },
      },
    ]);

    expect(registry.getContribution("auth", "openai")).toMatchObject({
      id: "openai",
      provider: "openai",
      pluginId: "direct",
    });
  });
});
