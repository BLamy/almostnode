import type { MessagePortLike } from "./message-port-transport";

export type CodexHostOperation =
  | "auth/env"
  | "fs/readFile"
  | "fs/writeFile"
  | "fs/applyPatch"
  | "fs/createDirectory"
  | "fs/readDirectory"
  | "fs/getMetadata"
  | "network/fetch"
  | "command/exec"
  | "command/write"
  | "command/resize"
  | "command/terminate"
  | "process/spawn"
  | "process/writeStdin"
  | "process/resizePty"
  | "process/kill";

export interface CodexHostRequest {
  type: "codex/host/request";
  id: string;
  op: CodexHostOperation;
  params?: unknown;
}

export interface CodexHostResponse {
  type: "codex/host/response";
  id: string;
  result?: unknown;
  error?: {
    code?: string;
    message: string;
  };
}

export interface CodexHostEvent {
  type: "codex/host/event";
  event: string;
  params?: unknown;
}

export type CodexHostWireMessage =
  | CodexHostRequest
  | CodexHostResponse
  | CodexHostEvent;

export interface CreateCodexHostBridgeOptions {
  container: CodexHostContainer;
  defaultCwd?: string;
  env?: Record<string, string>;
}

export interface CodexHostContainer {
  vfs: CodexHostVirtualFileSystem;
  network?: CodexHostNetworkController;
  createTerminalSession(
    options?: CodexHostTerminalSessionOptions,
  ): CodexHostTerminalSession;
}

export interface CodexHostVirtualFileSystem {
  readFileSync(path: string): Uint8Array;
  readFileSync(path: string, encoding: "utf8" | "utf-8"): string;
  writeFileSync(path: string, data: string | Uint8Array): void;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  unlinkSync(path: string): void;
  readdirSync(path: string): string[];
  statSync(path: string): CodexHostStats;
}

export interface CodexHostStats {
  isDirectory(): boolean;
  size: number;
  mtimeMs: number;
  mode: number;
}

export interface CodexHostNetworkController {
  fetch(request: CodexHostNetworkFetchRequest): Promise<CodexHostNetworkFetchResponse>;
}

export interface CodexHostNetworkFetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  bodyBase64?: string;
  redirect?: RequestRedirect;
  credentials?: RequestCredentials;
  retryOnTailscaleRecovery?: boolean;
}

export interface CodexHostNetworkFetchResponse {
  url: string;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  bodyBase64: string;
}

export interface CodexHostTerminalSessionOptions {
  cwd?: string;
  env?: Record<string, string>;
}

export interface CodexHostRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface CodexHostTerminalSession {
  run(
    command: string,
    options?: {
      onStdout?: (data: string) => void;
      onStderr?: (data: string) => void;
      signal?: AbortSignal;
      interactive?: boolean;
    },
  ): Promise<CodexHostRunResult>;
  sendInput(data: string): void;
  resize(cols: number, rows: number): void;
  abort(): void;
  dispose(): void;
}

interface CommandExecParams {
  processId?: string;
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
  tty?: boolean;
  streamStdin?: boolean;
  timeoutMs?: number;
  streamStdoutStderr?: boolean;
  size?: TerminalSize;
}

interface CommandWriteParams {
  processId: string;
  data?: string;
  deltaBase64?: string;
  closeStdin?: boolean;
}

interface CommandResizeParams {
  processId: string;
  cols: number;
  rows: number;
}

interface ProcessSpawnParams {
  processHandle: string;
  command: string[];
  cwd: string;
  env?: Record<string, string>;
  tty?: boolean;
  streamStdin?: boolean;
  timeoutMs?: number;
  streamStdoutStderr?: boolean;
  size?: TerminalSize;
}

interface ProcessWriteStdinParams {
  processHandle: string;
  deltaBase64?: string;
  closeStdin?: boolean;
}

interface ProcessResizePtyParams {
  processHandle: string;
  cols: number;
  rows: number;
}

interface TerminalSize {
  cols: number;
  rows: number;
}

