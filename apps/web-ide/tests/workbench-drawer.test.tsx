import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { WorkbenchDrawer, DRAWER_OPEN_EVENT } from "../src/desktop/workbench-drawer";

beforeAll(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost:5173/",
    pretendToBeVisual: true,
  });
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    localStorage: dom.window.localStorage,
    Event: dom.window.Event,
    KeyboardEvent: dom.window.KeyboardEvent,
    requestAnimationFrame: dom.window.requestAnimationFrame.bind(dom.window),
    cancelAnimationFrame: dom.window.cancelAnimationFrame.bind(dom.window),
  });
});

function renderDrawer(props: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): { container: HTMLElement; root: Root; rerender: (open: boolean) => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (open: boolean) => {
    flushSync(() => {
      root.render(
        <WorkbenchDrawer open={open} onOpenChange={props.onOpenChange}>
          <div data-testid="drawer-child">workbench</div>
        </WorkbenchDrawer>,
      );
    });
  };
  render(props.open);
  return { container, root, rerender: render };
}

describe("workbench drawer", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("keeps children mounted when closed and clips via zero width", () => {
    const { container, rerender, root } = renderDrawer({
      open: true,
      onOpenChange: () => {},
    });

    expect(container.querySelector('[data-testid="drawer-child"]')).toBeTruthy();
    const drawer = container.querySelector(".webide-drawer") as HTMLElement;
    expect(drawer.style.width).not.toBe("0px");

    rerender(false);

    // Children must never unmount — Monaco has no re-mount path.
    expect(container.querySelector('[data-testid="drawer-child"]')).toBeTruthy();
    expect(
      (container.querySelector(".webide-drawer") as HTMLElement).style.width,
    ).toBe("0px");
    // Inner content keeps its pixel width so Monaco never measures 0x0.
    const content = container.querySelector(".webide-drawer-content") as HTMLElement;
    expect(content.style.width).not.toBe("0px");
    expect(content.style.width).toMatch(/px$/);

    root.unmount();
    container.remove();
  });

  it("opens via the drawer-open window event and dispatches resize", () => {
    // Run the deferred layout-resize callbacks synchronously.
    const rafSpy = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        cb(0);
        return 1;
      });
    const timeoutSpy = vi
      .spyOn(window, "setTimeout")
      .mockImplementation(((cb: () => void) => {
        cb();
        return 0;
      }) as typeof window.setTimeout);

    const onOpenChange = vi.fn();
    const { container, root } = renderDrawer({ open: false, onOpenChange });

    const resizeListener = vi.fn();
    window.addEventListener("resize", resizeListener);

    window.dispatchEvent(new Event(DRAWER_OPEN_EVENT));
    expect(onOpenChange).toHaveBeenCalledWith(true);
    // Resize fires both on the next frame and after the transition window.
    expect(resizeListener).toHaveBeenCalledTimes(2);

    // The event only opens — it never closes an open drawer.
    onOpenChange.mockClear();
    root.unmount();
    const reopened = renderDrawer({ open: true, onOpenChange });
    window.dispatchEvent(new Event(DRAWER_OPEN_EVENT));
    expect(onOpenChange).not.toHaveBeenCalled();

    window.removeEventListener("resize", resizeListener);
    rafSpy.mockRestore();
    timeoutSpy.mockRestore();
    reopened.root.unmount();
    reopened.container.remove();
    container.remove();
  });

  it("restores persisted width on mount", () => {
    window.localStorage.setItem("almostnode-workbench-drawer-width", "555");
    const { container, root } = renderDrawer({ open: true, onOpenChange: () => {} });
    const content = container.querySelector(".webide-drawer-content") as HTMLElement;
    expect(content.style.width).toBe("555px");
    root.unmount();
    container.remove();
  });
});
