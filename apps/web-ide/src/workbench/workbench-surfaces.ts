import type { IDisposable } from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import { SimpleEditorInput } from "@codingame/monaco-vscode-workbench-service-override";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { strToU8, zipSync } from "fflate";
import type { VirtualFS } from "almostnode";
import {
  registerRenderedEditors,
  type RenderedEditorFactories,
} from "../features/rendered-editors";
import { createDomSlot } from "./framework/dom-slot";
import {
  MutableSurfaceModel,
  createStaticSurfaceModel,
  type SurfaceModel,
} from "./framework/model";
import { mountWorkbenchSurface } from "./framework/mount";
import {
  getWorkbenchEntrypoint,
  registerWorkbenchEntrypoints,
} from "./framework/registry";
import {
  CODESPACE_EDITOR_TYPE_ID,
  DATABASE_EDITOR_TYPE_ID,
  DATABASE_VIEW_ID,
  FILES_VIEW_ID,
  KEYCHAIN_VIEW_ID,
  OPEN_CODE_VIEW_ID,
  PREVIEW_EDITOR_TYPE_ID,
  TERMINAL_VIEW_ID,
  TESTS_VIEW_ID,
} from "./surface-constants";
import type {
  DatabaseSidebarActions,
  DatabaseSidebarState,
  KeychainSidebarActions,
  KeychainSidebarSlotStatus,
  KeychainSidebarState,
  SlotSurfaceActions,
  SlotSurfaceState,
  TestsSidebarActions,
  TestsSidebarState,
} from "./surface-model-types";

const NODE_MODULES_REFRESH_DELAY_MS = 48;

function scheduleUiFrame(callback: () => void): { cancel: () => void } {
  if (
    typeof window !== "undefined" &&
    typeof window.requestAnimationFrame === "function"
  ) {
    const handle = window.requestAnimationFrame(() => callback());
    return {
      cancel: () => window.cancelAnimationFrame(handle),
    };
  }

  const handle = setTimeout(callback, 0);
  return {
    cancel: () => clearTimeout(handle),
  };
}

function queueTerminalFit(callback: () => void): void {
  scheduleUiFrame(callback);

  if (typeof window !== "undefined") {
    window.setTimeout(callback, 0);
    window.setTimeout(callback, 120);
    window.setTimeout(callback, 400);
  }

  // Xterm can calculate stale rows before the web fonts finish loading.
  if (typeof document !== "undefined" && "fonts" in document) {
    void document.fonts.ready
      .then(() => {
        callback();
      })
      .catch(() => undefined);
  }
}

function normalizeWorkbenchPath(path: string): string {
  if (!path) return "/";
  return path.startsWith("/")
    ? path.replace(/\/+/g, "/")
    : `/${path}`.replace(/\/+/g, "/");
}

function getWorkspaceNodeModulesPath(workspaceRoot: string): string {
  const normalizedRoot = normalizeWorkbenchPath(workspaceRoot);
  return normalizedRoot === "/"
    ? "/node_modules"
    : `${normalizedRoot}/node_modules`;
}

function isWorkspaceChangePath(path: string, workspaceRoot: string): boolean {
  const normalizedPath = normalizeWorkbenchPath(path);
  const normalizedRoot = normalizeWorkbenchPath(workspaceRoot);
  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  );
}

function isNodeModulesChangePath(path: string, workspaceRoot: string): boolean {
  const normalizedPath = normalizeWorkbenchPath(path);
  const nodeModulesPath = getWorkspaceNodeModulesPath(workspaceRoot);
  return (
    normalizedPath === nodeModulesPath ||
    normalizedPath.startsWith(`${nodeModulesPath}/`)
  );
}

interface PreviewSurfaceCommands {
  run(): void;
  refresh(): void;
  toggleSelect(): void;
}

function mountStaticSlotSurface<TState, TActions>(
  container: HTMLElement,
  entrypointId: string,
  model: SurfaceModel<TState, TActions>,
): IDisposable {
  const entrypoint = getWorkbenchEntrypoint(entrypointId);
  if (!entrypoint) {
    throw new Error(`Workbench entrypoint "${entrypointId}" was not found.`);
  }

  return mountWorkbenchSurface(container, entrypoint, model);
}

export interface RegisteredWorkbenchSurfaces {
  previewInput: SimpleEditorInput;
  codespaceInput: SimpleEditorInput;
  databaseInput: SimpleEditorInput;
  renderedEditors: RenderedEditorFactories;
  filesViewId: string;
  openCodeViewId: string;
  terminalViewId: string;
  databaseViewId: string;
  keychainViewId: string;
  testsViewId: string;
  setActivation(id: string, active: boolean): void;
  dispose(): void;
}

export class FilesSidebarSurface {
  private readonly root = document.createElement("div");
  readonly model: SurfaceModel<SlotSurfaceState, SlotSurfaceActions> =
    createStaticSurfaceModel(
      { slot: createDomSlot(this.root) },
      {},
    );
  private readonly directoryOpenState = new Map<string, boolean>();
  private selectedPath: string | null = null;
  private contextMenu: HTMLDivElement | null = null;
  private autoExpandTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingRefresh: { cancel: () => void } | null = null;
  private pendingNodeModulesRefresh: ReturnType<typeof setTimeout> | null =
    null;
  private renderedNodeModulesExists = false;
  private readonly changeListener = (path: string) =>
    this.handleWorkspaceMutation(path);
  private readonly deleteListener = (path: string) =>
    this.handleWorkspaceMutation(path);

  /* Lucide-compatible SVG paths (viewBox 0 0 24 24) */
  private static readonly P = {
    chevron: '<path d="m9 18 6-6-6-6"/>',
    folder:
      '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
    folderOpen:
      '<path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"/>',
    file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
    fileCode:
      '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10 13-2 2 2 2"/><path d="m14 17 2-2-2-2"/>',
    fileJson:
      '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 12a1 1 0 0 0-1 1v1a1 1 0 0 1-1 1 1 1 0 0 1 1 1v1a1 1 0 0 0 1 1"/><path d="M14 18a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1 1 1 0 0 1-1-1v-1a1 1 0 0 0-1-1"/>',
    fileText:
      '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M10 13H8"/><path d="M16 17H8"/><path d="M16 13h-2"/>',
    hash: '<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
    settings:
      '<circle cx="12" cy="12" r="3"/><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>',
    image:
      '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
    globe:
      '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
    box: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/>',
  } as const;

  private static readonly EXT: Record<
    string,
    [keyof typeof FilesSidebarSurface.P, string]
  > = {
    ts: ["fileCode", "#3178C6"],
    tsx: ["fileCode", "#3178C6"],
    js: ["fileCode", "#CBCB41"],
    jsx: ["fileCode", "#CBCB41"],
    mjs: ["fileCode", "#CBCB41"],
    cjs: ["fileCode", "#CBCB41"],
    json: ["fileJson", "#CBCB41"],
    css: ["hash", "#519ABA"],
    scss: ["hash", "#F55385"],
    less: ["hash", "#563D7C"],
    html: ["globe", "#E44D26"],
    htm: ["globe", "#E44D26"],
    svg: ["image", "#F7B93E"],
    png: ["image", "#A074C4"],
    jpg: ["image", "#A074C4"],
    jpeg: ["image", "#A074C4"],
    gif: ["image", "#A074C4"],
    ico: ["image", "#A074C4"],
    md: ["fileText", "#519ABA"],
    txt: ["fileText", "#8ca0bb"],
    yaml: ["settings", "#CB171E"],
    yml: ["settings", "#CB171E"],
    toml: ["settings", "#6D8086"],
    env: ["settings", "#ECD53F"],
    sh: ["fileCode", "#4EAA25"],
    py: ["fileCode", "#3572A5"],
  };

  private static readonly NAMES: Record<
    string,
    [keyof typeof FilesSidebarSurface.P, string]
  > = {
    "package.json": ["box", "#E8274B"],
    "package-lock.json": ["box", "#E8274B"],
    "tsconfig.json": ["settings", "#3178C6"],
    "tsconfig.node.json": ["settings", "#3178C6"],
    ".gitignore": ["settings", "#F05032"],
    ".eslintrc.json": ["settings", "#4B32C3"],
    ".prettierrc": ["settings", "#F7B93E"],
    "vite.config.ts": ["settings", "#646CFF"],
    "vite.config.js": ["settings", "#646CFF"],
    "next.config.js": ["settings", "#e6edf7"],
    "next.config.mjs": ["settings", "#e6edf7"],
    "tailwind.config.js": ["settings", "#38BDF8"],
    "tailwind.config.ts": ["settings", "#38BDF8"],
    "postcss.config.js": ["settings", "#DD3A0A"],
  };

