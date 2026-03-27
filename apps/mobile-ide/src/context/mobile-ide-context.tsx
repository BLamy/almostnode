import * as Clipboard from "expo-clipboard";
import * as Linking from "expo-linking";
import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useColorScheme } from "react-native";
import {
  applyProjectOps as applyProjectOpsOnDisk,
  createProject as createProjectOnDisk,
  deleteProject as deleteProjectOnDisk,
  duplicateProject as duplicateProjectOnDisk,
  listProjects as listProjectsOnDisk,
  loadProject as loadProjectFromDisk,
  readSelectedProjectId as readSelectedProjectIdFromDisk,
  renameProject as renameProjectOnDisk,
  setSelectedProjectId as setSelectedProjectIdOnDisk,
} from "../storage/project-store";
import { loadStoredSecrets, saveStoredSecrets } from "../storage/settings-store";
import type {
  MobileSecretFiles,
  OpenCodeStatus,
  PreviewStateSnapshot,
  ProjectFileApplyOp,
  ProjectManifest,
  SerializedFile,
  TemplateId,
  ThemeMode,
} from "../types";

interface MobileIdeContextValue {
  loading: boolean;
  busy: boolean;
  themeMode: ThemeMode;
  projects: ProjectManifest[];
  activeProject: ProjectManifest | null;
  activeProjectFiles: SerializedFile[];
  activeProjectRevision: number;
  settings: MobileSecretFiles;
  openCodeStatus: OpenCodeStatus | null;
  previewState: PreviewStateSnapshot | null;
  createProject(templateId: TemplateId, title: string): Promise<void>;
  openProject(projectId: string): Promise<void>;
  renameProject(projectId: string, title: string): Promise<void>;
  duplicateProject(projectId: string): Promise<void>;
  deleteProject(projectId: string): Promise<void>;
  persistActiveProjectOps(ops: ProjectFileApplyOp[]): Promise<void>;
  flushActiveProject(): Promise<SerializedFile[]>;
  loadSecrets(): Promise<MobileSecretFiles>;
  saveSecrets(next: MobileSecretFiles): Promise<void>;
  copyText(text: string): Promise<void>;
  openExternalUrl(url: string): Promise<void>;
  updateOpenCodeStatus(status: OpenCodeStatus): Promise<void>;
  updatePreviewState(state: PreviewStateSnapshot): Promise<void>;
}

const MobileIdeContext = createContext<MobileIdeContextValue | null>(null);

const EMPTY_SECRETS: MobileSecretFiles = {
  authJson: null,
  mcpAuthJson: null,
  configJson: null,
  configJsonc: null,
  legacyConfigJson: null,
};

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

