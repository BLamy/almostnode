import type { SerializedFile } from "opencode-mobile-runtime";
import {
  MOBILE_TEMPLATE_REGISTRY,
  type MobileTemplateDefinition,
  type TemplateId,
} from "./generated/mobile-template-registry";

export interface TemplateOption {
  id: TemplateId;
  label: string;
  description: string;
}

export const TEMPLATE_OPTIONS: TemplateOption[] = [
  {
    id: "vite",
    label: "Vite",
    description: "Fast React starter with the full AlmostNode demo stack.",
  },
  {
    id: "nextjs",
    label: "Next.js",
    description: "App Router starter for server-style routing in the browser sandbox.",
  },
  {
    id: "tanstack",
    label: "TanStack",
    description: "File-based TanStack Router starter for SPA workflows.",
  },
];

export function getTemplateDefinition(templateId: TemplateId): MobileTemplateDefinition {
  return MOBILE_TEMPLATE_REGISTRY[templateId];
}

export function getTemplateSeedFiles(templateId: TemplateId): SerializedFile[] {
  const template = getTemplateDefinition(templateId);
  return Object.entries(template.files)
    .map(([relativePath, contentBase64]) => ({
      path: `/project/${relativePath}`,
      contentBase64,
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}
