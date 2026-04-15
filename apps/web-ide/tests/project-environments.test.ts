import { describe, expect, it } from "vitest";
import {
  createCodespaceUpgradeBranchName,
  deriveProjectEnvironmentMenuState,
  inferProjectRepoRef,
  mergeCodespaceRecord,
} from "../src/features/project-environments";

describe("project-environments", () => {
  it("creates a stable upgrade branch name from UTC time", () => {
    const branch = createCodespaceUpgradeBranchName(
      new Date(Date.UTC(2026, 3, 14, 12, 34, 56)),
    );

    expect(branch).toBe("almostnode/codespace-20260414123456");
  });

  it("derives menu state for a running codespace", () => {
    const state = deriveProjectEnvironmentMenuState({
      activeEnvironment: "codespace",
      gitRemote: {
        name: "origin",
        url: "https://github.com/acme/demo.git",
        provider: "github",
        repositoryFullName: "acme/demo",
      },
      codespace: {
        name: "acme-demo-123",
        displayName: "Demo",
        webUrl: "https://acme-demo-123.github.dev",
        state: "Available",
        machine: "standardLinux",
        idleTimeoutMinutes: 30,
        retentionHours: 24,
        supportsBridge: true,
        lastSyncedAt: null,
      },
    });

    expect(state.label).toBe("Codespace: Running");
    expect(state.canSyncCredentials).toBe(true);
  });

  it("infers repo refs from a github remote when no explicit repo ref exists", () => {
    const repoRef = inferProjectRepoRef({
      repoRef: null,
      gitRemote: {
        name: "origin",
        url: "https://github.com/acme/demo.git",
        provider: "github",
        repositoryFullName: "acme/demo",
      },
    }, "feature/codespace");

    expect(repoRef).toEqual({
      owner: "acme",
      repo: "demo",
      branch: "feature/codespace",
      remoteUrl: "https://github.com/acme/demo.git",
    });
  });

  it("merges codespace updates without dropping existing fields", () => {
    const next = mergeCodespaceRecord({
      name: "demo-1",
      displayName: "Demo",
      webUrl: "https://demo-1.github.dev",
      state: "stopped",
      machine: "standardLinux",
      idleTimeoutMinutes: 30,
      retentionHours: 24,
      supportsBridge: false,
      lastSyncedAt: null,
    }, {
      state: "Available",
      supportsBridge: true,
      lastSyncedAt: 123,
    });

    expect(next).toEqual({
      name: "demo-1",
      displayName: "Demo",
      webUrl: "https://demo-1.github.dev",
      state: "Available",
      machine: "standardLinux",
      idleTimeoutMinutes: 30,
      retentionHours: 24,
      supportsBridge: true,
      lastSyncedAt: 123,
    });
  });
});
