import { afterEach, describe, expect, it, vi } from 'vitest';
import { createServer as createHttpServer } from 'node:http';
import {
  createOAuthLoopbackService,
  type OAuthLoopbackService,
} from './oauth-loopback';

describe('oauth loopback service', () => {
  let service: OAuthLoopbackService | null = null;

  afterEach(() => {
    service?.dispose();
    service = null;
    vi.restoreAllMocks();
  });

  it('opens the auth URL and resolves with the captured callback URL', async () => {
    const openExternal = vi.fn(async () => {});
    service = createOAuthLoopbackService({ openExternal });

    const session = await service.createSession();
    const waitPromise = service.waitForCallback({
      sessionId: session.sessionId,
      timeoutMs: 5_000,
      successHtml: '<html><body>done</body></html>',
    });

    await service.openExternal({
      sessionId: session.sessionId,
      url: 'https://oauth2.neon.tech/oauth2/auth?client_id=neonctl',
    });

    const response = await fetch(`${session.redirectUri}?code=test-code&state=test-state`);
    const body = await response.text();
    const result = await waitPromise;

    expect(openExternal).toHaveBeenCalledWith(
      'https://oauth2.neon.tech/oauth2/auth?client_id=neonctl',
    );
    expect(response.status).toBe(200);
    expect(body).toContain('done');
    expect(result.callbackUrl).toBe(`${session.redirectUri}?code=test-code&state=test-state`);
  });

  it('can capture a POST body with CORS enabled for localhost callback flows', async () => {
    service = createOAuthLoopbackService();
    const session = await service.createSession({
      allowedOrigins: ['https://app.infisical.com'],
      callbackPath: '/',
      captureBody: true,
      matchAnyPath: true,
    });
    const waitPromise = service.waitForCallback({
      sessionId: session.sessionId,
      timeoutMs: 5_000,
    });

    const preflight = await fetch(`${session.redirectUri}cli-login`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://app.infisical.com',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-origin')).toBe('https://app.infisical.com');

    const response = await fetch(`${session.redirectUri}cli-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://app.infisical.com',
      },
      body: JSON.stringify({
        email: 'loopback@example.com',
        JTWToken: 'token-1',
      }),
    });
    const body = await response.text();
    const result = await waitPromise;

    expect(response.status).toBe(200);
    expect(response.headers.get('access-control-allow-origin')).toBe('https://app.infisical.com');
    expect(body).toContain('Authentication complete');
    expect(result.callbackUrl).toBe(`${session.redirectUri}cli-login`);
    expect(result.requestMethod).toBe('POST');
    expect(JSON.parse(result.requestBody || '{}')).toEqual({
      email: 'loopback@example.com',
      JTWToken: 'token-1',
    });
  });

  it('times out if no callback request arrives', async () => {
    service = createOAuthLoopbackService();
    const session = await service.createSession();

    await expect(
      service.waitForCallback({
        sessionId: session.sessionId,
        timeoutMs: 1_000,
      }),
    ).rejects.toThrow('Authentication timed out after 1 seconds.');
  });

  it('can bind the callback listener to a preferred port when requested', async () => {
    const preferredPort = await new Promise<number>((resolve, reject) => {
      const probe = createHttpServer();
      probe.once('error', reject);
      probe.listen(0, '127.0.0.1', () => {
        const address = probe.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to allocate a probe port.'));
          return;
        }
        const port = address.port;
        probe.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(port);
        });
      });
    });

    service = createOAuthLoopbackService();
    const session = await service.createSession({
      callbackPath: '/oauth/callback',
      preferredPort,
    });

    expect(session.redirectUri).toBe(`http://127.0.0.1:${preferredPort}/oauth/callback`);
  });
});
