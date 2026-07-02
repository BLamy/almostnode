// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { terminalOverlayHost } from "./terminal-overlay-host";

describe("terminalOverlayHost", () => {
  afterEach(() => {
    terminalOverlayHost.set(null);
  });

  it("starts with no active host", () => {
    expect(terminalOverlayHost.get()).toBeNull();
  });

  it("tracks the most recently set host", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");

    terminalOverlayHost.set(a);
    expect(terminalOverlayHost.get()).toBe(a);

    terminalOverlayHost.set(b);
    expect(terminalOverlayHost.get()).toBe(b);
  });

  it("can be cleared", () => {
    terminalOverlayHost.set(document.createElement("div"));
    terminalOverlayHost.set(null);
    expect(terminalOverlayHost.get()).toBeNull();
  });
});
