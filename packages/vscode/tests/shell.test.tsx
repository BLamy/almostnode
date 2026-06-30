// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import { PluginRegistry } from "@agent-wasm/sdk/plugins";
import {
  VSCode,
  createVSCodeShell,
  defineVSCodeCustomEditor,
  defineVSCodePanel,
} from "../src";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("@agent-wasm/vscode", () => {
  it("routes plugin panels and custom editors from the unified registry", async () => {
    const workspace = createMockWorkspace({
      "/project/schema.graph.json": "{}",
    });

    const registry = PluginRegistry.fromManifests([
      {
        id: "graph-tools",
        commands: {
          lintGraph: {
            command: "echo lint",
          },
        },
        vscode: {
          panels: {
            graph: {
              title: "Graph",
              location: "sidebar",
            },
          },
          customEditors: {
            graphEditor: {
              displayName: "Graph Editor",
              filePatterns: ["**/*.graph.json"],
            },
          },
        },
      },
    ]);
    const shell = createVSCodeShell({ workspace, plugins: registry });

    expect(shell.getPanels("sidebar").map((panel) => panel.id)).toEqual(["graph"]);
    expect(shell.matchCustomEditor("/project/schema.graph.json")?.id).toBe("graphEditor");

    shell.fileProvider.writeFile("/project/schema.graph.json", '{"changed":true}');
    expect(workspace.readFile("/project/schema.graph.json")).toBe('{"changed":true}');

    const opened = shell.openResource("/project/schema.graph.json");
    expect(opened.kind).toBe("customEditor");
    expect(workspace.getSnapshot().currentFile).toBe("/project/schema.graph.json");

    shell.dispose();
  });

  it("mounts custom editors with stable Playwright metadata", async () => {
    const workspace = createMockWorkspace({
      "/project/workflow.graph.json": "initial",
    });

    const shell = createVSCodeShell({
      workspace,
      customEditors: [
        defineVSCodeCustomEditor({
          id: "graphEditor",
          pluginId: "graph-tools",
          displayName: "Graph Editor",
          filePatterns: ["**/*.graph.json"],
          render({ container, resource, workspace: mountedWorkspace }) {
            const input = document.createElement("input");
            input.value = mountedWorkspace.readFile(resource);
            input.addEventListener("input", () => {
              mountedWorkspace.writeFile(resource, input.value);
            });
            container.append(input);
          },
        }),
      ],
    });
    const container = document.createElement("div");
    document.body.append(container);

    const disposable = await shell.mountCustomEditor(
      "graphEditor",
      "/project/workflow.graph.json",
      container,
    );
    const target = shell.getPlaywrightTarget("/project/workflow.graph.json");

    expect(container.dataset.agentWasmPluginId).toBe("graph-tools");
    expect(container.dataset.agentWasmVscodeEditorId).toBe("graphEditor");
    expect(container.dataset.agentWasmResource).toBe("/project/workflow.graph.json");
    expect(target).toMatchObject({
      kind: "customEditor",
      pluginId: "graph-tools",
      editorId: "graphEditor",
      resource: "/project/workflow.graph.json",
    });
    expect(target?.selector).toBe(`[data-testid="${container.dataset.testid}"]`);

    const input = container.querySelector("input") as HTMLInputElement;
    input.value = "changed through custom editor";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(workspace.readFile("/project/workflow.graph.json")).toBe("changed through custom editor");

    disposable.dispose();
    shell.dispose();
  });

  it("renders the React wrapper and saves text edits through the workspace VFS", async () => {
    const workspace = createMockWorkspace({
      "/project/src/main.js": "console.log('before')",
    });
    workspace.setCurrentFile("/project/src/main.js");

    const container = document.createElement("div");
    container.style.width = "800px";
    container.style.height = "480px";
    document.body.append(container);

    await act(async () => {
      createRoot(container).render(
        <VSCode
          workspace={workspace}
          panels={[
            defineVSCodePanel({
              id: "agent",
              title: "Agent",
              location: "sidebar",
              render({ container: panelContainer }) {
                panelContainer.textContent = "Agent panel";
              },
            }),
          ]}
        />,
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(container.textContent).toContain("Agent panel");
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.value).toContain("before");

    await act(async () => {
      setNativeValue(textarea, "console.log('after')");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(workspace.readFile("/project/src/main.js")).toBe("console.log('after')");
  });
});

function setNativeValue(element: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(element, value);
}

function createMockWorkspace(initialFiles: Record<string, string>) {
  const files = new Map(Object.entries(initialFiles));
  const listeners = new Set<() => void>();
  let currentFile = Object.keys(initialFiles)[0] ?? null;
  const emit = () => {
    for (const listener of listeners) {
      listener();
    }
  };

  return {
    container: {
      run: async (command: string) => ({
        command,
        exitCode: 0,
        stdout: "",
        stderr: "",
      }),
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => ({
      currentFile,
    }),
    setCurrentFile(path: string) {
      currentFile = path;
      emit();
    },
    readFile(path: string) {
      const value = files.get(path);
      if (value == null) {
        throw new Error(`Missing mock file: ${path}`);
      }
      return value;
    },
    writeFile(path: string, content: string) {
      files.set(path, content);
      emit();
    },
    listFiles(root = "/project") {
      return [...files.keys()].filter((path) => path.startsWith(root));
    },
  };
}
