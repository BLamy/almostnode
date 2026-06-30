import {
  PluginRegistry,
  type AgentWasmPluginManifest,
  type CommandContribution,
  type NormalizedAgentWasmPluginManifest,
  type VSCodeCustomEditorContribution,
  type VSCodePanelContribution,
} from "@agent-wasm/sdk/plugins";

export interface VSCodeWorkspaceController {
  container: {
    run(command: string): unknown | Promise<unknown>;
  };
  subscribe(listener: () => void): () => void;
  getSnapshot(): {
    currentFile: string | null;
  };
  setCurrentFile(path: string): void;
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  listFiles(root?: string): string[];
}

export interface DisposableLike {
  dispose(): void;
}

export type VSCodeCommandHandler<TResult = unknown> = (
  context: VSCodeCommandContext,
  ...args: unknown[]
) => TResult | Promise<TResult>;

export interface VSCodeCommandContext {
  shell: VSCodeShell;
  workspace: VSCodeWorkspaceController;
}

export interface VSCodeCommandDefinition<TResult = unknown> {
  id: string;
  title?: string;
  handler: VSCodeCommandHandler<TResult>;
}

export interface VSCodePanelRenderContext {
  shell: VSCodeShell;
  workspace: VSCodeWorkspaceController;
  pluginRegistry: PluginRegistry;
  panel: VSCodePanelDefinition;
  container: HTMLElement;
}

export interface VSCodeCustomEditorRenderContext {
  shell: VSCodeShell;
  workspace: VSCodeWorkspaceController;
  pluginRegistry: PluginRegistry;
  editor: VSCodeCustomEditorDefinition;
  container: HTMLElement;
  resource: string;
}

export type VSCodePanelRenderer = (
  context: VSCodePanelRenderContext,
) => void | DisposableLike | Promise<void | DisposableLike>;

export type VSCodeCustomEditorRenderer = (
  context: VSCodeCustomEditorRenderContext,
) => void | DisposableLike | Promise<void | DisposableLike>;

export interface VSCodePanelDefinition extends VSCodePanelContribution {
  render?: VSCodePanelRenderer;
}

export interface VSCodeCustomEditorDefinition extends VSCodeCustomEditorContribution {
  render?: VSCodeCustomEditorRenderer;
}

export type VSCodeContributionModuleLoader = (
  contribution: VSCodePanelDefinition | VSCodeCustomEditorDefinition,
) => Promise<unknown>;

export interface VSCodeFileProvider {
  readFile(resource: string): string;
  writeFile(resource: string, content: string): void;
  listFiles(root?: string): string[];
}

export interface OpenResourceResult {
  resource: string;
  kind: "customEditor" | "text";
  customEditor?: VSCodeCustomEditorDefinition;
}

export interface VSCodePlaywrightTargetRequest {
  editorId?: string;
  resource?: string;
}

export interface VSCodePlaywrightTarget {
  kind: "customEditor";
  pluginId?: string;
  editorId: string;
  resource?: string;
  testId: string;
  selector: string;
}

export interface VSCodeShellOptions {
  workspace: VSCodeWorkspaceController;
  plugins?: PluginRegistry | AgentWasmPluginManifest[] | NormalizedAgentWasmPluginManifest[];
  panels?: VSCodePanelDefinition[];
  customEditors?: VSCodeCustomEditorDefinition[];
  commands?: VSCodeCommandDefinition[];
  moduleLoader?: VSCodeContributionModuleLoader;
}

export interface VSCodeShell {
  workspace: VSCodeWorkspaceController;
  pluginRegistry: PluginRegistry;
  fileProvider: VSCodeFileProvider;
  registerPanel(definition: VSCodePanelDefinition): DisposableLike;
  registerCustomEditor(definition: VSCodeCustomEditorDefinition): DisposableLike;
  registerCommand<TResult = unknown>(definition: VSCodeCommandDefinition<TResult>): DisposableLike;
  executeCommand<TResult = unknown>(id: string, ...args: unknown[]): Promise<TResult>;
  getPanel(id: string): VSCodePanelDefinition | undefined;
  getPanels(location?: VSCodePanelContribution["location"]): VSCodePanelDefinition[];
  getCustomEditor(id: string): VSCodeCustomEditorDefinition | undefined;
  getCustomEditors(): VSCodeCustomEditorDefinition[];
  matchCustomEditor(resource: string): VSCodeCustomEditorDefinition | undefined;
  openResource(resource: string): OpenResourceResult;
  mountPanel(id: string, container: HTMLElement): Promise<DisposableLike>;
  mountCustomEditor(
    editorId: string,
    resource: string,
    container: HTMLElement,
  ): Promise<DisposableLike>;
  getPlaywrightTarget(
    target: string | VSCodePlaywrightTargetRequest,
  ): VSCodePlaywrightTarget | undefined;
  subscribe(listener: () => void): DisposableLike;
  dispose(): void;
}

