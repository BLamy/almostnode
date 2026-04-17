import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from 'just-bash';
import { setDefaultNetworkController } from '../src/network';
import { runWranglerCommand } from '../src/shims/wrangler-command';
import {
  DEFAULT_WRANGLER_CLIENT_ID,
  readPendingWranglerAuthState,
  readWranglerAuthConfig,
  WRANGLER_AUTH_CONFIG_PATH,
} from '../src/shims/wrangler-auth';
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

describe('wrangler command', () => {
  beforeEach(() => {
    setDefaultNetworkController(null);
  });

  afterEach(() => {
    setDefaultNetworkController(null);
    vi.restoreAllMocks();
  });

  it('starts a browser login, stores pending auth, and completes the OAuth exchange', async () => {
    const vfs = new VirtualFS();
    const requests: Array<{ body: string; method: string; url: string }> = [];

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        requests.push({
          url: request.url,
          method: request.method || 'GET',
          body: decodeBody(request.bodyBase64),
        });

        if (
          request.method === 'POST'
          && request.url === 'https://dash.cloudflare.com/oauth2/token'
        ) {
          expect(decodeBody(request.bodyBase64)).toContain(
            `client_id=${encodeURIComponent(DEFAULT_WRANGLER_CLIENT_ID)}`,
          );
          expect(decodeBody(request.bodyBase64)).toContain(
            `redirect_uri=${encodeURIComponent('http://localhost:8976/oauth/callback')}`,
          );
          return jsonResponse(request.url, {
            access_token: 'cloudflare-oauth-token',
            refresh_token: 'cloudflare-refresh-token',
            expires_in: 3600,
            scope: 'account:read user:read workers:write',
          });
        }

        if (
          request.method === 'GET'
          && request.url === 'https://api.cloudflare.com/client/v4/user'
        ) {
          expect(request.headers?.authorization).toBe('Bearer cloudflare-oauth-token');
          return jsonResponse(request.url, {
            success: true,
            result: {
              id: 'user-1',
              email: 'worker@example.com',
              first_name: 'Worker',
              last_name: 'User',
            },
          });
        }

        throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
      }),
    } as any);

    const loginResult = await runWranglerCommand(
      ['login', '--browser=false'],
      makeCtx(),
      vfs,
    );

    expect(loginResult.exitCode).toBe(0);
    expect(loginResult.stdout).toContain('wrangler login complete');

    const pending = readPendingWranglerAuthState(vfs);
    expect(pending).not.toBeNull();

    const completeResult = await runWranglerCommand(
      [
        'login',
        'complete',
        `http://localhost:8976/oauth/callback?code=test-auth-code&state=${pending?.state}`,
      ],
      makeCtx(),
      vfs,
    );

    expect(completeResult.exitCode).toBe(0);
    expect(completeResult.stdout).toContain('Logged in to Cloudflare as worker@example.com');

    const saved = readWranglerAuthConfig(vfs);
    expect(saved.accessToken).toBe('cloudflare-oauth-token');
    expect(saved.refreshToken).toBe('cloudflare-refresh-token');
    expect(saved.scopes).toEqual(['account:read', 'user:read', 'workers:write']);
    expect(saved.path).toBe(WRANGLER_AUTH_CONFIG_PATH);
    expect(readPendingWranglerAuthState(vfs)).toBeNull();
    expect(requests.some((request) => request.url.endsWith('/oauth2/token'))).toBe(true);
  });

  it('prints the saved OAuth token and renders whoami JSON', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/home/user/.config/.wrangler/config', { recursive: true });
    vfs.writeFileSync(
      WRANGLER_AUTH_CONFIG_PATH,
      [
        'oauth_token = "saved-cloudflare-token"',
        'refresh_token = "saved-refresh-token"',
        'expiration_time = "2099-01-01T00:00:00.000Z"',
        'scopes = ["account:read","user:read","workers:write"]',
        '',
      ].join('\n'),
    );

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (request.url === 'https://api.cloudflare.com/client/v4/user') {
          expect(request.headers?.authorization).toBe('Bearer saved-cloudflare-token');
          return jsonResponse(request.url, {
            success: true,
            result: {
              id: 'user-1',
              email: 'saved@example.com',
              first_name: 'Saved',
              last_name: 'User',
            },
          });
        }

        if (request.url === 'https://api.cloudflare.com/client/v4/accounts') {
          expect(request.headers?.authorization).toBe('Bearer saved-cloudflare-token');
          return jsonResponse(request.url, {
            success: true,
            result: [
              {
                id: 'account-1',
                name: 'Example Account',
              },
            ],
          });
        }

        throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
      }),
    } as any);

    const tokenResult = await runWranglerCommand(
      ['auth', 'token'],
      makeCtx(),
      vfs,
    );

    expect(tokenResult.exitCode).toBe(0);
    expect(tokenResult.stdout).toBe('saved-cloudflare-token\n');

    const whoamiResult = await runWranglerCommand(
      ['whoami', '--json'],
      makeCtx(),
      vfs,
    );

    expect(whoamiResult.exitCode).toBe(0);
    expect(JSON.parse(whoamiResult.stdout)).toEqual({
      loggedIn: true,
      authType: 'OAuth Token',
      email: 'saved@example.com',
      accounts: [
        {
          id: 'account-1',
          name: 'Example Account',
        },
      ],
      tokenPermissions: ['account:read', 'user:read', 'workers:write'],
    });
  });

  it('clears saved auth state on logout', async () => {
    const vfs = new VirtualFS();
    vfs.mkdirSync('/home/user/.config/.wrangler/config', { recursive: true });
    vfs.writeFileSync(
      WRANGLER_AUTH_CONFIG_PATH,
      [
        'oauth_token = "saved-cloudflare-token"',
        'refresh_token = "saved-refresh-token"',
        'expiration_time = "2099-01-01T00:00:00.000Z"',
        'scopes = ["account:read","user:read"]',
        '',
      ].join('\n'),
    );

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (request.url === 'https://dash.cloudflare.com/oauth2/revoke') {
          return {
            url: request.url,
            status: 200,
            statusText: 'OK',
            headers: {
              'content-type': 'text/plain',
            },
            bodyBase64: encodeBody('revoked'),
          };
        }

        throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
      }),
    } as any);

    const result = await runWranglerCommand(
      ['logout'],
      makeCtx(),
      vfs,
    );

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Successfully logged out.');
    expect(readWranglerAuthConfig(vfs).accessToken).toBeNull();
  });
});
