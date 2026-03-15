declare module "virtual:workspace-templates" {
  interface TemplateMetadata {
    defaultFile: string;
    runCommand: string;
  }

  interface TemplateData {
    metadata: TemplateMetadata;
    files: Record<string, string>;
    directories: string[];
  }

  const templates: Record<string, TemplateData>;
  export default templates;
}
