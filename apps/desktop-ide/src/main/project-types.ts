export type TemplateId = 'vite' | 'nextjs' | 'tanstack' | 'app-building';

export interface SerializedFile {
  path: string;
  contentBase64: string;
}

export interface LoadedProjectPayload {
  projectId: string;
  projectDirectory: string;
  templateId: TemplateId;
  title: string;
}

export interface RecentProjectItem {
  id: string;
  title: string;
  templateId: TemplateId;
  lastOpenedAt: string;
  projectId: string;
  projectDirectory: string;
}
