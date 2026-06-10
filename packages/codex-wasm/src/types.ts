export interface CodexCliTerminalSize {
  columns: number;
  rows: number;
}

export interface CodexCliRunOptions {
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  terminalSize?: CodexCliTerminalSize;
}

export interface CodexCliRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  env?: Record<string, string>;
  browserExec?: CodexCliBrowserExecPlan;
  browserLogin?: CodexCliBrowserLoginRequest;
  browserTui?: CodexCliBrowserTuiResult;
}

export interface CodexCliBrowserExecPlan {
  prompt: string;
  model: string;
  instructions: string;
  toolChoice: string;
  parallelToolCalls: boolean;
  store: boolean;
  stream: boolean;
  json: boolean;
  outputLastMessagePath?: string;
  warnings: string[];
  cwd?: string;
  applyPatchGrammar?: string;
}

export type CodexCliBrowserLoginRequest =
  | { type: "chatgpt" }
  | { type: "deviceCode" };

export interface CodexCliBrowserTuiResult {
  ansi: string;
  action: CodexCliBrowserTuiAction;
  scrollbackAnsi?: string;
  cursor?: {
    x: number;
    y: number;
  };
}

export type CodexCliBrowserTuiAction =
  | { type: "none" }
  | { type: "login" }
  | { type: "exec"; prompt: string }
  | { type: "shell"; command: string }
  | { type: "exit"; exitCode: number };

export interface CodexCliWorkerStartMessage {
  type: "codex-cli/worker/start";
  port: MessagePort;
  wasmModuleUrl?: string;
  wasmInitInput?: string | URL | Request | BufferSource | WebAssembly.Module;
}

export interface CodexCliWorkerReadyMessage {
  type: "codex-cli/worker/ready";
  supportsRealCodex: boolean;
}

export interface CodexCliWorkerRunMessage extends CodexCliRunOptions {
  type: "codex-cli/worker/run";
  id: string;
  args: string[];
}

export interface CodexCliWorkerRunResultMessage {
  type: "codex-cli/worker/runResult";
  id: string;
  result: CodexCliRunResult;
}

export interface CodexCliWorkerRunErrorMessage {
  type: "codex-cli/worker/runError";
  id: string;
  error: {
    message: string;
    stack?: string;
  };
}

export interface CodexCliWorkerErrorMessage {
  type: "codex-cli/worker/error";
  message: string;
  stack?: string;
}

export type CodexCliWorkerMessage =
  | CodexCliWorkerStartMessage
  | CodexCliWorkerReadyMessage
  | CodexCliWorkerRunMessage
  | CodexCliWorkerRunResultMessage
  | CodexCliWorkerRunErrorMessage
  | CodexCliWorkerErrorMessage;
