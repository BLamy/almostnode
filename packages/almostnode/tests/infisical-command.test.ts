import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createContainer } from '../src/index';
import { setDefaultNetworkController } from '../src/network';
import type { ShellCommandContext } from '../src/shell-commands';
import { runInfisicalCommand } from '../src/shims/infisical-command';
import {
  readInfisicalAuth,
  readInfisicalConfig,
  readInfisicalWorkspaceConfig,
  writeInfisicalAuth,
  writeInfisicalConfig,
  writeInfisicalWorkspaceConfig,
} from '../src/shims/infisical-auth';
import { VirtualFS } from '../src/virtual-fs';

function makeCtx(env: Record<string, string> = {}, cwd = '/'): ShellCommandContext {
  return { cwd, env } as unknown as ShellCommandContext;
}

type KeypressHandler = (
  ch: string | undefined,
  key: { name?: string; ctrl?: boolean; sequence?: string },
) => void;

function makeInteractiveCtx(env: Record<string, string> = {}, cwd = '/'): {
  ctx: ShellCommandContext;
  sendKey: KeypressHandler;
  sendKeys: (events: Array<Parameters<KeypressHandler>>) => void;
  stdout: () => string;
  stderr: () => string;
  hasKeypressListener: () => boolean;
} {
  const handlers = new Set<KeypressHandler>();
  const stdoutBuffer: string[] = [];
  const stderrBuffer: string[] = [];

  const ctx = {
    cwd,
    env,
    writeStdout: (data: string) => { stdoutBuffer.push(data); },
    writeStderr: (data: string) => { stderrBuffer.push(data); },
    onKeypress: (handler: KeypressHandler) => {
      handlers.add(handler);
      return () => { handlers.delete(handler); };
    },
  } as unknown as ShellCommandContext;

  const sendKey: KeypressHandler = (ch, key) => {
    for (const handler of Array.from(handlers)) handler(ch, key);
  };

  return {
    ctx,
    sendKey,
    sendKeys: (events) => { for (const args of events) sendKey(...args); },
    stdout: () => stdoutBuffer.join(''),
    stderr: () => stderrBuffer.join(''),
    hasKeypressListener: () => handlers.size > 0,
  };
}

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function base64(s: string): string {
  return Buffer.from(s, 'utf8').toString('base64');
}

function encodeBody(body: string): string {
  return Buffer.from(body, 'utf8').toString('base64');
}

function decodeBody(value?: string): string {
  if (!value) return '';
  return Buffer.from(value, 'base64').toString('utf8');
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
    statusText: status >= 200 && status < 300 ? 'OK' : 'Error',
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    bodyBase64: encodeBody(JSON.stringify(body)),
  };
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function createJwt(
  payload: Record<string, unknown>,
): string {
  return [
    base64UrlJson({ alg: 'none', typ: 'JWT' }),
    base64UrlJson(payload),
    '',
  ].join('.');
}

