type MaybePromise<T> = T | Promise<T>;
type JsonRecord = Record<string, unknown>;

export interface PluginWorkspaceController {
  readFile(path: string): string;
  listFiles(root?: string): string[];
}

export type PluginContributionKind =
  | "skills"
  | "commands"
  | "agents"
  | "hooks"
  | "mcpServers"
  | "lspServers"
  | "monitors"
  | "bin"
  | "auth";

export type PluginDiagnosticLevel = "info" | "warning" | "error";

export interface PluginDiagnostic {
  level: PluginDiagnosticLevel;
  code: string;
  message: string;
  pluginId?: string;
  contributionKind?: PluginContributionKind | "settings" | "vscode.panels" | "vscode.customEditors";
  contributionId?: string;
  source?: string;
}

export interface PluginContributionSource {
  pluginId: string;
  path?: string;
  manifestPath?: string;
  sourceId?: string;
}

export interface PluginContributionBase {
  id: string;
  pluginId?: string;
  source?: PluginContributionSource;
  title?: string;
  label?: string;
  description?: string;
  [key: string]: unknown;
}

export interface SkillContribution extends PluginContributionBase {
  path?: string;
  kind?: "skill";
}

export interface CommandContribution extends PluginContributionBase {
  command?: string;
  path?: string;
}

export interface AgentContribution extends PluginContributionBase {
  path?: string;
}

export interface HookContribution extends PluginContributionBase {
  event?: string;
  command?: string;
  path?: string;
}

export interface McpServerContribution extends PluginContributionBase {
  type?: string;
  command?: string;
  url?: string;
  args?: string[];
}

export interface LspServerContribution extends PluginContributionBase {
  command?: string;
  args?: string[];
  transport?: string;
  extensionToLanguage?: Record<string, string>;
}

export interface MonitorContribution extends PluginContributionBase {
  command?: string;
  path?: string;
}

export interface BinContribution extends PluginContributionBase {
  path?: string;
  command?: string;
}

export interface AuthContribution extends PluginContributionBase {
  provider?: string;
  scopes?: string[];
}

export type VSCodeContributionLocation = "sidebar" | "panel" | "auxiliarybar";

export interface VSCodePanelContribution extends PluginContributionBase {
  title: string;
  location?: VSCodeContributionLocation;
  icon?: string;
  order?: number;
  default?: boolean;
  module?: string;
  export?: string;
}

export interface VSCodeCustomEditorContribution extends PluginContributionBase {
  displayName?: string;
  filePatterns?: string[];
  selector?: string;
  priority?: number;
  module?: string;
  export?: string;
  command?: string;
}

export type PluginContributionMap<T extends PluginContributionBase> = Record<string, T>;

export interface AgentWasmPluginManifest {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  homepage?: string;
  repository?: unknown;
  license?: string;
  keywords?: string[];
  source?: PluginContributionSource;
  skills?: PluginContributionMap<SkillContribution> | SkillContribution[] | unknown;
  commands?: PluginContributionMap<CommandContribution> | CommandContribution[] | unknown;
  agents?: PluginContributionMap<AgentContribution> | AgentContribution[] | unknown;
  hooks?: PluginContributionMap<HookContribution> | HookContribution[] | unknown;
  mcpServers?: PluginContributionMap<McpServerContribution> | McpServerContribution[] | string | unknown;
  lspServers?: PluginContributionMap<LspServerContribution> | LspServerContribution[] | string | unknown;
  monitors?: PluginContributionMap<MonitorContribution> | MonitorContribution[] | unknown;
  bin?: PluginContributionMap<BinContribution> | BinContribution[] | string[] | string | unknown;
  settings?: Record<string, unknown> | string | unknown;
  auth?: PluginContributionMap<AuthContribution> | AuthContribution[] | unknown;
  vscode?: {
    panels?: PluginContributionMap<VSCodePanelContribution> | VSCodePanelContribution[] | unknown;
    customEditors?: PluginContributionMap<VSCodeCustomEditorContribution> | VSCodeCustomEditorContribution[] | unknown;
    [key: string]: unknown;
  };
  raw?: JsonRecord;
  [key: string]: unknown;
}