export function MobileIdeProvider(
  props: React.PropsWithChildren,
): React.ReactElement {
  const colorScheme = useColorScheme();
  const themeMode: ThemeMode = colorScheme === "dark" ? "dark" : "light";
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [projects, setProjects] = useState<ProjectManifest[]>([]);
  const [activeProject, setActiveProject] = useState<ProjectManifest | null>(null);
  const [activeProjectFiles, setActiveProjectFiles] = useState<SerializedFile[]>([]);
  const [activeProjectRevision, setActiveProjectRevision] = useState(0);
  const [settings, setSettings] = useState<MobileSecretFiles>(EMPTY_SECRETS);
  const [openCodeStatus, setOpenCodeStatus] = useState<OpenCodeStatus | null>(null);
  const [previewState, setPreviewState] = useState<PreviewStateSnapshot | null>(null);
  const settingsRef = useRef(settings);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    let active = true;

    void (async () => {
      const [storedProjects, selectedProjectId, storedSecrets] = await Promise.all([
        listProjectsOnDisk(),
        readSelectedProjectIdFromDisk(),
        loadStoredSecrets(),
      ]);

      if (!active) {
        return;
      }

      setProjects(storedProjects);
      setSettings(storedSecrets);

      if (selectedProjectId) {
        const selectedProject = await loadProjectFromDisk(selectedProjectId);
        if (active && selectedProject) {
          setActiveProject(selectedProject.manifest);
          setActiveProjectFiles(selectedProject.files);
          setActiveProjectRevision(selectedProject.revision);
        }
      }

      if (active) {
        setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  const value = useMemo<MobileIdeContextValue>(() => ({
    loading,
    busy,
    themeMode,
    projects,
    activeProject,
    activeProjectFiles,
    activeProjectRevision,
    settings,
    openCodeStatus,
    previewState,
    async createProject(templateId, title) {
      setBusy(true);
      try {
        const createdProject = await createProjectOnDisk({ templateId, title });
        setProjects((currentProjects) => [
          createdProject.manifest,
          ...currentProjects.filter((project) => project.id !== createdProject.manifest.id),
        ]);
        setActiveProject(createdProject.manifest);
        setActiveProjectFiles(createdProject.files);
        setActiveProjectRevision(createdProject.revision);
        setOpenCodeStatus(null);
        setPreviewState(null);
      } finally {
        setBusy(false);
      }
    },
    async openProject(projectId) {
      setBusy(true);
      try {
        await setSelectedProjectIdOnDisk(projectId);
        const loadedProject = await loadProjectFromDisk(projectId);
        if (!loadedProject) {
          return;
        }

        setActiveProject(loadedProject.manifest);
        setActiveProjectFiles(loadedProject.files);
        setActiveProjectRevision(loadedProject.revision);
        setProjects(await listProjectsOnDisk());
        setOpenCodeStatus(null);
        setPreviewState(null);
      } finally {
        setBusy(false);
      }
    },
    async renameProject(projectId, title) {
      setBusy(true);
      try {
        const updatedManifest = await renameProjectOnDisk(projectId, title);
        setProjects((currentProjects) => currentProjects.map((project) => (
          project.id === updatedManifest.id ? updatedManifest : project
        )));
        setActiveProject((currentProject) => (
          currentProject?.id === updatedManifest.id ? updatedManifest : currentProject
        ));
      } finally {
        setBusy(false);
      }
    },
    async duplicateProject(projectId) {
      setBusy(true);
      try {
        const duplicatedProject = await duplicateProjectOnDisk(projectId);
        setProjects((currentProjects) => [
          duplicatedProject.manifest,
          ...currentProjects.filter((project) => project.id !== duplicatedProject.manifest.id),
        ]);
        setActiveProject(duplicatedProject.manifest);
        setActiveProjectFiles(duplicatedProject.files);
        setActiveProjectRevision(duplicatedProject.revision);
        setOpenCodeStatus(null);
        setPreviewState(null);
      } finally {
        setBusy(false);
      }
    },
    async deleteProject(projectId) {
      setBusy(true);
      try {
        await deleteProjectOnDisk(projectId);
        const nextProjects = await listProjectsOnDisk();
        setProjects(nextProjects);

        if (activeProject?.id === projectId) {
          const nextActiveProjectId = await readSelectedProjectIdFromDisk();
          if (nextActiveProjectId) {
            const nextProject = await loadProjectFromDisk(nextActiveProjectId);
            setActiveProject(nextProject?.manifest ?? null);
            setActiveProjectFiles(nextProject?.files ?? []);
            setActiveProjectRevision(nextProject?.revision ?? 0);
          } else {
            setActiveProject(null);
            setActiveProjectFiles([]);
            setActiveProjectRevision(0);
          }

          setOpenCodeStatus(null);
          setPreviewState(null);
        }
      } finally {
        setBusy(false);
      }
    },
    async persistActiveProjectOps(ops) {
      if (!activeProject || ops.length === 0) {
        return;
      }

      const updatedManifest = await applyProjectOpsOnDisk(activeProject.id, ops);
      setActiveProject(updatedManifest);
      setActiveProjectFiles((currentFiles) => applyOpsToFiles(currentFiles, ops));
      setActiveProjectRevision((currentRevision) => Math.max(currentRevision + 1, Date.now()));
      setProjects((currentProjects) => currentProjects.map((project) => (
        project.id === updatedManifest.id ? updatedManifest : project
      )));
    },
    async flushActiveProject() {
      if (!activeProject) {
        return [];
      }

      const flushedProject = await loadProjectFromDisk(activeProject.id);
      if (!flushedProject) {
        return [];
      }

      setActiveProject(flushedProject.manifest);
      setActiveProjectFiles(flushedProject.files);
      setActiveProjectRevision(flushedProject.revision);
      setProjects((currentProjects) => currentProjects.map((project) => (
        project.id === flushedProject.manifest.id ? flushedProject.manifest : project
      )));

      return flushedProject.files;
    },
    async loadSecrets() {
      return settingsRef.current;
    },
    async saveSecrets(next) {
      const savedSecrets = await saveStoredSecrets(next);
      setSettings(savedSecrets);
    },
    async copyText(text) {
      await Clipboard.setStringAsync(text);
    },
    async openExternalUrl(url) {
      await Linking.openURL(url);
    },
    async updateOpenCodeStatus(status) {
      setOpenCodeStatus(status);
    },
    async updatePreviewState(state) {
      setPreviewState(state);
    },
  }), [
    activeProject,
    activeProjectFiles,
    activeProjectRevision,
    busy,
    loading,
    openCodeStatus,
    previewState,
    projects,
    settings,
    themeMode,
  ]);

  return (
    <MobileIdeContext.Provider value={value}>
      {props.children}
    </MobileIdeContext.Provider>
  );
}

export function useMobileIde(): MobileIdeContextValue {
  const context = useContext(MobileIdeContext);
  if (!context) {
    throw new Error("MobileIdeProvider is missing");
  }
  return context;
}
