import { describe, expect, it, vi } from "vitest";
import { executeCodeMode, stripTypes } from "./codemode-sandbox";

describe("code-mode sandbox", () => {
  it("strips TypeScript types", async () => {
    const js = await stripTypes("const x: number = 1; return x;");
    expect(js).not.toContain(": number");
  });

  it("returns a value and captures console output", async () => {
    const result = await executeCodeMode({
      code: "console.log('hello', { a: 1 }); return 2 + 3;",
      invokeTool: async () => undefined,
      toolPaths: [],
    });
    expect(result.ok).toBe(true);
    expect(result.value).toBe(5);
    expect(result.logs).toEqual([{ level: "log", text: 'hello {"a":1}' }]);
  });

  it("routes tools.* calls through the host invoker and parses JSON results", async () => {
    const invokeTool = vi.fn(async (path: string, args: unknown) => {
      expect(path).toBe("gh.createIssue");
      expect(args).toEqual({ title: "Bug" });
      return { ok: true, data: { id: 9 } };
    });
    const result = await executeCodeMode({
      code: "const r = await tools.gh.createIssue({ title: 'Bug' }); return r.data.id;",
      invokeTool,
      toolPaths: ["gh.createIssue"],
    });
    expect(result.ok).toBe(true);
    expect(result.value).toBe(9);
    expect(invokeTool).toHaveBeenCalledOnce();
  });

  it("supports nested tool namespaces and multiple calls", async () => {
    const invokeTool = vi.fn(async (path: string) => ({ path }));
    const result = await executeCodeMode({
      code: `
        const a = await tools.executor.sources.list();
        const b = await tools.search({ query: 'x' });
        return [a.path, b.path];
      `,
      invokeTool,
      toolPaths: ["executor.sources.list", "search"],
    });
    expect(result.ok).toBe(true);
    expect(result.value).toEqual(["executor.sources.list", "search"]);
  });

  it("disables fetch inside the sandbox", async () => {
    const result = await executeCodeMode({
      code: "await fetch('https://evil.test'); return 1;",
      invokeTool: async () => undefined,
      toolPaths: [],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("fetch is disabled");
  });

  it("reports runtime errors from user code", async () => {
    const result = await executeCodeMode({
      code: "throw new Error('boom'); return 1;",
      invokeTool: async () => undefined,
      toolPaths: [],
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("boom");
  });

  it("interrupts code that exceeds the time budget", async () => {
    const result = await executeCodeMode({
      code: "while (true) {}",
      invokeTool: async () => undefined,
      toolPaths: [],
      timeoutMs: 200,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/interrupt|time budget/i);
  });
});
