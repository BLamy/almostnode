import { readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Plugin } from "vite";

const VIRTUAL_ID = "virtual:workbench-entrypoints";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

function walkEntrypoints(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkEntrypoints(fullPath));
      continue;
    }

    if (entry.name.endsWith(".entrypoint.ts")) {
      results.push(fullPath);
    }
  }

  return results.sort();
}

export function buildWorkbenchEntrypointsVirtualModule(
  entrypointsDir: string,
): string {
  const files = walkEntrypoints(entrypointsDir);
  const imports = files
    .map((file, index) => {
      const normalized = file.split("\\").join("/");
      return `import entrypoint${index} from ${JSON.stringify(normalized)};`;
    })
    .join("\n");
  const exports = `export default [${files
    .map((_, index) => `entrypoint${index}`)
    .join(", ")}];`;

  return `${imports}\n${exports}\n`;
}

export function workbenchEntrypointsPlugin(options: {
  entrypointsDir: string;
}): Plugin {
  const entrypointsDir = resolve(options.entrypointsDir);

  return {
    name: "workbench-entrypoints",
    resolveId(id) {
      if (id === VIRTUAL_ID) {
        return RESOLVED_ID;
      }
    },
    load(id) {
      if (id !== RESOLVED_ID) {
        return;
      }

      return buildWorkbenchEntrypointsVirtualModule(entrypointsDir);
    },
    configureServer(server) {
      server.watcher.add(entrypointsDir);
      server.watcher.on("change", (file) => {
        if (!file.startsWith(entrypointsDir)) {
          return;
        }

        const module = server.moduleGraph.getModuleById(RESOLVED_ID);
        if (module) {
          server.moduleGraph.invalidateModule(module);
        }
        server.ws.send({ type: "full-reload" });
      });
    },
  };
}
