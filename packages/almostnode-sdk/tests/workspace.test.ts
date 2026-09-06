// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { resetServerBridge } from "@agent-wasm/core";
import { createWorkspace } from "../src";

describe("almostnode-sdk workspace", () => {
  it("keeps virtual previews under the configured hosting path", async () => {
    resetServerBridge();
    const workspace = createWorkspace({
      basePath: "/almostnode/os/",
      autoStartPreview: false,
    });
    try {
      await workspace.ready;
      expect(workspace.container.serverBridge.getBasePath()).toBe("/almostnode/os");
      expect(new URL(workspace.container.serverBridge.getServerUrl(3000)).pathname)
        .toBe("/almostnode/os/__virtual__/3000");
    } finally {
      workspace.destroy();
      resetServerBridge();
    }
  });

  it("seeds the default template and persists snapshots", async () => {
    let savedSnapshot: unknown = null;
    const snapshotStore = {
      load: async () => savedSnapshot as any,
      save: async (_key: string, snapshot: unknown) => {
        savedSnapshot = snapshot;
      },
      clear: async () => {
        savedSnapshot = null;
      },
    };

    const first = createWorkspace({ snapshotStore });
    await first.ready;
    first.writeFile("/project/src/main.js", "document.body.textContent = 'changed'");
    await first.snapshots.save();
    first.destroy();

    const second = createWorkspace({ snapshotStore });
    await second.ready;

    expect(second.readFile("/project/src/main.js")).toContain("changed");
    second.destroy();
  });

  it("passes custom shell commands through to the container", async () => {
    const workspace = createWorkspace({
      shellCommands: [
        {
          name: "sdk-hello",
          execute: async (_args, context) => {
            context.writeStdout("hello from sdk\n");
            return { stdout: "", stderr: "", exitCode: 0 };
          },
        },
      ],
    });
    await workspace.ready;

    const result = await workspace.container.run("sdk-hello");

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello from sdk");
    workspace.destroy();
  });

  it("coalesces concurrent preview starts for the same command", async () => {
    let runs = 0;
    const workspace = createWorkspace({
      autoStartPreview: false,
      template: {
        id: "preview-test",
        label: "Preview Test",
        defaultFile: "/project/README.md",
        runCommand: "preview-ready",
        files: {
          "/project/README.md": "preview",
        },
      },
      shellCommands: [
        {
          name: "preview-ready",
          interceptShellParsing: true,
          execute: async () => {
            runs += 1;
            await new Promise((resolve) => setTimeout(resolve, 25));
            return {
              stdout: "ready\n",
              stderr: "",
              exitCode: 0,
            };
          },
        },
      ],
    });
    await workspace.ready;

    await Promise.all([
      workspace.preview.start(),
      workspace.preview.start(),
    ]);

    expect(runs).toBe(1);
    workspace.destroy();
  });

  it("creates files and directories", async () => {
    const workspace = createWorkspace({ autoStartPreview: false });
    await workspace.ready;

    workspace.createFile("/project/src/widget.ts", "export const x = 1;");
    expect(workspace.readFile("/project/src/widget.ts")).toBe("export const x = 1;");
    expect(workspace.getSnapshot().currentFile).toBe("/project/src/widget.ts");

    expect(() => workspace.createFile("/project/src/widget.ts")).toThrow();

    workspace.createDirectory("/project/components");
    expect(workspace.vfs.existsSync("/project/components")).toBe(true);
    expect(workspace.vfs.statSync("/project/components").isDirectory()).toBe(true);

    workspace.destroy();
  });

  it("renames a file and remaps the current file", async () => {
    const workspace = createWorkspace({ autoStartPreview: false });
    await workspace.ready;

    workspace.createFile("/project/old.ts", "value");
    workspace.setCurrentFile("/project/old.ts");
    workspace.rename("/project/old.ts", "/project/new.ts");

    expect(workspace.vfs.existsSync("/project/old.ts")).toBe(false);
    expect(workspace.readFile("/project/new.ts")).toBe("value");
    expect(workspace.getSnapshot().currentFile).toBe("/project/new.ts");

    workspace.destroy();
  });

  it("renames a directory subtree and remaps the open descendant file", async () => {
    const workspace = createWorkspace({ autoStartPreview: false });
    await workspace.ready;

    workspace.createFile("/project/feature/a.ts", "a");
    workspace.createFile("/project/feature/nested/b.ts", "b");
    workspace.setCurrentFile("/project/feature/nested/b.ts");

    workspace.rename("/project/feature", "/project/renamed");

    expect(workspace.vfs.existsSync("/project/feature")).toBe(false);
    expect(workspace.readFile("/project/renamed/a.ts")).toBe("a");
    expect(workspace.readFile("/project/renamed/nested/b.ts")).toBe("b");
    expect(workspace.getSnapshot().currentFile).toBe("/project/renamed/nested/b.ts");

    expect(() => workspace.rename("/project/renamed/a.ts", "/project/renamed/nested/b.ts")).toThrow();

    workspace.destroy();
  });

  it("removes a directory and all of its contents", async () => {
    const workspace = createWorkspace({ autoStartPreview: false });
    await workspace.ready;

    workspace.createFile("/project/trash/a.ts", "a");
    workspace.createFile("/project/trash/deep/b.ts", "b");
    workspace.setCurrentFile("/project/trash/deep/b.ts");

    workspace.remove("/project/trash");

    expect(workspace.vfs.existsSync("/project/trash")).toBe(false);
    expect(workspace.listFiles().some((path) => path.startsWith("/project/trash"))).toBe(false);
    // current file was under the removed dir, so it should have been cleared off it
    expect(workspace.getSnapshot().currentFile).not.toContain("/project/trash");

    workspace.destroy();
  });

  it("moves a file into a folder and rejects moving a folder into itself", async () => {
    const workspace = createWorkspace({ autoStartPreview: false });
    await workspace.ready;

    workspace.createFile("/project/loose.ts", "loose");
    workspace.createDirectory("/project/dest");

    workspace.move("/project/loose.ts", "/project/dest");
    expect(workspace.vfs.existsSync("/project/loose.ts")).toBe(false);
    expect(workspace.readFile("/project/dest/loose.ts")).toBe("loose");

    workspace.createDirectory("/project/parent/child");
    expect(() => workspace.move("/project/parent", "/project/parent/child")).toThrow();

    workspace.destroy();
  });
});
