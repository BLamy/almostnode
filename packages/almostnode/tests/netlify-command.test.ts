import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from 'just-bash';
import { setDefaultNetworkController } from '../src/network';
import { runNetlifyCommand } from '../src/shims/netlify-command';
import {
  NETLIFY_CLI_CLIENT_ID,
  NETLIFY_CONFIG_PATH,
  readNetlifyAccessToken,
} from '../src/shims/netlify-auth';
import { VirtualFS } from '../src/virtual-fs';

function makeCtx(env: Record<string, string> = {}, cwd = '/'): CommandContext {
  return { cwd, env } as unknown as CommandContext;
}

function encodeBody(body: string): string {
  return Buffer.from(body, 'utf8').toString('base64');
}

function decodeBody(bodyBase64: string | undefined): string {
  return Buffer.from(bodyBase64 || '', 'base64').toString('utf8');
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

describe('netlify command', () => {
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

  it('completes Netlify browser login and persists the access token', async () => {
    const vfs = new VirtualFS();
    const open = vi.fn(() => null);

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        open,
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
          && request.url === `https://api.netlify.com/api/v1/oauth/tickets?client_id=${NETLIFY_CLI_CLIENT_ID}`
        ) {
          return jsonResponse(request.url, {
            id: 'ticket-1',
            authorized: false,
          }, 201);
        }

        if (
          request.method === 'GET'
          && request.url === 'https://api.netlify.com/api/v1/oauth/tickets/ticket-1'
        ) {
          return jsonResponse(request.url, {
            id: 'ticket-1',
            authorized: true,
          });
        }

        if (
          request.method === 'POST'
          && request.url === 'https://api.netlify.com/api/v1/oauth/tickets/ticket-1/exchange'
        ) {
          return jsonResponse(request.url, {
            id: 'ticket-1',
            access_token: 'netlify-test-token',
            user_id: 'user-1',
            user_email: 'test@example.com',
          }, 201);
        }

        if (
          request.method === 'GET'
          && request.url === 'https://api.netlify.com/api/v1/user'
        ) {
          expect(request.headers?.authorization).toBe('Bearer netlify-test-token');
          return jsonResponse(request.url, {
            id: 'user-1',
            email: 'test@example.com',
            full_name: 'Test User',
          });
        }

        throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
      }),
    } as any);

    const result = await runNetlifyCommand(['login'], makeCtx(), vfs);

    if (result.exitCode !== 0) {
      throw new Error(
        `netlify login failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      );
    }

    expect(result.stdout).toContain('Opening https://app.netlify.com/authorize?response_type=ticket&ticket=ticket-1 ...');
    expect(result.stdout).toContain('Successfully logged in as test@example.com');
    expect(open).toHaveBeenCalledWith(
      'https://app.netlify.com/authorize?response_type=ticket&ticket=ticket-1',
      '_blank',
    );
    expect(readNetlifyAccessToken(vfs)).toBe('netlify-test-token');

    const saved = JSON.parse(vfs.readFileSync(NETLIFY_CONFIG_PATH, 'utf8')) as {
      userId: string;
      users: Record<string, { auth: { token: string }; email: string; name: string }>;
    };
    expect(saved.userId).toBe('user-1');
    expect(saved.users['user-1']).toMatchObject({
      email: 'test@example.com',
      name: 'Test User',
      auth: {
        token: 'netlify-test-token',
      },
    });
    expect(requests.some((request) => request.url.endsWith('/user'))).toBe(true);
  });

  it('supports the request/check approval flow', async () => {
    const vfs = new VirtualFS();

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (
          request.method === 'POST'
          && request.url === `https://api.netlify.com/api/v1/oauth/tickets?client_id=${NETLIFY_CLI_CLIENT_ID}`
        ) {
          expect(decodeBody(request.bodyBase64)).toBe(JSON.stringify({ message: 'Need a Netlify token' }));
          return jsonResponse(request.url, {
            id: 'ticket-2',
            authorized: false,
          }, 201);
        }

        if (
          request.method === 'GET'
          && request.url === 'https://api.netlify.com/api/v1/oauth/tickets/ticket-2'
        ) {
          return jsonResponse(request.url, {
            id: 'ticket-2',
            authorized: true,
          });
        }

        if (
          request.method === 'POST'
          && request.url === 'https://api.netlify.com/api/v1/oauth/tickets/ticket-2/exchange'
        ) {
          return jsonResponse(request.url, {
            id: 'ticket-2',
            access_token: 'netlify-requested-token',
            user_id: 'user-2',
            user_email: 'request@example.com',
          }, 201);
        }

        if (
          request.method === 'GET'
          && request.url === 'https://api.netlify.com/api/v1/user'
        ) {
          return jsonResponse(request.url, {
            id: 'user-2',
            email: 'request@example.com',
            full_name: 'Requester',
          });
        }

        throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
      }),
    } as any);

    const requestResult = await runNetlifyCommand(
      ['login', '--request', 'Need a Netlify token'],
      makeCtx(),
      vfs,
    );

    expect(requestResult.exitCode).toBe(0);
    expect(requestResult.stdout).toContain('Ticket ID: ticket-2');
    expect(requestResult.stdout).toContain('netlify login --check ticket-2');

    const checkResult = await runNetlifyCommand(
      ['login', '--check', 'ticket-2'],
      makeCtx(),
      vfs,
    );

    expect(checkResult.exitCode).toBe(0);
    expect(checkResult.stdout).toContain('Status: authorized');
    expect(checkResult.stdout).toContain('Email: request@example.com');
    expect(readNetlifyAccessToken(vfs)).toBe('netlify-requested-token');
  });

  it('prints the saved auth token', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/home/user/.config/netlify', { recursive: true });
    vfs.writeFileSync(
      NETLIFY_CONFIG_PATH,
      JSON.stringify({
        userId: 'user-1',
        users: {
          'user-1': {
            id: 'user-1',
            email: 'saved@example.com',
            auth: {
              token: 'saved-netlify-token',
            },
          },
        },
      }, null, '\t'),
    );

    const result = await runNetlifyCommand(['auth', 'token'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('saved-netlify-token\n');
  });

  it('clears the saved Netlify auth state on logout', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/home/user/.config/netlify', { recursive: true });
    vfs.writeFileSync(
      NETLIFY_CONFIG_PATH,
      JSON.stringify({
        telemetryDisabled: false,
        cliId: 'cli-1',
        userId: 'user-1',
        users: {
          'user-1': {
            id: 'user-1',
            email: 'saved@example.com',
            auth: {
              token: 'saved-netlify-token',
              github: {
                user: 'octocat',
              },
            },
          },
        },
      }, null, '\t'),
    );

    const result = await runNetlifyCommand(['logout'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Removed Netlify login state.');

    const saved = JSON.parse(vfs.readFileSync(NETLIFY_CONFIG_PATH, 'utf8')) as {
      userId: string | null;
      users: Record<string, { auth: Record<string, unknown> }>;
    };

    expect(saved.userId).toBeNull();
    expect(saved.users['user-1'].auth.token).toBeUndefined();
    expect(saved.users['user-1'].auth.github).toEqual({ user: 'octocat' });
    expect(readNetlifyAccessToken(vfs)).toBeNull();
  });

  it('uses bearer auth for whoami', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/home/user/.config/netlify', { recursive: true });
    vfs.writeFileSync(
      NETLIFY_CONFIG_PATH,
      JSON.stringify({
        userId: 'user-1',
        users: {
          'user-1': {
            id: 'user-1',
            email: 'plain@example.com',
            auth: {
              token: 'plain-token',
            },
          },
        },
      }, null, '\t'),
    );

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        expect(request.headers?.authorization).toBe('Bearer plain-token');
        return jsonResponse(request.url, {
          id: 'user-1',
          email: 'plain@example.com',
        });
      }),
    } as any);

    const result = await runNetlifyCommand(['auth', 'whoami'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('plain@example.com\n');
  });
});
