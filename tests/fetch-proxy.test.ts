/**
 * Tests for the globalThis.fetch CORS proxy patching (runtime.ts)
 * and ClientRequest redirect handling (http.ts)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('Fetch CORS Proxy', () => {
  const CORS_PROXY = 'https://almostnode-cors-proxy.langtail.workers.dev/?url=';
  let origFetch: typeof globalThis.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  // Simulate the fetch proxy logic from runtime.ts for unit testing
  function createProxiedFetch(mockFetchImpl: typeof globalThis.fetch) {
    const MAX_REDIRECTS = 10;
    return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

      if (url.startsWith('http') && !url.includes('localhost') && !url.includes('almostnode-cors-proxy')) {
        let effectiveInit: RequestInit = { ...init };
        if (input instanceof Request) {
          const req = input;
          if (!effectiveInit.method && req.method !== 'GET') effectiveInit.method = req.method;
          if (!effectiveInit.headers) {
            effectiveInit.headers = new Headers(req.headers);
          }
          if (!effectiveInit.body && req.body && req.method !== 'GET' && req.method !== 'HEAD') {
            effectiveInit.body = req.body;
          }
          if (!effectiveInit.signal && req.signal) effectiveInit.signal = req.signal;
          if (effectiveInit.redirect === undefined && req.redirect) effectiveInit.redirect = req.redirect;
          if (effectiveInit.credentials === undefined && req.credentials) effectiveInit.credentials = req.credentials;
        }

        const headers = new Headers(effectiveInit.headers);
        headers.delete('accept-encoding');
        headers.delete('host');
        effectiveInit.headers = headers;

        let currentUrl = url;
        let currentMethod = effectiveInit.method || 'GET';
        let currentBody = effectiveInit.body;
        for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount++) {
          const proxiedUrl = CORS_PROXY + encodeURIComponent(currentUrl);
          const resp = await mockFetchImpl(proxiedUrl, {
            ...effectiveInit,
            method: currentMethod,
            body: currentBody,
            redirect: 'manual',
          });

          if (resp.status >= 300 && resp.status < 400) {
            const location = resp.headers.get('location');
            if (location) {
              currentUrl = new URL(location, currentUrl).href;
              if (resp.status === 303) {
                currentMethod = 'GET';
                currentBody = undefined;
              }
              if ((resp.status === 301 || resp.status === 302) && currentMethod !== 'GET' && currentMethod !== 'HEAD') {
                currentMethod = 'GET';
                currentBody = undefined;
              }
              if (redirectCount === MAX_REDIRECTS) {
                throw new TypeError('Failed to fetch: too many redirects');
              }
              continue;
            }
          }
          return resp;
        }
        throw new TypeError('Failed to fetch: too many redirects');
      }
      return mockFetchImpl(input, init);
    };
  }

  beforeEach(() => {
    mockFetch = vi.fn();
  });

  describe('Request object property extraction', () => {
    it('should preserve method from Request object', async () => {
      mockFetch.mockResolvedValue(new Response('ok', { status: 200 }));
      const proxiedFetch = createProxiedFetch(mockFetch);

      const req = new Request('https://api.example.com/data', { method: 'POST' });
      await proxiedFetch(req);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [, fetchInit] = mockFetch.mock.calls[0];
      expect(fetchInit.method).toBe('POST');
    });

    it('should preserve headers from Request object', async () => {
      mockFetch.mockResolvedValue(new Response('ok', { status: 200 }));
      const proxiedFetch = createProxiedFetch(mockFetch);

      const req = new Request('https://api.example.com/data', {
        headers: { 'Authorization': 'Bearer token123', 'Content-Type': 'application/json' },
      });
      await proxiedFetch(req);

      const [, fetchInit] = mockFetch.mock.calls[0];
      const headers = new Headers(fetchInit.headers);
      expect(headers.get('authorization')).toBe('Bearer token123');
      expect(headers.get('content-type')).toBe('application/json');
    });

    it('should let init override Request properties', async () => {
      mockFetch.mockResolvedValue(new Response('ok', { status: 200 }));
      const proxiedFetch = createProxiedFetch(mockFetch);

      const req = new Request('https://api.example.com/data', { method: 'POST' });
      await proxiedFetch(req, { method: 'PUT' });

      const [, fetchInit] = mockFetch.mock.calls[0];
      expect(fetchInit.method).toBe('PUT');
    });

    it('should strip accept-encoding and host headers', async () => {
      mockFetch.mockResolvedValue(new Response('ok', { status: 200 }));
      const proxiedFetch = createProxiedFetch(mockFetch);

      const req = new Request('https://api.example.com/data', {
        headers: { 'accept-encoding': 'gzip, br', 'host': 'api.example.com', 'x-custom': 'keep' },
      });
      await proxiedFetch(req);

      const [, fetchInit] = mockFetch.mock.calls[0];
      const headers = new Headers(fetchInit.headers);
      expect(headers.get('accept-encoding')).toBeNull();
      expect(headers.get('host')).toBeNull();
      expect(headers.get('x-custom')).toBe('keep');
    });

    it('should proxy the URL through CORS proxy', async () => {
      mockFetch.mockResolvedValue(new Response('ok', { status: 200 }));
      const proxiedFetch = createProxiedFetch(mockFetch);

      await proxiedFetch('https://api.example.com/data');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe(CORS_PROXY + encodeURIComponent('https://api.example.com/data'));
    });

    it('should not proxy same-origin requests', async () => {
      mockFetch.mockResolvedValue(new Response('ok', { status: 200 }));
      const proxiedFetch = createProxiedFetch(mockFetch);

      await proxiedFetch('http://localhost:5173/api/data');

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:5173/api/data');
    });
  });

  describe('Redirect handling', () => {
    it('should follow 301 redirect through CORS proxy', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, {
          status: 301,
          headers: { 'location': 'https://api.example.com/v2/data' },
        }))
        .mockResolvedValueOnce(new Response('{"result": true}', { status: 200 }));

      const proxiedFetch = createProxiedFetch(mockFetch);
      const resp = await proxiedFetch('https://api.example.com/v1/data');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Second call should proxy the redirected URL
      const [secondUrl] = mockFetch.mock.calls[1];
      expect(secondUrl).toBe(CORS_PROXY + encodeURIComponent('https://api.example.com/v2/data'));
      expect(resp.status).toBe(200);
    });

    it('should follow 302 redirect through CORS proxy', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, {
          status: 302,
          headers: { 'location': 'https://cdn.example.com/file.json' },
        }))
        .mockResolvedValueOnce(new Response('[]', { status: 200 }));

      const proxiedFetch = createProxiedFetch(mockFetch);
      const resp = await proxiedFetch('https://api.example.com/download');

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(resp.status).toBe(200);
    });

    it('should change method to GET on 303 redirect', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, {
          status: 303,
          headers: { 'location': 'https://api.example.com/result' },
        }))
        .mockResolvedValueOnce(new Response('{"done": true}', { status: 200 }));

      const proxiedFetch = createProxiedFetch(mockFetch);
      await proxiedFetch('https://api.example.com/submit', { method: 'POST', body: 'data' });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [, secondInit] = mockFetch.mock.calls[1];
      expect(secondInit.method).toBe('GET');
      expect(secondInit.body).toBeUndefined();
    });

    it('should preserve method on 307 redirect', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, {
          status: 307,
          headers: { 'location': 'https://api.example.com/new-endpoint' },
        }))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }));

      const proxiedFetch = createProxiedFetch(mockFetch);
      await proxiedFetch('https://api.example.com/old-endpoint', { method: 'POST', body: 'data' });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [, secondInit] = mockFetch.mock.calls[1];
      expect(secondInit.method).toBe('POST');
      expect(secondInit.body).toBe('data');
    });

    it('should preserve method on 308 redirect', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, {
          status: 308,
          headers: { 'location': 'https://api.example.com/permanent' },
        }))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }));

      const proxiedFetch = createProxiedFetch(mockFetch);
      await proxiedFetch('https://api.example.com/old', { method: 'PUT', body: 'update' });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      const [, secondInit] = mockFetch.mock.calls[1];
      expect(secondInit.method).toBe('PUT');
      expect(secondInit.body).toBe('update');
    });

    it('should change POST to GET on 301 redirect', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, {
          status: 301,
          headers: { 'location': 'https://api.example.com/new' },
        }))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }));

      const proxiedFetch = createProxiedFetch(mockFetch);
      await proxiedFetch('https://api.example.com/old', { method: 'POST', body: 'data' });

      const [, secondInit] = mockFetch.mock.calls[1];
      expect(secondInit.method).toBe('GET');
      expect(secondInit.body).toBeUndefined();
    });

    it('should resolve relative redirect URLs', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, {
          status: 302,
          headers: { 'location': '/v2/data' },
        }))
        .mockResolvedValueOnce(new Response('ok', { status: 200 }));

      const proxiedFetch = createProxiedFetch(mockFetch);
      await proxiedFetch('https://api.example.com/v1/data');

      const [secondUrl] = mockFetch.mock.calls[1];
      expect(secondUrl).toBe(CORS_PROXY + encodeURIComponent('https://api.example.com/v2/data'));
    });

    it('should follow multiple redirects', async () => {
      mockFetch
        .mockResolvedValueOnce(new Response(null, {
          status: 302,
          headers: { 'location': 'https://api.example.com/step2' },
        }))
        .mockResolvedValueOnce(new Response(null, {
          status: 302,
          headers: { 'location': 'https://api.example.com/step3' },
        }))
        .mockResolvedValueOnce(new Response('final', { status: 200 }));

      const proxiedFetch = createProxiedFetch(mockFetch);
      const resp = await proxiedFetch('https://api.example.com/step1');

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(resp.status).toBe(200);
    });

    it('should throw on too many redirects', async () => {
      // Create 11 redirect responses (exceeds MAX_REDIRECTS of 10)
      for (let i = 0; i < 12; i++) {
        mockFetch.mockResolvedValueOnce(new Response(null, {
          status: 302,
          headers: { 'location': `https://api.example.com/redirect${i + 1}` },
        }));
      }

      const proxiedFetch = createProxiedFetch(mockFetch);
      await expect(proxiedFetch('https://api.example.com/start'))
        .rejects.toThrow('too many redirects');
    });

    it('should use redirect: manual for proxied requests', async () => {
      mockFetch.mockResolvedValue(new Response('ok', { status: 200 }));
      const proxiedFetch = createProxiedFetch(mockFetch);

      await proxiedFetch('https://api.example.com/data');

      const [, fetchInit] = mockFetch.mock.calls[0];
      expect(fetchInit.redirect).toBe('manual');
    });
  });
});
