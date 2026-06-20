/**
 * Regression tests for getShellCommandFromInvocation: agent bash tools invoke
 * `/bin/sh -lc <script>` — the script must pass through verbatim instead of
 * being re-quoted and lossily re-parsed downstream.
 */

import { describe, it, expect } from "vitest";
import { getShellCommandFromInvocation } from "../src/features/opencode-shell-invocation";

describe("getShellCommandFromInvocation", () => {
  it("extracts the script from sh -c", () => {
    expect(getShellCommandFromInvocation("/bin/sh", ["-c", "echo hi"])).toBe(
      "echo hi",
    );
  });

  it("extracts the script from sh -lc (combined flags)", () => {
    const script = 'rg "createBrowserRouter|Routes|useDB" src package.json -n';
    expect(getShellCommandFromInvocation("/bin/sh", ["-lc", script])).toBe(
      script,
    );
  });

  it("extracts single-quoted scripts from sh -lc without mangling", () => {
    const script = "sed -n '1,260p' src/pages/Home.tsx";
    expect(getShellCommandFromInvocation("sh", ["-lc", script])).toBe(script);
  });

  it("extracts the script from bash -lc", () => {
    const script = "grep -E 'a|b' file.txt";
    expect(getShellCommandFromInvocation("/bin/bash", ["-lc", script])).toBe(
      script,
    );
  });

  it("returns null for non-shell commands", () => {
    expect(getShellCommandFromInvocation("node", ["script.js"])).toBeNull();
  });

  it("returns null for sh invoked on a script file (no -c)", () => {
    expect(getShellCommandFromInvocation("sh", ["build.sh"])).toBeNull();
  });

  it("does not treat long options like --check as a command flag", () => {
    expect(getShellCommandFromInvocation("sh", ["--check", "x"])).toBeNull();
  });
});
