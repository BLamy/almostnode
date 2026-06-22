import { getService, ICodeEditorService } from '@codingame/monaco-vscode-api';
import {
  IEditorGroupsService,
  IEditorService,
  IMarkerService,
} from '@codingame/monaco-vscode-api/services';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import {
  EditorResourceAccessor,
  SideBySideEditor,
} from '@codingame/monaco-vscode-api/vscode/vs/workbench/common/editor';
import type { ContainerInstance } from '@agent-wasm/core';
import {
  ClaudeIdeVirtualServer,
  SSE_PATH,
  CLAUDE_IDE_DEFAULT_PORT,
  isSelectionEmpty,
  createClaudeIdeSelectionChangedParams,
  normalizeClaudeIdeFilePath,
  createClaudeIdeDiagnosticFiles,
  resolveCodeEditorFromControl,
  type CodeEditorLike,
  type EditorServiceLike,
  type EditorGroupsServiceLike,
  type CodeEditorServiceLike,
  type MarkerServiceLike,
  type ClaudeIdeSelectionChangedParams,
  type ClaudeIdeOpenFileParams,
  type ClaudeIdeDiagnosticFile,
  type ClaudeIdeFileUpdatedParams,
} from '@agent-wasm/code';

// The reusable, host-agnostic Claude IDE server now lives in @agent-wasm/code.
// Re-exported here so existing demo consumers keep their import paths; this file
// owns only the Monaco-coupled bridge that supplies editor state to the server.
export {
  ClaudeIdeVirtualServer,
  normalizeClaudeIdeFilePath,
  createClaudeIdeSelectionChangedParams,
  createClaudeIdeDiagnosticFiles,
};
export {
  CLAUDE_IDE_SERVER_NAME,
  CLAUDE_IDE_TRANSPORT_TYPE,
  CLAUDE_IDE_NAME,
  buildClaudeIdeMcpConfig,
  serializeClaudeIdeDiagnosticsResult,
} from '@agent-wasm/code';
export type {
  ClaudeIdeSelectionChangedParams,
  ClaudeIdeDiagnosticFile,
  ClaudeIdeOpenFileParams,
  ClaudeIdeFileUpdatedParams,
};
export type {
  ClaudeIdeSelectionPoint,
  ClaudeIdeSelectionRange,
  ClaudeIdeDiagnostic,
} from '@agent-wasm/code';

export class ClaudeIdeBridge {
  private readonly editorListeners = new Map<
    CodeEditorLike,
    Array<{ dispose(): void }>
  >();

  private readonly disposables: Array<{ dispose(): void }> = [];

  private readonly server: ClaudeIdeVirtualServer;

  private readonly sseUrl: string;

  private selectionKey: string | null = null;
  private selectionRefreshPending = false;
  private readonly clientInitializedListeners = new Set<() => void>();

  private constructor(
    private readonly container: ContainerInstance,
    private readonly port: number,
    private readonly editorService: EditorServiceLike,
    private readonly editorGroupsService: EditorGroupsServiceLike,
    private readonly codeEditorService: CodeEditorServiceLike,
    private readonly markerService: MarkerServiceLike,
  ) {
    this.server = new ClaudeIdeVirtualServer(port, {
      getSelection: () => this.getSelectionChangedParams(),
      openFile: (params) => this.openFile(params),
      getDiagnostics: (uri) => this.getDiagnostics(uri),
      handleFileUpdated: (params) => this.handleFileUpdated(params),
      onClientInitialized: () => {
        for (const listener of this.clientInitializedListeners) {
          listener();
        }
      },
    });
    this.sseUrl = `${this.container.serverBridge.getServerUrl(port)}${SSE_PATH}`;
  }

  /**
   * Subscribe to MCP client `initialize` requests — fired each time a Claude
   * CLI finishes booting far enough to connect to the IDE bridge. Used as the
   * readiness signal before injecting chat input into the TUI.
   */
  onClientInitialized(listener: () => void): () => void {
    this.clientInitializedListeners.add(listener);
    return () => {
      this.clientInitializedListeners.delete(listener);
    };
  }

