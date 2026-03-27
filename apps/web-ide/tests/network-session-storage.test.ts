import { describe, expect, it } from "vitest";
import {
  clearStoredTailscaleSessionSnapshot,
  clearStoredWorkbenchNetworkConfig,
  parseStoredTailscaleSessionSnapshot,
  parseStoredWorkbenchNetworkConfig,
  readStoredTailscaleSessionSnapshot,
  readStoredWorkbenchNetworkConfig,
  TAILSCALE_SESSION_STORAGE_KEY,
  WORKBENCH_NETWORK_SESSION_STORAGE_KEY,
  writeStoredTailscaleSessionSnapshot,
  writeStoredWorkbenchNetworkConfig,
} from "../src/features/network-session";

class MemorySessionStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

describe("workbench network session storage", () => {
  it("restores persisted tailscale provider and exit-node selection", () => {
    const storage = new MemorySessionStorage();

    writeStoredWorkbenchNetworkConfig(
      {
        provider: "tailscale",
        useExitNode: true,
        exitNodeId: "node-sfo",
      },
      storage,
    );

    expect(readStoredWorkbenchNetworkConfig(storage)).toEqual({
      provider: "tailscale",
      useExitNode: true,
      exitNodeId: "node-sfo",
    });
  });

  it("clears the stored network selection on logout", () => {
    const storage = new MemorySessionStorage();
    storage.setItem(
      WORKBENCH_NETWORK_SESSION_STORAGE_KEY,
      JSON.stringify({
        provider: "tailscale",
        useExitNode: true,
        exitNodeId: "node-nyc",
      }),
    );

    clearStoredWorkbenchNetworkConfig(storage);

    expect(storage.getItem(WORKBENCH_NETWORK_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("drops malformed stored network config", () => {
    const storage = new MemorySessionStorage();
    storage.setItem(
      WORKBENCH_NETWORK_SESSION_STORAGE_KEY,
      '{"provider":"tailscale","useExitNode":"yes"}',
    );

    expect(
      parseStoredWorkbenchNetworkConfig(
        storage.getItem(WORKBENCH_NETWORK_SESSION_STORAGE_KEY),
      ),
    ).toBeNull();
    expect(readStoredWorkbenchNetworkConfig(storage)).toBeNull();
    expect(storage.getItem(WORKBENCH_NETWORK_SESSION_STORAGE_KEY)).toBeNull();
  });

  it("round-trips persisted tailscale session state", () => {
    const storage = new MemorySessionStorage();

    writeStoredTailscaleSessionSnapshot(
      {
        control: "node-auth",
        profile: "user-profile",
      },
      storage,
    );

    expect(readStoredTailscaleSessionSnapshot(storage)).toEqual({
      control: "node-auth",
      profile: "user-profile",
    });
  });

  it("drops malformed stored tailscale session state", () => {
    const storage = new MemorySessionStorage();
    storage.setItem(
      TAILSCALE_SESSION_STORAGE_KEY,
      '{"control":{"nested":true}}',
    );

    expect(
      parseStoredTailscaleSessionSnapshot(
        storage.getItem(TAILSCALE_SESSION_STORAGE_KEY),
      ),
    ).toBeNull();
    expect(readStoredTailscaleSessionSnapshot(storage)).toBeNull();
    expect(storage.getItem(TAILSCALE_SESSION_STORAGE_KEY)).toBeNull();

    writeStoredTailscaleSessionSnapshot({ control: "alpha" }, storage);
    clearStoredTailscaleSessionSnapshot(storage);
    expect(storage.getItem(TAILSCALE_SESSION_STORAGE_KEY)).toBeNull();
  });
});