  constructor(
    private readonly vfs: VirtualFS,
    private readonly workspaceRoot: string,
    private readonly openFile: (path: string) => void,
    private readonly openFileAsText?: (path: string) => void,
  ) {
    this.root.id = "webideFilesTree";
    this.root.className = "almostnode-files-tree";
    this.directoryOpenState.set(this.workspaceRoot, true);

    this.vfs.on("change", this.changeListener);
    this.vfs.on("delete", this.deleteListener);
    this.render();

    // Right-click on empty space in tree root
    this.root.addEventListener("contextmenu", (e) => {
      // Only handle clicks on the root itself, not on items within it
      if (e.target === this.root) {
        e.preventDefault();
        this.showContextMenu(e.clientX, e.clientY, [
          {
            label: "New File",
            action: () => this.startInlineInput(this.workspaceRoot, "file"),
          },
          {
            label: "New Folder",
            action: () => this.startInlineInput(this.workspaceRoot, "folder"),
          },
        ]);
      }
    });

    // Root tree as drop target (move to workspace root)
    this.root.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer!.dropEffect = "move";
      this.root.classList.add("is-drag-over");
    });
    this.root.addEventListener("dragleave", (e) => {
      if (e.relatedTarget && this.root.contains(e.relatedTarget as Node))
        return;
      this.root.classList.remove("is-drag-over");
    });
    this.root.addEventListener("drop", (e) => {
      e.preventDefault();
      this.root.classList.remove("is-drag-over");
      this.clearAutoExpand();
      const sourcePath = e.dataTransfer?.getData("text/plain");
      if (!sourcePath || !this.canMoveTo(sourcePath, this.workspaceRoot))
        return;
      const newPath = this.joinPath(
        this.workspaceRoot,
        this.nameOf(sourcePath),
      );
      this.vfs.renameSync(sourcePath, newPath);
      if (this.selectedPath === sourcePath) this.selectedPath = newPath;
      this.scheduleRefresh();
    });

    // Dismiss context menu on click outside or Escape
    document.addEventListener("click", () => this.dismissContextMenu());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") this.dismissContextMenu();
    });
  }

  attach(container: HTMLElement): IDisposable {
    return mountStaticSlotSurface(container, FILES_VIEW_ID, this.model);
  }

  private render(): void {
    try {
      this.root.replaceChildren(this.renderDirectory(this.workspaceRoot, 0));
      this.renderedNodeModulesExists = this.vfs.existsSync(
        getWorkspaceNodeModulesPath(this.workspaceRoot),
      );
    } catch {
      const empty = document.createElement("div");
      empty.className = "almostnode-files-tree__empty";
      empty.textContent = "Waiting for the workspace tree...";
      this.root.replaceChildren(empty);
      this.renderedNodeModulesExists = false;
    }
  }

  private scheduleRefresh(): void {
    if (this.pendingRefresh) {
      return;
    }

    this.pendingRefresh = scheduleUiFrame(() => {
      this.pendingRefresh = null;
      this.render();
    });
  }

  private handleWorkspaceMutation(path: string): void {
    if (!isWorkspaceChangePath(path, this.workspaceRoot)) {
      return;
    }

    if (isNodeModulesChangePath(path, this.workspaceRoot)) {
      this.scheduleNodeModulesRefresh(path);
      return;
    }

    this.scheduleRefresh();
  }

  private scheduleNodeModulesRefresh(path: string): void {
    const nodeModulesPath = getWorkspaceNodeModulesPath(this.workspaceRoot);
    const normalizedPath = normalizeWorkbenchPath(path);
    const nodeModulesExists = this.vfs.existsSync(nodeModulesPath);
    const isNodeModulesRootChange = normalizedPath === nodeModulesPath;
    const isNodeModulesExpanded = this.isDirectoryOpen(nodeModulesPath, 1);
    const shouldRefresh =
      isNodeModulesRootChange ||
      nodeModulesExists !== this.renderedNodeModulesExists ||
      isNodeModulesExpanded;

    if (!shouldRefresh) {
      return;
    }

    if (this.pendingNodeModulesRefresh) {
      clearTimeout(this.pendingNodeModulesRefresh);
    }

    this.pendingNodeModulesRefresh = setTimeout(() => {
      this.pendingNodeModulesRefresh = null;
      this.scheduleRefresh();
    }, NODE_MODULES_REFRESH_DELAY_MS);
  }

  private svg(
    pathKey: keyof typeof FilesSidebarSurface.P,
    color: string,
    sw: number,
    ...cls: string[]
  ): SVGSVGElement {
    const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    el.setAttribute("viewBox", "0 0 24 24");
    el.setAttribute("width", "16");
    el.setAttribute("height", "16");
    el.setAttribute("fill", "none");
    el.setAttribute("stroke", color);
    el.setAttribute("stroke-width", String(sw));
    el.setAttribute("stroke-linecap", "round");
    el.setAttribute("stroke-linejoin", "round");
    for (const c of cls) el.classList.add(c);
    el.innerHTML = FilesSidebarSurface.P[pathKey];
    return el;
  }

  private folderSvg(
    pathKey: "folder" | "folderOpen",
    ...cls: string[]
  ): SVGSVGElement {
    const color = "#C09553";
    const el = this.svg(pathKey, color, 1.5, ...cls);
    el.setAttribute("fill", color);
    el.setAttribute("fill-opacity", "0.2");
    return el;
  }

  private fileIcon(name: string): SVGSVGElement {
    const match =
      FilesSidebarSurface.NAMES[name] ??
      FilesSidebarSurface.EXT[name.split(".").pop()?.toLowerCase() ?? ""];
    const [key, color] = match ?? (["file", "#8ca0bb"] as const);
    return this.svg(key, color, 1.5, "almostnode-files-tree__icon");
  }

  private getDefaultDirectoryOpen(path: string, depth: number): boolean {
    if (path === this.workspaceRoot) {
      return true;
    }

    if (path === getWorkspaceNodeModulesPath(this.workspaceRoot)) {
      return false;
    }

    return depth < 2;
  }

  private isDirectoryOpen(path: string, depth: number): boolean {
    return (
      this.directoryOpenState.get(path) ??
      this.getDefaultDirectoryOpen(path, depth)
    );
  }

  private populateDirectoryChildren(
    children: HTMLElement,
    path: string,
    depth: number,
  ): void {
    children.replaceChildren();

    const entries = this.vfs.readdirSync(path).sort((left, right) => {
      const leftPath = this.joinPath(path, left);
      const rightPath = this.joinPath(path, right);
      const leftIsDirectory = this.vfs.statSync(leftPath).isDirectory();
      const rightIsDirectory = this.vfs.statSync(rightPath).isDirectory();

      if (leftIsDirectory !== rightIsDirectory) {
        return leftIsDirectory ? -1 : 1;
      }

      return left.localeCompare(right);
    });

    for (const entry of entries) {
      if (entry === ".git") continue;
      const fullPath = this.joinPath(path, entry);
      const stats = this.vfs.statSync(fullPath);
      if (stats.isDirectory()) {
        children.appendChild(this.renderDirectory(fullPath, depth + 1));
        continue;
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "almostnode-files-tree__file";
      button.dataset.path = fullPath;
      if (fullPath === this.selectedPath) button.classList.add("is-selected");

      const icon = this.fileIcon(entry);
      const fileLabel = document.createElement("span");
      fileLabel.className = "almostnode-files-tree__label";
      fileLabel.textContent = entry;

      button.append(icon, fileLabel);
      button.setAttribute("draggable", "true");
      button.addEventListener("dragstart", (e) => {
        e.dataTransfer!.setData("text/plain", fullPath);
        e.dataTransfer!.effectAllowed = "move";
        button.classList.add("is-dragging");
      });
      button.addEventListener("dragend", () => {
        button.classList.remove("is-dragging");
      });
      button.addEventListener("click", () => {
        this.selectedPath = fullPath;
        this.root
          .querySelectorAll(".is-selected")
          .forEach((el) => el.classList.remove("is-selected"));
        button.classList.add("is-selected");
        this.openFile(fullPath);
      });

      button.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        const menuItems: Array<
          { label: string; action: () => void } | "separator"
        > = [];
        const lowerEntry = entry.toLowerCase();
        if (
          this.openFileAsText &&
          (lowerEntry.endsWith(".md") || lowerEntry.endsWith(".json"))
        ) {
          menuItems.push({
            label: "Open as Text",
            action: () => this.openFileAsText!(fullPath),
          });
          menuItems.push("separator");
        }
        menuItems.push(
          {
            label: "Rename",
            action: () => this.startInlineInput(path, "file", fullPath),
          },
          {
            label: "Delete",
            action: () => {
              try {
                this.vfs.unlinkSync(fullPath);
              } catch {
                /* ignore */
              }
            },
          },
          "separator",
          { label: "Download", action: () => this.downloadFile(fullPath) },
        );
        this.showContextMenu(e.clientX, e.clientY, menuItems);
      });

      children.appendChild(button);
    }
  }

  private renderDirectory(path: string, depth: number): HTMLElement {
    const details = document.createElement("details");
    details.className = "almostnode-files-tree__directory";
    details.dataset.path = path;
    details.open = this.isDirectoryOpen(path, depth);

    const summary = document.createElement("summary");
    summary.className = "almostnode-files-tree__summary";

    const chevron = this.svg(
      "chevron",
      "#8ca0bb",
      2,
      "almostnode-files-tree__chevron",
    );
    const closed = this.folderSvg(
      "folder",
      "almostnode-files-tree__icon",
      "almostnode-files-tree__icon--closed",
    );
    const open = this.folderSvg(
      "folderOpen",
      "almostnode-files-tree__icon",
      "almostnode-files-tree__icon--open",
    );

    const label = document.createElement("span");
    label.className = "almostnode-files-tree__label";
    label.textContent =
      path === this.workspaceRoot ? "project" : this.nameOf(path);

    summary.append(chevron, closed, open, label);
    details.appendChild(summary);

    // Drag source (skip workspace root)
    if (path !== this.workspaceRoot) {
      summary.setAttribute("draggable", "true");
      summary.addEventListener("dragstart", (e) => {
        e.dataTransfer!.setData("text/plain", path);
        e.dataTransfer!.effectAllowed = "move";
        details.classList.add("is-dragging");
      });
      summary.addEventListener("dragend", () => {
        details.classList.remove("is-dragging");
      });
    }

    // Drop target on folder summary
    summary.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer!.dropEffect = "move";
      summary.classList.add("is-drag-over");
      // Auto-expand closed folder after 600ms
      if (!details.open && !this.autoExpandTimer) {
        this.autoExpandTimer = setTimeout(() => {
          details.open = true;
          this.autoExpandTimer = null;
        }, 600);
      }
    });
    summary.addEventListener("dragleave", (e) => {
      if (e.relatedTarget && summary.contains(e.relatedTarget as Node)) return;
      summary.classList.remove("is-drag-over");
      this.clearAutoExpand();
    });
    summary.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      summary.classList.remove("is-drag-over");
      this.clearAutoExpand();
      const sourcePath = e.dataTransfer?.getData("text/plain");
      if (!sourcePath || !this.canMoveTo(sourcePath, path)) return;
      const newPath = this.joinPath(path, this.nameOf(sourcePath));
      this.vfs.renameSync(sourcePath, newPath);
      if (this.selectedPath === sourcePath) this.selectedPath = newPath;
      this.scheduleRefresh();
    });

    // Context menu on folder summary
    summary.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const menuItems: Array<
        { label: string; action: () => void } | "separator"
      > = [
        {
          label: "New File",
          action: () => this.startInlineInput(path, "file"),
        },
        {
          label: "New Folder",
          action: () => this.startInlineInput(path, "folder"),
        },
      ];
      // Don't allow rename/delete on workspace root
      if (path !== this.workspaceRoot) {
        menuItems.push(
          "separator",
          {
            label: "Rename",
            action: () => this.startInlineInput(path, "folder", path),
          },
          {
            label: "Delete",
            action: () => {
              if (
                confirm(
                  `Delete folder "${this.nameOf(path)}" and all its contents?`,
                )
              ) {
                try {
                  this.deleteRecursive(path);
                } catch {
                  /* ignore */
                }
              }
            },
          },
        );
      }
      menuItems.push("separator", {
        label: "Download as ZIP",
        action: () => this.downloadFolder(path),
      });
      this.showContextMenu(e.clientX, e.clientY, menuItems);
    });

    const children = document.createElement("div");
    children.className = "almostnode-files-tree__children";
    const isLazyDirectory =
      path === getWorkspaceNodeModulesPath(this.workspaceRoot);
    if (!isLazyDirectory || details.open) {
      this.populateDirectoryChildren(children, path, depth);
    }

    details.addEventListener("toggle", () => {
      this.directoryOpenState.set(path, details.open);
      if (details.open && isLazyDirectory && children.childElementCount === 0) {
        this.populateDirectoryChildren(children, path, depth);
      }
    });

    details.appendChild(children);
    return details;
  }

  private showContextMenu(
    x: number,
    y: number,
    items: Array<{ label: string; action: () => void } | "separator">,
  ): void {
    this.dismissContextMenu();

    const menu = document.createElement("div");
    menu.className = "almostnode-files-tree__context-menu";
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;

    for (const item of items) {
      if (item === "separator") {
        const sep = document.createElement("div");
        sep.className = "almostnode-files-tree__context-separator";
        menu.appendChild(sep);
        continue;
      }
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "almostnode-files-tree__context-item";
      btn.textContent = item.label;
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.dismissContextMenu();
        item.action();
      });
      menu.appendChild(btn);
    }

    this.contextMenu = menu;
    document.body.appendChild(menu);

    // Adjust if menu goes off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth)
      menu.style.left = `${window.innerWidth - rect.width - 4}px`;
    if (rect.bottom > window.innerHeight)
      menu.style.top = `${window.innerHeight - rect.height - 4}px`;
  }

  private dismissContextMenu(): void {
    if (this.contextMenu) {
      this.contextMenu.remove();
      this.contextMenu = null;
    }
  }

  private startInlineInput(
    parentDir: string,
    type: "file" | "folder",
    renamePath?: string,
  ): void {
    // Find the children container for the parent directory
    const detailsEls = Array.from(
      this.root.querySelectorAll(".almostnode-files-tree__directory"),
    ) as HTMLDetailsElement[];
    let targetChildren: HTMLElement | null = null;

    if (parentDir === this.workspaceRoot) {
      // Root-level: the root itself is the top-level <details>
      const topDetails = this.root.querySelector(
        ".almostnode-files-tree__directory",
      ) as HTMLDetailsElement | null;
      if (topDetails) {
        topDetails.open = true;
        targetChildren = topDetails.querySelector(
          ":scope > .almostnode-files-tree__children",
        ) as HTMLElement | null;
      }
    } else {
      for (let i = 0; i < detailsEls.length; i++) {
        const d = detailsEls[i];
        if (d.dataset.path === parentDir) {
          d.open = true;
          targetChildren = d.querySelector(
            ":scope > .almostnode-files-tree__children",
          ) as HTMLElement | null;
          break;
        }
      }
    }

    if (renamePath) {
      // Rename: find the element and swap label with input
      this.startRenameInput(renamePath);
      return;
    }

    if (!targetChildren) return;

    // Create inline input row
    const row = document.createElement("div");
    row.className = "almostnode-files-tree__file";
    row.style.paddingLeft = type === "folder" ? "0.45rem" : "";

    const icon =
      type === "folder"
        ? this.folderSvg("folder", "almostnode-files-tree__icon")
        : this.svg("file", "#8ca0bb", 1.5, "almostnode-files-tree__icon");

    const input = document.createElement("input");
    input.type = "text";
    input.className = "almostnode-files-tree__inline-input";
    input.placeholder = type === "file" ? "filename" : "folder name";

    row.append(icon, input);
    targetChildren.insertBefore(row, targetChildren.firstChild);

    input.focus();

    const commit = () => {
      const name = input.value.trim();
      row.remove();
      if (!name) return;
      const fullPath = this.joinPath(parentDir, name);
      try {
        if (type === "folder") {
          this.vfs.mkdirSync(fullPath);
        } else {
          this.vfs.writeFileSync(fullPath, "");
          this.openFile(fullPath);
        }
      } catch {
        // Name conflict or invalid — silently ignore, tree stays as-is
      }
    };

    let committed = false;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        committed = true;
        commit();
      } else if (e.key === "Escape") {
        committed = true;
        row.remove();
      }
    });
    input.addEventListener("blur", () => {
      if (!committed) commit();
    });
  }

  private startRenameInput(filePath: string): void {
    const isDir = (() => {
      try {
        return this.vfs.statSync(filePath).isDirectory();
      } catch {
        return false;
      }
    })();
    const name = this.nameOf(filePath);
    const parentDir =
      filePath.substring(0, filePath.length - name.length - 1) || "/";

    // Find the element in the tree by data-path
    let targetEl: HTMLElement | null = null;

    if (isDir) {
      const allDetails = Array.from(
        this.root.querySelectorAll(".almostnode-files-tree__directory"),
      ) as HTMLElement[];
      for (let i = 0; i < allDetails.length; i++) {
        if (allDetails[i].dataset.path === filePath) {
          targetEl = allDetails[i].querySelector(
            ":scope > .almostnode-files-tree__summary",
          ) as HTMLElement | null;
          break;
        }
      }
    } else {
      const allFiles = Array.from(
        this.root.querySelectorAll(".almostnode-files-tree__file"),
      ) as HTMLElement[];
      for (let i = 0; i < allFiles.length; i++) {
        if (allFiles[i].dataset.path === filePath) {
          targetEl = allFiles[i];
          break;
        }
      }
    }

    if (!targetEl) return;

    const labelEl = targetEl.querySelector(
      ".almostnode-files-tree__label",
    ) as HTMLElement | null;
    if (!labelEl) return;

    const input = document.createElement("input");
    input.type = "text";
    input.className = "almostnode-files-tree__inline-input";
    input.value = name;

    labelEl.replaceWith(input);
    input.focus();
    // Select the name part before the extension for files
    if (!isDir) {
      const dotIndex = name.lastIndexOf(".");
      input.setSelectionRange(0, dotIndex > 0 ? dotIndex : name.length);
    } else {
      input.select();
    }

    const commit = () => {
      const newName = input.value.trim();
      if (!newName || newName === name) {
        this.scheduleRefresh();
        return;
      }
      const newPath = this.joinPath(parentDir, newName);
      try {
        this.vfs.renameSync(filePath, newPath);
        if (this.selectedPath === filePath) {
          this.selectedPath = newPath;
        }
      } catch {
        this.scheduleRefresh();
      }
    };

    let committed = false;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        committed = true;
        commit();
      } else if (e.key === "Escape") {
        committed = true;
        this.scheduleRefresh();
      }
    });
    input.addEventListener("blur", () => {
      if (!committed) commit();
    });
  }

  private deleteRecursive(path: string): void {
    const stat = this.vfs.statSync(path);
    if (stat.isDirectory()) {
      const entries = this.vfs.readdirSync(path);
      for (const entry of entries) {
        this.deleteRecursive(this.joinPath(path, entry));
      }
      this.vfs.rmdirSync(path);
    } else {
      this.vfs.unlinkSync(path);
    }
  }

  private downloadFile(filePath: string): void {
    try {
      const data = this.vfs.readFileSync(filePath);
      const blob = new Blob([typeof data === "string" ? data : data], {
        type: "application/octet-stream",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = this.nameOf(filePath);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }

  private downloadFolder(folderPath: string): void {
    try {
      const files: Record<string, Uint8Array> = {};
      const prefix = folderPath.endsWith("/") ? folderPath : folderPath + "/";
      const collect = (dir: string): void => {
        const entries = this.vfs.readdirSync(dir);
        for (const entry of entries) {
          const full = this.joinPath(dir, entry);
          const stat = this.vfs.statSync(full);
          if (stat.isDirectory()) {
            collect(full);
          } else {
            const relative = full.startsWith(prefix)
              ? full.slice(prefix.length)
              : full;
            const data = this.vfs.readFileSync(full);
            files[relative] =
              typeof data === "string"
                ? strToU8(data)
                : new Uint8Array(data as ArrayBuffer);
          }
        }
      };
      collect(folderPath);
      const zipped = zipSync(files);
      const blob = new Blob([zipped], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = this.nameOf(folderPath) + ".zip";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      /* ignore */
    }
  }

  private canMoveTo(sourcePath: string, targetDir: string): boolean {
    const basename = this.nameOf(sourcePath);
    const currentParent =
      sourcePath.substring(0, sourcePath.length - basename.length - 1) || "/";
    // Same parent — no-op
    if (currentParent === targetDir) return false;
    // Can't move folder into itself or descendant
    if (targetDir.startsWith(sourcePath + "/") || targetDir === sourcePath)
      return false;
    // Name conflict
    const newPath = this.joinPath(targetDir, basename);
    try {
      if (this.vfs.statSync(newPath)) return false;
    } catch {
      /* doesn't exist — good */
    }
    return true;
  }

  private clearAutoExpand(): void {
    if (this.autoExpandTimer) {
      clearTimeout(this.autoExpandTimer);
      this.autoExpandTimer = null;
    }
  }

  private joinPath(parent: string, child: string): string {
    return parent === "/" ? `/${child}` : `${parent}/${child}`;
  }

  private nameOf(path: string): string {
    return path.split("/").filter(Boolean).pop() || path;
  }
}

export class PreviewSurface {
  private readonly root = document.createElement("div");
  readonly model: SurfaceModel<SlotSurfaceState, SlotSurfaceActions> =
    createStaticSurfaceModel(
      { slot: createDomSlot(this.root) },
      {
        focus: () => this.focus(),
      },
    );
  private readonly toolbar = document.createElement("div");
  private readonly status = document.createElement("div");
  private readonly actions = document.createElement("div");
  private readonly runButton = document.createElement("button");
  private readonly refreshButton = document.createElement("button");
  private readonly selectButton = document.createElement("button");
  private readonly devtoolsButton = document.createElement("button");
  private readonly body = document.createElement("div");
  private readonly emptyState = document.createElement("div");
  private readonly iframe = document.createElement("iframe");
  private currentUrl: string | null = null;
  private activeDbName: string | null = null;
  private erudaVisible = false;

  constructor(commands: PreviewSurfaceCommands) {
    this.root.className = "almostnode-preview-surface";
    this.root.tabIndex = -1;

    this.toolbar.className = "almostnode-preview-surface__toolbar";

    this.status.className = "almostnode-preview-surface__status";
    this.status.id = "webidePreviewStatus";
    this.status.textContent = "Waiting for a preview server";

    this.actions.className = "almostnode-preview-surface__actions";

    this.runButton.type = "button";
    this.runButton.className = "almostnode-preview-surface__button";
    this.runButton.textContent = "Run";
    this.runButton.addEventListener("click", () => {
      commands.run();
    });

    this.refreshButton.type = "button";
    this.refreshButton.className = "almostnode-preview-surface__button";
    this.refreshButton.textContent = "Refresh";
    this.refreshButton.addEventListener("click", () => {
      commands.refresh();
    });

    this.selectButton.type = "button";
    this.selectButton.className = "almostnode-preview-surface__button";
    this.selectButton.textContent = "Select";
    this.selectButton.addEventListener("click", () => {
      commands.toggleSelect();
    });

    this.devtoolsButton.type = "button";
    this.devtoolsButton.className = "almostnode-preview-surface__button";
    this.devtoolsButton.textContent = "DevTools";
    this.devtoolsButton.addEventListener("click", () => {
      this.toggleDevtools();
    });

    this.actions.append(
      this.runButton,
      this.refreshButton,
      this.selectButton,
      this.devtoolsButton,
    );
    this.toolbar.append(this.status, this.actions);

    this.body.className = "almostnode-preview-surface__body";

    this.emptyState.className = "almostnode-preview-surface__empty";
    this.emptyState.textContent =
      "Run the workspace to start a preview server.";
    this.emptyState.style.display = "grid";

    this.iframe.id = "webidePreview";
    this.iframe.className = "almostnode-preview-surface__frame";
    this.iframe.title = "Preview";
    this.iframe.hidden = true;
    this.iframe.style.display = "none";

    this.body.append(this.emptyState, this.iframe);
    this.root.append(this.toolbar, this.body);
  }

  attach(container: HTMLElement): IDisposable {
    return mountStaticSlotSurface(container, PREVIEW_EDITOR_TYPE_ID, this.model);
  }

  setStatus(text: string): void {
    this.status.textContent = text;
    if (!this.currentUrl) {
      this.emptyState.textContent = text;
    }
  }

  setUrl(url: string): void {
    this.currentUrl = url;
    const displayUrl = this.activeDbName
      ? `${url}?db=${this.activeDbName}`
      : url;
    this.status.textContent = displayUrl;
    this.emptyState.hidden = true;
    this.emptyState.style.display = "none";
    this.iframe.hidden = false;
    this.iframe.style.display = "block";
    this.iframe.src = displayUrl;
  }

  setActiveDb(name: string | null): void {
    this.activeDbName = name;
    if (this.currentUrl) {
      const displayUrl = name
        ? `${this.currentUrl}?db=${name}`
        : this.currentUrl;
      this.status.textContent = displayUrl;
      this.iframe.src = displayUrl;
    }
  }

  clear(text: string): void {
    this.currentUrl = null;
    this.status.textContent = text;
    this.emptyState.textContent = text;
    this.emptyState.hidden = false;
    this.emptyState.style.display = "grid";
    this.iframe.hidden = true;
    this.iframe.style.display = "none";
    this.iframe.removeAttribute("src");
  }

  reload(): void {
    if (!this.currentUrl) {
      return;
    }

    const url = this.activeDbName
      ? `${this.currentUrl}?db=${this.activeDbName}`
      : this.currentUrl;
    this.iframe.src = url;
  }

  focus(): void {
    if (!this.iframe.hidden) {
      this.iframe.focus();
      return;
    }

    this.root.focus();
  }

  toggleDevtools(): void {
    if (!this.iframe.contentWindow) return;
    this.erudaVisible = !this.erudaVisible;
    this.devtoolsButton.classList.toggle("is-active", this.erudaVisible);
    this.iframe.contentWindow.postMessage(
      {
        type: "almostnode-devtools",
        action: this.erudaVisible ? "show" : "hide",
      },
      "*",
    );
  }

  getIframe(): HTMLIFrameElement {
    return this.iframe;
  }

  setSelectActive(active: boolean): void {
    this.selectButton.classList.toggle("is-active", active);
    this.selectButton.setAttribute("aria-pressed", active ? "true" : "false");
  }

  getBody(): HTMLDivElement {
    return this.body;
  }
}

export class ConsolePanelElement {
  readonly root = document.createElement("div");
  private readonly toolbar = document.createElement("div");
  private readonly clearButton = document.createElement("button");
  private readonly entries = document.createElement("div");
  private entryCount = 0;
  private static readonly MAX_ENTRIES = 1000;

  constructor() {
    this.root.className = "almostnode-console-panel";

    this.toolbar.className = "almostnode-console-panel__toolbar";

    this.clearButton.type = "button";
    this.clearButton.className = "almostnode-console-panel__clear";
    this.clearButton.textContent = "Clear";
    this.clearButton.addEventListener("click", () => this.clear());

    this.toolbar.appendChild(this.clearButton);

    this.entries.className = "almostnode-console-panel__entries";

    this.root.append(this.toolbar, this.entries);
  }

  addEntry(level: string, args: string[], timestamp: number): void {
    // Evict oldest if at capacity
    while (this.entryCount >= ConsolePanelElement.MAX_ENTRIES) {
      const first = this.entries.firstChild;
      if (!first) break;
      this.entries.removeChild(first);
      this.entryCount--;
    }

    const row = document.createElement("div");
    row.className = `almostnode-console-entry almostnode-console-entry--${level}`;

    const badge = document.createElement("span");
    badge.className = "almostnode-console-entry__level";
    badge.textContent = level;

    const time = document.createElement("span");
    time.className = "almostnode-console-entry__time";
    const d = new Date(timestamp);
    time.textContent = `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;

    const msg = document.createElement("span");
    msg.className = "almostnode-console-entry__message";
    msg.textContent = args.join(" ");

    row.append(badge, time, msg);
    this.entries.appendChild(row);
    this.entryCount++;

    // Auto-scroll to bottom
    this.entries.scrollTop = this.entries.scrollHeight;
  }

  clear(): void {
    this.entries.innerHTML = "";
    this.entryCount = 0;
  }
}

export class TerminalPanelSurface {
  private readonly root = document.createElement("div");
  readonly model: SurfaceModel<SlotSurfaceState, SlotSurfaceActions> =
    createStaticSurfaceModel(
      { slot: createDomSlot(this.root, {
        onAttach: () => this.handleSlotAttach(),
      }) },
      {
        focus: () => this.focus(),
      },
    );
  private readonly statusRow = document.createElement("div");
  private readonly tabs = document.createElement("div");
  private readonly status = document.createElement("div");
  private readonly actions = document.createElement("div");
  private readonly newTabButton = document.createElement("button");
  private readonly body = document.createElement("div");
  private readonly resizeObserver: ResizeObserver;
  private opened = false;
  private activeTabId: string | null = null;
  private readonly tabButtons = new Map<string, HTMLButtonElement>();
  private readonly tabBodies = new Map<string, HTMLDivElement>();
  private readonly tabStatuses = new Map<string, string>();
  private readonly terminals = new Map<
    string,
    { terminal: Terminal; fitAddon: FitAddon }
  >();
  private readonly customTabs = new Set<string>();

  constructor(
    private readonly callbacks: {
      onCreateTab: () => void;
      onCloseTab: (id: string) => void;
      onSelectTab: (id: string) => void;
      onResize?: (id: string, cols: number, rows: number) => void;
    },
  ) {
    this.root.className = "almostnode-terminal-surface";
    this.statusRow.className = "almostnode-terminal-surface__status-row";
    this.tabs.className = "almostnode-terminal-surface__tabs";
    this.actions.className = "almostnode-terminal-surface__actions";

    this.status.className = "almostnode-terminal-surface__status";
    this.status.id = "webideTerminalStatus";
    this.status.textContent = "Idle";

    this.newTabButton.type = "button";
    this.newTabButton.className = "almostnode-terminal-surface__new-tab";
    this.newTabButton.textContent = "+";
    this.newTabButton.setAttribute("aria-label", "New terminal");
    this.newTabButton.addEventListener("click", () => {
      this.callbacks.onCreateTab();
    });

    this.body.className = "almostnode-terminal-surface__body";

    this.actions.append(this.newTabButton);
    this.statusRow.append(this.tabs, this.status, this.actions);
    this.root.append(this.statusRow, this.body);

    this.resizeObserver = new ResizeObserver(() => {
      this.fit();
    });
    this.resizeObserver.observe(this.root);
    this.resizeObserver.observe(this.body);
  }

  private handleSlotAttach(): void {
    if (!this.opened) {
      for (const [tabId, { terminal }] of this.terminals.entries()) {
        const body = this.tabBodies.get(tabId);
        if (body) {
          terminal.open(body);
        }
      }
      this.opened = true;
    }

    this.fit();
    queueTerminalFit(() => this.fit());
  }

  attach(container: HTMLElement): IDisposable {
    const mount = mountStaticSlotSurface(container, TERMINAL_VIEW_ID, this.model);
    return {
      dispose: () => {
        mount.dispose();
      },
    };
  }

  updateStatus(text: string): void {
    if (!this.activeTabId) {
      this.status.textContent = text;
      return;
    }
    this.updateTabStatus(this.activeTabId, text);
  }

  focus(): void {
    const active = this.activeTabId
      ? this.terminals.get(this.activeTabId)
      : null;
    active?.terminal.focus();
  }

  addTab(tab: {
    id: string;
    title: string;
    terminal: Terminal;
    fitAddon: FitAddon;
    closable: boolean;
  }): void {
    if (this.tabButtons.has(tab.id)) {
      this.updateTabTitle(tab.id, tab.title);
      return;
    }

    tab.terminal.loadAddon(tab.fitAddon);
    this.terminals.set(tab.id, {
      terminal: tab.terminal,
      fitAddon: tab.fitAddon,
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "almostnode-terminal-surface__tab";
    button.dataset.terminalId = tab.id;
    button.addEventListener("click", () => {
      this.callbacks.onSelectTab(tab.id);
    });

    const label = document.createElement("span");
    label.className = "almostnode-terminal-surface__tab-label";
    label.textContent = tab.title;
    button.appendChild(label);

    if (tab.closable) {
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "almostnode-terminal-surface__tab-close";
      closeButton.textContent = "x";
      closeButton.setAttribute("aria-label", `Close ${tab.title}`);
      closeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.callbacks.onCloseTab(tab.id);
      });
      button.appendChild(closeButton);
    }

    const body = document.createElement("div");
    body.className = "almostnode-terminal-surface__terminal";
    body.dataset.terminalId = tab.id;
    body.hidden = true;
    body.style.display = "none";

    this.tabButtons.set(tab.id, button);
    this.tabBodies.set(tab.id, body);
    this.tabStatuses.set(tab.id, "Idle");
    this.tabs.appendChild(button);
    this.body.appendChild(body);

    if (this.opened) {
      tab.terminal.open(body);
    }

    queueTerminalFit(() => this.fit());
  }

  addCustomTab(tab: {
    id: string;
    title: string;
    element: HTMLElement;
    closable: boolean;
  }): void {
    if (this.tabButtons.has(tab.id)) return;

    this.customTabs.add(tab.id);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "almostnode-terminal-surface__tab";
    button.dataset.terminalId = tab.id;
    button.addEventListener("click", () => {
      this.callbacks.onSelectTab(tab.id);
    });

    const label = document.createElement("span");
    label.className = "almostnode-terminal-surface__tab-label";
    label.textContent = tab.title;
    button.appendChild(label);

    if (tab.closable) {
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "almostnode-terminal-surface__tab-close";
      closeButton.textContent = "x";
      closeButton.setAttribute("aria-label", `Close ${tab.title}`);
      closeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.callbacks.onCloseTab(tab.id);
      });
      button.appendChild(closeButton);
    }

    const body = document.createElement("div");
    body.className = "almostnode-terminal-surface__terminal";
    body.dataset.terminalId = tab.id;
    body.hidden = true;
    body.style.display = "none";
    body.appendChild(tab.element);

    this.tabButtons.set(tab.id, button);
    this.tabBodies.set(tab.id, body);
    this.tabStatuses.set(tab.id, "");
    this.tabs.appendChild(button);
    this.body.appendChild(body);
  }

  removeTab(id: string): void {
    this.tabButtons.get(id)?.remove();
    this.tabBodies.get(id)?.remove();
    this.tabButtons.delete(id);
    this.tabBodies.delete(id);
    this.tabStatuses.delete(id);
    this.terminals.delete(id);
    this.customTabs.delete(id);

    if (this.activeTabId === id) {
      this.activeTabId = null;
      this.status.textContent = "Idle";
    }
  }

  updateTabTitle(id: string, title: string): void {
    const button = this.tabButtons.get(id);
    const label = button?.querySelector(
      ".almostnode-terminal-surface__tab-label",
    );
    if (label) {
      label.textContent = title;
    }
  }

  updateTabStatus(id: string, text: string): void {
    this.tabStatuses.set(id, text);
    if (this.activeTabId === id) {
      this.status.textContent = text;
    }
  }

  setActiveTab(id: string): void {
    this.activeTabId = id;
    for (const [tabId, button] of this.tabButtons.entries()) {
      button.classList.toggle("is-active", tabId === id);
    }
    for (const [tabId, body] of this.tabBodies.entries()) {
      const isActive = tabId === id;
      body.hidden = !isActive;
      body.style.display = isActive ? "" : "none";
      // Only assign webideTerminal id to non-custom tabs
      if (!this.customTabs.has(tabId)) {
        if (isActive) {
          body.id = "webideTerminal";
        } else if (body.id === "webideTerminal") {
          body.removeAttribute("id");
        }
      }
    }
    this.status.textContent = this.tabStatuses.get(id) || "Idle";
    this.fit();
    queueTerminalFit(() => this.fit());
  }

  private fit(): void {
    if (!this.opened || !this.activeTabId) {
      return;
    }
    // Skip terminal-specific fit for custom tabs
    if (this.customTabs.has(this.activeTabId)) {
      return;
    }
    const activeBody = this.tabBodies.get(this.activeTabId);
    const activeTerminal = this.terminals.get(this.activeTabId);
    if (!activeBody || !activeTerminal) {
      return;
    }
    if (activeBody.clientWidth === 0 || activeBody.clientHeight === 0) {
      return;
    }

    activeTerminal.fitAddon.fit();
    this.callbacks.onResize?.(
      this.activeTabId,
      activeTerminal.terminal.cols,
      activeTerminal.terminal.rows,
    );
    activeTerminal.terminal.scrollToBottom();
  }
}

export type AgentLaunchKind = "opencode" | "terminal" | "claude";

export class OpenCodeTerminalSurface {
  private readonly root = document.createElement("div");
  readonly model: SurfaceModel<SlotSurfaceState, SlotSurfaceActions> =
    createStaticSurfaceModel(
      { slot: createDomSlot(this.root, {
        onAttach: () => this.handleSlotAttach(),
      }) },
      {
        focus: () => this.focus(),
      },
    );
  private readonly statusRow = document.createElement("div");
  private readonly tabs = document.createElement("div");
  private readonly launcher = document.createElement("div");
  private readonly splitButton = document.createElement("div");
  private readonly primaryLaunchButton = document.createElement("button");
  private readonly dropdownLaunchButton = document.createElement("button");
  private readonly body = document.createElement("div");
  private readonly loading = document.createElement("div");
  private readonly resizeObserver: ResizeObserver;
  private opened = false;
  private activeTabId: string | null = null;
  private readonly tabButtons = new Map<string, HTMLButtonElement>();
  private readonly tabBodies = new Map<string, HTMLDivElement>();
  private readonly tabStatuses = new Map<string, string>();
  private readonly terminals = new Map<
    string,
    { terminal: Terminal; fitAddon: FitAddon }
  >();
  private readonly customTabs = new Set<string>();
  private readonly customHosts = new Map<string, HTMLElement>();
  private menu: HTMLDivElement | null = null;
  private claudeAvailable = false;

  constructor(
    private readonly callbacks: {
      onLaunch: (kind: AgentLaunchKind) => void;
      onCloseTab?: (id: string) => void;
      onSelectTab?: (id: string) => void;
      onResize?: (id: string, cols: number, rows: number) => void;
    },
  ) {
    this.root.className = "almostnode-opencode-surface";
    this.statusRow.className = "almostnode-opencode-surface__status-row";
    this.tabs.className = "almostnode-opencode-surface__tabs";
    this.launcher.className = "almostnode-opencode-surface__launcher";
    this.splitButton.className = "almostnode-opencode-surface__split-button";

    this.primaryLaunchButton.type = "button";
    this.primaryLaunchButton.className =
      "almostnode-opencode-surface__launcher-primary";
    this.primaryLaunchButton.innerHTML =
      '<span class="almostnode-opencode-surface__launcher-plus" aria-hidden="true">+</span>' +
      '<span class="almostnode-opencode-surface__launcher-label">New Chat</span>';
    this.primaryLaunchButton.setAttribute(
      "aria-label",
      "Start a new OpenCode session",
    );
    this.primaryLaunchButton.addEventListener("click", () => {
      this.callbacks.onLaunch("opencode");
    });

    this.dropdownLaunchButton.type = "button";
    this.dropdownLaunchButton.className =
      "almostnode-opencode-surface__launcher-toggle";
    this.dropdownLaunchButton.setAttribute("aria-label", "Choose chat type");
    this.dropdownLaunchButton.setAttribute("aria-haspopup", "menu");
    this.dropdownLaunchButton.setAttribute("aria-expanded", "false");
    this.dropdownLaunchButton.innerHTML =
      '<span aria-hidden="true">▾</span>';
    this.dropdownLaunchButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (this.menu) {
        this.dismissMenu();
        return;
      }
      this.showMenu();
    });

    this.splitButton.append(
      this.primaryLaunchButton,
      this.dropdownLaunchButton,
    );
    this.launcher.append(this.splitButton);

    this.body.className = "almostnode-opencode-surface__body";
    this.loading.className = "almostnode-opencode-surface__loading";
    this.loading.innerHTML =
      '<div class="almostnode-opencode-surface__loading-content">' +
      '<div class="almostnode-opencode-surface__loading-icon">✦</div>' +
      '<div class="almostnode-opencode-surface__loading-text">Starting OpenCode...</div>' +
      "</div>";
    this.loading.hidden = true;
    this.loading.style.display = "none";

    this.statusRow.append(this.launcher, this.tabs);
    this.root.append(this.statusRow, this.body, this.loading);

    this.resizeObserver = new ResizeObserver(() => {
      this.fit();
    });
    this.resizeObserver.observe(this.root);
    this.resizeObserver.observe(this.body);

    document.addEventListener("click", this.handleDocumentClick);
    document.addEventListener("keydown", this.handleDocumentKeydown);
  }

  private handleSlotAttach(): void {
    if (!this.opened) {
      for (const [tabId, { terminal }] of this.terminals.entries()) {
        const body = this.tabBodies.get(tabId);
        if (body) {
          terminal.open(body);
        }
      }
      this.opened = true;
    }

    this.fit();
    queueTerminalFit(() => this.fit());
  }

  attach(container: HTMLElement): IDisposable {
    const mount = mountStaticSlotSurface(container, OPEN_CODE_VIEW_ID, this.model);
    return {
      dispose: () => {
        this.dismissMenu();
        mount.dispose();
      },
    };
  }

  focus(): void {
    const active = this.activeTabId
      ? this.terminals.get(this.activeTabId)
      : null;
    if (active) {
      active.terminal.focus();
      return;
    }

    this.activeTabId && this.customHosts.get(this.activeTabId)?.focus();
    if (!this.activeTabId) {
      this.primaryLaunchButton.focus();
    }
  }

  setClaudeAvailable(available: boolean): void {
    this.claudeAvailable = available;
    if (this.menu) {
      this.showMenu();
    }
  }

  showLoading(): void {
    this.loading.hidden = false;
    this.loading.style.display = "flex";
  }

  hideLoading(): void {
    this.loading.classList.add("is-hiding");
    const onEnd = () => {
      this.loading.removeEventListener("transitionend", onEnd);
      this.loading.hidden = true;
      this.loading.style.display = "none";
      this.loading.classList.remove("is-hiding");
    };
    this.loading.addEventListener("transitionend", onEnd);
    window.setTimeout(onEnd, 500);
  }

  updateStatus(text: string): void {
    if (!this.activeTabId) {
      return;
    }
    this.updateTabStatus(this.activeTabId, text);
  }

  private readonly handleDocumentClick = (event: MouseEvent): void => {
    const target = event.target;
    if (!(target instanceof Node) || !this.root.contains(target)) {
      this.dismissMenu();
    }
  };

  private readonly handleDocumentKeydown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") {
      this.dismissMenu();
    }
  };

  private getMenuItems(): Array<{
    kind: AgentLaunchKind;
    label: string;
    detail: string;
  }> {
    const items: Array<{
      kind: AgentLaunchKind;
      label: string;
      detail: string;
    }> = [
      {
        kind: "opencode",
        label: "OpenCode",
        detail: "Start OpenCode in this panel",
      },
      {
        kind: "terminal",
        label: "Empty Terminal",
        detail: "Open a terminal in this panel",
      },
    ];

    if (this.claudeAvailable) {
      items.push({
        kind: "claude",
        label: "Claude Code",
        detail: "Run Claude Code in this panel",
      });
    }

    return items;
  }

  private showMenu(): void {
    this.dismissMenu();

    const menu = document.createElement("div");
    menu.className = "almostnode-opencode-surface__menu";
    menu.setAttribute("role", "menu");

    for (const item of this.getMenuItems()) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "almostnode-opencode-surface__menu-item";
      button.setAttribute("role", "menuitem");
      button.innerHTML =
        `<span class="almostnode-opencode-surface__menu-label">${item.label}</span>` +
        `<span class="almostnode-opencode-surface__menu-detail">${item.detail}</span>`;
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        this.dismissMenu();
        this.callbacks.onLaunch(item.kind);
      });
      menu.appendChild(button);
    }

    this.menu = menu;
    this.dropdownLaunchButton.setAttribute("aria-expanded", "true");
    this.launcher.appendChild(menu);
  }

  private dismissMenu(): void {
    if (!this.menu) {
      return;
    }
    this.menu.remove();
    this.menu = null;
    this.dropdownLaunchButton.setAttribute("aria-expanded", "false");
  }

  addTab(tab: {
    id: string;
    title: string;
    terminal: Terminal;
    fitAddon: FitAddon;
    closable: boolean;
  }): void {
    if (this.tabButtons.has(tab.id)) {
      this.updateTabTitle(tab.id, tab.title);
      return;
    }

    tab.terminal.loadAddon(tab.fitAddon);
    this.terminals.set(tab.id, {
      terminal: tab.terminal,
      fitAddon: tab.fitAddon,
    });

    const button = document.createElement("button");
    button.type = "button";
    button.className = "almostnode-opencode-surface__tab";
    button.dataset.terminalId = tab.id;
    button.addEventListener("click", () => {
      this.callbacks.onSelectTab?.(tab.id);
    });

    const label = document.createElement("span");
    label.className = "almostnode-opencode-surface__tab-label";
    label.textContent = tab.title;
    button.appendChild(label);

    if (tab.closable) {
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "almostnode-opencode-surface__tab-close";
      closeButton.textContent = "x";
      closeButton.setAttribute("aria-label", `Close ${tab.title}`);
      closeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.callbacks.onCloseTab?.(tab.id);
      });
      button.appendChild(closeButton);
    }

    const body = document.createElement("div");
    body.className = "almostnode-opencode-surface__terminal";
    body.dataset.terminalId = tab.id;
    body.hidden = true;
    body.style.display = "none";

    this.tabButtons.set(tab.id, button);
    this.tabBodies.set(tab.id, body);
    this.tabStatuses.set(tab.id, "Idle");
    this.tabs.appendChild(button);
    this.body.appendChild(body);

    if (this.opened) {
      tab.terminal.open(body);
    }

    queueTerminalFit(() => this.fit());
  }

  addCustomTab(tab: {
    id: string;
    title: string;
    element: HTMLElement;
    closable: boolean;
  }): void {
    if (this.tabButtons.has(tab.id)) {
      this.updateTabTitle(tab.id, tab.title);
      return;
    }

    this.customTabs.add(tab.id);
    this.customHosts.set(tab.id, tab.element);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "almostnode-opencode-surface__tab";
    button.dataset.terminalId = tab.id;
    button.addEventListener("click", () => {
      this.callbacks.onSelectTab?.(tab.id);
    });

    const label = document.createElement("span");
    label.className = "almostnode-opencode-surface__tab-label";
    label.textContent = tab.title;
    button.appendChild(label);

    if (tab.closable) {
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "almostnode-opencode-surface__tab-close";
      closeButton.textContent = "x";
      closeButton.setAttribute("aria-label", `Close ${tab.title}`);
      closeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        this.callbacks.onCloseTab?.(tab.id);
      });
      button.appendChild(closeButton);
    }

    const body = document.createElement("div");
    body.className = "almostnode-opencode-surface__terminal";
    body.dataset.terminalId = tab.id;
    body.hidden = true;
    body.style.display = "none";
    body.appendChild(tab.element);

    this.tabButtons.set(tab.id, button);
    this.tabBodies.set(tab.id, body);
    this.tabStatuses.set(tab.id, "Idle");
    this.tabs.appendChild(button);
    this.body.appendChild(body);
  }

  removeTab(id: string): void {
    this.tabButtons.get(id)?.remove();
    this.tabBodies.get(id)?.remove();
    this.tabButtons.delete(id);
    this.tabBodies.delete(id);
    this.tabStatuses.delete(id);
    this.terminals.delete(id);
    this.customTabs.delete(id);
    this.customHosts.delete(id);

    if (this.activeTabId === id) {
      this.activeTabId = null;
    }
  }

  updateTabTitle(id: string, title: string): void {
    const button = this.tabButtons.get(id);
    const label = button?.querySelector(
      ".almostnode-opencode-surface__tab-label",
    );
    if (label) {
      label.textContent = title;
    }
  }

  updateTabStatus(id: string, text: string): void {
    this.tabStatuses.set(id, text);
  }

  setActiveTab(id: string): void {
    this.activeTabId = id;
    for (const [tabId, button] of this.tabButtons.entries()) {
      button.classList.toggle("is-active", tabId === id);
    }
    for (const [tabId, body] of this.tabBodies.entries()) {
      const isActive = tabId === id;
      body.hidden = !isActive;
      body.style.display = isActive ? "" : "none";
    }
    this.fit();
    queueTerminalFit(() => this.fit());
  }

  private fit(): void {
    if (!this.opened || !this.activeTabId) {
      return;
    }
    if (this.customTabs.has(this.activeTabId)) {
      return;
    }
    const activeBody = this.tabBodies.get(this.activeTabId);
    const activeTerminal = this.terminals.get(this.activeTabId);
    if (!activeBody || !activeTerminal) {
      return;
    }
    if (activeBody.clientWidth === 0 || activeBody.clientHeight === 0) {
      return;
    }

    activeTerminal.fitAddon.fit();
    this.callbacks.onResize?.(
      this.activeTabId,
      activeTerminal.terminal.cols,
      activeTerminal.terminal.rows,
    );
    activeTerminal.terminal.scrollToBottom();
  }
}

export interface DatabaseSidebarCallbacks {
  onOpen(name: string): void;
  onSwitch(name: string): void;
  onCreate(name: string): void;
  onDelete(name: string): void;
}

export class DatabaseSidebarSurface {
  readonly model = new MutableSurfaceModel<
    DatabaseSidebarState,
    DatabaseSidebarActions
  >(
    {
      databases: [],
      activeName: null,
    },
    {
      create: (name) => this.callbacks?.onCreate(name),
      open: (name) => this.callbacks?.onOpen(name),
      delete: (name) => this.callbacks?.onDelete(name),
    },
  );
  private callbacks: DatabaseSidebarCallbacks | null = null;

  setCallbacks(callbacks: DatabaseSidebarCallbacks): void {
    this.callbacks = callbacks;
  }

  update(
    databases: { name: string; createdAt: string }[],
    activeName: string | null,
  ): void {
    this.model.setSnapshot({
      databases: [...databases],
      activeName,
    });
  }

  attach(container: HTMLElement): IDisposable {
    return mountStaticSlotSurface(container, DATABASE_VIEW_ID, this.model);
  }
}

export interface CodespaceSurfaceCallbacks {
  onOpenExternal(url: string): void;
  onEmbedUnavailable(url: string, reason: string): void;
}

export class CodespaceSurface {
  private readonly root = document.createElement("div");
  readonly model: SurfaceModel<SlotSurfaceState, SlotSurfaceActions> =
    createStaticSurfaceModel(
      { slot: createDomSlot(this.root) },
      {
        focus: () => this.iframe.focus(),
      },
    );
  private readonly heading = document.createElement("div");
  private readonly detail = document.createElement("div");
  private readonly badge = document.createElement("span");
  private readonly iframe = document.createElement("iframe");
  private readonly emptyState = document.createElement("div");
  private readonly emptyTitle = document.createElement("div");
  private readonly emptyBody = document.createElement("div");
  private readonly emptyActions = document.createElement("div");
  private readonly openExternalButton = document.createElement("button");
  private readonly reloadButton = document.createElement("button");
  private callbacks: CodespaceSurfaceCallbacks | null = null;
  private currentUrl: string | null = null;
  private embedWatchdogId = 0;
  private loaded = false;

  constructor() {
    this.root.className = "almostnode-codespace-surface";
    this.root.style.cssText = [
      "display:flex",
      "flex-direction:column",
      "height:100%",
      "background:linear-gradient(180deg, rgba(17,20,26,0.96), rgba(10,12,17,0.98))",
      "color:#edf3ff",
      "font-family:'Instrument Sans', system-ui, sans-serif",
    ].join(";");

    const header = document.createElement("div");
    header.style.cssText = [
      "display:flex",
      "align-items:center",
      "justify-content:space-between",
      "gap:16px",
      "padding:14px 18px",
      "border-bottom:1px solid rgba(255,255,255,0.08)",
      "background:rgba(11,14,21,0.78)",
      "backdrop-filter:blur(14px)",
      "flex-shrink:0",
    ].join(";");

    const titleGroup = document.createElement("div");
    titleGroup.style.cssText = "display:flex;flex-direction:column;gap:4px;min-width:0;";
    this.heading.style.cssText = "font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
    this.heading.textContent = "Codespace";
    this.detail.style.cssText = "font-size:12px;color:rgba(237,243,255,0.68);";
    this.detail.textContent = "Upgrade this project to keep working in GitHub Codespaces.";
    titleGroup.append(this.heading, this.detail);

    this.badge.style.cssText = [
      "display:inline-flex",
      "align-items:center",
      "justify-content:center",
      "padding:5px 10px",
      "border-radius:999px",
      "font-size:11px",
      "font-weight:700",
      "letter-spacing:0.04em",
      "text-transform:uppercase",
      "background:rgba(255,255,255,0.08)",
      "color:#f9fcff",
    ].join(";");
    this.badge.textContent = "Idle";

    header.append(titleGroup, this.badge);

    const body = document.createElement("div");
    body.style.cssText = "position:relative;display:flex;flex:1;min-height:0;";

    this.iframe.style.cssText = "border:0;width:100%;height:100%;display:none;background:#0b0f17;";
    this.iframe.setAttribute("title", "GitHub Codespace");
    this.iframe.setAttribute("allow", "clipboard-read; clipboard-write; fullscreen");
    this.iframe.addEventListener("load", () => {
      this.loaded = true;
      this.clearWatchdog();
      this.badge.textContent = "Connected";
      this.emptyState.style.display = "none";
      this.iframe.style.display = "block";
    });
    this.iframe.addEventListener("error", () => {
      this.handleEmbedUnavailable("The embedded Codespace editor could not be loaded.");
    });

    this.emptyState.style.cssText = [
      "position:absolute",
      "inset:0",
      "display:flex",
      "flex-direction:column",
      "align-items:flex-start",
      "justify-content:center",
      "padding:32px",
      "gap:10px",
      "background:radial-gradient(circle at top left, rgba(78,130,255,0.2), transparent 38%), linear-gradient(180deg, rgba(12,16,24,0.94), rgba(9,11,16,0.98))",
    ].join(";");
    this.emptyTitle.style.cssText = "font-size:22px;font-weight:700;max-width:32rem;";
    this.emptyTitle.textContent = "Codespace not connected";
    this.emptyBody.style.cssText = "font-size:13px;line-height:1.5;color:rgba(237,243,255,0.72);max-width:34rem;";
    this.emptyBody.textContent = "Create or open a Codespace from the status bar to continue in a full GitHub environment.";
    this.emptyActions.style.cssText = "display:flex;gap:10px;margin-top:6px;";

    const buttonBase = [
      "border-radius:999px",
      "padding:8px 14px",
      "font:inherit",
      "font-size:12px",
      "font-weight:600",
      "cursor:pointer",
    ].join(";");
    this.openExternalButton.type = "button";
    this.openExternalButton.style.cssText = `${buttonBase};border:1px solid rgba(255,255,255,0.18);background:rgba(255,255,255,0.06);color:#f6fbff;`;
    this.openExternalButton.textContent = "Open in Browser";
    this.openExternalButton.addEventListener("click", () => {
      if (this.currentUrl) {
        this.callbacks?.onOpenExternal(this.currentUrl);
      }
    });
    this.reloadButton.type = "button";
    this.reloadButton.style.cssText = `${buttonBase};border:1px solid rgba(91,163,255,0.28);background:linear-gradient(135deg, #5ea0ff, #2f64f5);color:white;`;
    this.reloadButton.textContent = "Reload Embed";
    this.reloadButton.addEventListener("click", () => {
      if (this.currentUrl) {
        this.open(this.currentUrl, {
          title: this.heading.textContent || "Codespace",
          detail: this.detail.textContent || "",
          badge: "Connecting",
        });
      }
    });
    this.emptyActions.append(this.reloadButton, this.openExternalButton);
    this.emptyState.append(this.emptyTitle, this.emptyBody, this.emptyActions);

    body.append(this.iframe, this.emptyState);
    this.root.append(header, body);
  }

  setCallbacks(callbacks: CodespaceSurfaceCallbacks): void {
    this.callbacks = callbacks;
  }

  setEmptyState(title: string, detail: string, badge = "Idle"): void {
    this.currentUrl = null;
    this.loaded = false;
    this.clearWatchdog();
    this.heading.textContent = "Codespace";
    this.detail.textContent = detail;
    this.badge.textContent = badge;
    this.emptyTitle.textContent = title;
    this.emptyBody.textContent = detail;
    this.emptyState.style.display = "flex";
    this.iframe.style.display = "none";
    this.iframe.src = "about:blank";
  }

  open(
    url: string,
    options: { title: string; detail: string; badge?: string },
  ): void {
    this.currentUrl = url;
    this.loaded = false;
    this.heading.textContent = options.title;
    this.detail.textContent = options.detail;
    this.badge.textContent = options.badge ?? "Connecting";
    this.emptyTitle.textContent = "Connecting to Codespace";
    this.emptyBody.textContent = "Waiting for GitHub to load the remote editor. If embedding is blocked, almostnode will open it in a new tab automatically.";
    this.emptyState.style.display = "flex";
    this.iframe.style.display = "none";
    this.iframe.src = url;
    this.clearWatchdog();
    this.embedWatchdogId = window.setTimeout(() => {
      if (!this.loaded) {
        this.handleEmbedUnavailable("GitHub did not allow the Codespace editor to finish loading in this frame.");
      }
    }, 9000);
  }

  private handleEmbedUnavailable(reason: string): void {
    this.clearWatchdog();
    this.badge.textContent = "External";
    this.emptyTitle.textContent = "Embedded editor unavailable";
    this.emptyBody.textContent = reason;
    this.emptyState.style.display = "flex";
    this.iframe.style.display = "none";
    if (this.currentUrl) {
      this.callbacks?.onEmbedUnavailable(this.currentUrl, reason);
    }
  }

  private clearWatchdog(): void {
    if (this.embedWatchdogId) {
      window.clearTimeout(this.embedWatchdogId);
      this.embedWatchdogId = 0;
    }
  }
}

export type DatabaseQueryHandler = (
  operation: string,
  body: any,
  dbName?: string,
) => Promise<{ statusCode: number; body: string }>;

export class DatabaseBrowserSurface {
  private readonly root = document.createElement("div");
  readonly model: SurfaceModel<SlotSurfaceState, SlotSurfaceActions> =
    createStaticSurfaceModel(
      { slot: createDomSlot(this.root) },
      {
        focus: () => this.focus(),
      },
    );
  private readonly tableList = document.createElement("div");
  private readonly sqlTextarea = document.createElement("textarea");
  private readonly resultsArea = document.createElement("div");
  private readonly statusBar = document.createElement("div");
  private readonly dbLabel = document.createElement("span");
  private dbName: string = "";
  private queryHandler: DatabaseQueryHandler | null = null;

  constructor() {
    this.root.className = "almostnode-database-browser";
    this.root.style.cssText =
      'display:flex;flex-direction:column;height:100%;background:var(--almostnode-surface-bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:13px;';

    // Header bar
    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid var(--almostnode-toolbar-border);background:var(--almostnode-toolbar-bg);flex-shrink:0;";
    this.dbLabel.style.cssText = "font-weight:600;flex:1;";
    const refreshBtn = document.createElement("button");
    refreshBtn.textContent = "Refresh";
    refreshBtn.style.cssText =
      "background:var(--almostnode-button-bg);border:1px solid var(--almostnode-toolbar-border);color:var(--almostnode-button-fg);padding:3px 10px;border-radius:3px;cursor:pointer;font-size:12px;";
    refreshBtn.addEventListener("click", () => this.refreshTables());
    header.append(this.dbLabel, refreshBtn);

    // Body: left panel (table list) + right panel (SQL + results)
    const body = document.createElement("div");
    body.style.cssText = "display:flex;flex:1;overflow:hidden;";

    // Left panel — table list
    const leftPanel = document.createElement("div");
    leftPanel.style.cssText =
      "width:25%;min-width:140px;border-right:1px solid var(--almostnode-toolbar-border);overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:2px;background:var(--almostnode-surface-alt-bg);";
    const tableHeader = document.createElement("div");
    tableHeader.textContent = "Tables";
    tableHeader.style.cssText =
      "font-weight:600;margin-bottom:4px;color:var(--muted);font-size:11px;text-transform:uppercase;letter-spacing:.5px;";
    leftPanel.append(tableHeader, this.tableList);

    // Right panel — SQL editor + results
    const rightPanel = document.createElement("div");
    rightPanel.style.cssText =
      "flex:1;display:flex;flex-direction:column;overflow:hidden;";

    // SQL editor area
    const sqlArea = document.createElement("div");
    sqlArea.style.cssText =
      "display:flex;flex-direction:column;border-bottom:1px solid var(--almostnode-toolbar-border);flex-shrink:0;";
    const sqlHeader = document.createElement("div");
    sqlHeader.style.cssText =
      "display:flex;align-items:center;justify-content:space-between;padding:4px 8px;background:var(--almostnode-toolbar-bg);";
    const sqlLabel = document.createElement("span");
    sqlLabel.textContent = "SQL Query";
    sqlLabel.style.cssText =
      "font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;";
    const runBtn = document.createElement("button");
    runBtn.textContent = "Run";
    runBtn.style.cssText =
      "background:var(--almostnode-primary-button-bg);border:none;color:var(--almostnode-primary-button-fg);padding:3px 14px;border-radius:3px;cursor:pointer;font-size:12px;";
    runBtn.addEventListener("click", () => this.runQuery());
    sqlHeader.append(sqlLabel, runBtn);

    this.sqlTextarea.style.cssText =
      'width:100%;height:80px;background:var(--almostnode-editor-bg);color:var(--almostnode-editor-fg);border:none;padding:8px;font-family:"Cascadia Code","Fira Code",Consolas,monospace;font-size:13px;resize:vertical;outline:none;box-sizing:border-box;';
    this.sqlTextarea.placeholder = "Enter SQL query...";
    this.sqlTextarea.spellcheck = false;
    this.sqlTextarea.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        this.runQuery();
      }
    });
    sqlArea.append(sqlHeader, this.sqlTextarea);

    // Results area
    this.resultsArea.style.cssText = "flex:1;overflow:auto;padding:0;";

    // Status bar
    this.statusBar.style.cssText =
      "padding:4px 8px;border-top:1px solid var(--almostnode-toolbar-border);font-size:11px;color:var(--muted);flex-shrink:0;";
    this.statusBar.textContent = "Ready";

    rightPanel.append(sqlArea, this.resultsArea, this.statusBar);
    body.append(leftPanel, rightPanel);
    this.root.append(header, body);
  }

  setQueryHandler(handler: DatabaseQueryHandler): void {
    this.queryHandler = handler;
  }

  setDatabase(name: string): void {
    this.dbName = name;
    this.dbLabel.textContent = `Database: ${name}`;
    this.refreshTables();
  }

  focus(): void {
    this.sqlTextarea.focus();
  }

  attach(container: HTMLElement): IDisposable {
    container.style.overflow = "hidden";
    return mountStaticSlotSurface(
      container,
      DATABASE_EDITOR_TYPE_ID,
      this.model,
    );
  }

  private async refreshTables(): Promise<void> {
    if (!this.queryHandler || !this.dbName) return;
    this.tableList.innerHTML = "";
    try {
      const result = await this.queryHandler("tables", {}, this.dbName);
      const data = JSON.parse(result.body);
      if (data.tables && data.tables.length > 0) {
        for (const tableName of data.tables) {
          const row = document.createElement("div");
          row.style.cssText =
            "padding:4px 8px;cursor:pointer;border-radius:3px;display:flex;align-items:center;gap:6px;";
          row.addEventListener("mouseenter", () => {
            row.style.background = "var(--almostnode-list-hover-bg)";
          });
          row.addEventListener("mouseleave", () => {
            row.style.background = "transparent";
          });
          const icon = document.createElement("span");
          icon.textContent = "\u{1f4cb}";
          icon.style.cssText = "font-size:11px;";
          const label = document.createElement("span");
          label.textContent = tableName;
          row.append(icon, label);
          row.addEventListener("click", () => this.loadTable(tableName));
          this.tableList.appendChild(row);
        }
      } else {
        const empty = document.createElement("div");
        empty.style.cssText =
          "color:var(--almostnode-quiet);font-style:italic;padding:4px 8px;";
        empty.textContent = "No tables";
        this.tableList.appendChild(empty);
      }
    } catch (err: any) {
      this.statusBar.textContent = `Error loading tables: ${err.message}`;
      this.statusBar.style.color = "var(--almostnode-danger)";
    }
  }

  private async loadTable(tableName: string): Promise<void> {
    if (!this.queryHandler || !this.dbName) return;
    this.statusBar.textContent = `Loading ${tableName}...`;
    try {
      const result = await this.queryHandler(
        "query",
        { sql: `SELECT * FROM "${tableName}" LIMIT 100` },
        this.dbName,
      );
      const data = JSON.parse(result.body);
      if (data.error) {
        this.statusBar.textContent = `Error: ${data.error}`;
        this.statusBar.style.color = "var(--almostnode-danger)";
        return;
      }
      this.sqlTextarea.value = `SELECT * FROM "${tableName}" LIMIT 100`;
      this.renderResults(data.fields, data.rows);
      this.statusBar.textContent = `${data.rows.length} row(s) returned`;
      this.statusBar.style.color = "var(--muted)";
    } catch (err: any) {
      this.statusBar.textContent = `Error: ${err.message}`;
      this.statusBar.style.color = "var(--almostnode-danger)";
    }
  }

  private async runQuery(): Promise<void> {
    const sql = this.sqlTextarea.value.trim();
    if (!sql || !this.queryHandler || !this.dbName) return;
    this.statusBar.textContent = "Running query...";
    const start = performance.now();
    try {
      const result = await this.queryHandler("query", { sql }, this.dbName);
      const elapsed = Math.round(performance.now() - start);
      const data = JSON.parse(result.body);
      if (data.error) {
        this.resultsArea.innerHTML = "";
        this.statusBar.textContent = `Error: ${data.error}`;
        this.statusBar.style.color = "var(--almostnode-danger)";
        return;
      }
      this.statusBar.style.color = "var(--muted)";
      this.renderResults(data.fields, data.rows);
      this.statusBar.textContent = `${data.rows.length} row(s) returned in ${elapsed}ms`;
    } catch (err: any) {
      this.statusBar.style.color = "var(--almostnode-danger)";
      this.statusBar.textContent = `Error: ${err.message}`;
    }
  }

  private renderResults(fields: any[] | undefined, rows: any[]): void {
    this.resultsArea.innerHTML = "";
    if (!fields || fields.length === 0) {
      const msg = document.createElement("div");
      msg.style.cssText = "padding:12px;color:var(--muted);";
      msg.textContent =
        rows.length > 0 ? "Query executed successfully." : "No results.";
      this.resultsArea.appendChild(msg);
      return;
    }

    const table = document.createElement("table");
    table.style.cssText = "width:100%;border-collapse:collapse;font-size:12px;";

    const thead = document.createElement("thead");
    const headerRow = document.createElement("tr");
    for (const field of fields) {
      const th = document.createElement("th");
      th.textContent = field.name;
      th.style.cssText =
        "text-align:left;padding:6px 10px;background:var(--almostnode-toolbar-bg);border-bottom:1px solid var(--almostnode-toolbar-border);position:sticky;top:0;white-space:nowrap;font-weight:600;color:var(--accent);";
      headerRow.appendChild(th);
    }
    thead.appendChild(headerRow);
    table.appendChild(thead);

    const tbody = document.createElement("tbody");
    for (const row of rows) {
      const tr = document.createElement("tr");
      tr.addEventListener("mouseenter", () => {
        tr.style.background = "var(--almostnode-list-hover-bg)";
      });
      tr.addEventListener("mouseleave", () => {
        tr.style.background = "transparent";
      });
      for (const field of fields) {
        const td = document.createElement("td");
        const val = row[field.name];
        td.textContent = val === null ? "NULL" : String(val);
        td.style.cssText =
          "padding:4px 10px;border-bottom:1px solid var(--almostnode-toolbar-border);white-space:nowrap;max-width:300px;overflow:hidden;text-overflow:ellipsis;";
        if (val === null) td.style.color = "var(--almostnode-quiet)";
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    this.resultsArea.appendChild(table);
  }
}

// ── Keychain Sidebar ────────────────────────────────────────────────────────

export type KeychainSlotStatus = KeychainSidebarSlotStatus;

export class KeychainSidebarSurface {
  readonly model = new MutableSurfaceModel<
    KeychainSidebarState,
    KeychainSidebarActions
  >(
    {
      slots: [],
      hasStoredVault: false,
      supported: false,
    },
    {
      dispatch: (action) => {
        this.onAction?.(action);
      },
    },
  );
  private onAction: ((action: string) => void) | null = null;

  setActionHandler(handler: (action: string) => void): void {
    this.onAction = handler;
  }

  update(
    slots: KeychainSlotStatus[],
    options?: { hasStoredVault: boolean; supported: boolean },
  ): void {
    this.model.setSnapshot({
      slots,
      hasStoredVault: options?.hasStoredVault ?? false,
      supported: options?.supported ?? false,
    });
  }

  attach(container: HTMLElement): IDisposable {
    return mountStaticSlotSurface(container, KEYCHAIN_VIEW_ID, this.model);
  }
}

// ── Tests Sidebar ────────────────────────────────────────────────────────────

export interface TestEntry {
  id: string;
  name: string;
  status: "pending" | "passed" | "failed" | "running";
}

export interface TestsSidebarCallbacks {
  onRun: (testId: string) => void;
  onRunAll: () => void;
  onDelete: (testId: string) => void;
  onOpen: (testId: string) => void;
}

export class TestsSidebarSurface {
  readonly model = new MutableSurfaceModel<TestsSidebarState, TestsSidebarActions>(
    {
      tests: [],
    },
    {
      open: (id) => this.callbacks?.onOpen(id),
      run: (id) => this.callbacks?.onRun(id),
      runAll: () => this.callbacks?.onRunAll(),
      delete: (id) => this.callbacks?.onDelete(id),
    },
  );
  private callbacks: TestsSidebarCallbacks | null = null;

  setCallbacks(callbacks: TestsSidebarCallbacks): void {
    this.callbacks = callbacks;
  }

  update(tests: TestEntry[]): void {
    this.model.setSnapshot({
      tests: [...tests],
    });
  }

  updateTestStatus(testId: string, status: TestEntry["status"]): void {
    this.model.updateSnapshot((state) => ({
      tests: state.tests.map((test) =>
        test.id === testId ? { ...test, status } : test,
      ),
    }));
  }

  attach(container: HTMLElement): IDisposable {
    return mountStaticSlotSurface(container, TESTS_VIEW_ID, this.model);
  }
}

export function registerWorkbenchSurfaces(options: {
  filesSurface: FilesSidebarSurface;
  openCodeSurface: OpenCodeTerminalSurface;
  previewSurface: PreviewSurface;
  codespaceSurface: CodespaceSurface;
  terminalSurface: TerminalPanelSurface;
  databaseSurface: DatabaseSidebarSurface;
  databaseBrowserSurface: DatabaseBrowserSurface;
  keychainSurface: KeychainSidebarSurface;
  testsSurface: TestsSidebarSurface;
  vfs: VirtualFS;
  openFileAsText: (path: string) => void;
}): RegisteredWorkbenchSurfaces {
  const rendered = registerRenderedEditors({
    vfs: options.vfs,
    openFileAsText: options.openFileAsText,
  });
  const entrypoints = registerWorkbenchEntrypoints({
    surfaces: {
      filesSurface: options.filesSurface,
      openCodeSurface: options.openCodeSurface,
      previewSurface: options.previewSurface,
      codespaceSurface: options.codespaceSurface,
      terminalSurface: options.terminalSurface,
      databaseSurface: options.databaseSurface,
      databaseBrowserSurface: options.databaseBrowserSurface,
      keychainSurface: options.keychainSurface,
      testsSurface: options.testsSurface,
    },
  });

  return {
    get previewInput() {
      return entrypoints.createEditorInput(PREVIEW_EDITOR_TYPE_ID);
    },
    get codespaceInput() {
      return entrypoints.createEditorInput(CODESPACE_EDITOR_TYPE_ID);
    },
    get databaseInput() {
      return entrypoints.createEditorInput(DATABASE_EDITOR_TYPE_ID);
    },
    renderedEditors: rendered.factories,
    filesViewId: FILES_VIEW_ID,
    openCodeViewId: OPEN_CODE_VIEW_ID,
    terminalViewId: TERMINAL_VIEW_ID,
    databaseViewId: DATABASE_VIEW_ID,
    keychainViewId: KEYCHAIN_VIEW_ID,
    testsViewId: TESTS_VIEW_ID,
    setActivation: (id, active) => {
      entrypoints.setActivation(id, active);
    },
    dispose: () => {
      entrypoints.dispose();
      rendered.dispose();
    },
  };
}