export interface NormalizedAgentWasmPluginManifest {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  homepage?: string;
  repository?: unknown;
  license?: string;
  keywords?: string[];
  source?: PluginContributionSource;
  skills: PluginContributionMap<SkillContribution>;
  commands: PluginContributionMap<CommandContribution>;
  agents: PluginContributionMap<AgentContribution>;
  hooks: PluginContributionMap<HookContribution>;
  mcpServers: PluginContributionMap<McpServerContribution>;
  lspServers: PluginContributionMap<LspServerContribution>;
  monitors: PluginContributionMap<MonitorContribution>;
  bin: PluginContributionMap<BinContribution>;
  settings: Record<string, unknown>;
  auth: PluginContributionMap<AuthContribution>;
  vscode: {
    panels: PluginContributionMap<VSCodePanelContribution>;
    customEditors: PluginContributionMap<VSCodeCustomEditorContribution>;
  };
  raw?: JsonRecord;
}

export interface PluginFileReader {
  readFile(path: string): MaybePromise<string | null | undefined>;
  readDir?(path: string): MaybePromise<string[] | null | undefined>;
  listFiles?(root?: string): MaybePromise<string[]>;
}

export interface PluginDirectorySource {
  kind: "directory";
  id?: string;
  root?: string;
  files?: Record<string, string>;
  reader?: PluginFileReader;
  readFile?: PluginFileReader["readFile"];
  readDir?: PluginFileReader["readDir"];
  listFiles?: PluginFileReader["listFiles"];
}

export interface PluginWorkspaceSource {
  kind: "workspace";
  id?: string;
  root?: string;
  workspace: PluginWorkspaceController;
}

export interface PluginManifestSource {
  kind: "manifest";
  id?: string;
  root?: string;
  manifestPath?: string;
  manifest: AgentWasmPluginManifest;
}

export interface PluginPackageSource {
  kind: "package" | "npm";
  id?: string;
  packageName: string;
  root?: string;
  manifest?: AgentWasmPluginManifest;
  files?: Record<string, string>;
  reader?: PluginFileReader;
}

export type PluginSource =
  | AgentWasmPluginManifest
  | PluginManifestSource
  | PluginDirectorySource
  | PluginWorkspaceSource
  | PluginPackageSource;

export interface PluginMergeResult {
  manifest: NormalizedAgentWasmPluginManifest;
  plugins: NormalizedAgentWasmPluginManifest[];
  diagnostics: PluginDiagnostic[];
}

export interface LoadPluginsOptions {
  sourceId?: string;
}

type ContributionMapKey = Exclude<PluginContributionKind, never>;

const CONTRIBUTION_KEYS: ContributionMapKey[] = [
  "skills",
  "commands",
  "agents",
  "hooks",
  "mcpServers",
  "lspServers",
  "monitors",
  "bin",
  "auth",
];

const MANIFEST_CANDIDATES = [
  "plugin.json",
  ".claude-plugin/plugin.json",
  ".codex-plugin/plugin.json",
] as const;

const SIDECAR_FILES = [
  ".mcp.json",
  ".lsp.json",
  "settings.json",
  "hooks.json",
  "monitors.json",
] as const;

export class PluginRegistry {
  readonly manifest: NormalizedAgentWasmPluginManifest;
  readonly plugins: NormalizedAgentWasmPluginManifest[];
  readonly diagnostics: PluginDiagnostic[];

  constructor(
    manifests: AgentWasmPluginManifest[] | NormalizedAgentWasmPluginManifest[] = [],
    diagnostics: PluginDiagnostic[] = [],
  ) {
    const result = mergePluginManifests(manifests);
    this.manifest = result.manifest;
    this.plugins = result.plugins;
    this.diagnostics = [...diagnostics, ...result.diagnostics];
  }

  static fromManifests(
    manifests: AgentWasmPluginManifest[] | NormalizedAgentWasmPluginManifest[],
  ): PluginRegistry {
    return new PluginRegistry(manifests);
  }

