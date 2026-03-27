import type { ProjectFileApplyOp, SerializedFile } from "opencode-mobile-runtime";
import { getTemplateDefinition, getTemplateSeedFiles } from "../templates";
import type { ProjectIndexPayload, ProjectManifest, ProjectRecord, TemplateId } from "../types";

const STORAGE_KEY = "mobile-ide.project-store.v1";

interface WebProjectStorePayload extends ProjectIndexPayload {
  filesByProject: Record<string, SerializedFile[]>;
}

let memoryStore: WebProjectStorePayload | null = null;

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

function defaultWebStore(): WebProjectStorePayload {
  return {
    ...defaultProjectIndex(),
    filesByProject: {},
  };
}

function sortProjects(projects: ProjectManifest[]): ProjectManifest[] {
  return [...projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function toRevision(manifest: ProjectManifest): number {
  const parsed = Date.parse(manifest.updatedAt);
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readWebStore(): WebProjectStorePayload {
  if (!canUseLocalStorage()) {
    memoryStore ??= defaultWebStore();
    return memoryStore;
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const initial = defaultWebStore();
      memoryStore = initial;
      return initial;
    }

    const parsed = JSON.parse(raw) as Partial<WebProjectStorePayload>;
    const nextStore: WebProjectStorePayload = {
      ...defaultWebStore(),
      ...parsed,
      version: 1,
      projects: sortProjects(parsed.projects ?? []),
      filesByProject: parsed.filesByProject ?? {},
    };

    memoryStore = nextStore;
    return nextStore;
  } catch {
    const initial = defaultWebStore();
    memoryStore = initial;
    return initial;
  }
}

function writeWebStore(store: WebProjectStorePayload): void {
  const normalized: WebProjectStorePayload = {
    ...store,
    version: 1,
    projects: sortProjects(store.projects),
  };

  memoryStore = normalized;

  if (!canUseLocalStorage()) {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
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

function applyOpsToFiles(
  currentFiles: SerializedFile[],
  ops: ProjectFileApplyOp[],
): SerializedFile[] {
  const filesByPath = new Map(currentFiles.map((file) => [file.path, file]));

  for (const op of ops) {
    if (op.type === "delete") {
      filesByPath.delete(op.path);
      continue;
    }

    filesByPath.set(op.path, {
      path: op.path,
      contentBase64: op.contentBase64,
    });
  }

  return [...filesByPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

async function createProjectFromFiles(input: {
  title: string;
  templateId: TemplateId;
  runCommand: string;
  files: SerializedFile[];
  selectProject?: boolean;
}): Promise<ProjectRecord> {
  const store = readWebStore();
  const now = new Date().toISOString();
  const manifest: ProjectManifest = {
    id: createProjectId(),
    title: input.title,
    templateId: input.templateId,
    runCommand: input.runCommand,
    createdAt: now,
    updatedAt: now,
  };

  writeWebStore({
    ...updateIndexManifest(store, manifest),
    selectedProjectId: input.selectProject === false ? store.selectedProjectId : manifest.id,
    filesByProject: {
      ...store.filesByProject,
      [manifest.id]: [...input.files].sort((left, right) => left.path.localeCompare(right.path)),
    },
  });

  return {
    manifest,
    files: input.files,
    revision: toRevision(manifest),
  };
}

export async function listProjects(): Promise<ProjectManifest[]> {
  return sortProjects(readWebStore().projects);
}

export async function readSelectedProjectId(): Promise<string | null> {
  return readWebStore().selectedProjectId;
}

export async function setSelectedProjectId(projectId: string | null): Promise<void> {
  const store = readWebStore();
  writeWebStore({
    ...store,
    selectedProjectId: projectId,
  });
}

export async function loadProject(projectId: string): Promise<ProjectRecord | null> {
  const store = readWebStore();
  const manifest = store.projects.find((project) => project.id === projectId) ?? null;
  if (!manifest) {
    return null;
  }

  const files = store.filesByProject[projectId] ?? [];
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
  const store = readWebStore();
  const manifest = store.projects.find((project) => project.id === projectId);
  if (!manifest) {
    throw new Error("Project not found.");
  }

  const updatedManifest: ProjectManifest = {
    ...manifest,
    title,
    updatedAt: new Date().toISOString(),
  };

  writeWebStore({
    ...store,
    ...updateIndexManifest(store, updatedManifest),
  });

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
  const store = readWebStore();
  const nextProjects = store.projects.filter((project) => project.id !== projectId);
  const nextFilesByProject = { ...store.filesByProject };
  delete nextFilesByProject[projectId];

  writeWebStore({
    ...store,
    projects: nextProjects,
    selectedProjectId: store.selectedProjectId === projectId
      ? nextProjects[0]?.id ?? null
      : store.selectedProjectId,
    filesByProject: nextFilesByProject,
  });
}

export async function applyProjectOps(
  projectId: string,
  ops: ProjectFileApplyOp[],
): Promise<ProjectManifest> {
  const store = readWebStore();
  const manifest = store.projects.find((project) => project.id === projectId);
  if (!manifest) {
    throw new Error("Project not found.");
  }

  const updatedManifest: ProjectManifest = {
    ...manifest,
    updatedAt: new Date().toISOString(),
  };

  writeWebStore({
    ...store,
    ...updateIndexManifest(store, updatedManifest),
    filesByProject: {
      ...store.filesByProject,
      [projectId]: applyOpsToFiles(store.filesByProject[projectId] ?? [], ops),
    },
  });

  return updatedManifest;
}

export async function replaceProjectFiles(
  projectId: string,
  files: SerializedFile[],
): Promise<ProjectRecord> {
  const store = readWebStore();
  const manifest = store.projects.find((project) => project.id === projectId);
  if (!manifest) {
    throw new Error("Project not found.");
  }

  const updatedManifest: ProjectManifest = {
    ...manifest,
    updatedAt: new Date().toISOString(),
  };

  const normalizedFiles = [...files].sort((left, right) => left.path.localeCompare(right.path));

  writeWebStore({
    ...store,
    ...updateIndexManifest(store, updatedManifest),
    filesByProject: {
      ...store.filesByProject,
      [projectId]: normalizedFiles,
    },
  });

  return {
    manifest: updatedManifest,
    files: normalizedFiles,
    revision: toRevision(updatedManifest),
  };
}
