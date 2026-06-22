import { describe, expect, it } from "vitest";
import { createContainer } from "@agent-wasm/core";
import {
  SHADCN_TEMPLATE_IDS,
  WORKSPACE_ROOT,
  seedWorkspace,
  type TemplateId,
} from "../src/features/workspace-seed";

async function waitFor(predicate: () => boolean, timeoutMs = 8_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function keyModuleForTemplate(templateId: TemplateId): string | null {
  switch (templateId) {
    case "next":
      return null;
    case "vite":
    case "react-router":
    case "start":
      return "/src/main.tsx";
    case "astro":
      return "/src/styles/global.css";
    default:
      return null;
  }
}

describe("shadcn template previews", () => {
  it("starts every non-Laravel shadcn template through the internal preview bridge", async () => {
    for (const templateId of SHADCN_TEMPLATE_IDS) {
      const container = createContainer({
        cwd: WORKSPACE_ROOT,
        baseUrl: "http://localhost:5173",
      });
      const controller = new AbortController();
      const output: string[] = [];

      seedWorkspace(container, templateId);

      const runPromise = container.run("npm run dev", {
        cwd: WORKSPACE_ROOT,
        signal: controller.signal,
        onStdout: (chunk) => output.push(chunk),
        onStderr: (chunk) => output.push(chunk),
      });

      try {
        await waitFor(() => container.serverBridge.getServerPorts().includes(3000));
        expect(output.join(""), templateId).toContain("/__virtual__/3000/");

        const rootResponse = await container.serverBridge.handleRequest(3000, "GET", "/", {});
        expect(rootResponse.statusCode, templateId).toBe(200);
        expect(rootResponse.body.toString(), templateId).not.toContain("Internal Server Error");

        const keyModule = keyModuleForTemplate(templateId);
        if (keyModule) {
          const moduleResponse = await container.serverBridge.handleRequest(3000, "GET", keyModule, {});
          expect(moduleResponse.statusCode, `${templateId} ${keyModule}`).toBe(200);
          expect(moduleResponse.body.toString(), `${templateId} ${keyModule}`).not.toContain("Internal Server Error");
        }
      } finally {
        controller.abort();
        await runPromise;
        container.dispose();
      }
    }
  }, 60_000);
});
