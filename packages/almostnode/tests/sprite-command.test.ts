import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from 'just-bash';
import { setDefaultNetworkController } from '../src/network';
import { runSpriteCommand } from '../src/shims/sprite-command';
import {
  readSpriteLocalContext,
  readSpriteConfig,
  storeSpriteToken,
} from '../src/shims/sprite-storage';
import { VirtualFS } from '../src/virtual-fs';

function makeCtx(env: Record<string, string> = {}, cwd = '/'): CommandContext {
  return { cwd, env } as unknown as CommandContext;
}

function encodeBody(body: string): string {
  return Buffer.from(body, 'utf8').toString('base64');
}

function jsonResponse(
  url: string,
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
) {
  return {
    url,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    bodyBase64: encodeBody(JSON.stringify(body)),
  };
}

function emptyResponse(
  url: string,
  status = 200,
  headers: Record<string, string> = {},
) {
  return {
    url,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers,
    bodyBase64: '',
  };
}

class FakeWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  binaryType: BinaryType = 'blob';
  readonly sent: unknown[] = [];

  constructor(
    private readonly onSend?: (socket: FakeWebSocket, data: unknown) => void,
  ) {
    super();
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  emitMessage(data: unknown): void {
    const event = new Event('message') as MessageEvent;
    Object.defineProperty(event, 'data', {
      configurable: true,
      value: data,
    });
    this.dispatchEvent(event);
  }

  send(data: unknown): void {
    this.sent.push(data);
    this.onSend?.(this, data);
  }

  close(code = 1000, reason = ''): void {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    const event = new Event('close') as CloseEvent;
    Object.defineProperty(event, 'code', {
      configurable: true,
      value: code,
    });
    Object.defineProperty(event, 'reason', {
      configurable: true,
      value: reason,
    });
    this.dispatchEvent(event);
  }
}

