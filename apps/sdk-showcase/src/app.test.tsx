// @vitest-environment jsdom
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import React from "react";

describe("sdk-showcase", () => {
  it("renders the showcase shell", async () => {
    HTMLCanvasElement.prototype.getContext = (() => ({})) as typeof HTMLCanvasElement.prototype.getContext;
    const { App } = await import("./app");
    const container = document.createElement("div");
    document.body.append(container);
    createRoot(container).render(
      <App
        autoStartPreview={false}
        enableAgent={false}
        showPreview={false}
        showTerminal={false}
      />,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(container.textContent).toContain("almostnode");
  });
});