  static async fromSources(sources: PluginSource[]): Promise<PluginRegistry> {
    return loadPlugins(sources);
  }

  getContribution<T extends PluginContributionBase>(
    kind: PluginContributionKind,
    id: string,
  ): T | undefined {
    return (this.manifest[kind] as PluginContributionMap<T>)[id];
  }

  listContributions<T extends PluginContributionBase>(
    kind: PluginContributionKind,
  ): T[] {
    return Object.values(this.manifest[kind] as PluginContributionMap<T>);
  }

  listPanels(): VSCodePanelContribution[] {
    return Object.values(this.manifest.vscode.panels);
  }

  listCustomEditors(): VSCodeCustomEditorContribution[] {
    return Object.values(this.manifest.vscode.customEditors);
  }
}

export async function loadPlugins(
  sources: PluginSource[],
  options: LoadPluginsOptions = {},
): Promise<PluginRegistry> {
  const manifests: AgentWasmPluginManifest[] = [];
  const diagnostics: PluginDiagnostic[] = [];

  for (const source of sources) {
    if (isManifestLike(source)) {
      manifests.push({
        ...source,
        source: {
          pluginId: String(source.id ?? source.name ?? options.sourceId ?? "plugin"),
          sourceId: options.sourceId,
        },
      });
      continue;
    }

    if (source.kind === "manifest") {
      manifests.push({
        ...source.manifest,
        id: source.manifest.id ?? source.id ?? source.manifest.name,
        source: {
          pluginId: String(source.manifest.id ?? source.id ?? source.manifest.name ?? "plugin"),
          path: source.root,
          manifestPath: source.manifestPath,
          sourceId: options.sourceId,
        },
      });
      continue;
    }

    if (source.kind === "package" || source.kind === "npm") {
      if (source.manifest) {
        manifests.push({
          ...source.manifest,
          id: source.manifest.id ?? source.id ?? source.packageName,
          source: {
            pluginId: String(source.manifest.id ?? source.id ?? source.packageName),
            path: source.root,
            sourceId: source.packageName,
          },
        });
        continue;
      }

      if (!source.reader && !source.files) {
        diagnostics.push({
          level: "warning",
          code: "package-source-unresolved",
          message: `Plugin package source "${source.packageName}" requires a manifest, files, or reader in this runtime.`,
          source: source.packageName,
        });
        continue;
      }
    }

    const directorySource = source as PluginDirectorySource | PluginWorkspaceSource | PluginPackageSource;
    const discovered = await discoverPluginDirectory(directorySource, options);
    manifests.push(...discovered.manifests);
    diagnostics.push(...discovered.diagnostics);
  }

  return new PluginRegistry(manifests, diagnostics);
}

export function mergePluginManifests(
  manifests: AgentWasmPluginManifest[] | NormalizedAgentWasmPluginManifest[],
): PluginMergeResult {
  const diagnostics: PluginDiagnostic[] = [];
  const normalized = manifests.map((manifest, index) =>
    normalizePluginManifest(manifest, {
      pluginId: manifest.id ?? manifest.name ?? `plugin-${index + 1}`,
      sourceId: manifest.source?.sourceId,
      manifestPath: manifest.source?.manifestPath,
      path: manifest.source?.path,
    }),
  );
  const merged = createEmptyManifest("merged");

  for (const manifest of normalized) {
    if (manifest.id && manifest.id !== "merged") {
      merged.id = manifest.id;
    }
    for (const key of ["name", "version", "description", "homepage", "repository", "license", "keywords"] as const) {
      const value = manifest[key];
      if (value !== undefined) {
        (merged as unknown as Record<string, unknown>)[key] = value;
      }
    }
    if (manifest.source) {
      merged.source = manifest.source;
    }

    for (const kind of CONTRIBUTION_KEYS) {
      mergeContributionMap(
        merged[kind] as PluginContributionMap<PluginContributionBase>,
        manifest[kind] as PluginContributionMap<PluginContributionBase>,
        kind,
        diagnostics,
      );
    }

    mergeContributionMap(
      merged.vscode.panels,
      manifest.vscode.panels,
      "vscode.panels",
      diagnostics,
    );
    mergeContributionMap(
      merged.vscode.customEditors,
      manifest.vscode.customEditors,
      "vscode.customEditors",
      diagnostics,
    );

    for (const [setting, value] of Object.entries(manifest.settings)) {
      if (Object.prototype.hasOwnProperty.call(merged.settings, setting)) {
        diagnostics.push({
          level: "warning",
          code: "duplicate-setting",
          message: `Setting "${setting}" was provided more than once; the later value won.`,
          pluginId: manifest.id,
          contributionKind: "settings",
          contributionId: setting,
          source: manifest.source?.manifestPath ?? manifest.source?.path,
        });
      }
      merged.settings[setting] = value;
    }
  }

  return {
    manifest: merged,
    plugins: normalized,
    diagnostics,
  };
}

