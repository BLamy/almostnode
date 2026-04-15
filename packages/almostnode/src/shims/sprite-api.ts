import { getDefaultNetworkController, networkFetch, type NetworkController } from '../network';
import { EventEmitter } from './events';

const STREAM_ID_STDIN = 0;
const STREAM_ID_STDOUT = 1;
const STREAM_ID_STDERR = 2;
const STREAM_ID_EXIT = 3;
const STREAM_ID_STDIN_EOF = 4;

const textDecoder = new TextDecoder();

export interface SpriteInfo {
  id?: string;
  name: string;
  organization?: string;
  status?: string;
  url?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface SpriteListResult {
  sprites: SpriteInfo[];
  hasMore: boolean;
  nextContinuationToken?: string;
}

export interface SpriteExecOptions {
  apiUrl: string;
  token: string;
  spriteName: string;
  command?: string[];
  cwd?: string;
  env?: Record<string, string>;
  tty?: boolean;
  rows?: number;
  cols?: number;
  sessionId?: string;
  stdin?: string | Uint8Array | null;
  controller?: NetworkController | null;
}

export interface SpriteExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  messages: unknown[];
}

export interface SpriteFilesystemWriteOptions {
  mode?: number;
  mkdirParents?: boolean;
}

function withDefaultController(controller?: NetworkController | null): NetworkController {
  return controller ?? getDefaultNetworkController();
}

function normalizeApiUrl(apiUrl: string): string {
  return apiUrl.replace(/\/+$/, '');
}

function buildApiUrl(apiUrl: string, pathname: string): string {
  return `${normalizeApiUrl(apiUrl)}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}

function toWebSocketUrl(apiUrl: string): string {
  if (apiUrl.startsWith('https://')) {
    return `wss://${apiUrl.slice('https://'.length)}`;
  }
  if (apiUrl.startsWith('http://')) {
    return `ws://${apiUrl.slice('http://'.length)}`;
  }
  return apiUrl;
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function appendExecQuery(
  url: URL,
  options: Pick<SpriteExecOptions, 'command' | 'cwd' | 'env' | 'tty' | 'rows' | 'cols' | 'sessionId' | 'stdin'>,
): void {
  if (!options.sessionId && options.command?.length) {
    for (const arg of options.command) {
      url.searchParams.append('cmd', arg);
    }
    url.searchParams.set('path', options.command[0] ?? 'bash');
  }

  const shouldEnableStdin = options.stdin != null || options.tty || Boolean(options.sessionId);
  if (shouldEnableStdin) {
    url.searchParams.set('stdin', 'true');
  }

  if (options.cwd) {
    url.searchParams.set('dir', options.cwd);
  }

  if (options.env) {
    for (const [key, value] of Object.entries(options.env)) {
      url.searchParams.append('env', `${key}=${value}`);
    }
  }

  if (options.tty && !options.sessionId) {
    url.searchParams.set('tty', 'true');
    if (options.rows && Number.isFinite(options.rows)) {
      url.searchParams.set('rows', String(Math.max(1, Math.floor(options.rows))));
    }
    if (options.cols && Number.isFinite(options.cols)) {
      url.searchParams.set('cols', String(Math.max(1, Math.floor(options.cols))));
    }
  }
}

async function spriteFetch(
  apiUrl: string,
  token: string,
  pathname: string,
  init: RequestInit = {},
  controller?: NetworkController | null,
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return networkFetch(
    buildApiUrl(apiUrl, pathname),
    {
      ...init,
      headers,
    },
    withDefaultController(controller),
  );
}

function mapSpriteInfo(raw: Record<string, unknown>): SpriteInfo {
  return {
    id: typeof raw.id === 'string' ? raw.id : undefined,
    name: typeof raw.name === 'string' ? raw.name : '',
    organization: typeof raw.organization === 'string' ? raw.organization : undefined,
    status: typeof raw.status === 'string' ? raw.status : undefined,
    url: typeof raw.url === 'string' ? raw.url : undefined,
    createdAt: typeof raw.created_at === 'string' ? raw.created_at : undefined,
    updatedAt: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
  };
}

async function readResponseMessage(response: Response): Promise<string> {
  try {
    const body = await response.text();
    return body || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
}

export async function createSprite(
  apiUrl: string,
  token: string,
  name: string,
  controller?: NetworkController | null,
): Promise<SpriteInfo> {
  const response = await spriteFetch(
    apiUrl,
    token,
    '/v1/sprites',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    },
    controller,
  );

  if (!response.ok) {
    throw new Error(`Failed to create sprite: ${await readResponseMessage(response)}`);
  }

  return mapSpriteInfo(await response.json() as Record<string, unknown>);
}

