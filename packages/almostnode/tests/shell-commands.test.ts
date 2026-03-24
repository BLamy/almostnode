// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createContainer } from "../src/index";

describe("shell commands", () => {
  it("supports custom shell commands passed at container creation and persists session state", async () => {
    const container = createContainer({
      shellCommands: [
        {
          name: "workspace-init",
          execute: async (_args, context) => {
            context.setCwd("/project");
            context.setEnv("GREETING", "hello");
            context.writeStdout(`cwd:${context.cwd}\n`);
            return {
              stdout: "ready\n",
              stderr: "",
              exitCode: 0,
            };
          },
        },
      ],
    });
    container.vfs.mkdirSync("/project", { recursive: true });

    const session = container.createTerminalSession({ cwd: "/" });
    const initResult = await session.run("workspace-init");
    const followUp = await session.run("pwd; echo $GREETING");

    expect(initResult.exitCode).toBe(0);
    expect(initResult.stdout).toContain("cwd:/project");
    expect(initResult.stdout).toContain("ready");
    expect(session.getState().cwd).toBe("/project");
    expect(session.getState().env.GREETING).toBe("hello");
    expect(followUp.stdout).toContain("/project");
    expect(followUp.stdout).toContain("hello");
  });

  it("streams direct-dispatch custom command output and preserves quoted args", async () => {
    const container = createContainer();
    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    container.registerShellCommand({
      name: "quoted-echo",
      interceptShellParsing: true,
      execute: async (args, context) => {
        context.writeStdout(`stream:${args.join("|")}\n`);
        context.writeStderr("warn:chunk\n");
        return {
          stdout: "tail\n",
          stderr: "",
          exitCode: 0,
        };
      },
    });

    const session = container.createTerminalSession({ cwd: "/" });
    const result = await session.run('quoted-echo "hello world" second', {
      onStdout: (chunk) => stdoutChunks.push(chunk),
      onStderr: (chunk) => stderrChunks.push(chunk),
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("stream:hello world|second");
    expect(result.stdout).toContain("tail");
    expect(stdoutChunks.join("")).toContain("stream:hello world|second");
    expect(stderrChunks.join("")).toContain("warn:chunk");
  });

  it("keeps command registration isolated per container and restores builtin commands on unregister", async () => {
    const first = createContainer();
    const second = createContainer();

    first.registerShellCommand({
      name: "ps",
      execute: async () => ({
        stdout: "custom-ps\n",
        stderr: "",
        exitCode: 0,
      }),
    });

    const firstOverride = await first.run("ps");
    const secondBuiltin = await second.run("ps");
    const removed = first.unregisterShellCommand("ps");
    const restored = await first.run("ps");

    expect(firstOverride.stdout).toContain("custom-ps");
    expect(secondBuiltin.stdout).toContain("PID TTY");
    expect(removed).toBe(true);
    expect(restored.stdout).toContain("PID TTY");
  });
});
