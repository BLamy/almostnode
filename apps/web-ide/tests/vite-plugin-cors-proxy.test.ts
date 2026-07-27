// @vitest-environment node
import {
  createServer,
  get,
  request,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import { EventEmitter, once } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleCorsProxyRequest,
  parseWebSocketRelayRequest,
} from '../src/plugins/vite-plugin-cors-proxy';

const servers: Server[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map(closeServer));
});

function encodeRelayValue(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64');
}

describe('vite cors proxy websocket relay', () => {
  it('parses relay requests and strips reserved websocket headers', () => {
    const rawUrl = `/__api/ws-relay?url=${encodeURIComponent('wss://api.anthropic.com/socket')}`
      + `&headers=${encodeURIComponent(encodeRelayValue({
        Authorization: 'Bearer test',
        Host: 'malicious.example',
        'Sec-WebSocket-Key': 'abc123',
      }))}`
      + `&protocols=${encodeURIComponent(encodeRelayValue(['json', '', 'chat']))}`;

    expect(parseWebSocketRelayRequest(rawUrl)).toEqual({
      target: new URL('wss://api.anthropic.com/socket'),
      headers: {
        Authorization: 'Bearer test',
      },
      protocols: ['json', 'chat'],
    });
  });

  it('rejects non-websocket relay targets', () => {
    expect(() => {
      parseWebSocketRelayRequest(
        `/__api/ws-relay?url=${encodeURIComponent('https://api.anthropic.com/socket')}`,
      );
    }).toThrow('Unsupported target protocol');
  });
});

