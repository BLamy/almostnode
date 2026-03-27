import { Directory, File, Paths } from "expo-file-system";
import type { ProjectFileApplyOp, SerializedFile } from "opencode-mobile-runtime";
import { getTemplateDefinition, getTemplateSeedFiles } from "../templates";
import type { ProjectIndexPayload, ProjectManifest, ProjectRecord, TemplateId } from "../types";

const PROJECTS_DIRECTORY = new Directory(Paths.document, "projects");
const PROJECT_INDEX_FILE = new File(PROJECTS_DIRECTORY, "index.json");
const PROJECT_ROOT = "/project/";

function createProjectId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `project-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function defaultProjectIndex(): ProjectIndexPayload {
  return {
    version: 1,
    selectedProjectId: null,
    projects: [],
  };
}

function projectDirectory(projectId: string): Directory {
  return new Directory(PROJECTS_DIRECTORY, projectId);
}

function workspaceDirectory(projectId: string): Directory {
  return new Directory(projectDirectory(projectId), "workspace");
}

function manifestFile(projectId: string): File {
  return new File(projectDirectory(projectId), "manifest.json");
}

function indexFile(): File {
  return PROJECT_INDEX_FILE;
}

function normalizeWorkspaceRelativePath(path: string): string {
  if (!path.startsWith(PROJECT_ROOT)) {
    throw new Error(`Unsupported project path: ${path}`);
  }

  const relativePath = path.slice(PROJECT_ROOT.length);
  if (!relativePath) {
    throw new Error(`Unsupported project path: ${path}`);
  }

  return relativePath;
}

function writeJsonFile(file: File, value: unknown): void {
  file.create({ intermediates: true, overwrite: true });
  file.write(JSON.stringify(value, null, 2));
}

async function readJsonFile<T>(file: File, fallback: T): Promise<T> {
  if (!file.exists) {
    return fallback;
  }

  try {
    return JSON.parse(await file.text()) as T;
  } catch {
    return fallback;
  }
}

function toRevision(manifest: ProjectManifest): number {
  const parsed = Date.parse(manifest.updatedAt);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function sortProjects(projects: ProjectManifest[]): ProjectManifest[] {
  return [...projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function writeSerializedFile(rootDirectory: Directory, file: SerializedFile): void {
  const relativePath = normalizeWorkspaceRelativePath(file.path);
  const targetFile = new File(rootDirectory, ...relativePath.split("/"));
  targetFile.create({ intermediates: true, overwrite: true });
  targetFile.write(file.contentBase64, { encoding: "base64" });
}

async function collectSerializedFiles(
  directory: Directory,
  prefix = "",
): Promise<SerializedFile[]> {
  if (!directory.exists) {
    return [];
  }

  const files: SerializedFile[] = [];
  for (const entry of directory.list()) {
    if (entry instanceof Directory) {
      const nestedPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      files.push(...await collectSerializedFiles(entry, nestedPrefix));
      continue;
    }

    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    files.push({
      path: `/project/${relativePath}`,
      contentBase64: await entry.base64(),
    });
  }

  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function updateIndexManifest(
  index: ProjectIndexPayload,
  manifest: ProjectManifest,
): ProjectIndexPayload {
  return {
    ...index,
    projects: sortProjects([
      manifest,
      ...index.projects.filter((project) => project.id !== manifest.id),
    ]),
  };
}

async function ensureProjectIndex(): Promise<ProjectIndexPayload> {
  PROJECTS_DIRECTORY.create({ intermediates: true, idempotent: true });
  if (!PROJECT_INDEX_FILE.exists) {
    writeJsonFile(PROJECT_INDEX_FILE, defaultProjectIndex());
    return defaultProjectIndex();
  }

  const index = await readJsonFile(PROJECT_INDEX_FILE, defaultProjectIndex());
  if (index.version === 1) {
    return index;
  }

  writeJsonFile(PROJECT_INDEX_FILE, defaultProjectIndex());
  return defaultProjectIndex();
}

async function writeProjectIndex(index: ProjectIndexPayload): Promise<void> {
  PROJECTS_DIRECTORY.create({ intermediates: true, idempotent: true });
  writeJsonFile(indexFile(), {
    ...index,
    projects: sortProjects(index.projects),
  });
}

async function loadProjectManifest(projectId: string): Promise<ProjectManifest | null> {
  const manifest = await readJsonFile<ProjectManifest | null>(manifestFile(projectId), null);
  return manifest;
}

async function createProjectFromFiles(input: {
  title: string;
  templateId: TemplateId;
  runCommand: string;
  files: SerializedFile[];
  selectProject?: boolean;
}): Promise<ProjectRecord> {
  const now = new Date().toISOString();
  const manifest: ProjectManifest = {
    id: createProjectId(),
    title: input.title,
    templateId: input.templateId,
    runCommand: input.runCommand,
    createdAt: now,
    updatedAt: now,
  };

  const root = projectDirectory(manifest.id);
  const workspace = workspaceDirectory(manifest.id);
  root.create({ intermediates: true, idempotent: true });
  workspace.create({ intermediates: true, idempotent: true });

  for (const file of input.files) {
    writeSerializedFile(workspace, file);
  }

  writeJsonFile(manifestFile(manifest.id), manifest);

  const index = await ensureProjectIndex();
  await writeProjectIndex({
    ...updateIndexManifest(index, manifest),
    selectedProjectId: input.selectProject === false ? index.selectedProjectId : manifest.id,
  });

  return {
    manifest,
    files: input.files,
    revision: toRevision(manifest),
  };
}

export async function listProjects(): Promise<ProjectManifest[]> {
  const index = await ensureProjectIndex();
  return sortProjects(index.projects);
}

export async function readSelectedProjectId(): Promise<string | null> {
  const index = await ensureProjectIndex();
  return index.selectedProjectId;
}

export async function setSelectedProjectId(projectId: string | null): Promise<void> {
  const index = await ensureProjectIndex();
  await writeProjectIndex({
    ...index,
    selectedProjectId: projectId,
  });
}

export async function loadProject(projectId: string): Promise<ProjectRecord | null> {
  const manifest = await loadProjectManifest(projectId);
  if (!manifest) {
    return null;
  }

  const files = await collectSerializedFiles(workspaceDirectory(projectId));
  return {
    manifest,
    files,
    revision: toRevision(manifest),
  };
}

export async function createProject(input: {
  title: string;
  templateId: TemplateId;
}): Promise<ProjectRecord> {
  const template = getTemplateDefinition(input.templateId);
  return createProjectFromFiles({
    title: input.title,
    templateId: input.templateId,
    runCommand: template.runCommand,
    files: getTemplateSeedFiles(input.templateId),
  });
}

export async function renameProject(
  projectId: string,
  title: string,
): Promise<ProjectManifest> {
  const manifest = await loadProjectManifest(projectId);
  if (!manifest) {
    throw new Error("Project not found.");
  }

  const updatedManifest: ProjectManifest = {
    ...manifest,
    title,
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(manifestFile(projectId), updatedManifest);

  const index = await ensureProjectIndex();
  await writeProjectIndex(updateIndexManifest(index, updatedManifest));
  return updatedManifest;
}

export async function duplicateProject(projectId: string): Promise<ProjectRecord> {
  const source = await loadProject(projectId);
  if (!source) {
    throw new Error("Project not found.");
  }

  const duplicateTitle = source.manifest.title.endsWith(" Copy")
    ? `${source.manifest.title} 2`
    : `${source.manifest.title} Copy`;

  return createProjectFromFiles({
    title: duplicateTitle,
    templateId: source.manifest.templateId,
    runCommand: source.manifest.runCommand,
    files: source.files,
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  const root = projectDirectory(projectId);
  if (root.exists) {
    root.delete();
  }

  const index = await ensureProjectIndex();
  const nextProjects = index.projects.filter((project) => project.id !== projectId);
  await writeProjectIndex({
    ...index,
    selectedProjectId: index.selectedProjectId === projectId
      ? nextProjects[0]?.id ?? null
      : index.selectedProjectId,
    projects: nextProjects,
  });
}

export async function applyProjectOps(
  projectId: string,
  ops: ProjectFileApplyOp[],
): Promise<ProjectManifest> {
  const manifest = await loadProjectManifest(projectId);
  if (!manifest) {
    throw new Error("Project not found.");
  }

  const workspace = workspaceDirectory(projectId);
  workspace.create({ intermediates: true, idempotent: true });

  for (const op of ops) {
    const relativePath = normalizeWorkspaceRelativePath(op.path);
    const targetFile = new File(workspace, ...relativePath.split("/"));

    if (op.type === "delete") {
      if (targetFile.exists) {
        targetFile.delete();
      }
      continue;
    }

    targetFile.create({ intermediates: true, overwrite: true });
    targetFile.write(op.contentBase64, { encoding: "base64" });
  }

  const updatedManifest: ProjectManifest = {
    ...manifest,
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(manifestFile(projectId), updatedManifest);

  const index = await ensureProjectIndex();
  await writeProjectIndex(updateIndexManifest(index, updatedManifest));
  return updatedManifest;
}

export async function replaceProjectFiles(
  projectId: string,
  files: SerializedFile[],
): Promise<ProjectRecord> {
  const manifest = await loadProjectManifest(projectId);
  if (!manifest) {
    throw new Error("Project not found.");
  }

  const currentFiles = await collectSerializedFiles(workspaceDirectory(projectId));
  const incomingPaths = new Set(files.map((file) => file.path));

  for (const currentFile of currentFiles) {
    if (incomingPaths.has(currentFile.path)) {
      continue;
    }

    const relativePath = normalizeWorkspaceRelativePath(currentFile.path);
    const targetFile = new File(workspaceDirectory(projectId), ...relativePath.split("/"));
    if (targetFile.exists) {
      targetFile.delete();
    }
  }

  for (const file of files) {
    writeSerializedFile(workspaceDirectory(projectId), file);
  }

  const updatedManifest: ProjectManifest = {
    ...manifest,
    updatedAt: new Date().toISOString(),
  };
  writeJsonFile(manifestFile(projectId), updatedManifest);

  const index = await ensureProjectIndex();
  await writeProjectIndex(updateIndexManifest(index, updatedManifest));

  return {
    manifest: updatedManifest,
    files,
    revision: toRevision(updatedManifest),
  };
}
