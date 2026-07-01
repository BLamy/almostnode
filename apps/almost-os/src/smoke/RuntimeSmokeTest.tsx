"use client";

import { useEffect, useState } from "react";
import { getWorkspace } from "../runtime/runtime";

/**
 * Temporary boot smoke-test: proves the almostnode runtime starts under
 * Next.js + Turbopack and can run a real shell command against the shared VFS.
 * Replaced by <Desktop /> once the runtime path is confirmed.
 */
export default function RuntimeSmokeTest() {
  const [lines, setLines] = useState<string[]>(["booting almostnode runtime…"]);

  useEffect(() => {
    let alive = true;
    const push = (...parts: string[]) =>
      setLines((prev) => [...prev, ...parts.filter(Boolean)]);

    (async () => {
      try {
        const ws = getWorkspace();
        await ws.ready;
        if (!alive) return;
        push("✓ workspace ready");
        push(`files: ${ws.listFiles().join(", ") || "(none)"}`);

        const result = await ws.container.run(
          "echo hello-from-almostnode && pwd && ls -la",
          { cwd: "/project" },
        );
        if (!alive) return;
        push(`$ exit ${result.exitCode}`, result.stdout, result.stderr);
      } catch (error) {
        if (!alive) return;
        const message =
          error instanceof Error ? error.stack || error.message : String(error);
        push("✗ ERROR:", message);
      }
    })();

    return () => {
      alive = false;
    };
  }, []);

  return (
    <pre
      style={{
        margin: 0,
        minHeight: "100vh",
        padding: 24,
        background: "#0b1020",
        color: "#e5e7eb",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 13,
        lineHeight: 1.6,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {lines.join("\n")}
    </pre>
  );
}
