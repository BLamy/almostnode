import type { ContainerInstance } from "@agent-wasm/core";
import { chromeStore, hostOf, installChromeBridge } from "./chrome-store";

/**
 * Register agent-facing browser commands on the container so the terminal /
 * agents can drive the Chrome app. Agent tabs are grouped + view-only.
 *
 *   open-tab <url> [--group <name>] [--title <title>]
 *   tab-group <name> [color]
 */
export function registerChromeCommands(container: ContainerInstance): void {
  installChromeBridge();

  container.registerShellCommand({
    name: "open-tab",
    execute: (args) => {
      let group = "Agent";
      let title: string | undefined;
      const rest: string[] = [];
      for (let i = 0; i < args.length; i += 1) {
        if (args[i] === "--group") group = args[(i += 1)] ?? group;
        else if (args[i] === "--title") title = args[(i += 1)];
        else rest.push(args[i]);
      }
      const url = rest[0];
      if (!url) {
        return {
          stdout: "",
          stderr: "usage: open-tab <url> [--group <name>] [--title <title>]\n",
          exitCode: 1,
        };
      }
      const groupId = chromeStore.ensureGroup(group);
      chromeStore.createTab({ url, title: title ?? hostOf(url), groupId, viewOnly: true });
      return {
        stdout: `Opened ${url} in Chrome — group "${group}", view-only.\n`,
        stderr: "",
        exitCode: 0,
      };
    },
  });

  container.registerShellCommand({
    name: "tab-group",
    execute: (args) => {
      const name = args[0];
      if (!name) {
        return { stdout: "", stderr: "usage: tab-group <name> [color]\n", exitCode: 1 };
      }
      const id = chromeStore.createGroup(name, args[1]);
      return { stdout: `Created tab group "${name}" (${id}).\n`, stderr: "", exitCode: 0 };
    },
  });
}