export function normalizePluginManifest(
  manifest: AgentWasmPluginManifest | NormalizedAgentWasmPluginManifest,
  source: Partial<PluginContributionSource> = {},
): NormalizedAgentWasmPluginManifest {
  const pluginId = String(manifest.id ?? manifest.name ?? source.pluginId ?? "plugin");
  const contributionSource: PluginContributionSource = {
    pluginId,
    path: source.path ?? manifest.source?.path,
    manifestPath: source.manifestPath ?? manifest.source?.manifestPath,
    sourceId: source.sourceId ?? manifest.source?.sourceId,
  };
  const normalized = createEmptyManifest(pluginId);
  normalized.name = manifest.name;
  normalized.version = manifest.version;
  normalized.description = manifest.description;
  normalized.homepage = manifest.homepage;
  normalized.repository = manifest.repository;
  normalized.license = manifest.license;
  normalized.keywords = manifest.keywords;
  normalized.source = contributionSource;
  normalized.raw = manifest.raw;

  for (const kind of CONTRIBUTION_KEYS) {
    normalized[kind] = coerceContributionMap(
      manifest[kind],
      kind,
      pluginId,
      contributionSource,
    ) as never;
  }
  normalized.settings = coerceSettings(manifest.settings);
  normalized.vscode.panels = coerceContributionMap(
    manifest.vscode?.panels,
    "vscode.panels",
    pluginId,
    contributionSource,
  ) as PluginContributionMap<VSCodePanelContribution>;
  normalized.vscode.customEditors = coerceContributionMap(
    manifest.vscode?.customEditors,
    "vscode.customEditors",
    pluginId,
    contributionSource,
  ) as PluginContributionMap<VSCodeCustomEditorContribution>;

  return normalized;
}

async function discoverPluginDirectory(
  source: PluginDirectorySource | PluginWorkspaceSource | PluginPackageSource,
  options: LoadPluginsOptions,
): Promise<{ manifests: AgentWasmPluginManifest[]; diagnostics: PluginDiagnostic[] }> {
  const diagnostics: PluginDiagnostic[] = [];
  const manifests: AgentWasmPluginManifest[] = [];
  const root = normalizePath(source.root ?? "/");
  const sourceId =
    source.id
    ?? (source.kind === "package" || source.kind === "npm" ? source.packageName : undefined)
    ?? options.sourceId
    ?? basename(root)
    ?? "plugin";
  const reader = createReader(source);

  for (const candidate of MANIFEST_CANDIDATES) {
    const manifestPath = joinPath(root, candidate);
    const text = await reader.readFile(manifestPath);
    if (text == null) {
      continue;
    }

    const parsed = parseJsonObject(text, manifestPath, diagnostics);
    if (!parsed) {
      continue;
    }
    const expanded = await expandManifestReferences(parsed, reader, dirname(manifestPath), diagnostics);
    const pluginId = String(expanded.id ?? expanded.name ?? sourceId);
    manifests.push({
      ...expanded,
      id: expanded.id ?? expanded.name ?? pluginId,
      source: {
        pluginId,
        path: root,
        manifestPath,
        sourceId,
      },
    });
  }

  const sidecarManifest = await discoverSidecars(root, sourceId, reader, diagnostics);
  if (hasContributions(sidecarManifest)) {
    manifests.push(sidecarManifest);
  }

  const conventionManifest = await discoverFolderConventions(root, sourceId, reader);
  if (hasContributions(conventionManifest)) {
    manifests.push(conventionManifest);
  }

  return { manifests, diagnostics };
}

