/**
 * Wires the Replay recorder into the desktop: starts a background recording
 * on boot, installs the `window.almostOS.replay` bridge, and registers a
 * `replay` terminal command. Upload uses the token at
 * `/home/user/.replay/auth.json` (the Replay keychain slot) and routes
 * through the app's direct-then-CORS-proxy path.
 */

import type { ContainerInstance } from "@agent-wasm/core";
import { oauthFetch } from "@agent-wasm/keychain/oauth";
import { getWorkspace } from "../runtime/runtime";
import {
  isReplayRecording,
  readReplayToken,
  startReplayRecording,
  stopReplayRecording,
  uploadSimulationData,
  type UploadResult,
} from "./replay-capture";

/** Stop the current recording and upload it; keep recording afterwards. */
export async function uploadCurrentRecording(): Promise<UploadResult> {
  const packets = stopReplayRecording();
  if (packets.length === 0) {
    // Nothing captured (recording wasn't running) — start one for next time.
    void startReplayRecording();
    throw new Error("No recording in progress. A new one has been started.");
  }
  const vfs = getWorkspace().vfs as unknown as {
    existsSync(path: string): boolean;
    readFileSync(path: string, encoding: "utf8"): string;
  };
  const token = readReplayToken(vfs);
  const result = await uploadSimulationData(packets, {
    token,
    fetchImpl: (url, init) => oauthFetch(url, init, {}),
  });
  // Resume recording so a fresh session is always available.
  void startReplayRecording();
  return result;
}

export function installReplayBridge(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { almostOS?: Record<string, unknown> };
  w.almostOS = {
    ...(w.almostOS ?? {}),
    replay: {
      isRecording: () => isReplayRecording(),
      start: () => startReplayRecording(),
      /** Stop + upload the current recording; returns the app.replay.io URL. */
      upload: () => uploadCurrentRecording(),
    },
  };
}

const HELP = `replay — record the desktop and upload to Replay.io

Usage:
  replay start     Begin (or restart) a background recording
  replay status    Show whether a recording is in progress
  replay upload    Stop + upload the current recording, print the URL

Auth: paste your Replay auth.json into the Keychain (Replay.io slot), or run
'replayio login'. The token lands at /home/user/.replay/auth.json.
`;

export function registerReplayCommand(container: ContainerInstance): void {
  installReplayBridge();
  // Start a recording as soon as the command surface is wired.
  void startReplayRecording();

  container.registerShellCommand({
    name: "replay",
    execute: async (args) => {
      const [verb] = args;
      try {
        switch (verb) {
          case "start":
            await startReplayRecording();
            return { stdout: "Recording started.\n", stderr: "", exitCode: 0 };
          case "status":
            return {
              stdout: isReplayRecording() ? "Recording in progress.\n" : "Not recording.\n",
              stderr: "",
              exitCode: 0,
            };
          case "upload": {
            const result = await uploadCurrentRecording();
            const url = result.url ?? `visitDataId ${result.visitDataId} (run 'replayio login' for a full URL)`;
            return { stdout: `Uploaded: ${url}\n`, stderr: "", exitCode: 0 };
          }
          default:
            return { stdout: HELP, stderr: "", exitCode: verb ? 1 : 0 };
        }
      } catch (error) {
        return {
          stdout: "",
          stderr: `replay: ${error instanceof Error ? error.message : String(error)}\n`,
          exitCode: 1,
        };
      }
    },
  });
}
