import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CommandContext } from 'just-bash';
import { setDefaultNetworkController } from '../src/network';
import { runNeonCommand } from '../src/shims/neon-command';
import {
  NEON_CREDENTIALS_PATH,
  NEON_PENDING_AUTH_PATH,
  readPendingNeonAuthState,
  readNeonCredentials,
  writeNeonCredentials,
} from '../src/shims/neon-auth';
import { VirtualFS } from '../src/virtual-fs';

function makeCtx(env: Record<string, string> = {}, cwd = '/'): CommandContext {
  return { cwd, env } as unknown as CommandContext;
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
    statusText: status === 200 ? 'OK' : 'Error',
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

function createIdToken(payload: Record<string, unknown>): string {
  return [
    base64UrlJson({ alg: 'none', typ: 'JWT' }),
    base64UrlJson(payload),
    '',
  ].join('.');
}

describe('neon command', () => {
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

  it('completes Neon login by exchanging the pasted callback URL', async () => {
    const vfs = new VirtualFS();
    let lastAuthUrl = '';

    const open = vi.fn((url?: string | URL) => {
      lastAuthUrl = String(url || '');
      return null;
    });
    const prompt = vi.fn(() => {
      const authUrl = new URL(lastAuthUrl);
      const state = authUrl.searchParams.get('state') || '';
      return `http://127.0.0.1:44555/callback?code=auth-code-1&state=${encodeURIComponent(state)}`;
    });

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        open,
        alert: vi.fn(),
        prompt,
      },
    });

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (request.url !== 'https://oauth2.neon.tech/oauth2/token') {
          throw new Error(`Unexpected request: ${request.url}`);
        }

        const body = decodeBody(request.bodyBase64);
        expect(body).toContain('grant_type=authorization_code');
        expect(body).toContain('code=auth-code-1');
        expect(body).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%3A44555%2Fcallback');

        return jsonResponse(request.url, {
          access_token: 'neon-access-1',
          refresh_token: 'neon-refresh-1',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: createIdToken({
            sub: 'user-1',
            email: 'test@example.com',
          }),
        });
      }),
    } as any);

    const result = await runNeonCommand(['auth', 'login'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Authentication complete.');
    expect(result.stdout).toContain('test@example.com');
    expect(open).toHaveBeenCalledTimes(1);
    expect(prompt).toHaveBeenCalledTimes(1);

    const credentials = readNeonCredentials(vfs);
    expect(credentials).toMatchObject({
      access_token: 'neon-access-1',
      refresh_token: 'neon-refresh-1',
      token_type: 'Bearer',
      user_id: 'user-1',
    });
    expect(vfs.readFileSync(NEON_CREDENTIALS_PATH, 'utf8')).toContain('"access_token": "neon-access-1"');
    expect(readPendingNeonAuthState(vfs)).toBeNull();
  });

  it('uses the desktop loopback bridge to complete Neon login automatically', async () => {
    const vfs = new VirtualFS();
    let openedUrl = '';
    const createSession = vi.fn(async () => ({
      sessionId: 'desktop-session-1',
      redirectUri: 'http://127.0.0.1:40123/callback',
    }));
    const openExternal = vi.fn(async (input: { url: string }) => {
      openedUrl = input.url;
      return { opened: true };
    });
    const waitForCallback = vi.fn(async () => {
      const state = new URL(openedUrl).searchParams.get('state') || '';
      return {
        callbackUrl: `http://127.0.0.1:40123/callback?code=desktop-code-1&state=${encodeURIComponent(state)}`,
      };
    });

    (globalThis as typeof globalThis & {
      [desktopLoopbackBridgeKey]?: unknown;
    })[desktopLoopbackBridgeKey] = {
      createSession,
      openExternal,
      waitForCallback,
    };

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        open: vi.fn(),
      },
    });

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (request.url !== 'https://oauth2.neon.tech/oauth2/token') {
          throw new Error(`Unexpected request: ${request.url}`);
        }

        const body = decodeBody(request.bodyBase64);
        expect(body).toContain('grant_type=authorization_code');
        expect(body).toContain('code=desktop-code-1');
        expect(body).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%3A40123%2Fcallback');

        return jsonResponse(request.url, {
          access_token: 'desktop-access-1',
          refresh_token: 'desktop-refresh-1',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: createIdToken({
            sub: 'desktop-user-1',
            email: 'desktop@example.com',
          }),
        });
      }),
    } as any);

    const result = await runNeonCommand(['auth', 'login'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('desktop@example.com');
    expect(createSession).toHaveBeenCalledWith({ callbackPath: '/callback' });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openedUrl).toContain('redirect_uri=http%3A%2F%2F127.0.0.1%3A40123%2Fcallback');
    expect(waitForCallback).toHaveBeenCalledTimes(1);
    expect(readNeonCredentials(vfs)).toMatchObject({
      access_token: 'desktop-access-1',
      refresh_token: 'desktop-refresh-1',
      user_id: 'desktop-user-1',
    });
    expect(readPendingNeonAuthState(vfs)).toBeNull();
  });

  it('completes a pending Neon login from a pasted callback URL later', async () => {
    const vfs = new VirtualFS();
    let lastAuthUrl = '';

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        open: vi.fn((url?: string | URL) => {
          lastAuthUrl = String(url || '');
          return null;
        }),
        alert: vi.fn(),
        prompt: vi.fn(() => ''),
      },
    });

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (request.url !== 'https://oauth2.neon.tech/oauth2/token') {
          throw new Error(`Unexpected request: ${request.url}`);
        }

        const body = decodeBody(request.bodyBase64);
        expect(body).toContain('grant_type=authorization_code');
        expect(body).toContain('code=auth-code-2');

        return jsonResponse(request.url, {
          access_token: 'neon-access-2',
          refresh_token: 'neon-refresh-2',
          token_type: 'Bearer',
          expires_in: 3600,
          id_token: createIdToken({
            sub: 'user-2',
            email: 'later@example.com',
          }),
        });
      }),
    } as any);

    const started = await runNeonCommand(['auth', 'login'], makeCtx(), vfs);

    expect(started.exitCode).toBe(1);
    expect(started.stderr).toContain('neon auth complete');
    expect(vfs.existsSync(NEON_PENDING_AUTH_PATH)).toBe(true);
    expect(readPendingNeonAuthState(vfs)).not.toBeNull();

    const authUrl = new URL(lastAuthUrl);
    const state = authUrl.searchParams.get('state') || '';
    const completed = await runNeonCommand([
      'auth',
      'complete',
      `http://127.0.0.1:44555/callback?code=auth-code-2&state=${encodeURIComponent(state)}`,
    ], makeCtx(), vfs);

    expect(completed.exitCode).toBe(0);
    expect(completed.stdout).toContain('Authentication complete.');
    expect(completed.stdout).toContain('later@example.com');
    expect(readNeonCredentials(vfs)).toMatchObject({
      access_token: 'neon-access-2',
      refresh_token: 'neon-refresh-2',
      user_id: 'user-2',
    });
    expect(readPendingNeonAuthState(vfs)).toBeNull();
    expect(vfs.existsSync(NEON_PENDING_AUTH_PATH)).toBe(false);
  });

  it('prints the saved Neon access token', async () => {
    const vfs = new VirtualFS();
    writeNeonCredentials(vfs, {
      access_token: 'neon-access-saved',
      refresh_token: 'neon-refresh-saved',
      token_type: 'Bearer',
      expires_at: Date.now() + 3600_000,
      user_id: 'user-1',
    });

    const result = await runNeonCommand(['auth', 'token'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('neon-access-saved\n');
  });

  it('refreshes expired Neon credentials before printing the token', async () => {
    const vfs = new VirtualFS();
    writeNeonCredentials(vfs, {
      access_token: 'neon-access-expired',
      refresh_token: 'neon-refresh-old',
      token_type: 'Bearer',
      expires_at: Date.now() - 5_000,
      user_id: 'user-1',
    });

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (request.url !== 'https://oauth2.neon.tech/oauth2/token') {
          throw new Error(`Unexpected request: ${request.url}`);
        }

        const body = decodeBody(request.bodyBase64);
        expect(body).toContain('grant_type=refresh_token');
        expect(body).toContain('refresh_token=neon-refresh-old');

        return jsonResponse(request.url, {
          access_token: 'neon-access-refreshed',
          refresh_token: 'neon-refresh-new',
          token_type: 'Bearer',
          expires_in: 7200,
          id_token: createIdToken({
            sub: 'user-1',
            email: 'refreshed@example.com',
          }),
        });
      }),
    } as any);

    const result = await runNeonCommand(['auth', 'token'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('neon-access-refreshed\n');
    expect(readNeonCredentials(vfs)).toMatchObject({
      access_token: 'neon-access-refreshed',
      refresh_token: 'neon-refresh-new',
      user_id: 'user-1',
    });
  });

  it('removes stored Neon credentials on logout', async () => {
    const vfs = new VirtualFS();
    writeNeonCredentials(vfs, {
      access_token: 'neon-access-saved',
      refresh_token: 'neon-refresh-saved',
      token_type: 'Bearer',
      expires_at: Date.now() + 3600_000,
      user_id: 'user-1',
    });

    const result = await runNeonCommand(['auth', 'logout'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Removed Neon login state.');
    expect(readNeonCredentials(vfs)).toBeNull();
    expect(vfs.existsSync(NEON_CREDENTIALS_PATH)).toBe(false);
  });

  it('creates a long-lived Neon API key from the authenticated session', async () => {
    const vfs = new VirtualFS();
    writeNeonCredentials(vfs, {
      access_token: 'neon-access-saved',
      refresh_token: 'neon-refresh-saved',
      token_type: 'Bearer',
      expires_at: Date.now() + 3600_000,
      user_id: 'user-1',
    });

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (request.url !== 'https://console.neon.tech/api/v2/api_keys') {
          throw new Error(`Unexpected request: ${request.url}`);
        }

        expect(request.headers?.authorization).toBe('Bearer neon-access-saved');
        expect(request.headers?.['content-type']).toBe('application/json');
        expect(JSON.parse(decodeBody(request.bodyBase64))).toEqual({
          key_name: 'almostnode-test-key',
        });

        return jsonResponse(request.url, {
          id: 'key_123',
          key: 'napi_test_personal_key',
          name: 'almostnode-test-key',
        });
      }),
    } as any);

    const result = await runNeonCommand([
      'auth',
      'api-key',
      'create',
      '--name',
      'almostnode-test-key',
    ], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Created Neon personal API key "almostnode-test-key" (key_123).');
    expect(result.stdout).toContain('napi_test_personal_key');
  });

  it('creates a personal API key directly from a pending callback URL', async () => {
    const vfs = new VirtualFS();
    let lastAuthUrl = '';

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        open: vi.fn((url?: string | URL) => {
          lastAuthUrl = String(url || '');
          return null;
        }),
        alert: vi.fn(),
        prompt: vi.fn(() => ''),
      },
    });

    let tokenExchanged = false;
    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (request.url === 'https://oauth2.neon.tech/oauth2/token') {
          tokenExchanged = true;
          return jsonResponse(request.url, {
            access_token: 'neon-access-pending',
            refresh_token: 'neon-refresh-pending',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: createIdToken({
              sub: 'user-3',
              email: 'pending@example.com',
            }),
          });
        }
        if (request.url === 'https://console.neon.tech/api/v2/api_keys') {
          expect(tokenExchanged).toBe(true);
          expect(request.headers?.authorization).toBe('Bearer neon-access-pending');
          expect(JSON.parse(decodeBody(request.bodyBase64))).toEqual({
            key_name: 'pending-key',
          });
          return jsonResponse(request.url, {
            id: 'key_pending',
            key: 'napi_pending_personal_key',
            name: 'pending-key',
          });
        }
        throw new Error(`Unexpected request: ${request.url}`);
      }),
    } as any);

    const started = await runNeonCommand(['auth', 'login'], makeCtx(), vfs);
    expect(started.exitCode).toBe(1);
    expect(readPendingNeonAuthState(vfs)).not.toBeNull();

    const authUrl = new URL(lastAuthUrl);
    const state = authUrl.searchParams.get('state') || '';
    const result = await runNeonCommand([
      'auth',
      'api-key',
      'create',
      '--name',
      'pending-key',
      '--callback-url',
      `http://127.0.0.1:44555/callback?code=auth-code-3&state=${encodeURIComponent(state)}`,
    ], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Created Neon personal API key "pending-key" (key_pending).');
    expect(result.stdout).toContain('napi_pending_personal_key');
    expect(readPendingNeonAuthState(vfs)).toBeNull();
    expect(readNeonCredentials(vfs)).toMatchObject({
      access_token: 'neon-access-pending',
      refresh_token: 'neon-refresh-pending',
      user_id: 'user-3',
      personal_api_key: 'napi_pending_personal_key',
      personal_api_key_id: 'key_pending',
      personal_api_key_name: 'pending-key',
    });
  });

  it('auto-mints a personal API key during Neon login and saves it in credentials.json', async () => {
    const vfs = new VirtualFS();
    let lastAuthUrl = '';

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        open: vi.fn((url?: string | URL) => {
          lastAuthUrl = String(url || '');
          return null;
        }),
        alert: vi.fn(),
        prompt: vi.fn(() => {
          const state = new URL(lastAuthUrl).searchParams.get('state') || '';
          return `http://127.0.0.1:44555/callback?code=auth-code-auto&state=${encodeURIComponent(state)}`;
        }),
      },
    });

    const requests: string[] = [];
    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        requests.push(request.url);

        if (request.url === 'https://oauth2.neon.tech/oauth2/token') {
          return jsonResponse(request.url, {
            access_token: 'neon-access-auto',
            refresh_token: 'neon-refresh-auto',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: createIdToken({
              sub: 'user-auto',
              email: 'auto@example.com',
            }),
          });
        }

        if (request.url === 'https://console.neon.tech/api/v2/api_keys') {
          expect(request.method).toBe('POST');
          expect(request.headers?.authorization).toBe('Bearer neon-access-auto');
          const body = JSON.parse(decodeBody(request.bodyBase64)) as { key_name: string };
          expect(body.key_name).toMatch(/^almostnode-webide-/);
          return jsonResponse(request.url, {
            id: 'key_auto_123',
            key: 'napi_auto_mint_key',
            name: body.key_name,
          });
        }

        throw new Error(`Unexpected request: ${request.url}`);
      }),
    } as any);

    const result = await runNeonCommand(['auth', 'login'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(requests).toContain('https://oauth2.neon.tech/oauth2/token');
    expect(requests).toContain('https://console.neon.tech/api/v2/api_keys');

    const credentials = readNeonCredentials(vfs);
    expect(credentials).toMatchObject({
      access_token: 'neon-access-auto',
      personal_api_key: 'napi_auto_mint_key',
      personal_api_key_id: 'key_auto_123',
    });
    expect(credentials?.personal_api_key_name).toMatch(/^almostnode-webide-/);
  });

  it('keeps login credentials when auto-minting the API key fails', async () => {
    const vfs = new VirtualFS();
    let lastAuthUrl = '';

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        open: vi.fn((url?: string | URL) => {
          lastAuthUrl = String(url || '');
          return null;
        }),
        alert: vi.fn(),
        prompt: vi.fn(() => {
          const state = new URL(lastAuthUrl).searchParams.get('state') || '';
          return `http://127.0.0.1:44555/callback?code=code-fail&state=${encodeURIComponent(state)}`;
        }),
      },
    });

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (request.url === 'https://oauth2.neon.tech/oauth2/token') {
          return jsonResponse(request.url, {
            access_token: 'neon-access-failmint',
            refresh_token: 'neon-refresh-failmint',
            token_type: 'Bearer',
            expires_in: 3600,
            id_token: createIdToken({ sub: 'user-fm', email: 'fm@example.com' }),
          });
        }
        if (request.url === 'https://console.neon.tech/api/v2/api_keys') {
          return jsonResponse(request.url, { error: 'quota exceeded' }, 429);
        }
        throw new Error(`Unexpected request: ${request.url}`);
      }),
    } as any);

    const result = await runNeonCommand(['auth', 'login'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    const credentials = readNeonCredentials(vfs);
    expect(credentials?.access_token).toBe('neon-access-failmint');
    expect(credentials?.personal_api_key).toBeUndefined();
  });

  it('revokes the personal API key on logout', async () => {
    const vfs = new VirtualFS();
    writeNeonCredentials(vfs, {
      access_token: 'neon-access-logout',
      refresh_token: 'neon-refresh-logout',
      token_type: 'Bearer',
      expires_at: Date.now() + 3600_000,
      user_id: 'user-logout',
      personal_api_key: 'napi_logout_key',
      personal_api_key_id: 'key_logout_321',
      personal_api_key_name: 'almostnode-webide-logout',
    });

    const deleteRequests: Array<{ url: string; method: string; auth: string | undefined }> = [];
    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (
          request.method === 'DELETE'
          && request.url === 'https://console.neon.tech/api/v2/api_keys/key_logout_321'
        ) {
          deleteRequests.push({
            url: request.url,
            method: request.method || 'GET',
            auth: request.headers?.authorization,
          });
          return jsonResponse(request.url, { id: 'key_logout_321', revoked: true });
        }
        throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
      }),
    } as any);

    const result = await runNeonCommand(['auth', 'logout'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Removed Neon login state.');
    expect(deleteRequests).toEqual([
      {
        url: 'https://console.neon.tech/api/v2/api_keys/key_logout_321',
        method: 'DELETE',
        auth: 'Bearer neon-access-logout',
      },
    ]);
    expect(readNeonCredentials(vfs)).toBeNull();
  });

  it('still logs out when revoking the API key fails', async () => {
    const vfs = new VirtualFS();
    writeNeonCredentials(vfs, {
      access_token: 'neon-access-logout-fail',
      refresh_token: 'neon-refresh-logout-fail',
      token_type: 'Bearer',
      expires_at: Date.now() + 3600_000,
      user_id: 'user-logout-fail',
      personal_api_key: 'napi_still_logout',
      personal_api_key_id: 'key_fail_987',
    });

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (request.method === 'DELETE') {
          return jsonResponse(request.url, { error: 'server error' }, 500);
        }
        throw new Error(`Unexpected request: ${request.method || 'GET'} ${request.url}`);
      }),
    } as any);

    const result = await runNeonCommand(['auth', 'logout'], makeCtx(), vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Removed Neon login state.');
    expect(readNeonCredentials(vfs)).toBeNull();
  });

  it('saves the minted personal key to credentials when running api-key create manually', async () => {
    const vfs = new VirtualFS();
    writeNeonCredentials(vfs, {
      access_token: 'neon-access-saved',
      refresh_token: 'neon-refresh-saved',
      token_type: 'Bearer',
      expires_at: Date.now() + 3600_000,
      user_id: 'user-manual',
    });

    setDefaultNetworkController({
      fetch: vi.fn(async (request) => {
        if (request.url !== 'https://console.neon.tech/api/v2/api_keys') {
          throw new Error(`Unexpected request: ${request.url}`);
        }
        return jsonResponse(request.url, {
          id: 'key_manual_1',
          key: 'napi_manual_key',
          name: 'manual-key',
        });
      }),
    } as any);

    const result = await runNeonCommand(
      ['auth', 'api-key', 'create', '--name', 'manual-key'],
      makeCtx(),
      vfs,
    );

    expect(result.exitCode).toBe(0);
    expect(readNeonCredentials(vfs)).toMatchObject({
      access_token: 'neon-access-saved',
      personal_api_key: 'napi_manual_key',
      personal_api_key_id: 'key_manual_1',
      personal_api_key_name: 'manual-key',
    });
  });
});