interface MountedCustomEditor {
  editorId: string;
  pluginId?: string;
  resource: string;
  testId: string;
  selector: string;
  container: HTMLElement;
}

export function defineVSCodePanel(
  definition: VSCodePanelDefinition,
): VSCodePanelDefinition {
  return definition;
}

export function defineVSCodeCustomEditor(
  definition: VSCodeCustomEditorDefinition,
): VSCodeCustomEditorDefinition {
  return definition;
}

export function createVSCodeShell(options: VSCodeShellOptions): VSCodeShell {
  const pluginRegistry = coercePluginRegistry(options.plugins);
  const panels = new Map<string, VSCodePanelDefinition>();
  const customEditors = new Map<string, VSCodeCustomEditorDefinition>();
  const commands = new Map<string, VSCodeCommandDefinition>();
  const listeners = new Set<() => void>();
  const mountedCustomEditors = new Map<string, MountedCustomEditor>();
  const workspaceDispose = options.workspace.subscribe?.(() => emit()) ?? (() => {});
  let disposed = false;

  const fileProvider: VSCodeFileProvider = {
    readFile: (resource) => options.workspace.readFile(normalizeResource(resource)),
    writeFile: (resource, content) => {
      options.workspace.writeFile(normalizeResource(resource), content);
      emit();
    },
    listFiles: (root) => options.workspace.listFiles(root ? normalizeResource(root) : undefined),
  };

  const shell: VSCodeShell = {
    workspace: options.workspace,
    pluginRegistry,
    fileProvider,
    registerPanel(definition) {
      const normalized = normalizePanel(definition);
      panels.set(normalized.id, normalized);
      emit();
      return {
        dispose: () => {
          panels.delete(normalized.id);
          emit();
        },
      };
    },
    registerCustomEditor(definition) {
      const normalized = normalizeCustomEditor(definition);
      customEditors.set(normalized.id, normalized);
      emit();
      return {
        dispose: () => {
          customEditors.delete(normalized.id);
          emit();
        },
      };
    },
    registerCommand(definition) {
      commands.set(definition.id, definition);
      return {
        dispose: () => {
          commands.delete(definition.id);
        },
      };
    },
    async executeCommand<TResult = unknown>(id: string, ...args: unknown[]): Promise<TResult> {
      const command = commands.get(id);
      if (!command) {
        throw new Error(`VSCode command "${id}" was not registered.`);
      }
      return await command.handler({ shell, workspace: options.workspace }, ...args) as TResult;
    },
    getPanel: (id) => panels.get(id),
    getPanels(location) {
      return [...panels.values()]
        .filter((panel) => !location || panel.location === location)
        .sort((left, right) => (left.order ?? 0) - (right.order ?? 0) || left.id.localeCompare(right.id));
    },
    getCustomEditor: (id) => customEditors.get(id),
    getCustomEditors: () => [...customEditors.values()],
    matchCustomEditor(resource) {
      const normalizedResource = normalizeResource(resource);
      return [...customEditors.values()]
        .sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0))
        .find((editor) =>
          (editor.filePatterns ?? []).some((pattern) => matchesPattern(normalizedResource, pattern)),
        );
    },
    openResource(resource) {
      const normalizedResource = normalizeResource(resource);
      options.workspace.setCurrentFile(normalizedResource);
      const customEditor = shell.matchCustomEditor(normalizedResource);
      emit();
      return customEditor
        ? { resource: normalizedResource, kind: "customEditor", customEditor }
        : { resource: normalizedResource, kind: "text" };
    },
    async mountPanel(id, container) {
      const panel = panels.get(id);
      if (!panel) {
        throw new Error(`VSCode panel "${id}" was not registered.`);
      }
      applySurfaceMetadata(container, {
        kind: "panel",
        pluginId: panel.pluginId,
        contributionId: panel.id,
      });
      const disposable = await renderPanel(panel, container);
      return toDisposable(() => {
        disposable.dispose();
        clearElement(container);
      });
    },
    async mountCustomEditor(editorId, resource, container) {
      const editor = customEditors.get(editorId);
      if (!editor) {
        throw new Error(`VSCode custom editor "${editorId}" was not registered.`);
      }
      const normalizedResource = normalizeResource(resource);
      const testId = createCustomEditorTestId(editor.id, normalizedResource);
      const selector = `[data-testid="${testId}"]`;
      applyCustomEditorMetadata(container, editor, normalizedResource, testId);
      mountedCustomEditors.set(`${editor.id}:${normalizedResource}`, {
        editorId: editor.id,
        pluginId: editor.pluginId,
        resource: normalizedResource,
        testId,
        selector,
        container,
      });
      const disposable = await renderCustomEditor(editor, normalizedResource, container);
      return toDisposable(() => {
        disposable.dispose();
        mountedCustomEditors.delete(`${editor.id}:${normalizedResource}`);
        clearElement(container);
      });
    },
    getPlaywrightTarget(target) {
      const request = typeof target === "string"
        ? customEditors.has(target)
          ? { editorId: target }
          : { resource: target }
        : target;
      const resource = request.resource ? normalizeResource(request.resource) : undefined;
      const mounted = [...mountedCustomEditors.values()].find((item) =>
        (!request.editorId || item.editorId === request.editorId)
        && (!resource || item.resource === resource),
      );
      if (mounted) {
        return {
          kind: "customEditor",
          pluginId: mounted.pluginId,
          editorId: mounted.editorId,
          resource: mounted.resource,
          testId: mounted.testId,
          selector: mounted.selector,
        };
      }

      const editor = request.editorId
        ? customEditors.get(request.editorId)
        : resource
          ? shell.matchCustomEditor(resource)
          : undefined;
      if (!editor) {
        return undefined;
      }
      const testId = createCustomEditorTestId(editor.id, resource);
      return {
        kind: "customEditor",
        pluginId: editor.pluginId,
        editorId: editor.id,
        resource,
        testId,
        selector: resource
          ? `[data-testid="${testId}"]`
          : `[data-agent-wasm-vscode-editor-id="${escapeAttribute(editor.id)}"]`,
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return {
        dispose: () => {
          listeners.delete(listener);
        },
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      workspaceDispose();
      listeners.clear();
      panels.clear();
      customEditors.clear();
      commands.clear();
      mountedCustomEditors.clear();
    },
  };

  const renderPanel = async (
    panel: VSCodePanelDefinition,
    container: HTMLElement,
  ): Promise<DisposableLike> => {
    const renderer = await resolveRenderer<VSCodePanelRenderer>(panel, options.moduleLoader);
    if (renderer) {
      return normalizeRenderResult(
        await renderer({
          shell,
          workspace: options.workspace,
          pluginRegistry,
          panel,
          container,
        }),
      );
    }
    container.textContent = panel.title;
    return toDisposable();
  };

  const renderCustomEditor = async (
    editor: VSCodeCustomEditorDefinition,
    resource: string,
    container: HTMLElement,
  ): Promise<DisposableLike> => {
    const renderer = await resolveRenderer<VSCodeCustomEditorRenderer>(editor, options.moduleLoader);
    if (renderer) {
      return normalizeRenderResult(
        await renderer({
          shell,
          workspace: options.workspace,
          pluginRegistry,
          editor,
          container,
          resource,
        }),
      );
    }
    container.textContent = editor.displayName ?? editor.title ?? editor.id;
    return toDisposable();
  };

  shell.registerCommand({
    id: "vscode.open",
    title: "Open Resource",
    handler: (_context, resource) => shell.openResource(String(resource)),
  });
  shell.registerCommand({
    id: "workbench.action.openWith",
    title: "Open Resource With Editor",
    handler: (_context, resource, editorId) => {
      const normalizedResource = normalizeResource(String(resource));
      options.workspace.setCurrentFile(normalizedResource);
      const editor = customEditors.get(String(editorId));
      return editor
        ? { resource: normalizedResource, kind: "customEditor" as const, customEditor: editor }
        : shell.openResource(normalizedResource);
    },
  });

  for (const command of Object.values(pluginRegistry.manifest.commands)) {
    shell.registerCommand(createPluginCommand(command));
  }
  for (const panel of pluginRegistry.listPanels()) {
    shell.registerPanel(normalizePanel(panel));
  }
  for (const editor of pluginRegistry.listCustomEditors()) {
    shell.registerCustomEditor(normalizeCustomEditor(editor));
  }
  for (const panel of options.panels ?? []) {
    shell.registerPanel(panel);
  }
  for (const editor of options.customEditors ?? []) {
    shell.registerCustomEditor(editor);
  }
  for (const command of options.commands ?? []) {
    shell.registerCommand(command);
  }

  return shell;

  function emit(): void {
    for (const listener of listeners) {
      listener();
    }
  }

  function createPluginCommand(command: CommandContribution): VSCodeCommandDefinition {
    return {
      id: command.id,
      title: command.title ?? command.label,
      handler: async (_context, ...args) => {
        if (typeof command.handler === "function") {
          return await (command.handler as VSCodeCommandHandler)({ shell, workspace: options.workspace }, ...args);
        }
        if (typeof command.command === "string") {
          return await options.workspace.container.run(command.command);
        }
        return command;
      },
    };
  }
}

