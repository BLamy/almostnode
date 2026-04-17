import type { ReturnTypeOfCreateContainer } from "../workbench/workbench-host";
import { convertDatabaseXmlToDrizzle } from "./database-xml-to-drizzle";
import type { ReferenceAppFiles } from "./reference-app-loader";
import templates from "virtual:workspace-templates";

export const WORKSPACE_ROOT = "/project";
export const WORKSPACE_TESTS_ROOT = `${WORKSPACE_ROOT}/tests`;
export const WORKSPACE_TEST_E2E_ROOT = `${WORKSPACE_TESTS_ROOT}/e2e`;
export const WORKSPACE_TEST_METADATA_PATH = `${WORKSPACE_TESTS_ROOT}/.almostnode-tests.json`;
export const DEFAULT_FILE = `${WORKSPACE_ROOT}/src/App.tsx`;
export const DEFAULT_RUN_COMMAND = "npm run dev";

export const TEMPLATE_IDS = ["vite", "nextjs", "tanstack", "app-building"] as const;

export type TemplateId = (typeof TEMPLATE_IDS)[number];

export function isTemplateId(value: string): value is TemplateId {
  return (TEMPLATE_IDS as readonly string[]).includes(value);
}

export interface TemplateDefinition {
  id: TemplateId;
  defaultFile: string;
  runCommand: string;
  platforms?: Array<"web" | "desktop" | "mobile">;
  kind?: "app" | "control-plane";
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
    platforms: raw.metadata.platforms,
    kind: raw.metadata.kind,
    directories,
    files,
  };
}

const TEMPLATES: Record<TemplateId, TemplateDefinition> = {
  vite: buildTemplate("vite"),
  nextjs: buildTemplate("nextjs"),
  tanstack: buildTemplate("tanstack"),
  "app-building": buildTemplate("app-building"),
};

export function getTemplateDefaults(id: TemplateId): {
  defaultFile: string;
  runCommand: string;
} {
  const template = TEMPLATES[id];
  return { defaultFile: template.defaultFile, runCommand: template.runCommand };
}

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

  // Seed demo test for vite template
  if (templateId === "vite") {
    seedDemoTests(container);
  }
}

const DEMO_TEST_SPEC = `import { test, expect } from '@playwright/test';

test('todo-crud', async ({ page }) => {
  await page.goto('/todos');

  // Empty state
  await expect(page.getByText('No todos yet. Add one above.')).toBeVisible();

  // Add first todo
  await page.getByRole('textbox', { name: 'What needs to be done?' }).fill('Buy groceries');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Buy groceries')).toBeVisible();
  await expect(page.getByText('1 remaining')).toBeVisible();

  // Add second todo
  await page.getByRole('textbox', { name: 'What needs to be done?' }).fill('Walk the dog');
  await page.getByRole('button', { name: 'Add' }).click();
  await expect(page.getByText('Walk the dog')).toBeVisible();
  await expect(page.getByText('2 remaining')).toBeVisible();

  // Input should clear after adding
  await expect(page.getByRole('textbox', { name: 'What needs to be done?' })).toHaveValue('');

  // Toggle first todo as completed
  await page.getByRole('listitem').filter({ hasText: 'Buy groceries' }).getByRole('button').first().click();
  await expect(page.getByText('1 remaining')).toBeVisible();
  await expect(page.getByText('1 completed')).toBeVisible();

  // Delete completed todo
  await page.getByRole('listitem').filter({ hasText: 'Buy groceries' }).getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByText('Buy groceries')).not.toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(1);
  await expect(page.getByText('1 remaining')).toBeVisible();
  await expect(page.getByText('0 completed')).toBeVisible();
});
`;

const DEMO_TEST_METADATA = JSON.stringify({
  tests: [
    {
      id: "test-seed-todo-crud",
      name: "todo-crud",
      specPath: `${WORKSPACE_TEST_E2E_ROOT}/todo-crud.spec.ts`,
      createdAt: "2026-03-16T00:00:00.000Z",
      status: "pending",
    },
  ],
}, null, 2);

