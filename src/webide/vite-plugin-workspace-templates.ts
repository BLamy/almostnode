import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, dirname, posix } from "path";
import type { Plugin } from "vite";

interface TemplateMetadata {
  defaultFile: string;
  runCommand: string;
}

interface TemplateData {
  metadata: TemplateMetadata;
  files: Record<string, string>;
  directories: string[];
}

const VIRTUAL_ID = "virtual:workspace-templates";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

function walkDir(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else {
      results.push(full);
    }
  }
  return results;
}

function collectDirectories(filePaths: string[]): string[] {
  const dirs = new Set<string>();
  for (const fp of filePaths) {
    let dir = dirname(fp);
    while (dir && dir !== ".") {
      dirs.add(dir);
      dir = dirname(dir);
    }
  }
  return [...dirs].sort();
}

export function workspaceTemplatesPlugin(options: {
  templatesDir: string;
}): Plugin {
  return {
    name: "workspace-templates",
    resolveId(id) {
      if (id === VIRTUAL_ID) return RESOLVED_ID;
    },
    load(id) {
      if (id !== RESOLVED_ID) return;

      const { templatesDir } = options;
      const sharedDir = join(templatesDir, "_shared");

      // Read shared files
      let sharedFiles: Record<string, string> = {};
      try {
        for (const abs of walkDir(sharedDir)) {
          const rel = relative(sharedDir, abs).split("\\").join("/");
          sharedFiles[rel] = readFileSync(abs, "utf8");
        }
      } catch {
        // No _shared dir — fine
      }

      // Discover template dirs
      const templates: Record<string, TemplateData> = {};
      for (const entry of readdirSync(templatesDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name === "_shared") continue;
        const templateDir = join(templatesDir, entry.name);

        // Read metadata
        const metaPath = join(templateDir, "template.json");
        const metadata: TemplateMetadata = JSON.parse(
          readFileSync(metaPath, "utf8"),
        );

        // Walk template files (skip template.json itself)
        const files: Record<string, string> = { ...sharedFiles };
        for (const abs of walkDir(templateDir)) {
          const rel = relative(templateDir, abs).split("\\").join("/");
          if (rel === "template.json") continue;
          files[rel] = readFileSync(abs, "utf8");
        }

        const directories = collectDirectories(Object.keys(files));
        templates[entry.name] = { metadata, files, directories };
      }

      return `export default ${JSON.stringify(templates)};`;
    },
    configureServer(server) {
      server.watcher.add(options.templatesDir);
      server.watcher.on("change", (file) => {
        if (file.startsWith(options.templatesDir)) {
          const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
          if (mod) {
            server.moduleGraph.invalidateModule(mod);
            server.ws.send({ type: "full-reload" });
          }
        }
      });
    },
  };
}