function coercePluginRegistry(
  plugins: VSCodeShellOptions["plugins"],
): PluginRegistry {
  if (!plugins) {
    return new PluginRegistry();
  }
  if (plugins instanceof PluginRegistry) {
    return plugins;
  }
  if (isPluginRegistryLike(plugins)) {
    return plugins as PluginRegistry;
  }
  return new PluginRegistry(plugins);
}

function isPluginRegistryLike(value: unknown): value is PluginRegistry {
  return typeof value === "object"
    && value !== null
    && "manifest" in value
    && "listPanels" in value
    && "listCustomEditors" in value;
}

function normalizePanel(panel: VSCodePanelDefinition | VSCodePanelContribution): VSCodePanelDefinition {
  return {
    ...panel,
    location: panel.location ?? "sidebar",
    title: panel.title ?? panel.label ?? panel.id,
  };
}

function normalizeCustomEditor(
  editor: VSCodeCustomEditorDefinition | VSCodeCustomEditorContribution,
): VSCodeCustomEditorDefinition {
  return {
    ...editor,
    displayName: editor.displayName ?? editor.title ?? editor.label ?? editor.id,
    filePatterns: editor.filePatterns ?? [],
  };
}

async function resolveRenderer<TRenderer>(
  contribution: VSCodePanelDefinition | VSCodeCustomEditorDefinition,
  moduleLoader: VSCodeContributionModuleLoader | undefined,
): Promise<TRenderer | undefined> {
  if ("render" in contribution && contribution.render) {
    return contribution.render as TRenderer;
  }
  if (!moduleLoader || !contribution.module) {
    return undefined;
  }

  const loaded = await moduleLoader(contribution);
  const exportName = contribution.export ?? "default";
  const exported = isRecord(loaded) ? loaded[exportName] ?? loaded.default : loaded;
  if (typeof exported === "function") {
    return exported as TRenderer;
  }
  if (isRecord(exported) && typeof exported.render === "function") {
    return exported.render as TRenderer;
  }
  return undefined;
}