describe('sprite command', () => {
  const originalWindow = globalThis.window;
  const originalWebSocket = globalThis.WebSocket;

  beforeEach(() => {
    setDefaultNetworkController(null);
  });

  afterEach(() => {
    setDefaultNetworkController(null);
    vi.restoreAllMocks();

    if (originalWebSocket === undefined) {
      delete (globalThis as { WebSocket?: typeof WebSocket }).WebSocket;
    } else {
      Object.defineProperty(globalThis, 'WebSocket', {
        configurable: true,
        value: originalWebSocket,
      });
    }

    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it('stores auth tokens and lists configured orgs', async () => {
    const vfs = new VirtualFS();

    const result = await runSpriteCommand(
      ['auth', 'setup', '--token', 'demo/token-id/secret'],
      makeCtx(),
      vfs,
    );

    const listed = await runSpriteCommand(['org', 'list'], makeCtx(), vfs);
    const config = readSpriteConfig(vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Configured Sprites authentication for org demo');
    expect(config.current_selection.org).toBe('demo');
    expect(config.urls['https://api.sprites.dev']?.orgs.demo?.api_token).toBe(
      'demo/token-id/secret',
    );
    expect(listed.stdout).toContain('demo (current)');
  });

  it('accepts token input through sprite login browser prompt flow', async () => {
    const vfs = new VirtualFS();
    const open = vi.fn();
    const prompt = vi.fn(() => 'demo/token-id/secret');

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        open,
        prompt,
      },
    });

    const result = await runSpriteCommand(['login'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Authenticated to Fly.io Sprites for org demo');
    expect(open).toHaveBeenCalledWith('https://sprites.dev/account', '_blank');
    expect(prompt).toHaveBeenCalled();
    expect(readSpriteConfig(vfs).current_selection.org).toBe('demo');
  });

  it('runs a command inside a sprite over the exec websocket', async () => {
    const vfs = new VirtualFS();
    storeSpriteToken(vfs, {
      org: 'demo',
      token: 'demo/token-id/secret',
    });

    const textEncoder = new TextEncoder();
    const wsUrls: string[] = [];

    Object.defineProperty(globalThis, 'WebSocket', {
      configurable: true,
      value: FakeWebSocket,
    });

    setDefaultNetworkController({
      fetch: vi.fn(),
      connectWebSocket: vi.fn(async (url: string) => {
        wsUrls.push(url);
        const socket = new FakeWebSocket((instance, data) => {
          if (!(data instanceof Uint8Array) || data[0] !== 4) {
            return;
          }
          setTimeout(() => {
            const stdout = textEncoder.encode('hello from sprite\n');
            instance.emitMessage(
              new Uint8Array([1, ...stdout]).buffer,
            );
            instance.emitMessage(new Uint8Array([3, 0]).buffer);
            instance.close(1000, '');
          }, 0);
        });
        setTimeout(() => {
          socket.open();
        }, 0);
        return {
          socket: socket as unknown as WebSocket,
          url,
          route: 'browser' as const,
          proxied: false,
        };
      }),
    } as any);

    const result = await runSpriteCommand(
      ['exec', '-s', 'my-sprite', 'echo', 'hello'],
      makeCtx(),
      vfs,
    );

    if (result.exitCode !== 0) {
      throw new Error(
        `sprite exec failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('hello from sprite\n');
    expect(wsUrls).toHaveLength(1);
    expect(wsUrls[0]).toContain('/v1/sprites/my-sprite/exec');
    expect(wsUrls[0]).toContain('cmd=echo');
    expect(wsUrls[0]).toContain('cmd=hello');
  }, 10000);

  it('deploys a directory, creates the sprite when needed, and writes local context', async () => {
    const vfs = new VirtualFS();
    storeSpriteToken(vfs, {
      org: 'demo',
      token: 'demo/token-id/secret',
    });

    vfs.mkdirSync('/workspace/my-app', { recursive: true });
    vfs.mkdirSync('/workspace/my-app/node_modules/pkg', { recursive: true });
    vfs.writeFileSync('/workspace/my-app/package.json', '{"name":"my-app"}\n');
    vfs.writeFileSync('/workspace/my-app/index.js', 'console.log("hi")\n');
    vfs.writeFileSync('/workspace/my-app/node_modules/pkg/index.js', 'skip me\n');

    const requests: Array<{ url: string; method: string }> = [];
    const uploadedPaths: string[] = [];

    setDefaultNetworkController({
      fetch: vi.fn(async (request: {
        url: string;
        method?: string;
      }) => {
        requests.push({
          url: request.url,
          method: request.method || 'GET',
        });

        if (
          request.method === 'GET'
          && request.url === 'https://api.sprites.dev/v1/sprites/my-app'
        ) {
          return emptyResponse(request.url, 404);
        }
        if (
          request.method === 'POST'
          && request.url === 'https://api.sprites.dev/v1/sprites'
        ) {
          return jsonResponse(request.url, {
            name: 'my-app',
            organization: 'demo',
            url: 'https://my-app.sprites.dev',
          });
        }
        if (
          request.method === 'PUT'
          && request.url.startsWith('https://api.sprites.dev/v1/sprites/my-app/fs/write?')
        ) {
          uploadedPaths.push(new URL(request.url).searchParams.get('path') || '');
          return emptyResponse(request.url, 200);
        }
        throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
      }),
      connectWebSocket: vi.fn(),
    } as any);

    const result = await runSpriteCommand(
      ['deploy', '--skip-install', '/workspace/my-app'],
      makeCtx({}, '/workspace'),
      vfs,
    );

    if (result.exitCode !== 0) {
      throw new Error(JSON.stringify({
        stdout: result.stdout,
        stderr: result.stderr,
        requests,
        uploadedPaths,
      }, null, 2));
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Created sprite my-app.');
    expect(result.stdout).toContain('Uploaded 2 files');
    expect(result.stdout).toContain('Console: sprite console -s my-app');
    expect(requests.some((request) => request.method === 'POST')).toBe(true);
    expect(uploadedPaths).toContain('/home/sprite/my-app/package.json');
    expect(uploadedPaths).toContain('/home/sprite/my-app/index.js');
    expect(uploadedPaths.some((value) => value.includes('node_modules'))).toBe(
      false,
    );
    expect(readSpriteLocalContext(vfs, '/workspace/my-app')).toEqual({
      organization: 'demo',
      sprite: 'my-app',
    });
  });
});