function seedDemoTests(container: ReturnTypeOfCreateContainer): void {
  ensureDirectory(container, WORKSPACE_TEST_E2E_ROOT);
  container.vfs.writeFileSync(`${WORKSPACE_TEST_E2E_ROOT}/todo-crud.spec.ts`, DEMO_TEST_SPEC);
  if (!container.vfs.existsSync(WORKSPACE_TEST_METADATA_PATH)) {
    container.vfs.writeFileSync(WORKSPACE_TEST_METADATA_PATH, DEMO_TEST_METADATA);
  }
}

// ── DB helper file contents (reused from vite template, without template-specific type exports) ──

const DB_INDEX_TS = `/**
 * Typed database helpers over the PGlite HTTP bridge (/__db__/).
 */

export async function dbQuery<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await fetch('/__db__/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error);
  return data.rows;
}

export async function dbExec(sql: string): Promise<void> {
  const res = await fetch('/__db__/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql }),
  });
  if (!res.ok) throw new Error((await res.json()).error);
}
`;

const DRIZZLE_CONFIG_TS = `import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
});
`;

/**
 * Seed the workspace with a reference app's files.
 * Detects database.xml and generates Drizzle schema + migration.
 */
export function seedReferenceApp(
  container: ReturnTypeOfCreateContainer,
  app: ReferenceAppFiles,
): void {
  const databaseXml = app.files['database.xml'] || null;

  // Collect all directories needed
  const dirs = new Set<string>();
  for (const relPath of Object.keys(app.files)) {
    const parts = relPath.split('/');
    for (let i = 1; i <= parts.length - 1; i++) {
      dirs.add(`${WORKSPACE_ROOT}/${parts.slice(0, i).join('/')}`);
    }
  }

  // Add db/drizzle directories if we have a database
  if (databaseXml) {
    dirs.add(`${WORKSPACE_ROOT}/src/db`);
    dirs.add(`${WORKSPACE_ROOT}/drizzle`);
  }

  for (const dir of Array.from(dirs).sort()) {
    ensureDirectory(container, dir);
  }

  // Write all app files (skip database.xml — we convert it instead)
  for (const [relPath, content] of Object.entries(app.files)) {
    if (relPath === 'database.xml') continue;
    const absPath = `${WORKSPACE_ROOT}/${relPath}`;
    if (absPath === SETTINGS_PATH && container.vfs.existsSync(absPath)) continue;

    // Rewrite index.html: absolute paths like src="/src/main.tsx" must become
    // relative (src="./src/main.tsx") so module loads stay within the service
    // worker's /__virtual__/{port}/ scope.
    if (relPath === 'index.html') {
      const rewritten = content
        .replace(/\bsrc="\/(?!\/)/g, 'src="./')
        .replace(/\bhref="\/(?!\/)/g, 'href="./');
      container.vfs.writeFileSync(absPath, rewritten);
      continue;
    }

    container.vfs.writeFileSync(absPath, content);
  }

  // Convert database.xml → Drizzle schema + migration
  if (databaseXml) {
    const { schemaTs, migrationSql } = convertDatabaseXmlToDrizzle(databaseXml);

    container.vfs.writeFileSync(`${WORKSPACE_ROOT}/src/db/schema.ts`, schemaTs);
    container.vfs.writeFileSync(`${WORKSPACE_ROOT}/drizzle/0000_initial.sql`, migrationSql);
    container.vfs.writeFileSync(`${WORKSPACE_ROOT}/drizzle.config.ts`, DRIZZLE_CONFIG_TS);

    // Write generic db helpers (no template-specific types)
    if (!container.vfs.existsSync(`${WORKSPACE_ROOT}/src/db/index.ts`)) {
      container.vfs.writeFileSync(`${WORKSPACE_ROOT}/src/db/index.ts`, DB_INDEX_TS);
    }
  }

}
