import "./file-tree.css";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Collection,
  Tree,
  TreeItem,
  TreeItemContent,
  isTextDropItem,
  useDragAndDrop,
  type Key,
  type Selection,
} from "react-aria-components";
import { useWorkspace, useWorkspaceSnapshot } from "../provider";
import {
  basename,
  buildFileTree,
  DEFAULT_EXCLUDED_DIRS,
  dirname,
  indexNodes,
  type FileNode,
  type TreeFs,
} from "./build-tree";
import { ActionIcon, ChevronIcon, FileIcon, FolderIcon, type ActionIconName } from "./file-icons";
import { ContextMenu, type ContextMenuItem, type ContextMenuState } from "./context-menu";

const PATH_DRAG_TYPE = "application/x-almostnode-path";

export interface FileTreeProps {
  /** Workspace path whose children populate the tree. Defaults to `/project`. */
  root?: string;
  /** Header label. Defaults to the last segment of `root`. */
  rootLabel?: string;
  /** Directory base names shown as collapsed leaves. Defaults to node_modules/.git/dist. */
  excludeDirs?: string[];
  className?: string;
}

function reportError(error: unknown): void {
  if (typeof console !== "undefined") {
    console.warn("[FileTree]", error instanceof Error ? error.message : error);
  }
}

export function FileTree(props: FileTreeProps): React.ReactElement {
  const workspace = useWorkspace();
  const snapshot = useWorkspaceSnapshot();
  const root = props.root ?? "/project";
  const excludeDirs = props.excludeDirs ?? DEFAULT_EXCLUDED_DIRS;
  const excludeKey = excludeDirs.join("|");
  const rootLabel = props.rootLabel ?? (basename(root) || "project");

  const [refreshNonce, setRefreshNonce] = useState(0);
  const [expandedKeys, setExpandedKeys] = useState<Set<Key>>(() => new Set<Key>());
  const [selectedKeys, setSelectedKeys] = useState<Selection>(() => new Set<Key>());
  const [menu, setMenu] = useState<ContextMenuState | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [pending, setPending] = useState<{ parentDir: string; kind: "file" | "directory" } | null>(null);

  const { tree, nodeByPath } = useMemo(() => {
    const nodes = buildFileTree(workspace.vfs as unknown as TreeFs, root, { excludeDirs });
    return { tree: nodes, nodeByPath: indexNodes(nodes) };
    // `snapshot` identity changes on every workspace emit; `refreshNonce` forces
    // a rebuild for the manual Refresh action.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, root, excludeKey, snapshot, refreshNonce]);

  const currentFile = snapshot.currentFile;
  useEffect(() => {
    setSelectedKeys(currentFile ? new Set<Key>([currentFile]) : new Set<Key>());
  }, [currentFile]);

  const openFile = useCallback((path: string) => workspace.setCurrentFile(path), [workspace]);

  const toggleFolder = useCallback((path: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }, []);

  const expandFolder = useCallback((path: string) => {
    setExpandedKeys((prev) => new Set(prev).add(path));
  }, []);

  const remapExpanded = useCallback((oldPath: string, newPath: string) => {
    setExpandedKeys((prev) => {
      const next = new Set<Key>();
      for (const key of prev) {
        const k = String(key);
        if (k === oldPath) {
          next.add(newPath);
        } else if (k.startsWith(`${oldPath}/`)) {
          next.add(`${newPath}${k.slice(oldPath.length)}`);
        } else {
          next.add(key);
        }
      }
      return next;
    });
  }, []);

  const beginCreate = useCallback(
    (parentDir: string, kind: "file" | "directory") => {
      if (parentDir !== root) {
        expandFolder(parentDir);
      }
      setRenaming(null);
      setPending({ parentDir, kind });
    },
    [root, expandFolder],
  );

  const commitCreate = useCallback(
    (rawName: string) => {
      const name = rawName.trim();
      setPending((target) => {
        if (!target || !name) {
          return null;
        }
        const full = `${target.parentDir}/${name}`;
        try {
          if (target.kind === "file") {
            workspace.createFile(full, "");
          } else {
            workspace.createDirectory(full);
            expandFolder(full);
          }
        } catch (error) {
          reportError(error);
        }
        return null;
      });
    },
    [workspace, expandFolder],
  );

  const commitRename = useCallback(
    (path: string, rawName: string) => {
      const name = rawName.trim();
      setRenaming(null);
      if (!name || name === basename(path)) {
        return;
      }
      const newPath = `${dirname(path)}/${name}`;
      try {
        workspace.rename(path, newPath);
        remapExpanded(path, newPath);
      } catch (error) {
        reportError(error);
      }
    },
    [workspace, remapExpanded],
  );

  const removePath = useCallback(
    (path: string) => {
      try {
        workspace.remove(path);
      } catch (error) {
        reportError(error);
      }
    },
    [workspace],
  );

  const openItemMenu = useCallback(
    (event: React.MouseEvent, node: FileNode) => {
      event.preventDefault();
      event.stopPropagation();
      const items: ContextMenuItem[] = [];
      if (node.type === "directory") {
        items.push(
          { label: "New File", icon: "filePlus", onSelect: () => beginCreate(node.path, "file") },
          { label: "New Folder", icon: "folderPlus", onSelect: () => beginCreate(node.path, "directory") },
        );
      }
      items.push(
        { label: "Rename", icon: "rename", onSelect: () => setRenaming(node.path) },
        { label: "Delete", icon: "trash", danger: true, onSelect: () => removePath(node.path) },
      );
      setMenu({ x: event.clientX, y: event.clientY, items });
    },
    [beginCreate, removePath],
  );

  const openRootMenu = useCallback(
    (event: React.MouseEvent) => {
      if (event.target !== event.currentTarget) {
        return;
      }
      event.preventDefault();
      setMenu({
        x: event.clientX,
        y: event.clientY,
        items: [
          { label: "New File", icon: "filePlus", onSelect: () => beginCreate(root, "file") },
          { label: "New Folder", icon: "folderPlus", onSelect: () => beginCreate(root, "directory") },
        ],
      });
    },
    [beginCreate, root],
  );

  const { dragAndDropHooks } = useDragAndDrop({
    getItems: (keys) =>
      [...keys].map((key) => {
        const path = String(key);
        return { [PATH_DRAG_TYPE]: path, "text/plain": basename(path) };
      }),
    acceptedDragTypes: [PATH_DRAG_TYPE],
    getDropOperation: () => "move",
    // Only folders are valid "drop onto" targets; dropping on a file falls back
    // to a between-items drop, which we resolve to that file's parent folder.
    shouldAcceptItemDrop: (target) => nodeByPath.get(String(target.key))?.type === "directory",
    onMove: (event) => {
      const destDir =
        event.target.dropPosition === "on"
          ? String(event.target.key)
          : dirname(String(event.target.key));
      for (const key of event.keys) {
        try {
          workspace.move(String(key), destDir);
        } catch (error) {
          reportError(error);
        }
      }
    },
    onRootDrop: async (event) => {
      for (const item of event.items) {
        if (!isTextDropItem(item)) {
          continue;
        }
        const path = await item.getText(PATH_DRAG_TYPE);
        if (!path) {
          continue;
        }
        try {
          workspace.move(path, root);
        } catch (error) {
          reportError(error);
        }
      }
    },
  });

  const renderNode = useCallback(
    (node: FileNode): React.ReactElement => {
      const isDir = node.type === "directory";
      const hasChildren = isDir && !!node.children && node.children.length > 0;
      return (
        <TreeItem
          id={node.path}
          textValue={node.name}
          className="aw-ft-item"
          onAction={() => (isDir ? toggleFolder(node.path) : openFile(node.path))}
        >
          <TreeItemContent>
            {({ isExpanded, level }) => (
              <div
                className="aw-ft-row"
                data-kind={node.type}
                onContextMenu={(event) => openItemMenu(event, node)}
              >
                {Array.from({ length: Math.max(0, level - 1) }).map((_, index) => (
                  <span key={index} className="aw-ft-indent" aria-hidden="true" />
                ))}
                {hasChildren ? (
                  <Button slot="chevron" className="aw-ft-chevron" aria-label="Toggle folder">
                    <ChevronIcon className={`aw-ft-chevron__icon${isExpanded ? " is-open" : ""}`} />
                  </Button>
                ) : (
                  <span className="aw-ft-chevron aw-ft-chevron--leaf" aria-hidden="true" />
                )}
                {isDir ? (
                  <FolderIcon open={isExpanded} className="aw-ft-icon" />
                ) : (
                  <FileIcon name={node.name} className="aw-ft-icon" />
                )}
                {renaming === node.path ? (
                  <InlineInput
                    defaultValue={node.name}
                    selectBaseName={!isDir}
                    onCommit={(value) => commitRename(node.path, value)}
                    onCancel={() => setRenaming(null)}
                  />
                ) : (
                  <span className="aw-ft-label">{node.name}</span>
                )}
                {/* Keyboard/screen-reader drag affordance required by React Aria. */}
                <Button slot="drag" className="aw-ft-drag">
                  Drag {node.name}
                </Button>
              </div>
            )}
          </TreeItemContent>
          {hasChildren ? <Collection items={node.children}>{renderNode}</Collection> : null}
        </TreeItem>
      );
    },
    [toggleFolder, openFile, openItemMenu, renaming, commitRename],
  );

  return (
    <div className={`aw-file-tree${props.className ? ` ${props.className}` : ""}`}>
      <header className="aw-ft-header">
        <span className="aw-ft-title" title={root}>
          {rootLabel}
        </span>
        <div className="aw-ft-actions">
          <ToolButton label="New File" icon="filePlus" onPress={() => beginCreate(root, "file")} />
          <ToolButton label="New Folder" icon="folderPlus" onPress={() => beginCreate(root, "directory")} />
          <ToolButton label="Refresh" icon="refresh" onPress={() => setRefreshNonce((n) => n + 1)} />
          <ToolButton label="Collapse All" icon="collapse" onPress={() => setExpandedKeys(new Set())} />
        </div>
      </header>

      <div className="aw-ft-body" onContextMenu={openRootMenu}>
        {pending ? (
          <div className="aw-ft-row aw-ft-row--create" data-kind={pending.kind}>
            <span className="aw-ft-chevron aw-ft-chevron--leaf" aria-hidden="true" />
            {pending.kind === "file" ? (
              <FileIcon name="" className="aw-ft-icon" />
            ) : (
              <FolderIcon open={false} className="aw-ft-icon" />
            )}
            <InlineInput defaultValue="" onCommit={commitCreate} onCancel={() => setPending(null)} />
            <span className="aw-ft-create-hint">in {pending.parentDir.replace(root, "") || "/"}</span>
          </div>
        ) : null}

        <Tree
          aria-label={`${rootLabel} files`}
          className="aw-ft-tree"
          items={tree}
          selectionMode="single"
          selectedKeys={selectedKeys}
          onSelectionChange={(keys) => {
            setSelectedKeys(keys);
            if (keys === "all") {
              return;
            }
            const key = [...keys][0];
            if (key == null) {
              return;
            }
            if (nodeByPath.get(String(key))?.type === "file") {
              openFile(String(key));
            }
          }}
          expandedKeys={expandedKeys}
          onExpandedChange={(keys) => setExpandedKeys(new Set(keys))}
          dragAndDropHooks={dragAndDropHooks}
          renderEmptyState={() => <div className="aw-ft-empty">No files yet</div>}
        >
          {renderNode}
        </Tree>
      </div>

      <ContextMenu state={menu} onClose={() => setMenu(null)} />
    </div>
  );
}

function ToolButton({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: ActionIconName;
  onPress: () => void;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="aw-ft-toolbtn"
      title={label}
      aria-label={label}
      onClick={onPress}
    >
      <ActionIcon name={icon} />
    </button>
  );
}

function InlineInput({
  defaultValue,
  selectBaseName,
  onCommit,
  onCancel,
}: {
  defaultValue: string;
  selectBaseName?: boolean;
  onCommit: (value: string) => void;
  onCancel: () => void;
}): React.ReactElement {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      return;
    }
    el.focus();
    const dot = defaultValue.lastIndexOf(".");
    if (selectBaseName && dot > 0) {
      el.setSelectionRange(0, dot);
    } else {
      el.select();
    }
  }, [defaultValue, selectBaseName]);

  return (
    <input
      ref={ref}
      className="aw-ft-input"
      defaultValue={defaultValue}
      spellCheck={false}
      aria-label="Name"
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          onCommit(event.currentTarget.value);
        } else if (event.key === "Escape") {
          onCancel();
        }
      }}
      onBlur={(event) => onCommit(event.currentTarget.value)}
    />
  );
}
