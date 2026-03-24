// @vitest-environment jsdom
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import React from "react";
import { createWorkspace } from "../../almostnode-sdk/src/index";

describe("almostnode-react", () => {
  it("renders editor content from the workspace", async () => {
    HTMLCanvasElement.prototype.getContext = (() => ({})) as typeof HTMLCanvasElement.prototype.getContext;
    const { AlmostnodeProvider, EditorPane } = await import("../src");
    const workspace = createWorkspace();
    await workspace.ready;
    const container = document.createElement("div");
    document.body.append(container);

    createRoot(container).render(
      <AlmostnodeProvider workspace={workspace}>
        <EditorPane />
      </AlmostnodeProvider>,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const textarea = container.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea?.value).toContain("almostnode sdk");
    workspace.destroy();
  });

  it("keeps the latest agent mount under StrictMode async replays", async () => {
    const { AgentPanel, AlmostnodeProvider } = await import("../src");
    const workspace = createWorkspace({ autoStartPreview: false });
    await workspace.ready;

    let mountCount = 0;
    workspace.agents.register({
      id: "delayed-agent",
      label: "Delayed Agent",
      mount: async ({ element }) => {
        mountCount += 1;
        const mountId = mountCount;
        await new Promise((resolve) => setTimeout(resolve, mountId === 1 ? 30 : 0));
        element.textContent = `mounted-${mountId}`;
        return {
          dispose: () => {
            element.textContent = "";
          },
        };
      },
    });

    const container = document.createElement("div");
    container.style.width = "400px";
    container.style.height = "320px";
    document.body.append(container);

    createRoot(container).render(
      <React.StrictMode>
        <AlmostnodeProvider workspace={workspace}>
          <AgentPanel adapterId="delayed-agent" />
        </AlmostnodeProvider>
      </React.StrictMode>,
    );

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(container.textContent).toContain("mounted-2");
    workspace.destroy();
  });
});
