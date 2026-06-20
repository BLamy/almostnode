import { describe, expect, it } from "vitest";
import {
  agentWasmCredentialPaths,
  createAuthManifest,
  defaultAgentWasmAuthManifest,
  defaultCredentialSlots,
  getCredentialPathsForSlots,
  getCredentialSlot,
  getDefaultCredentialMirrorPaths,
} from "../src/auth";

describe("auth manifest", () => {
  it("registers the built-in credential slots expected by the web IDE", () => {
    expect(defaultCredentialSlots.map((slot) => slot.id)).toEqual([
      "claude",
      "codex",
      "opencode",
      "pi",
      "github",
      "aws",
      "infisical",
      "fly",
      "netlify",
      "cloudflare",
      "neon",
      "app-building",
      "replay",
      "tailscale",
    ]);
  });

  it("keeps default mirror paths scoped to live credential files", () => {
    expect(getDefaultCredentialMirrorPaths()).toContain(
      agentWasmCredentialPaths.codexAuth,
    );
    expect(getDefaultCredentialMirrorPaths()).toContain(
      agentWasmCredentialPaths.githubHosts,
    );
    expect(getDefaultCredentialMirrorPaths()).not.toContain(
      agentWasmCredentialPaths.tailscaleSession,
    );
    expect(getDefaultCredentialMirrorPaths()).toContain(
      "/home/user/.config/almostnode/aws/auth.json",
    );
    expect(getDefaultCredentialMirrorPaths()).toContain(
      "/home/user/.infisical/auth.json",
    );
    expect(getDefaultCredentialMirrorPaths()).toContain(
      "/__almostnode/keychain/app-building-config.json",
    );
  });

  it("returns unique paths for selected slots", () => {
    expect(
      getCredentialPathsForSlots(defaultCredentialSlots, ["codex", "github"]),
    ).toEqual([
      agentWasmCredentialPaths.codexAuth,
      agentWasmCredentialPaths.codexConfigToml,
      agentWasmCredentialPaths.codexConfigJson,
      agentWasmCredentialPaths.githubHosts,
    ]);
  });

  it("builds a manifest with provider and mirror rule defaults", () => {
    const manifest = createAuthManifest();
    expect(manifest.providers.some((provider) => provider.id === "codex")).toBe(
      true,
    );
    expect(manifest.mirrorRules.length).toBe(getDefaultCredentialMirrorPaths().length);
    expect(defaultAgentWasmAuthManifest.slots.length).toBe(
      defaultCredentialSlots.length,
    );
    expect(getCredentialSlot(manifest.slots, "github")?.label).toBe("GitHub");
  });
});
