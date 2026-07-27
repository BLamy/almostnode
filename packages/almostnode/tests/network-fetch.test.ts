import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserFetch, browserFetchStream } from '../src/network/fetch';
import type { NetworkOptions } from '../src/network/types';

const DEFAULT_OPTIONS: Required<NetworkOptions> = {
  provider: 'browser',
  authMode: 'interactive',
  authKey: null,
  controlUrl: null,
  hostname: null,
  useExitNode: false,
  exitNodeId: null,
  acceptDns: false,
  corsProxy: 'https://proxy.example/?url=',
  tailscaleConnected: false,
};

function encodeBody(body: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(body);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function createMockResponse(
  body: string,
  headers: Record<string, string>,
  overrides?: {
    status?: number;
    statusText?: string;
    url?: string;
  },
): Response {
  return {
    status: overrides?.status ?? 200,
    statusText: overrides?.statusText ?? 'OK',
    url: overrides?.url ?? 'https://proxy.example/response',
    headers: new Headers(headers),
    arrayBuffer: vi.fn(async () => encodeBody(body)),
  } as unknown as Response;
}

function setResponseUrl(response: Response, url: string): Response {
  Object.defineProperty(response, 'url', {
    configurable: true,
    value: url,
  });
  return response;
}

describe('browserFetch', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('strips transport headers from proxied responses after materializing the body', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      createMockResponse('{"ok":true}', {
        'content-type': 'application/json',
        'content-encoding': 'br',
        'content-length': '999',
        'transfer-encoding': 'chunked',
        'x-almostnode-upstream-status': '200',
        'x-almostnode-upstream-status-text': 'OK',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await browserFetch(
      {
        url: 'https://ui.shadcn.com/r/index.json',
      },
      DEFAULT_OPTIONS,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'https://proxy.example/?url=' + encodeURIComponent('https://ui.shadcn.com/r/index.json'),
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
      }),
    );
    expect(response.headers).toEqual({
      'content-type': 'application/json',
    });
    expect(Buffer.from(response.bodyBase64, 'base64').toString('utf8')).toBe('{"ok":true}');
  });

  it('strips transport headers from same-origin responses too', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      createMockResponse('plain-text', {
        'content-type': 'text/plain; charset=utf-8',
        'content-encoding': 'gzip',
        'content-length': '10',
      }, {
        url: 'http://localhost:5173/api/test',
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', new URL('http://localhost:5173/workbench'));

    const response = await browserFetch(
      {
        url: 'http://localhost:5173/api/test',
      },
      DEFAULT_OPTIONS,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:5173/api/test',
      expect.objectContaining({
        method: 'GET',
      }),
    );
    expect(response.headers).toEqual({
      'content-type': 'text/plain; charset=utf-8',
    });
    expect(Buffer.from(response.bodyBase64, 'base64').toString('utf8')).toBe('plain-text');
  });

  it('streams proxied response chunks incrementally after following redirects', async () => {
    let redirectCancelled = false;
    const redirectBody = new ReadableStream<Uint8Array>({
      cancel() {
        redirectCancelled = true;
      },
    });
    const redirectResponse = new Response(redirectBody, {
      status: 200,
      headers: {
        location: 'https://api.openai.com/v1/responses/final',
        'x-almostnode-upstream-status': '307',
        'x-almostnode-upstream-status-text': 'Temporary Redirect',
      },
    });

    let bodyController!: ReadableStreamDefaultController<Uint8Array>;
    const finalResponse = setResponseUrl(new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          bodyController = controller;
          controller.enqueue(new TextEncoder().encode('first'));
        },
      }),
      {
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          'content-encoding': 'br',
          'transfer-encoding': 'chunked',
        },
      },
    ), 'https://proxy.example/?url=encoded-final-target');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(redirectResponse)
      .mockResolvedValueOnce(finalResponse);
    vi.stubGlobal('fetch', fetchMock);

    const response = await browserFetchStream(
      {
        url: 'https://api.openai.com/v1/responses',
        redirect: 'follow',
        headers: {
          authorization: 'Bearer test-token',
          'proxy-authorization': 'Basic proxy-token',
          cookie: 'session=one',
          cookie2: '$Version=1',
          'x-request-id': 'request-1',
        },
      },
      DEFAULT_OPTIONS,
    );

    expect(redirectCancelled).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://proxy.example/?url='
      + encodeURIComponent('https://api.openai.com/v1/responses/final'),
    );
    const redirectedHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(redirectedHeaders.get('authorization')).toBe('Bearer test-token');
    expect(redirectedHeaders.get('proxy-authorization')).toBe(
      'Basic proxy-token',
    );
    expect(redirectedHeaders.get('cookie')).toBe('session=one');
    expect(redirectedHeaders.get('cookie2')).toBe('$Version=1');
    expect(redirectedHeaders.get('x-request-id')).toBe('request-1');
    expect(response.headers).toEqual({
      'content-type': 'text/event-stream',
    });
    expect(response.url).toBe(
      'https://api.openai.com/v1/responses/final',
    );

    const reader = response.body.getReader();
    await expect(reader.read()).resolves.toEqual({
      value: new TextEncoder().encode('first'),
      done: false,
    });

    let secondReadSettled = false;
    const secondRead = reader.read().finally(() => {
      secondReadSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(secondReadSettled).toBe(false);

    bodyController.enqueue(new TextEncoder().encode('second'));
    await expect(secondRead).resolves.toEqual({
      value: new TextEncoder().encode('second'),
      done: false,
    });
    bodyController.close();
    await expect(reader.read()).resolves.toEqual({
      value: undefined,
      done: true,
    });
    reader.releaseLock();
  });

  it('strips credential headers when a proxied redirect changes origin', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            location: 'https://uploads.openaiusercontent.com/v1/responses',
            'x-almostnode-upstream-status': '307',
            'x-almostnode-upstream-status-text': 'Temporary Redirect',
          },
        }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await browserFetchStream(
      {
        url: 'https://api.openai.com/v1/responses',
        redirect: 'follow',
        headers: {
          authorization: 'Bearer test-token',
          'proxy-authorization': 'Basic proxy-token',
          cookie: 'session=one',
          cookie2: '$Version=1',
          'x-request-id': 'request-1',
        },
      },
      DEFAULT_OPTIONS,
    );

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const redirectedHeaders = new Headers(fetchMock.mock.calls[1]?.[1]?.headers);
    expect(redirectedHeaders.get('authorization')).toBeNull();
    expect(redirectedHeaders.get('proxy-authorization')).toBeNull();
    expect(redirectedHeaders.get('cookie')).toBeNull();
    expect(redirectedHeaders.get('cookie2')).toBeNull();
    expect(redirectedHeaders.get('x-request-id')).toBe('request-1');

    await response.body.cancel();
  });

  it('rejects and cancels proxied redirects when redirect mode is error', async () => {
    let redirectCancelled = false;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            redirectCancelled = true;
          },
        }),
        {
          status: 200,
          headers: {
            location: 'https://api.openai.com/v1/responses/final',
            'x-almostnode-upstream-status': '302',
            'x-almostnode-upstream-status-text': 'Found',
          },
        },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      browserFetchStream(
        {
          url: 'https://api.openai.com/v1/responses',
          redirect: 'error',
        },
        DEFAULT_OPTIONS,
      ),
    ).rejects.toThrow('redirect mode is set to error');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(redirectCancelled).toBe(true);
  });

  it('does not treat non-redirect 3xx statuses as Fetch redirects', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 200,
        headers: {
          location: '/not-followed',
          'x-almostnode-upstream-status': '304',
          'x-almostnode-upstream-status-text': 'Not Modified',
        },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await browserFetchStream(
      {
        url: 'https://api.openai.com/v1/responses',
        redirect: 'error',
      },
      DEFAULT_OPTIONS,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(304);
    expect(response.url).toBe('https://api.openai.com/v1/responses');
    await response.body.cancel();
  });

  it.each([
    {
      label: 'rewrites POST to GET for 301',
      status: 301,
      method: 'POST',
      expectedMethod: 'GET',
      removesBody: true,
    },
    {
      label: 'preserves PUT for 301',
      status: 301,
      method: 'PUT',
      expectedMethod: 'PUT',
      removesBody: false,
    },
    {
      label: 'rewrites POST to GET for 302',
      status: 302,
      method: 'POST',
      expectedMethod: 'GET',
      removesBody: true,
    },
    {
      label: 'preserves PUT for 302',
      status: 302,
      method: 'PUT',
      expectedMethod: 'PUT',
      removesBody: false,
    },
    {
      label: 'rewrites PUT to GET for 303',
      status: 303,
      method: 'PUT',
      expectedMethod: 'GET',
      removesBody: true,
    },
    {
      label: 'preserves HEAD for 303',
      status: 303,
      method: 'HEAD',
      expectedMethod: 'HEAD',
      removesBody: false,
    },
  ])('$label and handles body headers per Fetch', async ({
    status,
    method,
    expectedMethod,
    removesBody,
  }) => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            location: '/final',
            'x-almostnode-upstream-status': String(status),
            'x-almostnode-upstream-status-text': 'Redirect',
          },
        }),
      )
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const response = await browserFetchStream(
      {
        url: 'https://api.openai.com/v1/responses',
        redirect: 'follow',
        method,
        bodyBase64: Buffer.from('request-body').toString('base64'),
        headers: {
          'content-encoding': 'identity',
          'content-language': 'en',
          'content-location': '/body',
          'content-type': 'application/json',
          'x-request-id': 'request-1',
        },
      },
      DEFAULT_OPTIONS,
    );

    const redirectedInit = fetchMock.mock.calls[1]?.[1];
    const redirectedHeaders = new Headers(redirectedInit?.headers);
    expect(redirectedInit?.method).toBe(expectedMethod);
    expect(redirectedInit?.body == null).toBe(removesBody || method === 'HEAD');
    for (const header of [
      'content-encoding',
      'content-language',
      'content-location',
      'content-type',
    ]) {
      expect(redirectedHeaders.has(header)).toBe(!removesBody);
    }
    expect(redirectedHeaders.get('x-request-id')).toBe('request-1');

    await response.body.cancel();
  });
});
