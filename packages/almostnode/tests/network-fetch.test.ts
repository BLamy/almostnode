import { afterEach, describe, expect, it, vi } from 'vitest';
import { browserFetch } from '../src/network/fetch';
import type { NetworkOptions } from '../src/network/types';

const DEFAULT_OPTIONS: Required<NetworkOptions> = {
  provider: 'browser',
  authMode: 'interactive',
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
});
