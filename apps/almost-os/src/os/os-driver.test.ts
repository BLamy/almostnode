// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  buildTree,
  getAccessibleName,
  getRole,
  listApps,
  renderTree,
  resetOsDriver,
  snapshot,
} from "./os-driver";

afterEach(() => {
  document.body.innerHTML = "";
  resetOsDriver();
});

/** Mount a fake app window with the data attributes Window.tsx sets. */
function mountWindow(appId: string, title: string, bodyHtml: string, focused = true): void {
  const win = document.createElement("div");
  win.className = `os-window${focused ? " is-focused" : ""}`;
  win.setAttribute("data-app-id", appId);
  win.setAttribute("data-window-id", `${appId}-1`);
  win.setAttribute("aria-label", title);
  const body = document.createElement("div");
  body.className = "os-window__body";
  body.innerHTML = bodyHtml;
  win.appendChild(body);
  document.body.appendChild(win);
}

describe("accessibility helpers", () => {
  it("resolves implicit and explicit roles", () => {
    const btn = document.createElement("button");
    expect(getRole(btn)).toBe("button");
    const div = document.createElement("div");
    div.setAttribute("role", "tab");
    expect(getRole(div)).toBe("tab");
  });

  it("derives accessible names from aria-label, labels, and placeholders", () => {
    const el = document.createElement("button");
    el.setAttribute("aria-label", "Save");
    expect(getAccessibleName(el)).toBe("Save");

    const input = document.createElement("input");
    input.setAttribute("placeholder", "Email");
    expect(getAccessibleName(input)).toBe("Email");
  });
});

describe("buildTree", () => {
  it("produces a ref-tree of interesting elements", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <h1>Title</h1>
      <button aria-label="Go">Go</button>
      <div><span>plain text</span></div>
    `;
    const refMap = new Map<string, Element>();
    const tree = buildTree(root, refMap);
    const flat = JSON.stringify(tree);
    expect(flat).toContain('"heading"');
    expect(flat).toContain('"button"');
    expect(flat).toContain("Go");
    // refs point at real elements
    expect(refMap.size).toBeGreaterThan(0);
    expect([...refMap.values()].some((el) => el.tagName === "BUTTON")).toBe(true);
  });

  it("renders a readable indented tree", () => {
    const root = document.createElement("div");
    root.innerHTML = `<button aria-label="Run">Run</button>`;
    const text = renderTree(buildTree(root, new Map()));
    expect(text).toMatch(/- button "Run" \[e\d+\]/);
  });
});

describe("listApps", () => {
  it("lists open windows with focus state", () => {
    mountWindow("executor", "executor.sh", "<h1>hi</h1>", true);
    mountWindow("finder", "Finder", "<h1>files</h1>", false);
    const apps = listApps();
    expect(apps.map((a) => a.appId).sort()).toEqual(["executor", "finder"]);
    expect(apps.find((a) => a.appId === "executor")?.focused).toBe(true);
    expect(apps.find((a) => a.appId === "finder")?.focused).toBe(false);
  });
});

describe("snapshot + act", () => {
  it("snapshots an app and clicks a ref", () => {
    let clicked = false;
    mountWindow("todo", "Todo", `<button id="b">Add</button>`);
    document.querySelector<HTMLButtonElement>("#b")!.addEventListener("click", () => {
      clicked = true;
    });
    const snap = snapshot("todo");
    expect("tree" in snap).toBe(true);
    if (!("tree" in snap)) return;
    const btnRef = findRef(snap.tree, "button");
    expect(btnRef).toBeTruthy();
    const result = act("todo", btnRef!, { type: "click" });
    expect(result.ok).toBe(true);
    expect(clicked).toBe(true);
  });

  it("fills a text input and fires input/change", () => {
    mountWindow("form", "Form", `<input id="name" placeholder="Name" />`);
    let lastValue = "";
    document.querySelector<HTMLInputElement>("#name")!.addEventListener("input", (e) => {
      lastValue = (e.target as HTMLInputElement).value;
    });
    const snap = snapshot("form");
    if (!("tree" in snap)) throw new Error("no tree");
    const ref = findRef(snap.tree, "textbox");
    const result = act("form", ref!, { type: "fill", value: "Ada" });
    expect(result.ok).toBe(true);
    expect(document.querySelector<HTMLInputElement>("#name")!.value).toBe("Ada");
    expect(lastValue).toBe("Ada");
  });

  it("errors on unknown app / stale ref", () => {
    expect(snapshot("nope")).toEqual({ error: expect.stringContaining("No open window") });
    mountWindow("a", "A", `<button>x</button>`);
    const result = act("a", "e99", { type: "click" });
    expect(result.ok).toBe(false);
  });

  it("rejects filling a non-text ref", () => {
    mountWindow("a", "A", `<button id="b">x</button>`);
    const snap = snapshot("a");
    if (!("tree" in snap)) throw new Error("no tree");
    const ref = findRef(snap.tree, "button")!;
    const result = act("a", ref, { type: "fill", value: "x" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not a text field/);
  });
});

function findRef(nodes: ReturnType<typeof buildTree>, role: string): string | null {
  for (const node of nodes) {
    if (node.role === role && node.ref) return node.ref;
    const child = findRef(node.children, role);
    if (child) return child;
  }
  return null;
}