async function expandManifestReferences(
  raw: JsonRecord,
  reader: PluginFileReader,
  manifestDir: string,
  diagnostics: PluginDiagnostic[],
): Promise<AgentWasmPluginManifest> {
  const expanded: AgentWasmPluginManifest = { ...raw };

  for (const key of ["mcpServers", "lspServers", "settings"] as const) {
    const value = raw[key];
    if (typeof value !== "string") {
      continue;
    }
    const targetPath = joinPath(manifestDir, value);
    const text = await reader.readFile(targetPath);
    if (text == null) {
      diagnostics.push({
        level: "warning",
        code: "referenced-file-missing",
        message: `Referenced plugin file "${value}" could not be found.`,
        source: targetPath,
      });
      continue;
    }
    const parsed = parseJsonObject(text, targetPath, diagnostics);
    if (parsed) {
      expanded[key] = unwrapServerObject(key, parsed);
    }
  }

  return expanded;
}

async function discoverSidecars(
  root: string,
  sourceId: string,
  reader: PluginFileReader,
  diagnostics: PluginDiagnostic[],
): Promise<AgentWasmPluginManifest> {
  const manifest: AgentWasmPluginManifest = {
    id: sourceId,
    source: {
      pluginId: sourceId,
      path: root,
      sourceId,
    },
  };

  for (const sidecar of SIDECAR_FILES) {
    const fullPath = joinPath(root, sidecar);
    const text = await reader.readFile(fullPath);
    if (text == null) {
      continue;
    }
    const parsed = parseJsonObject(text, fullPath, diagnostics);
    if (!parsed) {
      continue;
    }

    if (sidecar === ".mcp.json") {
      manifest.mcpServers = unwrapServerObject("mcpServers", parsed);
    } else if (sidecar === ".lsp.json") {
      manifest.lspServers = unwrapServerObject("lspServers", parsed);
    } else if (sidecar === "settings.json") {
      manifest.settings = parsed;
    } else if (sidecar === "hooks.json") {
      manifest.hooks = parsed;
    } else if (sidecar === "monitors.json") {
      manifest.monitors = parsed;
    }
  }

  return manifest;
}

async function discoverFolderConventions(
  root: string,
  sourceId: string,
  reader: PluginFileReader,
): Promise<AgentWasmPluginManifest> {
  const source: PluginContributionSource = {
    pluginId: sourceId,
    path: root,
    sourceId,
  };
  const manifest: AgentWasmPluginManifest = {
    id: sourceId,
    source,
    skills: {},
    commands: {},
    agents: {},
    hooks: {},
    monitors: {},
    bin: {},
  };

  for (const skillsRoot of ["skills", ".agents/skills", ".claude/skills"]) {
    const directory = joinPath(root, skillsRoot);
    const children = await listDirectChildren(reader, directory);
    for (const child of children) {
      if (child.startsWith(".")) {
        continue;
      }
      const childPath = joinPath(directory, child);
      if (child.endsWith(".md")) {
        const id = stripExtension(child);
        (manifest.skills as PluginContributionMap<SkillContribution>)[id] = {
          id,
          pluginId: sourceId,
          path: toRelativePath(childPath, root),
          source,
        };
        continue;
      }

      const skillFile = joinPath(childPath, "SKILL.md");
      if (await reader.readFile(skillFile) != null) {
        (manifest.skills as PluginContributionMap<SkillContribution>)[child] = {
          id: child,
          pluginId: sourceId,
          path: toRelativePath(skillFile, root),
          source,
        };
      }
    }
  }

  await discoverFlatFiles(root, "commands", manifest.commands as PluginContributionMap<CommandContribution>, sourceId, source, reader);
  await discoverFlatFiles(root, "agents", manifest.agents as PluginContributionMap<AgentContribution>, sourceId, source, reader);
  await discoverFlatFiles(root, "hooks", manifest.hooks as PluginContributionMap<HookContribution>, sourceId, source, reader);
  await discoverFlatFiles(root, "monitors", manifest.monitors as PluginContributionMap<MonitorContribution>, sourceId, source, reader);

  const binDirectory = joinPath(root, "bin");
  for (const child of await listDirectChildren(reader, binDirectory)) {
    if (child.startsWith(".")) {
      continue;
    }
    const childPath = joinPath(binDirectory, child);
    (manifest.bin as PluginContributionMap<BinContribution>)[child] = {
      id: child,
      pluginId: sourceId,
      command: child,
      path: toRelativePath(childPath, root),
      source,
    };
  }

  return manifest;
}

