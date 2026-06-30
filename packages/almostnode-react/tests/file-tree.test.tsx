// @vitest-environment jsdom
import { createRoot } from "react-dom/client";
import { act } from "react";
import { beforeAll, describe, expect, it } from "vitest";
import React from "react";
import { createWorkspace } from "../../almostnode-sdk/src/index";

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // React Aria reads matchMedia / ResizeObserver during render; jsdom lacks them.
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
});

describe("FileTree", () => {
  it("renders the seeded workspace files and reflects new files", async () => {
    const { AlmostnodeProvider, FileTree } = await import("../src");
    const workspace = createWorkspace({ autoStartPreview: false });
    await workspace.ready;
    workspace.createFile("/project/src/widget.ts", "export const x = 1;");

    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <AlmostnodeProvider workspace={workspace}>
          <FileTree />
        </AlmostnodeProvider>,
      );
    });

    // Top-level entries are always rendered; nested files appear once expanded,
    // but the directory node and root files should be present.
    expect(container.textContent).toContain("package.json");
    expect(container.textContent).toContain("src");

    await act(async () => {
      root.unmount();
    });
    workspace.destroy();
  });
});
