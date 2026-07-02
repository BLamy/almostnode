/**
 * Exposes the os-driver to the AI two ways (Phase 3 wiring):
 *   - `window.almostOS.os.*`  — the in-page bridge the AI drawer calls.
 *   - `desktop` shell command — the terminal/agent surface, mirroring
 *     `playwright-cli`: apps / snapshot / screenshot / click / fill /
 *     create-app.
 *
 * Screenshots are written to the VFS as PNG files (base64-decoded) so the
 * agent can open them, matching the playwright-cli behavior.
 */

import type { ContainerInstance } from "@agent-wasm/core";
import { createApp, type CreateAppSpec } from "./app-authoring";
import {
  act,
  listApps,
  renderTree,
  screenshot,
  snapshot,
  type OsAction,
} from "./os-driver";

export function installOsDriverBridge(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { almostOS?: Record<string, unknown> };
  w.almostOS = {
    ...(w.almostOS ?? {}),
    os: {
      listApps,
      snapshot,
      screenshot,
      act,
      createApp,
    },
  };
}

const HELP = `desktop — inspect and drive open apps

Usage:
  desktop apps                       List open app windows
  desktop snapshot <app>             Accessibility ref-tree of an app
  desktop screenshot <app> [out.png] Capture an app to a PNG in the VFS
  desktop click <app> <ref>          Click a ref from the snapshot
  desktop fill <app> <ref> <text>    Set a text field's value
  desktop type <app> <ref> <text>    Append to a text field
  desktop create-app <name> [html]   Scaffold + launch a new Electron app
`;

function decodeDataUrl(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function registerOsDriverCommand(container: ContainerInstance): void {
  installOsDriverBridge();

  container.registerShellCommand({
    name: "desktop",
    execute: async (args, context) => {
      const [verb, ...rest] = args;
      try {
        switch (verb) {
          case "apps": {
            const apps = listApps();
            if (apps.length === 0) return { stdout: "No open windows.\n", stderr: "", exitCode: 0 };
            const lines = apps.map(
              (a) =>
                `${a.appId.padEnd(14)} ${a.focused ? "*" : " "} ${a.minimized ? "(min) " : "      "}${a.title}`,
            );
            return { stdout: `${lines.join("\n")}\n`, stderr: "", exitCode: 0 };
          }
          case "snapshot": {
            if (!rest[0]) return usage();
            const snap = snapshot(rest[0]);
            if ("error" in snap) return { stdout: "", stderr: `${snap.error}\n`, exitCode: 1 };
            return { stdout: `${snap.text || renderTree(snap.tree)}\n`, stderr: "", exitCode: 0 };
          }
          case "screenshot": {
            if (!rest[0]) return usage();
            const result = await screenshot(rest[0]);
            if ("error" in result) return { stdout: "", stderr: `${result.error}\n`, exitCode: 1 };
            const out = rest[1]
              ? rest[1].startsWith("/")
                ? rest[1]
                : `${context.cwd.replace(/\/$/, "")}/${rest[1]}`
              : `${context.cwd.replace(/\/$/, "")}/${rest[0]}.png`;
            context.vfs.writeFileSync(out, decodeDataUrl(result.dataUrl) as unknown as string);
            return { stdout: `Saved ${out}\n`, stderr: "", exitCode: 0 };
          }
          case "click":
          case "focus": {
            if (!rest[0] || !rest[1]) return usage();
            return actResult(act(rest[0], rest[1], { type: verb } as OsAction));
          }
          case "fill":
          case "type": {
            if (!rest[0] || !rest[1]) return usage();
            const value = rest.slice(2).join(" ");
            return actResult(act(rest[0], rest[1], { type: verb, value } as OsAction));
          }
          case "create-app": {
            if (!rest[0]) return usage();
            const spec: CreateAppSpec = { name: rest[0] };
            if (rest[1]) spec.html = rest.slice(1).join(" ");
            const created = await createApp(spec);
            return {
              stdout: `Created and launched "${created.name}" (${created.id}) at ${created.dir}\n`,
              stderr: "",
              exitCode: 0,
            };
          }
          default:
            return { stdout: HELP, stderr: "", exitCode: verb ? 1 : 0 };
        }
      } catch (error) {
        return {
          stdout: "",
          stderr: `desktop: ${error instanceof Error ? error.message : String(error)}\n`,
          exitCode: 1,
        };
      }

      function usage() {
        return { stdout: "", stderr: HELP, exitCode: 1 };
      }
      function actResult(result: ReturnType<typeof act>) {
        return result.ok
          ? { stdout: `${result.detail ?? "ok"}\n`, stderr: "", exitCode: 0 }
          : { stdout: "", stderr: `${result.error}\n`, exitCode: 1 };
      }
    },
  });
}