async function discoverFlatFiles<T extends PluginContributionBase>(
  root: string,
  directoryName: string,
  target: PluginContributionMap<T>,
  pluginId: string,
  source: PluginContributionSource,
  reader: PluginFileReader,
): Promise<void> {
  const directory = joinPath(root, directoryName);
  const children = await listDirectChildren(reader, directory);
  for (const child of children) {
    if (child.startsWith(".") || child.includes("/")) {
      continue;
    }
    const childPath = joinPath(directory, child);
    const text = await reader.readFile(childPath);
    if (text == null) {
      continue;
    }
    const id = stripExtension(child);
    target[id] = {
      id,
      pluginId,
      path: toRelativePath(childPath, root),
      source,
    } as unknown as T;
  }
}

function mergeContributionMap<T extends PluginContributionBase>(
  target: PluginContributionMap<T>,
  source: PluginContributionMap<T>,
  kind: PluginContributionKind | "vscode.panels" | "vscode.customEditors",
  diagnostics: PluginDiagnostic[],
): void {
  for (const [id, contribution] of Object.entries(source)) {
    if (Object.prototype.hasOwnProperty.call(target, id)) {
      diagnostics.push({
        level: "warning",
        code: "duplicate-contribution",
        message: `${kind} contribution "${id}" was provided more than once; the later value won.`,
        pluginId: contribution.pluginId,
        contributionKind: kind,
        contributionId: id,
        source: contribution.source?.manifestPath ?? contribution.source?.path,
      });
    }
    target[id] = contribution;
  }
}

function coerceContributionMap(
  value: unknown,
  kind: PluginContributionKind | "vscode.panels" | "vscode.customEditors",
  pluginId: string,
  source: PluginContributionSource,
): PluginContributionMap<PluginContributionBase> {
  const map: PluginContributionMap<PluginContributionBase> = {};

  if (value == null || typeof value === "string") {
    return map;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const contribution = coerceContribution(item, undefined, kind, pluginId, source);
      if (contribution) {
        map[contribution.id] = contribution;
      }
    }
    return map;
  }

  if (!isRecord(value)) {
    return map;
  }

  if (isSingleContributionObject(value)) {
    const contribution = coerceContribution(value, undefined, kind, pluginId, source);
    if (contribution) {
      map[contribution.id] = contribution;
    }
    return map;
  }

  for (const [id, item] of Object.entries(value)) {
    const contribution = coerceContribution(item, id, kind, pluginId, source);
    if (contribution) {
      map[contribution.id] = contribution;
    }
  }

  return map;
}

function coerceContribution(
  value: unknown,
  fallbackId: string | undefined,
  kind: PluginContributionKind | "vscode.panels" | "vscode.customEditors",
  pluginId: string,
  source: PluginContributionSource,
): PluginContributionBase | null {
  if (value == null) {
    return null;
  }

  if (typeof value === "string") {
    const id = fallbackId ?? stripExtension(basename(value));
    return defaultContributionForKind(kind, {
      id,
      pluginId,
      path: value,
      source,
    });
  }

  if (!isRecord(value)) {
    const id = fallbackId;
    return id
      ? defaultContributionForKind(kind, { id, pluginId, value, source })
      : null;
  }

  const id = String(
    value.id
    ?? fallbackId
    ?? value.name
    ?? value.command
    ?? value.path
    ?? value.module
    ?? "",
  );
  if (!id) {
    return null;
  }

  return defaultContributionForKind(kind, {
    id,
    pluginId,
    source,
    ...value,
  });
}

