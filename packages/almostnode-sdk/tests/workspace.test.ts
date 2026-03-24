// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createWorkspace } from "../src";

describe("almostnode-sdk workspace", () => {
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
});