function normalizeRenderResult(value: void | DisposableLike): DisposableLike {
  return value && typeof value.dispose === "function" ? value : toDisposable();
}

function toDisposable(dispose: () => void = () => {}): DisposableLike {
  return { dispose };
}

function applySurfaceMetadata(
  container: HTMLElement,
  options: {
    kind: "panel" | "customEditor";
    pluginId?: string;
    contributionId: string;
  },
): void {
  container.dataset.agentWasmVscodeSurface = options.kind;
  container.dataset.agentWasmPluginId = options.pluginId ?? "";
  container.dataset.agentWasmContributionId = options.contributionId;
}

function applyCustomEditorMetadata(
  container: HTMLElement,
  editor: VSCodeCustomEditorDefinition,
  resource: string,
  testId: string,
): void {
  applySurfaceMetadata(container, {
    kind: "customEditor",
    pluginId: editor.pluginId,
    contributionId: editor.id,
  });
  container.dataset.agentWasmVscodeEditorId = editor.id;
  container.dataset.agentWasmResource = resource;
  container.dataset.testid = testId;
}

function clearElement(container: HTMLElement): void {
  container.replaceChildren();
}

function normalizeResource(resource: string): string {
  if (resource.startsWith("file://")) {
    return normalizePath(decodeURIComponent(resource.slice("file://".length)));
  }
  return normalizePath(resource);
}

function matchesPattern(resource: string, pattern: string): boolean {
  const normalizedResource = normalizeResource(resource);
  const normalizedPattern = normalizePath(pattern);
  if (normalizedPattern === normalizedResource) {
    return true;
  }
  if (normalizedPattern.startsWith("**/*.")) {
    return normalizedResource.endsWith(normalizedPattern.slice("**/*".length));
  }
  if (normalizedPattern.startsWith("*.")) {
    return basename(normalizedResource).endsWith(normalizedPattern.slice(1));
  }
  if (normalizedPattern.startsWith("**/")) {
    return normalizedResource.endsWith(normalizedPattern.slice(3));
  }
  if (normalizedPattern.includes("*")) {
    const expression = new RegExp(`^${normalizedPattern.split("*").map(escapeRegExp).join(".*")}$`);
    return expression.test(normalizedResource);
  }
  return normalizedResource.endsWith(normalizedPattern);
}

function createCustomEditorTestId(editorId: string, resource: string | undefined): string {
  return [
    "agent-wasm-custom-editor",
    sanitizeForTestId(editorId),
    resource ? hashString(resource) : "any",
  ].join("-");
}

function sanitizeForTestId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "editor";
}

function hashString(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function escapeAttribute(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePath(path: string): string {
  const absolute = path.startsWith("/");
  const segments: string[] = [];
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

function basename(path: string): string {
  return normalizePath(path).split("/").pop() ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
