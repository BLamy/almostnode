import type { ContainerInstance } from "almostnode";
import {
  isSupportedOxcPath,
  resolveOxcConfigForFile,
  type OxcDiagnostic,
  type RunOxcOnSourceOptions,
  type RunOxcOnSourceResult,
} from "almostnode/internal";
import * as monaco from "monaco-editor";
import OxcWorker from "../workers/oxc.worker?worker";

const OXC_MARKER_OWNER = "oxlint";
const OXC_SUPPORTED_LANGUAGE_IDS = [
  "javascript",
  "javascriptreact",
  "typescript",
  "typescriptreact",
] as const;

function readWorkspaceText(
  container: ContainerInstance,
  filePath: string,
): string | null {
  if (!container.vfs.existsSync(filePath)) {
    return null;
  }

  try {
    const raw: unknown = container.vfs.readFileSync(filePath);
    if (typeof raw === "string") {
      return raw;
    }
    if (raw instanceof Uint8Array) {
      return new TextDecoder().decode(raw);
    }
    if (raw instanceof ArrayBuffer) {
      return new TextDecoder().decode(new Uint8Array(raw));
    }
    if (raw && typeof raw === "object" && ArrayBuffer.isView(raw)) {
      const view = raw as ArrayBufferView;
      return new TextDecoder().decode(
        new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
      );
    }
    return String(raw);
  } catch {
    return null;
  }
}

function createOxcAccessor(container: ContainerInstance) {
  return {
    exists(targetPath: string): boolean {
      return container.vfs.existsSync(targetPath);
    },
    readText(targetPath: string): string | null {
      return readWorkspaceText(container, targetPath);
    },
  };
}

function modelPath(model: monaco.editor.ITextModel): string | null {
  if (model.uri.scheme !== "file") {
    return null;
  }
  const filePath = model.uri.fsPath || model.uri.path;
  return filePath || null;
}

function isOxcModel(model: monaco.editor.ITextModel): boolean {
  const filePath = modelPath(model);
  return !!filePath && isSupportedOxcPath(filePath);
}

function toMarkerSeverity(
  severity: OxcDiagnostic["severity"],
): monaco.MarkerSeverity {
  switch (severity) {
    case "error":
      return monaco.MarkerSeverity.Error;
    case "warning":
      return monaco.MarkerSeverity.Warning;
    default:
      return monaco.MarkerSeverity.Info;
  }
}

class OxcWorkerClient {
  private readonly worker = new OxcWorker();
  private workerError: Error | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: RunOxcOnSourceResult) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor() {
    this.worker.onmessage = (
      event: MessageEvent<{
        id: number;
        result?: RunOxcOnSourceResult;
        error?: string;
      }>,
    ) => {
      const pending = this.pending.get(event.data.id);
      if (!pending) {
        return;
      }
      this.pending.delete(event.data.id);
      if (event.data.error) {
        pending.reject(new Error(event.data.error));
        return;
      }
      pending.resolve(event.data.result!);
    };
    this.worker.onerror = (event) => {
      const error = new Error(
        event.message ? `OXC worker crashed: ${event.message}` : "OXC worker crashed",
      );
      this.workerError = error;
      console.error("[oxc] worker error", event);
      for (const pending of this.pending.values()) {
        pending.reject(error);
      }
      this.pending.clear();
    };
  }

  run(input: RunOxcOnSourceOptions) {
    if (this.workerError) {
      return Promise.reject(this.workerError);
    }
    const id = this.nextRequestId++;
    const promise = new Promise<RunOxcOnSourceResult>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.worker.postMessage({ id, input });
    return promise;
  }

  dispose(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}

