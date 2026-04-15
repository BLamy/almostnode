import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from 'just-bash';
import { setDefaultNetworkController } from '../src/network';
import { runFlyCommand } from '../src/shims/fly-command';
import {
  FLY_CONFIG_PATH,
  readFlyAccessToken,
} from '../src/shims/fly-auth';
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

describe('fly command', () => {
  const originalWindow = globalThis.window;

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
  });

  it('completes Fly browser login and persists the access token', async () => {
    const vfs = new VirtualFS();
    const open = vi.fn(() => null);

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        open,
        location: {
          hostname: 'web-ide.local',
        },
      },
    });

    const requests: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        requests.push({
          url: request.url,
          method: request.method || 'GET',
          headers: request.headers || {},
        });

        if (
          request.method === 'POST'
          && request.url === 'https://api.fly.io/api/v1/cli_sessions'
        ) {
          return jsonResponse(request.url, {
            id: 'session-1',
            auth_url: 'https://fly.io/app/auth/cli/session-1',
          }, 201);
        }

        if (
          request.method === 'GET'
          && request.url === 'https://api.fly.io/api/v1/cli_sessions/session-1'
        ) {
          return jsonResponse(request.url, {
            id: 'session-1',
            access_token: 'fm2_test-token',
          });
        }

        if (
          request.method === 'POST'
          && request.url === 'https://api.fly.io/graphql'
        ) {
          expect(request.headers?.authorization).toBe('FlyV1 fm2_test-token');
          return jsonResponse(request.url, {
            data: {
              viewer: {
                id: 'user-1',
                email: 'test@example.com',
              },
            },
          });
        }

        throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
      }),
    } as any);

    const result = await runFlyCommand(['login'], makeCtx(), vfs);

    if (result.exitCode !== 0) {
      throw new Error(
        `fly login failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }

    expect(result.stdout).toContain('Opening https://fly.io/app/auth/cli/session-1 ...');
    expect(result.stdout).toContain('Successfully logged in as test@example.com');
    expect(open).toHaveBeenCalledWith('https://fly.io/app/auth/cli/session-1', '_blank');
    expect(readFlyAccessToken(vfs)).toBe('fm2_test-token');
    expect(vfs.readFileSync(FLY_CONFIG_PATH, 'utf8')).toContain('access_token: "fm2_test-token"');
    expect(requests.some((request) => request.url.endsWith('/graphql'))).toBe(true);
  });

  it('prints the saved auth token', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/home/user/.fly', { recursive: true });
    vfs.writeFileSync(FLY_CONFIG_PATH, 'access_token: "fm2_saved-token"\n');

    const result = await runFlyCommand(['auth', 'token'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('fm2_saved-token\n');
  });

  it('clears Fly auth state on logout', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/home/user/.fly', { recursive: true });
    vfs.writeFileSync(
      FLY_CONFIG_PATH,
      [
        'access_token: "fm2_saved-token"',
        'last_login: "2026-04-15T12:00:00.000Z"',
        'auto_update: true',
        '',
      ].join('\n'),
    );

    const result = await runFlyCommand(['auth', 'logout'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Removed Fly.io login state.');
    expect(vfs.readFileSync(FLY_CONFIG_PATH, 'utf8')).toBe('auto_update: true\n');
    expect(readFlyAccessToken(vfs)).toBeNull();
  });

  it('uses bearer auth for whoami when the token is not a macaroon', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/home/user/.fly', { recursive: true });
    vfs.writeFileSync(FLY_CONFIG_PATH, 'access_token: "plain-token"\n');

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        expect(request.headers?.authorization).toBe('Bearer plain-token');
        return jsonResponse(request.url, {
          data: {
            viewer: {
              email: 'plain@example.com',
            },
          },
        });
      }),
    } as any);

    const result = await runFlyCommand(['auth', 'whoami'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('plain@example.com\n');
  });
});