function defaultContributionForKind(
  kind: PluginContributionKind | "vscode.panels" | "vscode.customEditors",
  contribution: PluginContributionBase,
): PluginContributionBase {
  if (kind === "vscode.panels") {
    return {
      location: "sidebar",
      title: contribution.title ?? contribution.label ?? contribution.id,
      ...contribution,
    };
  }
  if (kind === "vscode.customEditors") {
    return {
      displayName: contribution.displayName ?? contribution.title ?? contribution.label ?? contribution.id,
      filePatterns: Array.isArray(contribution.filePatterns)
        ? contribution.filePatterns
        : contribution.selector
          ? [String(contribution.selector)]
          : [],
      ...contribution,
    };
  }
  if (kind === "bin") {
    return {
      command: contribution.command ?? contribution.id,
      ...contribution,
    };
  }
  return contribution;
}

function coerceSettings(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    return {};
  }
  return { ...value };
}

function createEmptyManifest(id: string): NormalizedAgentWasmPluginManifest {
  return {
    id,
    skills: {},
    commands: {},
    agents: {},
    hooks: {},
    mcpServers: {},
    lspServers: {},
    monitors: {},
    bin: {},
    settings: {},
    auth: {},
    vscode: {
      panels: {},
      customEditors: {},
    },
  };
}

function hasContributions(manifest: AgentWasmPluginManifest): boolean {
  return CONTRIBUTION_KEYS.some((key) => {
    const value = manifest[key];
    return isRecord(value) && Object.keys(value).length > 0;
  })
    || (isRecord(manifest.settings) && Object.keys(manifest.settings).length > 0)
    || (isRecord(manifest.vscode?.panels) && Object.keys(manifest.vscode.panels).length > 0)
    || (isRecord(manifest.vscode?.customEditors) && Object.keys(manifest.vscode.customEditors).length > 0);
}

function unwrapServerObject(key: "mcpServers" | "lspServers" | "settings", parsed: JsonRecord): JsonRecord {
  if (key in parsed && isRecord(parsed[key])) {
    return parsed[key] as JsonRecord;
  }
  return parsed;
}

function createReader(
  source: PluginDirectorySource | PluginWorkspaceSource | PluginPackageSource,
): PluginFileReader {
  if (source.kind === "workspace") {
    return {
      readFile: (path) => {
        try {
          return source.workspace.readFile(path);
        } catch {
          return null;
        }
      },
      listFiles: (root) => source.workspace.listFiles(root),
    };
  }

  const root = normalizePath(source.root ?? "/");
  const files = source.files ? normalizeFiles(source.files, root) : null;
  const reader = source.reader;

  return {
    readFile: async (path) => {
      const normalized = normalizePath(path);
      if (files && Object.prototype.hasOwnProperty.call(files, normalized)) {
        return files[normalized];
      }
      const directRead = "readFile" in source ? source.readFile ?? reader?.readFile : reader?.readFile;
      if (directRead) {
        return directRead(normalized);
      }
      return null;
    },
    readDir: async (path) => {
      const normalized = normalizePath(path);
      const directReadDir = "readDir" in source ? source.readDir ?? reader?.readDir : reader?.readDir;
      if (directReadDir) {
        return directReadDir(normalized);
      }
      if (files) {
        return directChildrenFromFiles(Object.keys(files), normalized);
      }
      return null;
    },
    listFiles: async (path = root) => {
      const normalized = normalizePath(path);
      const directListFiles = "listFiles" in source ? source.listFiles ?? reader?.listFiles : reader?.listFiles;
      if (directListFiles) {
        return directListFiles(normalized);
      }
      if (files) {
        return Object.keys(files).filter((file) => file === normalized || file.startsWith(`${trimTrailingSlash(normalized)}/`));
      }
      return [];
    },
  };
}