  static async create(options: {
    container: ContainerInstance;
  }): Promise<ClaudeIdeBridge> {
    const [editorService, editorGroupsService, codeEditorService, markerService] =
      await Promise.all([
        getService(IEditorService),
        getService(IEditorGroupsService),
        getService(ICodeEditorService),
        getService(IMarkerService),
      ]);

    const port = ClaudeIdeBridge.getNextAvailablePort(options.container);
    const bridge = new ClaudeIdeBridge(
      options.container,
      port,
      editorService,
      editorGroupsService,
      codeEditorService,
      markerService,
    );
    bridge.start();
    return bridge;
  }

  getSseUrl(): string {
    return this.sseUrl;
  }

  dispose(): void {
    for (const disposable of this.disposables.splice(0)) {
      disposable.dispose();
    }
    for (const editor of [...this.editorListeners.keys()]) {
      this.unregisterCodeEditor(editor);
    }
    this.server.dispose();
    this.container.serverBridge.unregisterServer(this.port);
  }

  private static getNextAvailablePort(container: ContainerInstance): number {
    const usedPorts = new Set(container.serverBridge.getServerPorts());
    let port = CLAUDE_IDE_DEFAULT_PORT;
    while (usedPorts.has(port)) {
      port += 1;
    }
    return port;
  }

  private start(): void {
    this.container.serverBridge.registerServer(
      this.server as never,
      this.port,
      '0.0.0.0',
      { purpose: 'auxiliary', name: 'claude-ide-bridge' },
    );

    for (const editor of this.codeEditorService.listCodeEditors()) {
      this.registerCodeEditor(editor as CodeEditorLike);
    }

    this.disposables.push(
      this.codeEditorService.onCodeEditorAdd((editor) => {
        this.registerCodeEditor(editor as CodeEditorLike);
        this.scheduleSelectionRefresh();
      }),
    );
    this.disposables.push(
      this.codeEditorService.onCodeEditorRemove((editor) => {
        this.unregisterCodeEditor(editor as CodeEditorLike);
        this.scheduleSelectionRefresh();
      }),
    );
    this.disposables.push(
      this.editorService.onDidActiveEditorChange(() => {
        this.scheduleSelectionRefresh();
      }),
    );
    this.disposables.push(
      this.editorService.onDidVisibleEditorsChange(() => {
        this.scheduleSelectionRefresh();
      }),
    );
    this.scheduleSelectionRefresh();
  }

  private registerCodeEditor(editor: CodeEditorLike): void {
    if (this.editorListeners.has(editor)) {
      return;
    }

    const disposables = [
      editor.onDidChangeCursorSelection?.(() => this.scheduleSelectionRefresh()),
      editor.onDidFocusEditorText?.(() => this.scheduleSelectionRefresh()),
      editor.onDidChangeModel?.(() => this.scheduleSelectionRefresh()),
    ].filter((value): value is { dispose(): void } => !!value);

    this.editorListeners.set(editor, disposables);
  }

  private unregisterCodeEditor(editor: CodeEditorLike): void {
    const disposables = this.editorListeners.get(editor);
    if (!disposables) {
      return;
    }

    for (const disposable of disposables) {
      disposable.dispose();
    }
    this.editorListeners.delete(editor);
  }

  private scheduleSelectionRefresh(force = false): void {
    if (force) {
      this.selectionKey = null;
    }

    if (this.selectionRefreshPending) {
      return;
    }

    this.selectionRefreshPending = true;
    queueMicrotask(() => {
      this.selectionRefreshPending = false;
      void this.publishSelectionChanged();
    });
  }

  private async publishSelectionChanged(): Promise<void> {
    const selection = await this.getSelectionChangedParams();
    const nextKey = selection ? JSON.stringify(selection) : null;
    if (nextKey === this.selectionKey) {
      return;
    }

    this.selectionKey = nextKey;
    await this.server.broadcastSelectionChanged(selection);
  }

