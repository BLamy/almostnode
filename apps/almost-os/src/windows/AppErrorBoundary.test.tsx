// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./AppErrorBoundary";

// Opt into React's act() testing semantics (flushes effects/state deterministically).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function mount(node: React.ReactNode): void {
  act(() => {
    root.render(node);
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function Boom({ shouldThrow }: { shouldThrow: boolean }): React.ReactElement {
  if (shouldThrow) throw new Error("kaboom");
  return <div className="ok">alive</div>;
}

describe("AppErrorBoundary", () => {
  it("renders children when they don't throw", () => {
    mount(
      <AppErrorBoundary appName="Finder" onClose={() => {}}>
        <Boom shouldThrow={false} />
      </AppErrorBoundary>,
    );
    expect(container.querySelector(".ok")?.textContent).toBe("alive");
    expect(container.querySelector(".os-app-crash")).toBeNull();
  });

  it("catches a render error and shows the fallback with the app name", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mount(
      <AppErrorBoundary appName="Winamp" onClose={() => {}}>
        <Boom shouldThrow={true} />
      </AppErrorBoundary>,
    );
    const crash = container.querySelector(".os-app-crash");
    expect(crash).not.toBeNull();
    expect(container.querySelector(".os-app-crash__title")?.textContent).toContain("Winamp");
    expect(container.querySelector(".os-app-crash__detail")?.textContent).toBe("kaboom");
  });

  it("static getDerivedStateFromError surfaces the error into state", () => {
    const err = new Error("nope");
    expect(AppErrorBoundary.getDerivedStateFromError(err)).toEqual({ error: err });
  });

  it("Close invokes onClose", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const onClose = vi.fn();
    mount(
      <AppErrorBoundary appName="Napster" onClose={onClose}>
        <Boom shouldThrow={true} />
      </AppErrorBoundary>,
    );
    const closeBtn = [...container.querySelectorAll(".os-app-crash__btn")].find(
      (b) => b.textContent === "Close",
    ) as HTMLButtonElement;
    act(() => closeBtn.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Reload remounts the subtree so a recovered app renders again", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // A stable external flag (not mutated during render) controls throwing, so
    // React's DEV error-retry sees consistent behavior.
    let broken = true;
    function Flaky(): React.ReactElement {
      if (broken) throw new Error("first mount fails");
      return <div className="recovered">back</div>;
    }
    mount(
      <AppErrorBoundary appName="Code" onClose={() => {}}>
        <Flaky />
      </AppErrorBoundary>,
    );
    expect(container.querySelector(".os-app-crash")).not.toBeNull();
    // Fix the underlying failure, then Reload → fresh mount renders content.
    broken = false;
    const reloadBtn = [...container.querySelectorAll(".os-app-crash__btn")].find(
      (b) => b.textContent === "Reload",
    ) as HTMLButtonElement;
    act(() => reloadBtn.click());
    expect(container.querySelector(".os-app-crash")).toBeNull();
    expect(container.querySelector(".recovered")?.textContent).toBe("back");
  });
});
