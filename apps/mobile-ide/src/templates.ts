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
    id: "next",
    label: "Next.js",
    description: "App Router starter with shadcn component metadata.",
  },
  {
    id: "vite",
    label: "Vite",
    description: "Fast React starter with the full agent-wasm demo stack.",
  },
  {
    id: "start",
    label: "TanStack Start",
    description: "TanStack route starter with shadcn component aliases.",
  },
  {
    id: "react-router",
    label: "React Router",
    description: "React Router starter with shadcn components.",
  },
  {
    id: "astro",
    label: "Astro",
    description: "Astro project scaffold with shadcn metadata.",
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
