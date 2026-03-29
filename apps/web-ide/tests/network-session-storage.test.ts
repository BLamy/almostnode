import { afterEach, describe, expect, it } from "vitest";
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

const originalLocalStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
const originalSessionStorage = Object.getOwnPropertyDescriptor(
  globalThis,
  "sessionStorage",
);

afterEach(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  } else {
    delete (globalThis as typeof globalThis & { localStorage?: MemorySessionStorage }).localStorage;
  }

  if (originalSessionStorage) {
    Object.defineProperty(globalThis, "sessionStorage", originalSessionStorage);
  } else {
    delete (globalThis as typeof globalThis & { sessionStorage?: MemorySessionStorage }).sessionStorage;
  }
});

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
      acceptDns: true,
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
        acceptDns: true,
        stateSnapshot: null,
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

  it("prefers localStorage so sessions survive browser restarts", () => {
    const localStorage = new MemorySessionStorage();
    const sessionStorage = new MemorySessionStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: localStorage,
      configurable: true,
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      value: sessionStorage,
      configurable: true,
    });

    writeStoredWorkbenchNetworkConfig({
      provider: "tailscale",
      useExitNode: true,
      exitNodeId: "node-sfo",
    });
    writeStoredTailscaleSessionSnapshot({
      control: "node-auth",
      profile: "user-profile",
    });

    expect(localStorage.getItem(WORKBENCH_NETWORK_SESSION_STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem(TAILSCALE_SESSION_STORAGE_KEY)).not.toBeNull();
    expect(sessionStorage.getItem(WORKBENCH_NETWORK_SESSION_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(TAILSCALE_SESSION_STORAGE_KEY)).toBeNull();
    expect(readStoredWorkbenchNetworkConfig()).toEqual({
      provider: "tailscale",
      useExitNode: true,
      exitNodeId: "node-sfo",
      acceptDns: true,
    });
    expect(readStoredTailscaleSessionSnapshot()).toEqual({
      control: "node-auth",
      profile: "user-profile",
    });
  });

  it("falls back to sessionStorage when localStorage is unavailable", () => {
    const sessionStorage = new MemorySessionStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get() {
        throw new Error("localStorage unavailable");
      },
    });
    Object.defineProperty(globalThis, "sessionStorage", {
      value: sessionStorage,
      configurable: true,
    });

    writeStoredWorkbenchNetworkConfig({
      provider: "tailscale",
      useExitNode: false,
      exitNodeId: null,
      acceptDns: false,
    });
    writeStoredTailscaleSessionSnapshot({
      control: "fallback-node",
    });

    expect(readStoredWorkbenchNetworkConfig()).toEqual({
      provider: "tailscale",
      useExitNode: false,
      exitNodeId: null,
      acceptDns: false,
    });
    expect(readStoredTailscaleSessionSnapshot()).toEqual({
      control: "fallback-node",
    });
    expect(sessionStorage.getItem(WORKBENCH_NETWORK_SESSION_STORAGE_KEY)).not.toBeNull();
    expect(sessionStorage.getItem(TAILSCALE_SESSION_STORAGE_KEY)).not.toBeNull();
  });
});