describe('vite cors proxy HTTP streaming', () => {
  it('forwards response headers before the first upstream body chunk', async () => {
    let releaseFirstChunk!: () => void;
    let firstChunkReleased = false;
    const firstChunkGate = new Promise<void>((resolve) => {
      releaseFirstChunk = () => {
        firstChunkReleased = true;
        resolve();
      };
    });
    const upstream = await listen(async (_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'x-upstream': 'headers-first',
      });
      res.flushHeaders();
      await firstChunkGate;
      res.end('data: first\n\n');
    });
    const proxy = await listenProxy();

    const response = await withTimeout(
      new Promise<IncomingMessage>((resolve, reject) => {
        const client = get(
          corsProxyUrl(proxy.url, `${upstream.url}/headers-first`),
          resolve,
        );
        client.once('error', reject);
      }),
      1_000,
      'proxy response headers before body',
    );

    expect(firstChunkReleased).toBe(false);
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(response.headers['x-upstream']).toBe('headers-first');

    const body = collectRemainingResponseBody(response);
    releaseFirstChunk();
    await expect(body).resolves.toBe('data: first\n\n');
  });

  it('forwards the first upstream chunk before the response completes', async () => {
    let releaseFinalChunk!: () => void;
    let finalChunkReleased = false;
    const finalChunkGate = new Promise<void>((resolve) => {
      releaseFinalChunk = () => {
        finalChunkReleased = true;
        resolve();
      };
    });
    const upstream = await listen(async (_req, res) => {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'x-upstream': 'streaming',
      });
      res.flushHeaders();
      res.write('data: first\n\n');
      await finalChunkGate;
      res.end('data: second\n\n');
    });
    const proxy = await listenProxy();
    const proxyUrl = corsProxyUrl(proxy.url, `${upstream.url}/stream`);

    const response = await withTimeout(
      new Promise<IncomingMessage>((resolve, reject) => {
        const client = get(proxyUrl, resolve);
        client.once('error', reject);
      }),
      1_000,
      'proxy response headers',
    );
    const [firstChunk] = await withTimeout(
      once(response, 'data') as Promise<[Buffer]>,
      1_000,
      'first proxy response chunk',
    );

    expect(firstChunk.toString('utf8')).toBe('data: first\n\n');
    expect(finalChunkReleased).toBe(false);
    expect(response.headers['content-type']).toBe('text/event-stream');
    expect(response.headers['x-upstream']).toBe('streaming');

    const remainingBody = collectRemainingResponseBody(response);
    releaseFinalChunk();
    await expect(remainingBody).resolves.toBe('data: second\n\n');
  });

  it('preserves redirect metadata while forwarding the response body', async () => {
    const upstream = await listen((_req, res) => {
      res.statusCode = 307;
      res.statusMessage = 'Temporary Redirect';
      res.setHeader('location', '/final');
      res.setHeader('content-type', 'text/plain');
      res.end('redirecting');
    });
    const proxy = await listenProxy();

    const response = await requestText(
      corsProxyUrl(proxy.url, `${upstream.url}/redirect`),
    );

    expect(response.statusCode).toBe(200);
    expect(response.statusMessage).toBe('OK');
    expect(response.headers['x-almostnode-upstream-status']).toBe('307');
    expect(response.headers['x-almostnode-upstream-status-text']).toBe(
      'Temporary Redirect',
    );
    expect(response.headers.location).toBe('/final');
    expect(response.headers['content-type']).toBe('text/plain');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toBe('redirecting');
  });

  it('ends HEAD and bodyless responses without reading a response body', async () => {
    const upstreamMethods: string[] = [];
    const upstream = await listen((req, res) => {
      upstreamMethods.push(req.method ?? '');
      if (req.url === '/empty') {
        res.statusCode = 204;
        res.end();
        return;
      }
      res.statusCode = 200;
      res.setHeader('x-upstream-method', req.method ?? '');
      res.end('body that HEAD must not forward');
    });
    const proxy = await listenProxy();

    const head = await requestText(
      corsProxyUrl(proxy.url, `${upstream.url}/head`),
      { method: 'HEAD' },
    );
    const empty = await requestText(
      corsProxyUrl(proxy.url, `${upstream.url}/empty`),
    );

    expect(head.statusCode).toBe(200);
    expect(head.headers['x-upstream-method']).toBe('HEAD');
    expect(head.body).toBe('');
    expect(empty.statusCode).toBe(204);
    expect(empty.body).toBe('');
    expect(upstreamMethods).toEqual(['HEAD', 'GET']);
  });

  it('never forwards proxy-origin cookies but preserves explicit authorization', async () => {
    let upstreamHeaders: IncomingMessage['headers'] = {};
    const upstream = await listen((req, res) => {
      upstreamHeaders = req.headers;
      res.end('ok');
    });
    const proxy = await listenProxy();

    await requestText(
      corsProxyUrl(proxy.url, `${upstream.url}/headers`),
      {
        headers: {
          authorization: 'Bearer test-token',
          cookie: 'web-ide-session=secret',
          cookie2: '$Version=1',
          'x-request-id': 'request-1',
        },
      },
    );

    expect(upstreamHeaders.authorization).toBe('Bearer test-token');
    expect(upstreamHeaders.cookie).toBeUndefined();
    expect(upstreamHeaders.cookie2).toBeUndefined();
    expect(upstreamHeaders['x-request-id']).toBe('request-1');
  });

  it('cancels the upstream stream when the downstream client disconnects', async () => {
    let markUpstreamClosed!: () => void;
    const upstreamClosed = new Promise<void>((resolve) => {
      markUpstreamClosed = resolve;
    });
    const upstream = await listen((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.flushHeaders();
      res.write('data: first\n\n');
      const interval = setInterval(() => {
        res.write('data: keepalive\n\n');
      }, 25);
      res.once('close', () => {
        clearInterval(interval);
        markUpstreamClosed();
      });
    });
    const proxy = await listenProxy();
    const response = await withTimeout(
      new Promise<IncomingMessage>((resolve, reject) => {
        const client = get(
          corsProxyUrl(proxy.url, `${upstream.url}/abort`),
          resolve,
        );
        client.once('error', reject);
      }),
      1_000,
      'abort test response',
    );
    response.on('error', () => {
      // Destroying the response is the behavior under test.
    });
    await withTimeout(
      once(response, 'data') as Promise<[Buffer]>,
      1_000,
      'abort test first chunk',
    );

    response.destroy();

    await withTimeout(upstreamClosed, 1_000, 'upstream cancellation');
  });

  it('cancels the upstream stream when the downstream writer errors before close', async () => {
    let cancelReason: unknown;
    const upstreamBody = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: first\n\n'));
      },
      cancel(reason) {
        cancelReason = reason;
      },
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(upstreamBody, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );

    const requestEmitter = Object.assign(new EventEmitter(), {
      url: '/__api/cors-proxy?url=https%3A%2F%2Fapi.openai.com%2Fv1%2Fresponses',
      method: 'GET',
      headers: {},
    }) as unknown as IncomingMessage;
    const responseEmitter = new EventEmitter();
    const response = Object.assign(responseEmitter, {
      destroyed: false,
      writableEnded: false,
      headersSent: false,
      statusCode: 200,
      statusMessage: '',
      setHeader: () => responseEmitter,
      flushHeaders: () => undefined,
      write: () => {
        setTimeout(() => {
          responseEmitter.emit('error', new Error('downstream write failed'));
        }, 0);
        return false;
      },
      end: () => undefined,
    }) as unknown as ServerResponse;

    await expect(
      handleCorsProxyRequest(requestEmitter, response),
    ).rejects.toThrow('downstream write failed');
    expect(cancelReason).toBe('downstream response did not complete');
  });
});

async function listen(
  handler: RequestListener,
): Promise<{ server: Server; url: string }> {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Test server did not expose a TCP port.');
  }
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function listenProxy(): Promise<{ server: Server; url: string }> {
  return listen((req, res) => {
    void handleCorsProxyRequest(req, res).catch((error) => {
      if (res.destroyed || res.writableEnded) {
        return;
      }
      if (res.headersSent) {
        res.destroy(error instanceof Error ? error : undefined);
        return;
      }
      res.statusCode = 500;
      res.end(error instanceof Error ? error.message : String(error));
    });
  });
}

function corsProxyUrl(proxyUrl: string, targetUrl: string): string {
  return `${proxyUrl}/__api/cors-proxy?url=${encodeURIComponent(targetUrl)}`;
}

function collectRemainingResponseBody(response: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    response.on('data', (chunk: Buffer) => chunks.push(chunk));
    response.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    response.once('error', reject);
  });
}

function requestText(
  url: string,
  options: {
    method?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<{
  statusCode: number | undefined;
  statusMessage: string | undefined;
  headers: IncomingMessage['headers'];
  body: string;
}> {
  return new Promise((resolve, reject) => {
    const client = request(url, options, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.once('end', () => {
        resolve({
          statusCode: response.statusCode,
          statusMessage: response.statusMessage,
          headers: response.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        });
      });
      response.once('error', reject);
    });
    client.once('error', reject);
    client.end();
  });
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Timed out waiting for ${label}.`));
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections?.();
  });
}