describe('infisical command', () => {
  const originalWindow = globalThis.window;
  const desktopLoopbackBridgeKey = Symbol.for('almostnode.desktopOAuthLoopback');

  beforeEach(() => {
    setDefaultNetworkController(null);
  });

  afterEach(() => {
    setDefaultNetworkController(null);
    vi.restoreAllMocks();

    if (originalWindow === undefined) {
      delete (globalThis as { window?: Window }).window;
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }

    delete (globalThis as typeof globalThis & {
      [desktopLoopbackBridgeKey]?: unknown;
    })[desktopLoopbackBridgeKey];
  });

  it('logs in through the desktop browser flow and stores the user session', async () => {
    const vfs = new VirtualFS();
    let openedUrl = '';
    const accessToken = createJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      sub: 'user-1',
    });

    (globalThis as typeof globalThis & {
      [desktopLoopbackBridgeKey]?: unknown;
    })[desktopLoopbackBridgeKey] = {
      createSession: vi.fn(async () => ({
        sessionId: 'desktop-infisical-session',
        redirectUri: 'http://127.0.0.1:43123/',
      })),
      openExternal: vi.fn(async (input: { url: string }) => {
        openedUrl = input.url;
        return { opened: true };
      }),
      waitForCallback: vi.fn(async () => ({
        callbackUrl: 'http://127.0.0.1:43123/',
        requestMethod: 'POST',
        requestBody: JSON.stringify({
          email: 'user@example.com',
          JTWToken: accessToken,
          RefreshToken: 'refresh-token-1',
          privateKey: 'private-key-1',
        }),
      })),
    };

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        open: vi.fn(),
      },
    });

    const result = await runInfisicalCommand(
      ['login'],
      makeCtx(),
      vfs,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Welcome to Infisical!');
    expect(result.stdout).toContain('user@example.com');
    expect(result.stdout).toContain('Quick links');
    expect(result.stdout).toContain('https://infisical.com/docs/cli/usage');
    expect(openedUrl).toContain('https://app.infisical.com/login');
    expect(openedUrl).toContain('callback_port=43123');

    expect(readInfisicalConfig(vfs)).toMatchObject({
      domain: 'https://app.infisical.com',
      loggedInUserEmail: 'user@example.com',
    });
    expect(readInfisicalAuth(vfs)).toMatchObject({
      accessToken,
      email: 'user@example.com',
      refreshToken: 'refresh-token-1',
      privateKey: 'private-key-1',
      method: 'user',
    });
    expect(readInfisicalAuth(vfs).expiresAt).toBeTruthy();
  });

  it('lets the user pick the EU hosting option via the arrow-key menu', async () => {
    const vfs = new VirtualFS();
    let openedUrl = '';
    const accessToken = createJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      sub: 'user-eu',
    });

    (globalThis as typeof globalThis & {
      [desktopLoopbackBridgeKey]?: unknown;
    })[desktopLoopbackBridgeKey] = {
      createSession: vi.fn(async () => ({
        sessionId: 'eu-session',
        redirectUri: 'http://127.0.0.1:55118/',
      })),
      openExternal: vi.fn(async (input: { url: string }) => {
        openedUrl = input.url;
        return { opened: true };
      }),
      waitForCallback: vi.fn(async () => {
        // Delay so the test has time to send arrow keys first.
        await new Promise((resolve) => setTimeout(resolve, 50));
        return {
          callbackUrl: 'http://127.0.0.1:55118/',
          requestMethod: 'POST',
          requestBody: JSON.stringify({
            email: 'eu@example.com',
            JTWToken: accessToken,
            RefreshToken: 'refresh-eu',
            privateKey: 'pk-eu',
          }),
        };
      }),
    };

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { open: vi.fn() },
    });

    const interactive = makeInteractiveCtx();
    const loginPromise = runInfisicalCommand(['login'], interactive.ctx, vfs);

    // Wait for the select prompt to attach its keypress listener, then
    // navigate down to "Infisical Cloud (EU Region)" and confirm.
    await flushMicrotasks();
    expect(interactive.hasKeypressListener()).toBe(true);
    interactive.sendKey(undefined, { name: 'down' });
    interactive.sendKey('\r', { name: 'return' });

    const result = await loginPromise;
    expect(result.exitCode).toBe(0);
    expect(openedUrl).toContain('https://eu.infisical.com/login');
    expect(readInfisicalConfig(vfs)).toMatchObject({ domain: 'https://eu.infisical.com' });
    expect(readInfisicalAuth(vfs)).toMatchObject({
      accessToken,
      email: 'eu@example.com',
      domain: 'https://eu.infisical.com',
    });
  });

  it('accepts a pasted base64 token when the loopback never fires', async () => {
    vi.useFakeTimers();
    const vfs = new VirtualFS();
    const accessToken = createJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      sub: 'paste-user',
    });
    const pastedToken = base64(JSON.stringify({
      email: 'pasted@example.com',
      JTWToken: accessToken,
      RefreshToken: 'refresh-pasted',
      privateKey: 'pk-pasted',
    }));

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { open: vi.fn() },
    });

    const interactive = makeInteractiveCtx();
    const loginPromise = runInfisicalCommand(
      ['login', '--domain=https://app.infisical.com'],
      interactive.ctx,
      vfs,
    );

    // Advance past the 5s paste prompt delay.
    await vi.advanceTimersByTimeAsync(5_500);
    expect(interactive.hasKeypressListener()).toBe(true);
    // Stream the base64 token character-by-character, then Enter.
    for (const ch of pastedToken) {
      interactive.sendKey(ch, { sequence: ch });
    }
    interactive.sendKey('\r', { name: 'return' });

    // Advance past the 1s welcome-banner sleep.
    await vi.advanceTimersByTimeAsync(1_100);

    const result = await loginPromise;
    vi.useRealTimers();

    expect(result.exitCode).toBe(0);
    expect(interactive.stdout()).toContain('Welcome to Infisical!');
    expect(interactive.stdout()).toContain('pasted@example.com');
    expect(readInfisicalAuth(vfs)).toMatchObject({
      accessToken,
      email: 'pasted@example.com',
      method: 'user',
    });
  });

  it('still supports Universal Auth for automation', async () => {
    const vfs = new VirtualFS();

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        expect(request.method).toBe('POST');
        expect(request.url).toBe('https://app.infisical.com/api/v1/auth/universal-auth/login');
        expect(JSON.parse(decodeBody(request.bodyBase64))).toEqual({
          clientId: 'client-id',
          clientSecret: 'client-secret',
          organizationSlug: 'team-two',
        });

        return jsonResponse(request.url, {
          accessToken: 'inf-access-token',
          expiresIn: 3600,
          accessTokenMaxTTL: 3600,
          tokenType: 'Bearer',
        });
      }),
    } as any);

    const result = await runInfisicalCommand(
      [
        'login',
        '--method=universal-auth',
        '--client-id=client-id',
        '--client-secret=client-secret',
        '--organization-slug=team-two',
      ],
      makeCtx(),
      vfs,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Authenticated with Infisical Universal Auth.');
    expect(readInfisicalConfig(vfs).machineIdentity).toMatchObject({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      organizationSlug: 'team-two',
    });
    expect(readInfisicalAuth(vfs)).toMatchObject({
      accessToken: 'inf-access-token',
      method: 'universal-auth',
      clientId: 'client-id',
      organizationSlug: 'team-two',
    });
  });

  it('writes a workspace project config with init', async () => {
    const vfs = new VirtualFS();

    const result = await runInfisicalCommand(
      ['init', '--projectId=project-123', '--env=prod'],
      makeCtx({}, '/workspace/app'),
      vfs,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('project-123');
    expect(readInfisicalWorkspaceConfig(vfs, '/workspace/app')).toMatchObject({
      workspaceId: 'project-123',
      defaultEnvironment: 'prod',
    });
  });

  it('lists and retrieves secrets using the stored browser session', async () => {
    const vfs = new VirtualFS();
    const accessToken = createJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      sub: 'user-2',
    });
    writeInfisicalConfig(vfs, {
      ...readInfisicalConfig(vfs),
      domain: 'https://app.infisical.com',
      loggedInUserEmail: 'reader@example.com',
    });
    writeInfisicalAuth(vfs, {
      version: 2,
      accessToken,
      email: 'reader@example.com',
      refreshToken: 'refresh-token-2',
      privateKey: 'private-key-2',
      tokenType: 'Bearer',
      expiresAt: null,
      issuedAt: null,
      domain: 'https://app.infisical.com',
      method: 'user',
      clientId: null,
      organizationSlug: null,
    });
    writeInfisicalWorkspaceConfig(vfs, '/workspace/app', {
      workspaceId: 'project-456',
      defaultEnvironment: 'staging',
    });

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (request.method === 'GET' && request.url.startsWith('https://app.infisical.com/api/v4/secrets?')) {
          expect(request.headers?.authorization).toBe(`Bearer ${accessToken}`);
          expect(request.url).toContain('projectId=project-456');
          expect(request.url).toContain('environment=staging');
          return jsonResponse(request.url, {
            secrets: [
              {
                secretKey: 'FOO',
                secretValue: 'bar',
              },
            ],
          });
        }

        if (request.method === 'GET' && request.url.startsWith('https://app.infisical.com/api/v4/secrets/FOO?')) {
          expect(request.headers?.authorization).toBe(`Bearer ${accessToken}`);
          return jsonResponse(request.url, {
            secret: {
              secretKey: 'FOO',
              secretValue: 'bar',
            },
          });
        }

        throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
      }),
    } as any);

    const listResult = await runInfisicalCommand(
      ['secrets'],
      makeCtx({}, '/workspace/app'),
      vfs,
    );
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout).toBe('FOO=bar\n');

    const getResult = await runInfisicalCommand(
      ['secrets', 'get', 'FOO', '--plain'],
      makeCtx({}, '/workspace/app'),
      vfs,
    );
    expect(getResult.exitCode).toBe(0);
    expect(getResult.stdout).toBe('bar\n');
  });

  it('creates, updates, and deletes secrets via the v4 API', async () => {
    const vfs = new VirtualFS();
    const accessToken = createJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      sub: 'user-3',
    });
    writeInfisicalConfig(vfs, {
      ...readInfisicalConfig(vfs),
      domain: 'https://app.infisical.com',
      loggedInUserEmail: 'writer@example.com',
    });
    writeInfisicalAuth(vfs, {
      version: 2,
      accessToken,
      email: 'writer@example.com',
      refreshToken: 'refresh-token-3',
      privateKey: 'private-key-3',
      tokenType: 'Bearer',
      expiresAt: null,
      issuedAt: null,
      domain: 'https://app.infisical.com',
      method: 'user',
      clientId: null,
      organizationSlug: null,
    });
    writeInfisicalWorkspaceConfig(vfs, '/workspace/app', {
      workspaceId: 'project-789',
      defaultEnvironment: 'dev',
    });

    const seenRequests: Array<{ body: string; method: string; url: string }> = [];
    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        seenRequests.push({
          body: decodeBody(request.bodyBase64),
          method: request.method || 'GET',
          url: request.url,
        });

        if (
          request.method === 'PATCH'
          && request.url === 'https://app.infisical.com/api/v4/secrets/EXISTING_SECRET'
        ) {
          expect(request.headers?.authorization).toBe(`Bearer ${accessToken}`);
          expect(JSON.parse(decodeBody(request.bodyBase64))).toMatchObject({
            environment: 'dev',
            projectId: 'project-789',
            secretPath: '/',
            secretValue: 'updated-value',
            type: 'shared',
          });
          return jsonResponse(request.url, {
            secret: {
              secretKey: 'EXISTING_SECRET',
              secretValue: 'updated-value',
            },
          });
        }

        if (
          request.method === 'PATCH'
          && request.url === 'https://app.infisical.com/api/v4/secrets/NEW_SECRET'
        ) {
          return {
            url: request.url,
            status: 404,
            statusText: 'Not Found',
            headers: {
              'content-type': 'application/json',
            },
            bodyBase64: encodeBody(JSON.stringify({ message: 'not found' })),
          };
        }

        if (
          request.method === 'POST'
          && request.url === 'https://app.infisical.com/api/v4/secrets/NEW_SECRET'
        ) {
          expect(request.headers?.authorization).toBe(`Bearer ${accessToken}`);
          expect(JSON.parse(decodeBody(request.bodyBase64))).toMatchObject({
            environment: 'dev',
            projectId: 'project-789',
            secretPath: '/',
            secretValue: 'created-value',
            type: 'shared',
          });
          return jsonResponse(request.url, {
            secret: {
              secretKey: 'NEW_SECRET',
              secretValue: 'created-value',
            },
          });
        }

        if (
          request.method === 'DELETE'
          && request.url === 'https://app.infisical.com/api/v4/secrets/EXISTING_SECRET'
        ) {
          expect(JSON.parse(decodeBody(request.bodyBase64))).toMatchObject({
            environment: 'dev',
            projectId: 'project-789',
            secretPath: '/',
            type: 'shared',
          });
          return jsonResponse(request.url, {
            secret: {
              secretKey: 'EXISTING_SECRET',
            },
          });
        }

        throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
      }),
    } as any);

    const setResult = await runInfisicalCommand(
      ['secrets', 'set', 'NEW_SECRET=created-value', 'EXISTING_SECRET=updated-value'],
      makeCtx({}, '/workspace/app'),
      vfs,
    );
    expect(setResult.exitCode).toBe(0);
    expect(setResult.stdout).toContain('CREATED NEW_SECRET');
    expect(setResult.stdout).toContain('UPDATED EXISTING_SECRET');

    const deleteResult = await runInfisicalCommand(
      ['secrets', 'delete', 'EXISTING_SECRET'],
      makeCtx({}, '/workspace/app'),
      vfs,
    );
    expect(deleteResult.exitCode).toBe(0);
    expect(deleteResult.stdout).toContain('DELETED EXISTING_SECRET');
    expect(seenRequests.some((request) => request.method === 'POST' && request.url.endsWith('/NEW_SECRET'))).toBe(true);
    expect(seenRequests.some((request) => request.method === 'DELETE' && request.url.endsWith('/EXISTING_SECRET'))).toBe(true);
  });

  it('is registered as a shell command for container.run callers', async () => {
    const container = createContainer();
    const accessToken = createJwt({
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      sub: 'user-4',
    });

    writeInfisicalConfig(container.vfs, {
      ...readInfisicalConfig(container.vfs),
      loggedInUserEmail: 'shell@example.com',
    });
    writeInfisicalAuth(container.vfs, {
      version: 2,
      accessToken,
      email: 'shell@example.com',
      refreshToken: 'refresh-token-4',
      privateKey: 'private-key-4',
      tokenType: 'Bearer',
      expiresAt: null,
      issuedAt: null,
      domain: 'https://app.infisical.com',
      method: 'user',
      clientId: null,
      organizationSlug: null,
    });

    const result = await container.run('infisical status');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Infisical status: authenticated');
    expect(result.stdout).toContain('shell@example.com');
  });
});
