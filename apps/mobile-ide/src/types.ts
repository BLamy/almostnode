import type {
  MobileSecretFiles,
  OpenCodeStatus,
  PreviewStateSnapshot,
  ProjectFileApplyOp,
  SerializedFile,
  ThemeMode,
} from "opencode-mobile-runtime";
import type { TemplateId } from "./generated/mobile-template-registry";

export type {
  MobileSecretFiles,
  OpenCodeStatus,
  PreviewStateSnapshot,
  ProjectFileApplyOp,
  SerializedFile,
  ThemeMode,
};

export type { TemplateId };

export interface ProjectManifest {
  id: string;
  title: string;
  templateId: TemplateId;
  runCommand: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectRecord {
  manifest: ProjectManifest;
  files: SerializedFile[];
  revision: number;
}

export interface ProjectIndexPayload {
  version: 1;
  selectedProjectId: string | null;
  projects: ProjectManifest[];
}