interface CommandProcess {
  session: CodexHostTerminalSession;
  timeout: ReturnType<typeof setTimeout> | null;
}

export class CodexHostBridge {
  private readonly commands = new Map<string, CommandProcess>();
  private nextProcessId = 1;
  private detachPort: (() => void) | null = null;

  constructor(private readonly options: CreateCodexHostBridgeOptions) {}

  attach(port: MessagePortLike): () => void {
    const listener = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!isCodexHostRequest(message)) return;
      void this.respondToRequest(port, message);
    };

    if (port.addEventListener) {
      port.addEventListener("message", listener);
    } else {
      const previous = port.onmessage;
      port.onmessage = (event) => {
        previous?.(event);
        listener(event);
      };
    }

    port.start?.();

    this.detachPort = () => {
      if (port.removeEventListener) {
        port.removeEventListener("message", listener);
      }
    };
    return this.detachPort;
  }

  dispose(): void {
    this.detachPort?.();
    this.detachPort = null;

    for (const process of this.commands.values()) {
      if (process.timeout) clearTimeout(process.timeout);
      process.session.dispose();
    }
    this.commands.clear();
  }

  private async respondToRequest(
    port: Pick<MessagePortLike, "postMessage">,
    request: CodexHostRequest,
  ): Promise<void> {
    try {
      const result = await this.handleRequest(port, request);
      port.postMessage({
        type: "codex/host/response",
        id: request.id,
        result,
      } satisfies CodexHostResponse);
    } catch (error) {
      port.postMessage({
        type: "codex/host/response",
        id: request.id,
        error: serializeHostError(error),
      } satisfies CodexHostResponse);
    }
  }

  private async handleRequest(
    port: Pick<MessagePortLike, "postMessage">,
    request: CodexHostRequest,
  ): Promise<unknown> {
    switch (request.op) {
      case "auth/env":
        return { env: { ...this.options.env } };
      case "fs/readFile":
        return this.readFile(request.params);
      case "fs/writeFile":
        return this.writeFile(request.params);
      case "fs/applyPatch":
        return this.applyPatch(request.params);
      case "fs/createDirectory":
        return this.createDirectory(request.params);
      case "fs/readDirectory":
        return this.readDirectory(request.params);
      case "fs/getMetadata":
        return this.getMetadata(request.params);
      case "network/fetch":
        return this.fetchNetwork(request.params);
      case "command/exec":
        return this.execCommand(port, request.params);
      case "command/write":
        return this.writeCommand(request.params);
      case "command/resize":
        return this.resizeCommand(request.params);
      case "command/terminate":
        return this.terminateCommand(request.params);
      case "process/spawn":
        return this.spawnProcess(port, request.params);
      case "process/writeStdin":
        return this.writeProcessStdin(request.params);
      case "process/resizePty":
        return this.resizeProcessPty(request.params);
      case "process/kill":
        return this.killProcess(request.params);
      default:
        return assertNever(request.op);
    }
  }

  private readFile(params: unknown): unknown {
    const { path, encoding } = assertRecord(params, "fs/readFile params");
    const filePath = assertString(path, "path");
    const requestedEncoding = encoding === "base64" ? "base64" : "utf8";

    if (requestedEncoding === "base64") {
      const bytes = this.options.container.vfs.readFileSync(filePath);
      return { content: bytesToBase64(bytes), encoding: "base64" };
    }

    return {
      content: this.options.container.vfs.readFileSync(filePath, "utf8"),
      encoding: "utf8",
    };
  }

  private writeFile(params: unknown): unknown {
    const { path, content, encoding } = assertRecord(
      params,
      "fs/writeFile params",
    );
    const filePath = assertString(path, "path");
    const fileContent = assertString(content, "content");

    ensureParentDirectory(this.options.container.vfs, filePath);
    this.options.container.vfs.writeFileSync(
      filePath,
      encoding === "base64" ? base64ToBytes(fileContent) : fileContent,
    );
    return { path: filePath };
  }

  private applyPatch(params: unknown): unknown {
    const { cwd, patch } = assertRecord(params, "fs/applyPatch params");
    const result = applyCodexPatch(
      this.options.container.vfs,
      assertString(patch, "patch"),
      cwd == null ? "/" : assertString(cwd, "cwd"),
    );
    return {
      stdout: renderApplyPatchSuccess(result.changes),
      stderr: "",
      exitCode: 0,
      changes: result.changes,
    };
  }

  private createDirectory(params: unknown): unknown {
    const { path, recursive } = assertRecord(
      params,
      "fs/createDirectory params",
    );
    const filePath = assertString(path, "path");
    this.options.container.vfs.mkdirSync(filePath, {
      recursive: recursive !== false,
    });
    return { path: filePath };
  }

  private readDirectory(params: unknown): unknown {
    const { path } = assertRecord(params, "fs/readDirectory params");
    const directoryPath = assertString(path, "path");
    const names = this.options.container.vfs.readdirSync(directoryPath);
    return {
      entries: names.map((name) => {
        const childPath = joinPosix(directoryPath, name);
        const stats = this.options.container.vfs.statSync(childPath);
        return {
          name,
          path: childPath,
          type: stats.isDirectory() ? "directory" : "file",
          size: stats.size,
          mtimeMs: stats.mtimeMs,
        };
      }),
    };
  }

  private getMetadata(params: unknown): unknown {
    const { path } = assertRecord(params, "fs/getMetadata params");
    const filePath = assertString(path, "path");
    const stats = this.options.container.vfs.statSync(filePath);
    return {
      path: filePath,
      type: stats.isDirectory() ? "directory" : "file",
      size: stats.size,
      mtimeMs: stats.mtimeMs,
      mode: stats.mode,
    };
  }

  private async fetchNetwork(params: unknown): Promise<unknown> {
    const network = this.options.container.network;
    if (!network) {
      throw new Error("Codex host bridge container does not expose network/fetch.");
    }
    return network.fetch(assertNetworkFetchParams(params));
  }

  private async execCommand(
    port: Pick<MessagePortLike, "postMessage">,
    params: unknown,
  ): Promise<unknown> {
    const parsed = assertCommandExecParams(params);
    const processId = parsed.processId ?? `codex-${this.nextProcessId++}`;
    if (this.commands.has(processId)) {
      throw Object.assign(
        new Error(`Duplicate active Codex command process: ${processId}`),
        { code: "EEXIST" },
      );
    }

    const session = this.options.container.createTerminalSession({
      cwd: parsed.cwd ?? this.options.defaultCwd,
      env: { ...this.options.env, ...parsed.env },
    });
    if (parsed.size) {
      session.resize(parsed.size.cols, parsed.size.rows);
    }

    const timeout =
      typeof parsed.timeoutMs === "number" && parsed.timeoutMs > 0
        ? setTimeout(() => {
            session.abort();
          }, parsed.timeoutMs)
        : null;

    this.commands.set(processId, { session, timeout });

    const emitOutput = (stream: "stdout" | "stderr", data: string) => {
      if (!parsed.streamStdoutStderr) return;
      const deltaBase64 = stringToBase64(data);
      port.postMessage({
        type: "codex/host/event",
        event: "command/outputDelta",
        params: {
          processId,
          stream,
          deltaBase64,
          data: deltaBase64,
        },
      } satisfies CodexHostEvent);
    };

    try {
      const result = await session.run(shellCommandFromArgv(parsed.command), {
        interactive: parsed.tty,
        onStdout: (data) => emitOutput("stdout", data),
        onStderr: (data) => emitOutput("stderr", data),
      });

      return {
        processId,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
      };
    } finally {
      if (timeout) clearTimeout(timeout);
      this.commands.delete(processId);
      session.dispose();
    }
  }

  private writeCommand(params: unknown): unknown {
    const { processId, data, deltaBase64, closeStdin } =
      assertCommandWriteParams(params);
    const process = this.getCommandProcess(processId);

    if (typeof data === "string" && data.length > 0) {
      process.session.sendInput(data);
    }

    if (typeof deltaBase64 === "string" && deltaBase64.length > 0) {
      process.session.sendInput(
        new TextDecoder().decode(base64ToBytes(deltaBase64)),
      );
    }

    if (closeStdin) {
      process.session.sendInput("\u0004");
    }

    return { processId };
  }

  private resizeCommand(params: unknown): unknown {
    const { processId, cols, rows } = assertCommandResizeParams(params);
    const process = this.getCommandProcess(processId);
    process.session.resize(cols, rows);
    return { processId, cols, rows };
  }

  private terminateCommand(params: unknown): unknown {
    const { processId } = assertRecord(params, "command/terminate params");
    const id = assertString(processId, "processId");
    const process = this.getCommandProcess(id);
    process.session.abort();
    return { processId: id };
  }

  private spawnProcess(
    port: Pick<MessagePortLike, "postMessage">,
    params: unknown,
  ): unknown {
    const parsed = assertProcessSpawnParams(params);
    const processHandle = parsed.processHandle;
    if (this.commands.has(processHandle)) {
      throw Object.assign(
        new Error(`Duplicate active Codex process: ${processHandle}`),
        { code: "EEXIST" },
      );
    }

    const session = this.options.container.createTerminalSession({
      cwd: parsed.cwd,
      env: { ...this.options.env, ...parsed.env },
    });
    if (parsed.size) {
      session.resize(parsed.size.cols, parsed.size.rows);
    }

    const timeout =
      typeof parsed.timeoutMs === "number" && parsed.timeoutMs > 0
        ? setTimeout(() => {
            session.abort();
          }, parsed.timeoutMs)
        : null;

    this.commands.set(processHandle, { session, timeout });
    void this.runSpawnedProcess(port, processHandle, session, timeout, parsed);

    return { processHandle };
  }

  private async runSpawnedProcess(
    port: Pick<MessagePortLike, "postMessage">,
    processHandle: string,
    session: CodexHostTerminalSession,
    timeout: ReturnType<typeof setTimeout> | null,
    parsed: ProcessSpawnParams,
  ): Promise<void> {
    const emitOutput = (stream: "stdout" | "stderr", data: string) => {
      if (!parsed.streamStdoutStderr) return;
      const deltaBase64 = stringToBase64(data);
      port.postMessage({
        type: "codex/host/event",
        event: "process/outputDelta",
        params: {
          processHandle,
          stream,
          deltaBase64,
        },
      } satisfies CodexHostEvent);
    };

    try {
      const result = await session.run(shellCommandFromArgv(parsed.command), {
        interactive: parsed.tty,
        onStdout: (data) => emitOutput("stdout", data),
        onStderr: (data) => emitOutput("stderr", data),
      });
      this.emitProcessExited(port, processHandle, {
        exitCode: result.exitCode,
        stdout: parsed.streamStdoutStderr ? "" : result.stdout,
        stderr: parsed.streamStdoutStderr ? "" : result.stderr,
      });
    } catch (error) {
      this.emitProcessExited(port, processHandle, {
        exitCode: 1,
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      this.commands.delete(processHandle);
      session.dispose();
    }
  }

  private emitProcessExited(
    port: Pick<MessagePortLike, "postMessage">,
    processHandle: string,
    result: Pick<CodexHostRunResult, "exitCode" | "stdout" | "stderr">,
  ): void {
    port.postMessage({
      type: "codex/host/event",
      event: "process/exited",
      params: {
        processHandle,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stdoutCapReached: false,
        stderr: result.stderr,
        stderrCapReached: false,
      },
    } satisfies CodexHostEvent);
  }

  private writeProcessStdin(params: unknown): unknown {
    const { processHandle, deltaBase64, closeStdin } =
      assertProcessWriteStdinParams(params);
    const process = this.getCommandProcess(processHandle);

    if (typeof deltaBase64 === "string" && deltaBase64.length > 0) {
      process.session.sendInput(
        new TextDecoder().decode(base64ToBytes(deltaBase64)),
      );
    }

    if (closeStdin) {
      process.session.sendInput("\u0004");
    }

    return { processHandle };
  }

  private resizeProcessPty(params: unknown): unknown {
    const { processHandle, cols, rows } = assertProcessResizePtyParams(params);
    const process = this.getCommandProcess(processHandle);
    process.session.resize(cols, rows);
    return { processHandle, cols, rows };
  }

  private killProcess(params: unknown): unknown {
    const { processHandle } = assertRecord(params, "process/kill params");
    const handle = assertString(processHandle, "processHandle");
    const process = this.getCommandProcess(handle);
    process.session.abort();
    return { processHandle: handle };
  }

  private getCommandProcess(processId: string): CommandProcess {
    const process = this.commands.get(processId);
    if (!process) {
      throw Object.assign(
        new Error(`Unknown Codex command process: ${processId}`),
        {
          code: "ENOENT",
        },
      );
    }
    return process;
  }
}

export function createCodexHostBridge(
  options: CreateCodexHostBridgeOptions,
): CodexHostBridge {
  return new CodexHostBridge(options);
}

interface ApplyPatchChange {
  kind: "add" | "update" | "delete";
  path: string;
  movePath?: string;
}

interface ParsedApplyPatchAdd {
  type: "add";
  path: string;
  lines: string[];
}

interface ParsedApplyPatchDelete {
  type: "delete";
  path: string;
}

interface ParsedApplyPatchUpdate {
  type: "update";
  path: string;
  movePath?: string;
  chunks: Array<{
    oldLines: string[];
    newLines: string[];
  }>;
}

type ParsedApplyPatchHunk =
  | ParsedApplyPatchAdd
  | ParsedApplyPatchDelete
  | ParsedApplyPatchUpdate;

function applyCodexPatch(
  vfs: CodexHostVirtualFileSystem,
  patch: string,
  cwd: string,
): { changes: ApplyPatchChange[] } {
  const hunks = parseCodexPatch(patch);
  const changes: ApplyPatchChange[] = [];

  for (const hunk of hunks) {
    if (hunk.type === "add") {
      const filePath = resolveCodexPath(cwd, hunk.path);
      if (pathExists(vfs, filePath)) {
        throw new Error(`apply_patch verification failed: File already exists: ${hunk.path}`);
      }
      ensureParentDirectory(vfs, filePath);
      vfs.writeFileSync(filePath, linesToText(hunk.lines, true));
      changes.push({ kind: "add", path: hunk.path });
      continue;
    }

    if (hunk.type === "delete") {
      const filePath = resolveCodexPath(cwd, hunk.path);
      if (!pathExists(vfs, filePath)) {
        throw new Error(
          `apply_patch verification failed: Failed to delete file ${hunk.path}: No such file or directory`,
        );
      }
      vfs.unlinkSync(filePath);
      changes.push({ kind: "delete", path: hunk.path });
      continue;
    }

    const sourcePath = resolveCodexPath(cwd, hunk.path);
    if (!pathExists(vfs, sourcePath)) {
      throw new Error(
        `apply_patch verification failed: Failed to read file to update ${hunk.path}: No such file or directory`,
      );
    }

    const original = vfs.readFileSync(sourcePath, "utf8");
    const updated = applyUpdateChunks(original, hunk);
    const destinationPath = hunk.movePath
      ? resolveCodexPath(cwd, hunk.movePath)
      : sourcePath;

    ensureParentDirectory(vfs, destinationPath);
    vfs.writeFileSync(destinationPath, updated);
    if (destinationPath !== sourcePath) {
      vfs.unlinkSync(sourcePath);
    }
    changes.push({
      kind: "update",
      path: hunk.path,
      ...(hunk.movePath ? { movePath: hunk.movePath } : {}),
    });
  }

  return { changes };
}

function parseCodexPatch(patch: string): ParsedApplyPatchHunk[] {
  const lines = patch.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  if (lines[0] !== "*** Begin Patch") {
    throw new Error("apply_patch handler received invalid patch input");
  }

  const hunks: ParsedApplyPatchHunk[] = [];
  let index = 1;
  while (index < lines.length) {
    const line = lines[index];
    if (line === "*** End Patch") {
      return hunks;
    }

    if (line.startsWith("*** Add File: ")) {
      const path = line.slice("*** Add File: ".length);
      index += 1;
      const addLines: string[] = [];
      while (index < lines.length && !isPatchControlLine(lines[index])) {
        const addLine = lines[index];
        if (!addLine.startsWith("+")) {
          throw new Error("apply_patch verification failed: Add file lines must start with +");
        }
        addLines.push(addLine.slice(1));
        index += 1;
      }
      if (addLines.length === 0) {
        throw new Error("apply_patch verification failed: Add file requires content");
      }
      hunks.push({ type: "add", path, lines: addLines });
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      hunks.push({
        type: "delete",
        path: line.slice("*** Delete File: ".length),
      });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const path = line.slice("*** Update File: ".length);
      index += 1;
      let movePath: string | undefined;
      if (lines[index]?.startsWith("*** Move to: ")) {
        movePath = lines[index].slice("*** Move to: ".length);
        index += 1;
      }

      const chunks: ParsedApplyPatchUpdate["chunks"] = [];
      let current = createPatchChunk();
      while (index < lines.length && !isPatchControlLine(lines[index])) {
        const changeLine = lines[index];
        if (changeLine === "@@" || changeLine.startsWith("@@ ")) {
          pushPatchChunk(chunks, current);
          current = createPatchChunk();
          index += 1;
          continue;
        }
        if (changeLine === "*** End of File") {
          index += 1;
          continue;
        }
        if (changeLine.startsWith(" ")) {
          const text = changeLine.slice(1);
          current.oldLines.push(text);
          current.newLines.push(text);
          index += 1;
          continue;
        }
        if (changeLine.startsWith("-")) {
          current.oldLines.push(changeLine.slice(1));
          index += 1;
          continue;
        }
        if (changeLine.startsWith("+")) {
          current.newLines.push(changeLine.slice(1));
          index += 1;
          continue;
        }
        throw new Error(`apply_patch verification failed: Invalid update line: ${changeLine}`);
      }
      pushPatchChunk(chunks, current);
      hunks.push({ type: "update", path, movePath, chunks });
      continue;
    }

    throw new Error(`apply_patch handler received invalid patch input near: ${line}`);
  }

  throw new Error("apply_patch handler received invalid patch input");
}

function applyUpdateChunks(
  original: string,
  hunk: ParsedApplyPatchUpdate,
): string {
  let lines = textToLines(original);
  let searchFrom = 0;

  for (const chunk of hunk.chunks) {
    if (chunk.oldLines.length === 0 && chunk.newLines.length === 0) {
      continue;
    }
    const index = findLineSequence(lines, chunk.oldLines, searchFrom);
    if (index < 0) {
      throw new Error(
        `apply_patch verification failed: Failed to find expected context in ${hunk.path}`,
      );
    }
    lines = [
      ...lines.slice(0, index),
      ...chunk.newLines,
      ...lines.slice(index + chunk.oldLines.length),
    ];
    searchFrom = index + chunk.newLines.length;
  }

  return linesToText(lines, original.endsWith("\n"));
}

function createPatchChunk(): ParsedApplyPatchUpdate["chunks"][number] {
  return { oldLines: [], newLines: [] };
}

function pushPatchChunk(
  chunks: ParsedApplyPatchUpdate["chunks"],
  chunk: ParsedApplyPatchUpdate["chunks"][number],
): void {
  if (chunk.oldLines.length > 0 || chunk.newLines.length > 0) {
    chunks.push(chunk);
  }
}

function isPatchControlLine(line: string | undefined): boolean {
  return (
    line == null ||
    line === "*** End Patch" ||
    line.startsWith("*** Add File: ") ||
    line.startsWith("*** Delete File: ") ||
    line.startsWith("*** Update File: ")
  );
}

function findLineSequence(
  lines: string[],
  expected: string[],
  searchFrom: number,
): number {
  if (expected.length === 0) return searchFrom;
  for (let index = searchFrom; index <= lines.length - expected.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < expected.length; offset += 1) {
      if (lines[index + offset] !== expected[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return index;
  }
  return -1;
}

function textToLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function linesToText(lines: string[], trailingNewline: boolean): string {
  return `${lines.join("\n")}${trailingNewline ? "\n" : ""}`;
}

function renderApplyPatchSuccess(changes: ApplyPatchChange[]): string {
  const labels = changes.map((change) => {
    if (change.kind === "add") return `A ${change.path}`;
    if (change.kind === "delete") return `D ${change.path}`;
    if (change.movePath) return `M ${change.path} -> ${change.movePath}`;
    return `M ${change.path}`;
  });
  return `Success. Updated the following files:\n${labels.join("\n")}\n`;
}

function resolveCodexPath(cwd: string, maybePath: string): string {
  if (maybePath.startsWith("/")) return normalizeCodexPath(maybePath);
  return normalizeCodexPath(`${cwd.replace(/\/+$/, "")}/${maybePath}`);
}

function normalizeCodexPath(input: string): string {
  const parts: string[] = [];
  for (const part of input.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return `/${parts.join("/")}`;
}

function ensureParentDirectory(
  vfs: CodexHostVirtualFileSystem,
  filePath: string,
): void {
  const parent = parentPath(filePath);
  if (parent !== "/") {
    vfs.mkdirSync(parent, { recursive: true });
  }
}

function parentPath(filePath: string): string {
  const normalized = normalizeCodexPath(filePath);
  const index = normalized.lastIndexOf("/");
  return index <= 0 ? "/" : normalized.slice(0, index);
}

function pathExists(vfs: CodexHostVirtualFileSystem, path: string): boolean {
  try {
    vfs.statSync(path);
    return true;
  } catch {
    return false;
  }
}

function isCodexHostRequest(value: unknown): value is CodexHostRequest {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    candidate.type === "codex/host/request" &&
    typeof candidate.id === "string" &&
    typeof candidate.op === "string"
  );
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  return value;
}

function assertNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number`);
  }
  return value;
}

function assertStringRecord(
  value: unknown,
  label: string,
): Record<string, string> | undefined {
  if (value == null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }

  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      throw new Error(`${label}.${key} must be a string`);
    }
    result[key] = entry;
  }
  return result;
}

function assertNetworkFetchParams(params: unknown): CodexHostNetworkFetchRequest {
  const record = assertRecord(params, "network/fetch params");
  return {
    url: assertString(record.url, "url"),
    method:
      record.method == null ? undefined : assertString(record.method, "method"),
    headers: assertStringRecord(record.headers, "headers"),
    bodyBase64:
      record.bodyBase64 == null
        ? undefined
        : assertString(record.bodyBase64, "bodyBase64"),
    redirect:
      record.redirect == null
        ? undefined
        : assertString(record.redirect, "redirect") as RequestRedirect,
    credentials:
      record.credentials == null
        ? undefined
        : assertString(record.credentials, "credentials") as RequestCredentials,
    retryOnTailscaleRecovery: record.retryOnTailscaleRecovery === true,
  };
}

function assertCommandExecParams(params: unknown): CommandExecParams {
  const record = assertRecord(params, "command/exec params");
  const command = record.command;
  if (
    !Array.isArray(command) ||
    command.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("command must be a string array");
  }

  return {
    processId:
      record.processId == null
        ? undefined
        : assertString(record.processId, "processId"),
    command,
    cwd: record.cwd == null ? undefined : assertString(record.cwd, "cwd"),
    env: assertStringRecord(record.env, "env"),
    tty: record.tty === true,
    streamStdin: record.tty === true || record.streamStdin === true,
    timeoutMs:
      record.timeoutMs == null
        ? undefined
        : assertNumber(record.timeoutMs, "timeoutMs"),
    streamStdoutStderr:
      record.tty === true || record.streamStdoutStderr === true,
    size: record.size == null ? undefined : assertTerminalSize(record.size),
  };
}

function assertCommandWriteParams(params: unknown): CommandWriteParams {
  const record = assertRecord(params, "command/write params");
  const data =
    record.data == null ? undefined : assertString(record.data, "data");
  const deltaBase64 =
    record.deltaBase64 == null
      ? undefined
      : assertString(record.deltaBase64, "deltaBase64");
  const closeStdin = record.closeStdin === true;
  if (!data && !deltaBase64 && !closeStdin) {
    throw new Error("command/write requires data, deltaBase64, or closeStdin");
  }

  return {
    processId: assertString(record.processId, "processId"),
    data,
    deltaBase64,
    closeStdin,
  };
}

function assertTerminalSize(value: unknown): TerminalSize {
  const record = assertRecord(value, "size");
  return {
    cols: assertNumber(record.cols, "size.cols"),
    rows: assertNumber(record.rows, "size.rows"),
  };
}

function assertCommandResizeParams(params: unknown): CommandResizeParams {
  const record = assertRecord(params, "command/resize params");
  return {
    processId: assertString(record.processId, "processId"),
    cols: assertNumber(record.cols, "cols"),
    rows: assertNumber(record.rows, "rows"),
  };
}

function assertProcessSpawnParams(params: unknown): ProcessSpawnParams {
  const record = assertRecord(params, "process/spawn params");
  const command = record.command;
  if (
    !Array.isArray(command) ||
    command.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("command must be a string array");
  }

  return {
    processHandle: assertString(record.processHandle, "processHandle"),
    command,
    cwd: assertString(record.cwd, "cwd"),
    env: assertStringRecord(record.env, "env"),
    tty: record.tty === true,
    streamStdin: record.tty === true || record.streamStdin === true,
    timeoutMs:
      record.timeoutMs == null
        ? undefined
        : assertNumber(record.timeoutMs, "timeoutMs"),
    streamStdoutStderr:
      record.tty === true || record.streamStdoutStderr === true,
    size: record.size == null ? undefined : assertTerminalSize(record.size),
  };
}

function assertProcessWriteStdinParams(
  params: unknown,
): ProcessWriteStdinParams {
  const record = assertRecord(params, "process/writeStdin params");
  const deltaBase64 =
    record.deltaBase64 == null
      ? undefined
      : assertString(record.deltaBase64, "deltaBase64");
  const closeStdin = record.closeStdin === true;
  if (!deltaBase64 && !closeStdin) {
    throw new Error("process/writeStdin requires deltaBase64 or closeStdin");
  }

  return {
    processHandle: assertString(record.processHandle, "processHandle"),
    deltaBase64,
    closeStdin,
  };
}

function assertProcessResizePtyParams(params: unknown): ProcessResizePtyParams {
  const record = assertRecord(params, "process/resizePty params");
  return {
    processHandle: assertString(record.processHandle, "processHandle"),
    cols: assertNumber(record.cols, "cols"),
    rows: assertNumber(record.rows, "rows"),
  };
}

function serializeHostError(error: unknown): {
  code?: string;
  message: string;
} {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return {
      code: typeof code === "string" ? code : undefined,
      message: error.message,
    };
  }

  return { message: String(error) };
}

function shellCommandFromArgv(argv: string[]): string {
  return argv.map(quoteShellArg).join(" ");
}

function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function joinPosix(parent: string, child: string): string {
  if (parent === "/") return `/${child}`;
  return `${parent.replace(/\/+$/, "")}/${child}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  const bufferCtor = (
    globalThis as typeof globalThis & { Buffer?: typeof Buffer }
  ).Buffer;
  if (bufferCtor) return bufferCtor.from(bytes).toString("base64");

  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const bufferCtor = (
    globalThis as typeof globalThis & { Buffer?: typeof Buffer }
  ).Buffer;
  if (bufferCtor) return new Uint8Array(bufferCtor.from(value, "base64"));

  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function stringToBase64(value: string): string {
  return bytesToBase64(new TextEncoder().encode(value));
}

function assertNever(value: never): never {
  throw new Error(`Unsupported Codex host operation: ${String(value)}`);
}