  private getActiveFilePath(): string | null {
    const activeEditor =
      this.editorGroupsService.activeGroup?.activeEditor ?? this.editorService.activeEditor;
    const resource = EditorResourceAccessor.getCanonicalUri(activeEditor as never, {
      supportSideBySide: SideBySideEditor.PRIMARY,
      filterByScheme: 'file',
    });
    return resource?.scheme === 'file' ? resource.path : null;
  }

  private resolveActiveCodeEditor(): CodeEditorLike | null {
    return (
      resolveCodeEditorFromControl(this.editorService.activeTextEditorControl) ??
      (this.codeEditorService.getActiveCodeEditor() as CodeEditorLike | null)
    );
  }

  private async getSelectionChangedParams(): Promise<ClaudeIdeSelectionChangedParams | null> {
    const filePath = this.getActiveFilePath();
    if (!filePath) {
      return null;
    }

    const editor = this.resolveActiveCodeEditor();
    const model = editor?.getModel?.() ?? null;
    const modelPath = model?.uri?.scheme === 'file' ? model.uri.path : null;
    if (!editor || !model || !modelPath || modelPath !== filePath) {
      return null;
    }

    const explicitSelection = editor.getSelection?.() ?? null;
    const fallbackPosition = editor.getPosition?.() ?? null;
    const selection = explicitSelection ?? (
      fallbackPosition
        ? {
            startLineNumber: fallbackPosition.lineNumber,
            startColumn: fallbackPosition.column,
            endLineNumber: fallbackPosition.lineNumber,
            endColumn: fallbackPosition.column,
          }
        : null
    );

    if (!selection) {
      return null;
    }

    const text = isSelectionEmpty(selection)
      ? ''
      : model.getValueInRange?.(selection) ?? '';

    return createClaudeIdeSelectionChangedParams(filePath, selection, text);
  }

  private async openFile(params: ClaudeIdeOpenFileParams): Promise<void> {
    const rawFilePath = params.filePath?.trim();
    if (!rawFilePath) {
      throw new Error('openFile requires a filePath');
    }

    const filePath = normalizeClaudeIdeFilePath(rawFilePath);
    const selection = params.selection
      ? {
          startLineNumber: params.selection.start.line + 1,
          startColumn: params.selection.start.character + 1,
          endLineNumber: params.selection.end.line + 1,
          endColumn: params.selection.end.character + 1,
        }
      : undefined;

    await this.editorService.openEditor({
      resource: URI.file(filePath),
      options: {
        pinned: true,
        preserveFocus: params.makeFrontmost === false,
        ...(selection ? { selection } : {}),
      },
    });

    this.scheduleSelectionRefresh(true);
  }

  private async getDiagnostics(uri?: string): Promise<ClaudeIdeDiagnosticFile[]> {
    const resource = uri ? URI.parse(uri) : undefined;
    const markers = this.markerService.read(
      resource ? { resource } : undefined,
    );
    return createClaudeIdeDiagnosticFiles(
      markers.map((marker) => ({
        resource: marker.resource,
        severity: marker.severity,
        message: marker.message,
        source: marker.source,
        code: marker.code,
        startLineNumber: marker.startLineNumber,
        startColumn: marker.startColumn,
        endLineNumber: marker.endLineNumber,
        endColumn: marker.endColumn,
      })),
    );
  }

  private async handleFileUpdated(
    params: ClaudeIdeFileUpdatedParams,
  ): Promise<void> {
    const rawFilePath = params.filePath?.trim();
    if (!rawFilePath) {
      return;
    }

    const filePath = normalizeClaudeIdeFilePath(rawFilePath);
    const oldContent = typeof params.oldContent === 'string'
      ? params.oldContent
      : null;
    const newContent = typeof params.newContent === 'string'
      ? params.newContent
      : null;

    if (oldContent !== null && newContent !== null) {
      for (const editor of this.editorListeners.keys()) {
        const model = editor.getModel?.();
        if (model?.uri?.scheme !== 'file' || model.uri.path !== filePath) {
          continue;
        }

        if (model.getValue?.() === oldContent) {
          model.setValue?.(newContent);
        }
      }
    }

    if (this.getActiveFilePath() === filePath) {
      this.scheduleSelectionRefresh(true);
    }
  }
}