export async function getSprite(
  apiUrl: string,
  token: string,
  name: string,
  controller?: NetworkController | null,
): Promise<SpriteInfo> {
  const response = await spriteFetch(apiUrl, token, `/v1/sprites/${name}`, {}, controller);

  if (response.status === 404) {
    throw new Error(`Sprite not found: ${name}`);
  }
  if (!response.ok) {
    throw new Error(`Failed to load sprite: ${await readResponseMessage(response)}`);
  }

  return mapSpriteInfo(await response.json() as Record<string, unknown>);
}

export async function spriteExists(
  apiUrl: string,
  token: string,
  name: string,
  controller?: NetworkController | null,
): Promise<boolean> {
  try {
    await getSprite(apiUrl, token, name, controller);
    return true;
  } catch (error) {
    return !(error instanceof Error) || !error.message.startsWith('Sprite not found:');
  }
}

export async function listSprites(
  apiUrl: string,
  token: string,
  options: {
    prefix?: string;
    controller?: NetworkController | null;
  } = {},
): Promise<SpriteListResult> {
  const url = new URL(buildApiUrl(apiUrl, '/v1/sprites'));
  if (options.prefix) {
    url.searchParams.set('prefix', options.prefix);
  }

  const response = await networkFetch(
    url.toString(),
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    withDefaultController(options.controller),
  );

  if (!response.ok) {
    throw new Error(`Failed to list sprites: ${await readResponseMessage(response)}`);
  }

  const data = await response.json() as {
    sprites?: Array<Record<string, unknown>>;
    has_more?: boolean;
    next_continuation_token?: string;
  };

  return {
    sprites: (data.sprites ?? []).map((entry) => mapSpriteInfo(entry)),
    hasMore: data.has_more === true,
    nextContinuationToken:
      typeof data.next_continuation_token === 'string'
        ? data.next_continuation_token
        : undefined,
  };
}

export async function deleteSprite(
  apiUrl: string,
  token: string,
  name: string,
  controller?: NetworkController | null,
): Promise<void> {
  const response = await spriteFetch(
    apiUrl,
    token,
    `/v1/sprites/${name}`,
    {
      method: 'DELETE',
    },
    controller,
  );

  if (!response.ok && response.status !== 204) {
    throw new Error(`Failed to delete sprite: ${await readResponseMessage(response)}`);
  }
}

export async function writeSpriteFile(
  apiUrl: string,
  token: string,
  spriteName: string,
  remotePath: string,
  content: Uint8Array,
  options: SpriteFilesystemWriteOptions = {},
  controller?: NetworkController | null,
): Promise<void> {
  const url = new URL(buildApiUrl(apiUrl, `/v1/sprites/${spriteName}/fs/write`));
  url.searchParams.set('path', remotePath);
  url.searchParams.set('workingDir', '/');

  if (options.mkdirParents !== false) {
    url.searchParams.set('mkdirParents', 'true');
  }
  if (typeof options.mode === 'number') {
    url.searchParams.set('mode', options.mode.toString(8).padStart(4, '0'));
  }

  const response = await networkFetch(
    url.toString(),
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
      },
      body: content.buffer.slice(
        content.byteOffset,
        content.byteOffset + content.byteLength,
      ),
    },
    withDefaultController(controller),
  );

  if (!response.ok) {
    throw new Error(`Failed to write ${remotePath}: ${await readResponseMessage(response)}`);
  }
}

export class SpriteExecConnection extends EventEmitter {
  private socket: WebSocket | null = null;
  private exitCode = -1;
  private started = false;
  private done = false;

  constructor(private readonly options: SpriteExecOptions) {
    super();
  }

  private emitError(error: Error): void {
    if (this.listenerCount('error') > 0) {
      this.emit('error', error);
    }
  }

  async start(): Promise<void> {
    if (this.started) {
      throw new Error('Sprite exec connection already started');
    }
    this.started = true;

    const baseWsUrl = toWebSocketUrl(normalizeApiUrl(this.options.apiUrl));
    const path = this.options.sessionId
      ? `/v1/sprites/${this.options.spriteName}/exec/${this.options.sessionId}`
      : `/v1/sprites/${this.options.spriteName}/exec`;
    const url = new URL(`${baseWsUrl}${path}`);
    appendExecQuery(url, this.options);

    const { socket } = await withDefaultController(this.options.controller).connectWebSocket(
      url.toString(),
      {
        headers: {
          Authorization: `Bearer ${this.options.token}`,
        },
      },
    );

    this.socket = socket;
    this.socket.binaryType = 'arraybuffer';

    await new Promise<void>((resolve, reject) => {
      let settled = false;

      const handleOpen = (): void => {
        settled = true;
        resolve();
      };

      const handleError = (event: Event): void => {
        const error = new Error(`Sprite exec connection failed for ${this.options.spriteName}`);
        this.emitError(error);
        if (!settled) {
          settled = true;
          reject(error);
        }
      };

      const handleCloseBeforeOpen = (): void => {
        if (!settled) {
          settled = true;
          reject(new Error(`Sprite exec connection closed before opening for ${this.options.spriteName}`));
        }
      };

      socket.addEventListener('open', handleOpen, { once: true });
      socket.addEventListener('error', handleError, { once: true });
      socket.addEventListener('close', handleCloseBeforeOpen, { once: true });
    });

    socket.addEventListener('message', (event) => {
      this.handleMessage(event);
    });
    socket.addEventListener('error', () => {
      this.emitError(new Error(`Sprite exec websocket error for ${this.options.spriteName}`));
    });
    socket.addEventListener('close', (event) => {
      this.handleClose(event);
    });

    if (this.options.stdin != null) {
      this.sendInput(this.options.stdin);
      if (!this.options.tty) {
        this.sendEOF();
      }
    } else if (!this.options.tty) {
      this.sendEOF();
    }
  }

