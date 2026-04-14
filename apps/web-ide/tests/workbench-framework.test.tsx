import { beforeAll, describe, expect, it, vi } from "vitest";
import { JSDOM } from "jsdom";
import { MutableSurfaceModel } from "../src/workbench/framework/model";
import { mountWorkbenchSurface } from "../src/workbench/framework/mount";
import { useSurfaceModel } from "../src/workbench/framework/hooks";
import { validateWorkbenchEntrypoints } from "../src/workbench/framework/validate";

beforeAll(() => {
  const dom = new JSDOM("<!doctype html><html><body></body></html>");
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    HTMLElement: dom.window.HTMLElement,
    HTMLDivElement: dom.window.HTMLDivElement,
  });
});

describe("workbench framework", () => {
  it("rerenders mounted components when the surface model changes", () => {
    const model = new MutableSurfaceModel(
      { label: "idle" },
      { focus: vi.fn() },
    );

    function TestView(props: { model: typeof model }) {
      const [state] = useSurfaceModel(props.model);
      return <div data-testid="label">{state.label}</div>;
    }

    const container = document.createElement("div");
    const mount = mountWorkbenchSurface(
      container,
      {
        kind: "view",
        id: "test.view",
        title: "Test",
        location: "sidebar",
        component: TestView,
        createModel: () => model,
      },
      model,
    );

    expect(container.textContent).toContain("idle");

    model.setSnapshot({ label: "ready" });

    expect(container.textContent).toContain("ready");

    mount.dispose();
    expect(container.textContent).toBe("");
  });

  it("rejects duplicate entrypoint ids", () => {
    expect(() =>
      validateWorkbenchEntrypoints([
        {
          kind: "view",
          id: "dup",
          title: "One",
          location: "sidebar",
          component: () => null,
          createModel: () =>
            new MutableSurfaceModel({}, {
              focus: () => undefined,
            }),
        },
        {
          kind: "view",
          id: "dup",
          title: "Two",
          location: "sidebar",
          component: () => null,
          createModel: () =>
            new MutableSurfaceModel({}, {
              focus: () => undefined,
            }),
        },
      ]),
    ).toThrow(/Duplicate workbench entrypoint id/);
  });

  it("rejects unsupported view locations", () => {
    expect(() =>
      validateWorkbenchEntrypoints([
        {
          kind: "view",
          id: "bad.location",
          title: "Bad",
          location: "unsupported" as never,
          component: () => null,
          createModel: () =>
            new MutableSurfaceModel({}, {
              focus: () => undefined,
            }),
        },
      ]),
    ).toThrow(/Unsupported workbench view location/);
  });
});