export function installOxcMonacoIntegration(
  container: ContainerInstance,
): monaco.IDisposable {
  const workerClient = new OxcWorkerClient();
  const accessor = createOxcAccessor(container);
  const lintTimers = new Map<string, number>();
  const modelDisposables = new Map<string, monaco.IDisposable>();
  const disposables: monaco.IDisposable[] = [];

  const runLint = async (model: monaco.editor.ITextModel): Promise<void> => {
    if (model.isDisposed() || !isOxcModel(model)) {
      monaco.editor.setModelMarkers(model, OXC_MARKER_OWNER, []);
      return;
    }

    const filePath = modelPath(model)!;
    const config = resolveOxcConfigForFile(accessor, filePath);

    try {
      const result = await workerClient.run({
        filePath,
        sourceText: model.getValue(),
        format: false,
        lint: true,
        linterConfigText: config.linterConfigText,
      });

      if (model.isDisposed()) {
        return;
      }

      const markers = result.diagnostics.map((diagnostic) => ({
        severity: toMarkerSeverity(diagnostic.severity),
        message: diagnostic.helpMessage
          ? `${diagnostic.message} (${diagnostic.helpMessage})`
          : diagnostic.message,
        startLineNumber: model.getPositionAt(diagnostic.start).lineNumber,
        startColumn: model.getPositionAt(diagnostic.start).column,
        endLineNumber: model.getPositionAt(diagnostic.end).lineNumber,
        endColumn: model.getPositionAt(diagnostic.end).column,
        source: "oxlint",
      }));

      monaco.editor.setModelMarkers(model, OXC_MARKER_OWNER, markers);
    } catch {
      monaco.editor.setModelMarkers(model, OXC_MARKER_OWNER, []);
    }
  };

  const scheduleLint = (model: monaco.editor.ITextModel): void => {
    const key = model.uri.toString();
    const existing = lintTimers.get(key);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    lintTimers.set(
      key,
      window.setTimeout(() => {
        lintTimers.delete(key);
        void runLint(model);
      }, 180),
    );
  };

  const trackModel = (model: monaco.editor.ITextModel): void => {
    const key = model.uri.toString();
    if (modelDisposables.has(key)) {
      return;
    }

    const disposablesForModel: monaco.IDisposable[] = [];
    disposablesForModel.push(model.onDidChangeContent(() => {
      scheduleLint(model);
    }));
    modelDisposables.set(key, {
      dispose() {
        for (const disposable of disposablesForModel) {
          disposable.dispose();
        }
      },
    });
    scheduleLint(model);
  };

  for (const languageId of OXC_SUPPORTED_LANGUAGE_IDS) {
    disposables.push(monaco.languages.registerDocumentFormattingEditProvider(languageId, {
      async provideDocumentFormattingEdits(model) {
        if (!isOxcModel(model)) {
          return [];
        }
        const filePath = modelPath(model)!;
        const config = resolveOxcConfigForFile(accessor, filePath);
        try {
          const result = await workerClient.run({
            filePath,
            sourceText: model.getValue(),
            format: true,
            lint: false,
            formatterConfigText: config.formatterConfigText,
          });
          if (!result.formattedText || result.formattedText === model.getValue()) {
            return [];
          }
          return [{
            range: model.getFullModelRange(),
            text: result.formattedText,
          }];
        } catch {
          return [];
        }
      },
    }));
  }

  for (const model of monaco.editor.getModels()) {
    trackModel(model);
  }

  disposables.push(monaco.editor.onDidCreateModel((model) => {
    trackModel(model);
  }));
  disposables.push(monaco.editor.onWillDisposeModel((model) => {
    const key = model.uri.toString();
    const pending = lintTimers.get(key);
    if (pending !== undefined) {
      window.clearTimeout(pending);
      lintTimers.delete(key);
    }
    modelDisposables.get(key)?.dispose();
    modelDisposables.delete(key);
    monaco.editor.setModelMarkers(model, OXC_MARKER_OWNER, []);
  }));

  return {
    dispose() {
      for (const timerId of lintTimers.values()) {
        window.clearTimeout(timerId);
      }
      lintTimers.clear();
      for (const disposable of modelDisposables.values()) {
        disposable.dispose();
      }
      modelDisposables.clear();
      for (const disposable of disposables) {
        disposable.dispose();
      }
      workerClient.dispose();
    },
  };
}