  private handleMessage(event: MessageEvent): void {
    if (typeof event.data === 'string') {
      try {
        const message = JSON.parse(event.data) as { type?: string; exit_code?: number };
        this.emit('message', message);
        if (message.type === 'exit' && typeof message.exit_code === 'number') {
          this.exitCode = message.exit_code;
          this.finish(message.exit_code);
        }
      } catch {
        this.emit('message', event.data);
      }
      return;
    }

    const bytes = new Uint8Array(event.data as ArrayBuffer);
    if (this.options.tty) {
      this.emit('stdout', bytes);
      return;
    }

    if (bytes.length === 0) {
      return;
    }

    const streamId = bytes[0];
    const payload = bytes.slice(1);
    switch (streamId) {
      case STREAM_ID_STDOUT:
        this.emit('stdout', payload);
        break;
      case STREAM_ID_STDERR:
        this.emit('stderr', payload);
        break;
      case STREAM_ID_EXIT:
        this.exitCode = payload[0] ?? 0;
        this.finish(this.exitCode);
        break;
    }
  }

  private handleClose(event: CloseEvent): void {
    if (this.done) {
      return;
    }
    const nextExitCode = this.exitCode >= 0
      ? this.exitCode
      : (this.options.tty && event.code === 1000 ? 0 : 1);
    this.finish(nextExitCode);
  }

  private finish(exitCode: number): void {
    if (this.done) {
      return;
    }
    this.done = true;
    this.exitCode = exitCode;
    this.emit('exit', exitCode);
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.close(1000, '');
    }
  }

  sendInput(data: string | Uint8Array): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    const payload = typeof data === 'string' ? encodeText(data) : data;

    if (this.options.tty) {
      this.socket.send(payload);
      return;
    }

    const frame = new Uint8Array(payload.length + 1);
    frame[0] = STREAM_ID_STDIN;
    frame.set(payload, 1);
    this.socket.send(frame);
  }

  sendEOF(): void {
    if (this.options.tty || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(new Uint8Array([STREAM_ID_STDIN_EOF]));
  }

  resize(cols: number, rows: number): void {
    if (!this.options.tty || !this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify({
      type: 'resize',
      cols: Math.max(1, Math.floor(cols)),
      rows: Math.max(1, Math.floor(rows)),
    }));
  }

  signal(signalName: string): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.socket.send(JSON.stringify({
      type: 'signal',
      signal: signalName,
    }));
  }

  close(): void {
    if (!this.socket) {
      return;
    }
    if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
      this.socket.close(1000, '');
    }
  }

  wait(): Promise<number> {
    if (this.done) {
      return Promise.resolve(this.exitCode);
    }
    return new Promise((resolve) => {
      this.once('exit', (exitCode: number) => {
        resolve(exitCode);
      });
    });
  }
}

export async function runSpriteExec(options: SpriteExecOptions): Promise<SpriteExecResult> {
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];
  const messages: unknown[] = [];
  const connection = new SpriteExecConnection(options);
  let pendingError: Error | null = null;

  connection.on('stdout', (chunk: Uint8Array) => {
    stdoutChunks.push(chunk);
  });
  connection.on('stderr', (chunk: Uint8Array) => {
    stderrChunks.push(chunk);
  });
  connection.on('message', (message: unknown) => {
    messages.push(message);
  });
  connection.on('error', (error: Error) => {
    pendingError = error;
  });

  await connection.start();
  if (pendingError) {
    throw pendingError;
  }
  const exitCode = await new Promise<number>((resolve, reject) => {
    let settled = false;

    connection.on('error', (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });

    connection.wait().then((value) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(value);
    }, (error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    });
  });

  const stdout = textDecoder.decode(joinChunks(stdoutChunks));
  const stderr = textDecoder.decode(joinChunks(stderrChunks));

  return {
    stdout,
    stderr,
    exitCode,
    messages,
  };
}

function joinChunks(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 0) {
    return new Uint8Array(0);
  }

  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}
