import { describe, expect, it, vi } from "vitest";

import {
  createWebIdeCodexCliShellCommand,
  registerWebIdeCodexCliShellCommand,
  type WebIdeCodexCliShellCommandContainer,
} from "../src/features/codex-cli-browser-session";

describe("Web IDE Codex CLI shell command", () => {
  it("creates the codex shell command with direct shell parsing", () => {
    const command = createWebIdeCodexCliShellCommand({
      container: createContainerStub(),
      wasmModuleUrl: "/codex-wasm/codex_wasm.js",
    });

    expect(command.name).toBe("codex");
    expect(command.trusted).toBe(true);
    expect(command.interceptShellParsing).toBe(true);
  });

  it("registers codex on the Web IDE container", () => {
    const registerShellCommand = vi.fn();
    const container = {
      ...createContainerStub(),
      registerShellCommand,
    };

    registerWebIdeCodexCliShellCommand(container, {
      cwd: "/project",
      wasmModuleUrl: "/codex-wasm/codex_wasm.js",
    });

    expect(registerShellCommand).toHaveBeenCalledTimes(1);
    expect(registerShellCommand.mock.calls[0]?.[0]).toMatchObject({
      name: "codex",
      trusted: true,
      interceptShellParsing: true,
    });
  });
});

function createContainerStub(): WebIdeCodexCliShellCommandContainer {
  return {
    vfs: {},
    createTerminalSession() {
      throw new Error("not used by this test");
    },
    registerShellCommand() {},
  } as unknown as WebIdeCodexCliShellCommandContainer;
}
