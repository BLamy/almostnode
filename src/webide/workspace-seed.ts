import type { ReturnTypeOfCreateContainer } from "./workbench-host";
import templates from "virtual:workspace-templates";

export const WORKSPACE_ROOT = "/project";
export const DEFAULT_FILE = `${WORKSPACE_ROOT}/src/App.tsx`;
export const DEFAULT_RUN_COMMAND = "npm run dev";

export type TemplateId = "vite" | "nextjs" | "tanstack";

export interface TemplateDefinition {
  id: TemplateId;
  defaultFile: string;
  runCommand: string;
  directories: string[];
  files: Record<string, string>;
}

function buildTemplate(id: TemplateId): TemplateDefinition {
  const raw = templates[id];
  const files: Record<string, string> = {};
  for (const [rel, content] of Object.entries(raw.files)) {
    files[`${WORKSPACE_ROOT}/${rel}`] = content;
  }
  const directories = raw.directories.map((d) => `${WORKSPACE_ROOT}/${d}`);
  return {
    id,
    defaultFile: `${WORKSPACE_ROOT}/${raw.metadata.defaultFile}`,
    runCommand: raw.metadata.runCommand,
    directories,
    files,
  };
}

const TEMPLATES: Record<TemplateId, TemplateDefinition> = {
  vite: buildTemplate("vite"),
  nextjs: buildTemplate("nextjs"),
  tanstack: buildTemplate("tanstack"),
};

export function getTemplateDefaults(id: TemplateId): {
  defaultFile: string;
  runCommand: string;
} {
  const template = TEMPLATES[id];
  return { defaultFile: template.defaultFile, runCommand: template.runCommand };
}

const CLAUDE_WRAPPER_PATH = "/usr/local/bin/claude-wrapper";
const CLAUDE_WRAPPER_SCRIPT = '#!/bin/sh\nexec claude "$@"\n';
const SETTINGS_PATH = `${WORKSPACE_ROOT}/.vscode/settings.json`;

function ensureDirectory(
  container: ReturnTypeOfCreateContainer,
  path: string,
): void {
  if (!container.vfs.existsSync(path)) {
    container.vfs.mkdirSync(path, { recursive: true });
  }
}

export function seedWorkspace(
  container: ReturnTypeOfCreateContainer,
  templateId: TemplateId = "vite",
): void {
  const template = TEMPLATES[templateId];

  for (const directory of template.directories) {
    ensureDirectory(container, directory);
  }

  for (const [path, content] of Object.entries(template.files)) {
    // Guard settings file: only seed if it doesn't already exist (preserve user changes on IDB-backed sessions)
    if (path === SETTINGS_PATH && container.vfs.existsSync(path)) {
      continue;
    }
    container.vfs.writeFileSync(path, content);
  }

  // Write Claude wrapper executable
  ensureDirectory(container, "/usr/local/bin");
  container.vfs.writeFileSync(CLAUDE_WRAPPER_PATH, CLAUDE_WRAPPER_SCRIPT);
}
