import { describe, expect, it } from "vitest";
import { buildManagedApp } from "./app-authoring";

describe("buildManagedApp", () => {
  it("derives a kebab id from the name and scaffolds a complete app", async () => {
    const app = buildManagedApp({ name: "My Stopwatch!" });
    expect(app.id).toBe("my-stopwatch");
    expect(app.name).toBe("My Stopwatch!");
    const files = await app.loadFiles();
    expect(Object.keys(files).sort()).toEqual([
      "index.html",
      "main.js",
      "package.json",
      "preload.js",
    ]);
    const pkg = JSON.parse(files["package.json"]);
    expect(pkg).toMatchObject({ name: "my-stopwatch", main: "main.js" });
    expect(files["main.js"]).toContain("BrowserWindow");
    expect(files["main.js"]).toContain("loadFile(\"index.html\")");
  });

  it("honors a custom id, html, size, and extra files", async () => {
    const app = buildManagedApp({
      id: "timer",
      name: "Timer",
      html: "<body>tick</body>",
      width: 320,
      height: 200,
      files: { "extra.js": "console.log(1)" },
    });
    expect(app.id).toBe("timer");
    const files = await app.loadFiles();
    expect(files["index.html"]).toBe("<body>tick</body>");
    expect(files["main.js"]).toContain("width: 320");
    expect(files["main.js"]).toContain("height: 200");
    expect(files["extra.js"]).toBe("console.log(1)");
  });

  it("falls back to a safe id when the name has no usable characters", () => {
    expect(buildManagedApp({ name: "***" }).id).toBe("app");
  });
});
