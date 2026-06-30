import { describe, expect, it } from "vitest";
import {
  basename,
  buildFileTree,
  dirname,
  indexNodes,
  type TreeFs,
} from "../src/file-tree/build-tree";

class FakeFs implements TreeFs {
  private dirs = new Set<string>();
  private files = new Set<string>();
  private children = new Map<string, Set<string>>();

  file(path: string): this {
    this.files.add(path);
    this.link(path);
    return this;
  }

  dir(path: string): this {
    this.dirs.add(path);
    if (!this.children.has(path)) {
      this.children.set(path, new Set());
    }
    this.link(path);
    return this;
  }

  private link(path: string): void {
    const slash = path.lastIndexOf("/");
    if (slash <= 0) {
      return;
    }
    const parent = path.slice(0, slash);
    this.dirs.add(parent);
    if (!this.children.has(parent)) {
      this.children.set(parent, new Set());
    }
    this.children.get(parent)!.add(path.slice(slash + 1));
    this.link(parent);
  }

  existsSync(path: string): boolean {
    return this.dirs.has(path) || this.files.has(path);
  }

  readdirSync(path: string): string[] {
    const set = this.children.get(path);
    if (!set) {
      throw new Error(`ENOENT: ${path}`);
    }
    return [...set];
  }

  statSync(path: string): { isDirectory(): boolean } {
    const isDir = this.dirs.has(path);
    return { isDirectory: () => isDir };
  }
}

describe("buildFileTree", () => {
  it("sorts directories before files, each alphabetical", () => {
    const fs = new FakeFs()
      .file("/project/zebra.ts")
      .file("/project/App.tsx")
      .dir("/project/src")
      .dir("/project/components");

    const tree = buildFileTree(fs, "/project");
    expect(tree.map((node) => node.name)).toEqual([
      "components",
      "src",
      "App.tsx",
      "zebra.ts",
    ]);
    expect(tree.map((node) => node.type)).toEqual([
      "directory",
      "directory",
      "file",
      "file",
    ]);
  });

  it("nests children under directories", () => {
    const fs = new FakeFs()
      .file("/project/src/main.tsx")
      .file("/project/src/lib/util.ts");

    const tree = buildFileTree(fs, "/project");
    const src = tree.find((node) => node.name === "src");
    expect(src?.type).toBe("directory");
    const lib = src?.children?.find((node) => node.name === "lib");
    expect(lib?.children?.map((node) => node.name)).toEqual(["util.ts"]);
  });

  it("shows excluded directories as collapsed leaves (not walked)", () => {
    const fs = new FakeFs()
      .file("/project/index.ts")
      .file("/project/node_modules/react/index.js");

    const tree = buildFileTree(fs, "/project");
    const nodeModules = tree.find((node) => node.name === "node_modules");
    expect(nodeModules?.type).toBe("directory");
    expect(nodeModules?.children).toEqual([]);
  });

  it("returns an empty list when the root is missing", () => {
    const fs = new FakeFs();
    expect(buildFileTree(fs, "/nope")).toEqual([]);
  });

  it("indexes nodes by path and resolves dirname/basename", () => {
    const fs = new FakeFs().file("/project/src/main.tsx");
    const index = indexNodes(buildFileTree(fs, "/project"));
    expect(index.get("/project/src")?.type).toBe("directory");
    expect(index.get("/project/src/main.tsx")?.type).toBe("file");
    expect(dirname("/project/src/main.tsx")).toBe("/project/src");
    expect(basename("/project/src/main.tsx")).toBe("main.tsx");
  });
});