async function listDirectChildren(reader: PluginFileReader, directory: string): Promise<string[]> {
  const normalized = normalizePath(directory);
  const readDirResult = await reader.readDir?.(normalized);
  if (readDirResult?.length) {
    return [...new Set(readDirResult.map((entry) => entry.split("/").filter(Boolean).pop() ?? entry))].sort();
  }

  const files = await reader.listFiles?.(normalized);
  if (!files?.length) {
    return [];
  }
  return directChildrenFromFiles(files, normalized);
}

function directChildrenFromFiles(files: string[], directory: string): string[] {
  const prefix = `${trimTrailingSlash(normalizePath(directory))}/`;
  const children = new Set<string>();
  for (const file of files.map(normalizePath)) {
    if (!file.startsWith(prefix)) {
      continue;
    }
    const rest = file.slice(prefix.length);
    const [child] = rest.split("/");
    if (child) {
      children.add(child);
    }
  }
  return [...children].sort();
}

function normalizeFiles(files: Record<string, string>, root: string): Record<string, string> {
  const normalizedRoot = normalizePath(root);
  const result: Record<string, string> = {};
  for (const [path, content] of Object.entries(files)) {
    const normalized = path.startsWith("/")
      ? normalizePath(path)
      : joinPath(normalizedRoot, path);
    result[normalized] = content;
  }
  return result;
}

function parseJsonObject(
  text: string,
  source: string,
  diagnostics: PluginDiagnostic[],
): JsonRecord | null {
  try {
    const parsed = JSON.parse(stripJsonComments(text));
    if (!isRecord(parsed)) {
      diagnostics.push({
        level: "warning",
        code: "invalid-json-object",
        message: `Plugin file "${source}" did not contain a JSON object.`,
        source,
      });
      return null;
    }
    return parsed;
  } catch (error) {
    diagnostics.push({
      level: "error",
      code: "json-parse-failed",
      message: `Could not parse plugin file "${source}": ${error instanceof Error ? error.message : String(error)}`,
      source,
    });
    return null;
  }
}

function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  let escaping = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (inString) {
      output += char;
      if (escaping) {
        escaping = false;
      } else if (char === "\\") {
        escaping = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      while (i < text.length && text[i] !== "\n") {
        i += 1;
      }
      output += "\n";
      continue;
    }

    if (char === "/" && next === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) {
        i += 1;
      }
      i += 1;
      continue;
    }

    output += char;
  }
  return output;
}

function isManifestLike(value: PluginSource): value is AgentWasmPluginManifest {
  return isRecord(value) && !("kind" in value);
}

function isSingleContributionObject(value: JsonRecord): boolean {
  return typeof value.id === "string"
    || typeof value.path === "string"
    || typeof value.command === "string"
    || typeof value.module === "string"
    || Array.isArray(value.filePatterns);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizePath(path: string): string {
  const segments: string[] = [];
  const absolute = path.startsWith("/");
  for (const segment of path.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `${absolute ? "/" : ""}${segments.join("/")}` || (absolute ? "/" : ".");
}

function joinPath(...parts: string[]): string {
  const joined = parts
    .filter(Boolean)
    .join("/")
    .replace(/\/+/g, "/");
  return normalizePath(joined);
}

function dirname(path: string): string {
  const normalized = normalizePath(path);
  const parts = normalized.split("/");
  parts.pop();
  const joined = parts.join("/");
  return joined || (normalized.startsWith("/") ? "/" : ".");
}

function basename(path: string): string {
  const normalized = trimTrailingSlash(normalizePath(path));
  if (normalized === "/" || normalized === ".") {
    return "";
  }
  return normalized.split("/").pop() ?? "";
}

function stripExtension(path: string): string {
  return basename(path).replace(/\.[^.]+$/, "");
}

function trimTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

function toRelativePath(path: string, root: string): string {
  const normalizedRoot = `${trimTrailingSlash(normalizePath(root))}/`;
  const normalizedPath = normalizePath(path);
  return normalizedPath.startsWith(normalizedRoot)
    ? normalizedPath.slice(normalizedRoot.length)
    : normalizedPath;
}
