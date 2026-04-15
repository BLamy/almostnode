import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createIPNMock } = vi.hoisted(() => ({
  createIPNMock: vi.fn(),
}));

vi.mock('@tailscale/connect', () => ({
  createIPN: createIPNMock,
}));

vi.mock('@tailscale/connect/main.wasm?url', () => ({
  default: 'mock-tailscale.wasm',
}));

type WorkerMessageHandler = (event: { data: unknown }) => void | Promise<void>;

type WorkerResponseMessage =
  | { type: 'response'; id: number; ok: true; value: unknown }
  | {
      type: 'response';
      id: number;
      ok: false;
      error: {
        code: string;
        message: string;
        debug?: Record<string, unknown>;
      };
    };

type WorkerStatusMessage = {
  type: 'status';
  status: {
    state?: string;
    detail?: string;
  };
};

class MockWorkerGlobal {
  readonly posted: unknown[] = [];
  private readonly messageHandlers = new Set<WorkerMessageHandler>();

  addEventListener(type: 'message', handler: WorkerMessageHandler): void {
    if (type === 'message') {
      this.messageHandlers.add(handler);
    }
  }

  postMessage(message: unknown): void {
    this.posted.push(message);
  }

  async dispatch(message: unknown): Promise<void> {
    for (const handler of Array.from(this.messageHandlers)) {
      await handler({ data: message });
    }
  }
}

function restoreGlobalProperty(
  key: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(globalThis, key, descriptor);
    return;
  }

  delete (globalThis as Record<string, unknown>)[key];
}

function getResponseMessages(workerScope: MockWorkerGlobal): WorkerResponseMessage[] {
  return workerScope.posted.filter((message): message is WorkerResponseMessage => (
    typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === 'response'
  ));
}

function getStatusMessages(workerScope: MockWorkerGlobal): WorkerStatusMessage[] {
  return workerScope.posted.filter((message): message is WorkerStatusMessage => (
    typeof message === 'object'
    && message !== null
    && (message as { type?: unknown }).type === 'status'
  ));
}

async function requestDiagnostics(
  workerScope: MockWorkerGlobal,
  id = 9_999,
): Promise<Record<string, any>> {
  await workerScope.dispatch({
    id,
    type: 'getDiagnostics',
  });

  const response = getResponseMessages(workerScope).find(
    (message) => message.id === id && message.ok,
  );
  expect(response).toBeDefined();
  expect(response?.ok).toBe(true);
  return response?.value as Record<string, any>;
}

describe('tailscale connect worker', () => {
  let workerScope: MockWorkerGlobal;
  let processDescriptor: PropertyDescriptor | undefined;
  let fsDescriptor: PropertyDescriptor | undefined;
  let pathDescriptor: PropertyDescriptor | undefined;
  let selfDescriptor: PropertyDescriptor | undefined;
  let goDescriptor: PropertyDescriptor | undefined;
  let fetchDescriptor: PropertyDescriptor | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    createIPNMock.mockReset();

    processDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'process');
    fsDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fs');
    pathDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'path');
    selfDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'self');
    goDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'Go');
    fetchDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');

    workerScope = new MockWorkerGlobal();
    Object.defineProperty(globalThis, 'self', {
      value: workerScope,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, 'Go', {
      value: class MockGo {
        env: Record<string, string> = {};
      },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    restoreGlobalProperty('process', processDescriptor);
    restoreGlobalProperty('fs', fsDescriptor);
    restoreGlobalProperty('path', pathDescriptor);
    restoreGlobalProperty('self', selfDescriptor);
    restoreGlobalProperty('Go', goDescriptor);
    restoreGlobalProperty('fetch', fetchDescriptor);
  });

  it('starts a minimal IPN runtime without trying to call configure after run', async () => {
    const ipn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      fetch: vi.fn(async (_url: string) => ({
        url: 'https://db.ts.net/status',
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
        text: async () => 'tailnet-response',
      })),
    };
    createIPNMock.mockResolvedValue(ipn);

    await import('../src/network/tailscale-connect-worker');

    await workerScope.dispatch({
      id: 1,
      type: 'getStatus',
    });
    await vi.runAllTimersAsync();

    expect(createIPNMock).toHaveBeenCalledTimes(1);
    expect(ipn.run).toHaveBeenCalledTimes(1);
    expect(getResponseMessages(workerScope)).toContainEqual(
      expect.objectContaining({
        id: 1,
        ok: true,
      }),
    );
    expect(getResponseMessages(workerScope).filter((message) => !message.ok)).toHaveLength(0);
  });

  it('reports starting while a hydrated session is resuming', async () => {
    const ipn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      fetch: vi.fn(),
    };
    createIPNMock.mockResolvedValue(ipn);

    await import('../src/network/tailscale-connect-worker');

    await workerScope.dispatch({
      id: 1,
      type: 'hydrateStorage',
      snapshot: {
        profile: 'alpha',
      },
    });

    await workerScope.dispatch({
      id: 2,
      type: 'getStatus',
    });

    expect(getResponseMessages(workerScope)).toContainEqual(
      expect.objectContaining({
        id: 2,
        ok: true,
        value: expect.objectContaining({
          state: 'starting',
        }),
      }),
    );
  });

  it('uses string fetch for simple GET requests on the minimal runtime', async () => {
    const ipn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      fetch: vi.fn(async (url: string) => ({
        url,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
        text: async () => 'tailnet-response',
      })),
    };
    createIPNMock.mockResolvedValue(ipn);

    await import('../src/network/tailscale-connect-worker');

    const fetchPromise = workerScope.dispatch({
      id: 1,
      type: 'fetch',
      request: {
        url: 'https://db.ts.net/status',
        method: 'GET',
        headers: {},
      },
    });
    await vi.runAllTimersAsync();
    await fetchPromise;

    expect(ipn.run).toHaveBeenCalledTimes(1);
    expect(ipn.fetch).toHaveBeenCalledWith('https://db.ts.net/status');

    const responses = getResponseMessages(workerScope);
    expect(responses.at(-1)).toMatchObject({
      id: 1,
      ok: true,
      value: expect.objectContaining({
        url: 'https://db.ts.net/status',
        status: 200,
      }),
    });
  });

  it('rejects structured fetch requests before they hit the minimal runtime', async () => {
    const dnsFetch = vi.fn(async () => new Response(JSON.stringify({
      Status: 0,
      Answer: [{ type: 1, data: '104.18.33.45' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/dns-json' },
    }));
    Object.defineProperty(globalThis, 'fetch', {
      value: dnsFetch,
      configurable: true,
      writable: true,
    });

    const ipn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      fetch: vi.fn(),
    };
    createIPNMock.mockResolvedValue(ipn);

    await import('../src/network/tailscale-connect-worker');

    const fetchPromise = workerScope.dispatch({
      id: 1,
      type: 'fetch',
      request: {
        url: 'https://api.anthropic.com/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-key',
        },
        bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
      },
    });
    await vi.runAllTimersAsync();
    await fetchPromise;

    expect(ipn.run).toHaveBeenCalledTimes(1);
    expect(ipn.fetch).not.toHaveBeenCalled();

    const responses = getResponseMessages(workerScope);
    expect(responses.at(-1)).toMatchObject({
      id: 1,
      ok: false,
      error: {
        code: 'unsupported_fetch_shape',
        message: expect.stringContaining(
          'only supports simple GET requests',
        ),
      },
    });
  });

  it('seeds ipMap and keeps the original hostname for structured public fetches', async () => {
    const dnsFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toContain('cloudflare-dns.com/dns-query');
      expect(url).toContain('name=api.anthropic.com');
      return new Response(JSON.stringify({
        Status: 0,
        Answer: [{ type: 1, data: '104.18.33.45' }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      });
    });
    Object.defineProperty(globalThis, 'fetch', {
      value: dnsFetch,
      configurable: true,
      writable: true,
    });

    const ipn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      configure: vi.fn(async () => {}),
      fetch: vi.fn(async (request: {
        url: string;
        method?: string;
        headers?: Record<string, string>;
        bodyBase64?: string;
        redirect?: string;
      }) => ({
        url: request.url,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
        text: async () => '{"ok":true}',
      })),
    };
    createIPNMock.mockResolvedValue(ipn);

    await import('../src/network/tailscale-connect-worker');

    const fetchPromise = workerScope.dispatch({
      id: 1,
      type: 'fetch',
      request: {
        url: 'https://api.anthropic.com/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-key',
        },
        bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
      },
    });
    await vi.runAllTimersAsync();
    await fetchPromise;

    expect(createIPNMock).toHaveBeenCalledWith(expect.objectContaining({
      ipMap: { 'api.anthropic.com': '104.18.33.45' },
    }));
    expect(ipn.configure).toHaveBeenCalledWith(expect.objectContaining({
      ipMap: { 'api.anthropic.com': '104.18.33.45' },
    }));
    expect(ipn.fetch).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://api.anthropic.com/v1/messages',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-key',
      },
    }));
    const fetchArg = ipn.fetch.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(fetchArg).not.toHaveProperty('tlsServerName');
    expect(fetchArg.headers).not.toHaveProperty('Host');
  });

  it('allows long-running structured POST fetches to use the extended timeout budget', async () => {
    const dnsFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toContain('cloudflare-dns.com/dns-query');
      expect(url).toContain('name=api.anthropic.com');
      return new Response(JSON.stringify({
        Status: 0,
        Answer: [{ type: 1, data: '104.18.33.45' }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      });
    });
    Object.defineProperty(globalThis, 'fetch', {
      value: dnsFetch,
      configurable: true,
      writable: true,
    });

    const ipn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      configure: vi.fn(async () => {}),
      fetch: vi.fn(async (request: {
        url: string;
      }) => new Promise((resolve) => {
        setTimeout(() => resolve({
          url: request.url,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'application/json' },
          bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
          text: async () => '{"ok":true}',
        }), 20_000);
      })),
    };
    createIPNMock.mockResolvedValue(ipn);

    await import('../src/network/tailscale-connect-worker');

    const fetchPromise = workerScope.dispatch({
      id: 1,
      type: 'fetch',
      request: {
        url: 'https://api.anthropic.com/v1/messages',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-key',
        },
        bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
      },
    });

    await vi.advanceTimersByTimeAsync(15_000);
    expect(getResponseMessages(workerScope)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(5_000);
    await fetchPromise;

    expect(getResponseMessages(workerScope).at(-1)).toMatchObject({
      id: 1,
      ok: true,
      value: expect.objectContaining({
        url: 'https://api.anthropic.com/v1/messages',
        status: 200,
      }),
    });
  });

  it('recreates the IPN when a structured fetch omits bodyBase64 and emits starting status while recovering', async () => {
    const dnsFetch = vi.fn(async () => new Response(JSON.stringify({
      Status: 0,
      Answer: [{ type: 1, data: '104.18.32.47' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/dns-json' },
    }));
    Object.defineProperty(globalThis, 'fetch', {
      value: dnsFetch,
      configurable: true,
      writable: true,
    });

    const firstResponseText = vi.fn(async () => {
      throw new Error(
        'reading response body: context deadline exceeded ' +
        '(Client.Timeout or context cancellation while reading body)',
      );
    });
    const firstIpn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      configure: vi.fn(async () => {}),
      fetch: vi.fn(async (request: string | { url: string }) => ({
        url: typeof request === 'string' ? request : request.url,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        text: firstResponseText,
      })),
    };
    const secondIpn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      configure: vi.fn(async () => {}),
      fetch: vi.fn(async (request: string | { url: string }) => ({
        url: typeof request === 'string' ? request : request.url,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'application/json' },
        bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
        text: async () => '{"ok":true}',
      })),
    };
    createIPNMock
      .mockResolvedValueOnce(firstIpn)
      .mockResolvedValueOnce(secondIpn);

    await import('../src/network/tailscale-connect-worker');

    const firstFetchPromise = workerScope.dispatch({
      id: 1,
      type: 'fetch',
      request: {
        url: 'https://chatgpt.com/backend-api/codex/responses',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
      },
    });
    await vi.runAllTimersAsync();
    await firstFetchPromise;

    expect(firstResponseText).not.toHaveBeenCalled();
    expect(getResponseMessages(workerScope).at(-1)).toMatchObject({
      id: 1,
      ok: false,
      error: {
        code: 'runtime_unavailable',
        message: 'Tailscale structured fetch response omitted bodyBase64.',
        debug: expect.objectContaining({
          expectedBodyBase64: true,
          hadBodyBase64: false,
          lastRuntimeResetReason: 'Tailscale structured fetch response omitted bodyBase64.',
        }),
      },
    });
    expect(getStatusMessages(workerScope)).toContainEqual(
      expect.objectContaining({
        status: expect.objectContaining({
          state: 'starting',
          detail: expect.stringContaining('omitted bodyBase64'),
        }),
      }),
    );

    await expect(requestDiagnostics(workerScope, 101)).resolves.toMatchObject({
      counters: expect.objectContaining({
        totalFetches: 1,
        publicFetches: 1,
        structuredFetches: 1,
        runtimeResets: 1,
        recoveriesAttempted: 0,
        failures: 1,
      }),
      failureBuckets: expect.objectContaining({
        structured_fetch_missing_body_base64: 1,
      }),
      dominantFailureBucket: 'structured_fetch_missing_body_base64',
      runtimeResetCount: 1,
      lastRuntimeResetReason: 'Tailscale structured fetch response omitted bodyBase64.',
      recentFailures: [
        expect.objectContaining({
          host: 'chatgpt.com',
          bucket: 'structured_fetch_missing_body_base64',
          phase: 'read_body',
          requestShape: expect.objectContaining({
            method: 'POST',
            hasBody: true,
            contentType: 'application/json',
            acceptsEventStream: false,
          }),
        }),
      ],
    });

    const secondFetchPromise = workerScope.dispatch({
      id: 2,
      type: 'fetch',
      request: {
        url: 'https://chatgpt.com/backend-api/codex/responses',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
      },
    });
    await vi.runAllTimersAsync();
    await secondFetchPromise;

    expect(createIPNMock).toHaveBeenCalledTimes(2);
    expect(secondIpn.run).toHaveBeenCalledTimes(1);
    expect(getResponseMessages(workerScope).at(-1)).toMatchObject({
      id: 2,
      ok: true,
      value: expect.objectContaining({
        url: 'https://chatgpt.com/backend-api/codex/responses',
        status: 200,
      }),
    });
  });

  it('treats syscall/js.valueNew runtime logs as fatal recovery signals', async () => {
    const firstIpn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      fetch: vi.fn(async () => {
        const runtimeFs = (globalThis as {
          fs?: {
            writeSync: (
              fd: number,
              buffer: Uint8Array,
              offset?: number,
              length?: number,
              position?: number | null,
            ) => number;
          };
        }).fs;
        const runtimeLog = 'panic: syscall/js.valueNew returned an invalid handle\n';
        runtimeFs?.writeSync(
          2,
          new TextEncoder().encode(runtimeLog),
          0,
          runtimeLog.length,
          null,
        );
        throw new Error('runtime bridge closed');
      }),
    };
    const secondIpn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      fetch: vi.fn(async (url: string) => ({
        url,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
        bodyBase64: Buffer.from('tailnet-response').toString('base64'),
        text: async () => 'tailnet-response',
      })),
    };
    createIPNMock
      .mockResolvedValueOnce(firstIpn)
      .mockResolvedValueOnce(secondIpn);

    await import('../src/network/tailscale-connect-worker');

    const firstFetchPromise = workerScope.dispatch({
      id: 1,
      type: 'fetch',
      request: {
        url: 'https://db.ts.net/status',
        method: 'GET',
        headers: {},
      },
    });
    await vi.runAllTimersAsync();
    await firstFetchPromise;

    expect(getResponseMessages(workerScope).at(-1)).toMatchObject({
      id: 1,
      ok: false,
      error: {
        code: 'runtime_unavailable',
        message: 'runtime bridge closed',
        debug: expect.objectContaining({
          recentRuntimeSignal: expect.stringContaining('syscall/js.valueNew'),
          lastRuntimeResetReason: 'runtime bridge closed',
        }),
      },
    });

    const secondFetchPromise = workerScope.dispatch({
      id: 2,
      type: 'fetch',
      request: {
        url: 'https://db.ts.net/status',
        method: 'GET',
        headers: {},
      },
    });
    await vi.runAllTimersAsync();
    await secondFetchPromise;

    expect(createIPNMock).toHaveBeenCalledTimes(2);
    expect(secondIpn.run).toHaveBeenCalledTimes(1);
    expect(getResponseMessages(workerScope).at(-1)).toMatchObject({
      id: 2,
      ok: true,
      value: expect.objectContaining({
        url: 'https://db.ts.net/status',
        status: 200,
      }),
    });
  });

  it('retries public fetches via direct IP when the runtime still uses loopback DNS', async () => {
    const dnsFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toContain('cloudflare-dns.com/dns-query');
      expect(url).toContain('name=google.com');
      return new Response(JSON.stringify({
        Status: 0,
        Answer: [{ type: 1, data: '142.250.190.14' }],
      }), {
        status: 200,
        headers: { 'content-type': 'application/dns-json' },
      });
    });
    Object.defineProperty(globalThis, 'fetch', {
      value: dnsFetch,
      configurable: true,
      writable: true,
    });

    const ipn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      configure: vi.fn(async () => {}),
      fetch: vi.fn(async (request: {
        url: string;
        headers?: Record<string, string>;
        tlsServerName?: string;
        redirect?: string;
      }) => {
        if (request.url === 'http://google.com/') {
          throw new Error(
            'Get "http://google.com/": lookup google.com on [::1]:53: ' +
            'write udp 127.0.0.1:8->[::1]:53: write: Connection reset by peer',
          );
        }

        expect(request).toMatchObject({
          url: 'http://142.250.190.14/',
          headers: {
            Host: 'google.com',
          },
          redirect: 'manual',
        });
        expect(request).not.toHaveProperty('tlsServerName');
        return {
          url: request.url,
          status: 200,
          statusText: 'OK',
          headers: { 'content-type': 'text/plain' },
          bodyBase64: Buffer.from('google-response').toString('base64'),
          text: async () => 'google-response',
        };
      }),
    };
    createIPNMock.mockResolvedValue(ipn);

    await import('../src/network/tailscale-connect-worker');

    const fetchPromise = workerScope.dispatch({
      id: 1,
      type: 'fetch',
      request: {
        url: 'http://google.com/',
        method: 'GET',
        headers: {},
        redirect: 'manual',
      },
    });
    await vi.runAllTimersAsync();
    await fetchPromise;

    expect(ipn.fetch).toHaveBeenCalledTimes(2);
    expect(ipn.fetch.mock.calls[0]?.[0]).toMatchObject({
      url: 'http://google.com/',
      redirect: 'manual',
    });
    expect(ipn.fetch.mock.calls[1]?.[0]).toMatchObject({
      url: 'http://142.250.190.14/',
      headers: {
        Host: 'google.com',
      },
      redirect: 'manual',
    });

    const responses = getResponseMessages(workerScope);
    expect(responses.at(-1)).toMatchObject({
      id: 1,
      ok: true,
      value: expect.objectContaining({
        url: 'http://google.com/',
        status: 200,
      }),
    });

    await expect(requestDiagnostics(workerScope, 201)).resolves.toMatchObject({
      counters: expect.objectContaining({
        totalFetches: 1,
        publicFetches: 1,
        structuredFetches: 1,
        directIpFallbacks: 1,
        successes: 1,
        failures: 0,
      }),
      failureBuckets: expect.objectContaining({
        dns_loopback: 0,
      }),
      dominantFailureBucket: null,
    });
  });

  it('allows long-running structured POST fetches to complete through direct-IP fallback', async () => {
    const dnsFetch = vi.fn(async () => new Response(JSON.stringify({
      Status: 0,
      Answer: [{ type: 1, data: '160.79.104.10' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/dns-json' },
    }));
    Object.defineProperty(globalThis, 'fetch', {
      value: dnsFetch,
      configurable: true,
      writable: true,
    });

    const ipn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      configure: vi.fn(async () => {}),
      fetch: vi.fn(async (request: {
        url: string;
        tlsServerName?: string;
      }) => {
        if (request.url === 'https://api.anthropic.com/v1/messages?beta=true') {
          throw new Error(
            'Post "https://api.anthropic.com/v1/messages?beta=true": lookup api.anthropic.com on [::1]:53: ' +
            'write udp 127.0.0.1:24->[::1]:53: write: Connection reset by peer',
          );
        }

        expect(request).toMatchObject({
          url: 'https://160.79.104.10/v1/messages?beta=true',
          tlsServerName: 'api.anthropic.com',
        });

        return new Promise((resolve) => {
          setTimeout(() => resolve({
            url: request.url,
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
            text: async () => '{"ok":true}',
          }), 20_000);
        });
      }),
    };
    createIPNMock.mockResolvedValue(ipn);

    await import('../src/network/tailscale-connect-worker');

    const fetchPromise = workerScope.dispatch({
      id: 1,
      type: 'fetch',
      request: {
        url: 'https://api.anthropic.com/v1/messages?beta=true',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': 'test-key',
        },
        bodyBase64: Buffer.from('{"ok":true}').toString('base64'),
      },
    });

    await vi.advanceTimersByTimeAsync(15_000);
    expect(getResponseMessages(workerScope)).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(5_000);
    await fetchPromise;

    expect(ipn.fetch).toHaveBeenCalledTimes(2);
    expect(getResponseMessages(workerScope).at(-1)).toMatchObject({
      id: 1,
      ok: true,
      value: expect.objectContaining({
        url: 'https://api.anthropic.com/v1/messages?beta=true',
        status: 200,
      }),
    });
  });

  it('classifies body-read timeouts separately from generic fetch timeouts', async () => {
    const ipn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      fetch: vi.fn(async (url: string) => ({
        url,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
        text: async () => {
          throw new Error(
            'reading response body: context deadline exceeded ' +
            '(Client.Timeout or context cancellation while reading body)',
          );
        },
      })),
    };
    createIPNMock.mockResolvedValue(ipn);

    await import('../src/network/tailscale-connect-worker');

    const fetchPromise = workerScope.dispatch({
      id: 1,
      type: 'fetch',
      request: {
        url: 'https://db.ts.net/status',
        method: 'GET',
        headers: {},
      },
    });
    await vi.runAllTimersAsync();
    await fetchPromise;

    expect(getResponseMessages(workerScope).at(-1)).toMatchObject({
      id: 1,
      ok: false,
      error: {
        code: 'fetch_timeout',
        message: expect.stringContaining('Tailscale response body read failed'),
      },
    });

    await expect(requestDiagnostics(workerScope, 401)).resolves.toMatchObject({
      counters: expect.objectContaining({
        totalFetches: 1,
        tailnetFetches: 1,
        runtimeResets: 1,
        failures: 1,
      }),
      failureBuckets: expect.objectContaining({
        body_read_timeout: 1,
      }),
      dominantFailureBucket: 'body_read_timeout',
      recentFailures: [
        expect.objectContaining({
          host: 'db.ts.net',
          bucket: 'body_read_timeout',
          phase: 'read_body',
          requestShape: expect.objectContaining({
            method: 'GET',
            hasBody: false,
            acceptsEventStream: false,
          }),
        }),
      ],
    });
  });

  it('classifies direct-IP fallback failures when loopback DNS persists after ipMap sync', async () => {
    const dnsFetch = vi.fn(async () => new Response(JSON.stringify({
      Status: 0,
      Answer: [{ type: 1, data: '142.250.190.14' }],
    }), {
      status: 200,
      headers: { 'content-type': 'application/dns-json' },
    }));
    Object.defineProperty(globalThis, 'fetch', {
      value: dnsFetch,
      configurable: true,
      writable: true,
    });

    const ipn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      configure: vi.fn(async () => {}),
      fetch: vi.fn(async (request: { url: string }) => {
        if (request.url === 'https://google.com/') {
          throw new Error(
            'Get "https://google.com/": lookup google.com on [::1]:53: ' +
            'write udp 127.0.0.1:8->[::1]:53: write: Connection reset by peer',
          );
        }
        throw new Error('connect ECONNRESET');
      }),
    };
    createIPNMock.mockResolvedValue(ipn);

    await import('../src/network/tailscale-connect-worker');

    const fetchPromise = workerScope.dispatch({
      id: 1,
      type: 'fetch',
      request: {
        url: 'https://google.com/',
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        bodyBase64: Buffer.from('{"probe":true}').toString('base64'),
      },
    });
    await vi.runAllTimersAsync();
    await fetchPromise;

    expect(getResponseMessages(workerScope).at(-1)).toMatchObject({
      id: 1,
      ok: false,
      error: {
        message: expect.stringContaining('direct-IP retry failed'),
      },
    });

    await expect(requestDiagnostics(workerScope, 402)).resolves.toMatchObject({
      counters: expect.objectContaining({
        totalFetches: 1,
        publicFetches: 1,
        structuredFetches: 1,
        directIpFallbacks: 0,
        failures: 1,
      }),
      failureBuckets: expect.objectContaining({
        direct_ip_fallback_failed: 1,
      }),
      dominantFailureBucket: 'direct_ip_fallback_failed',
      recentFailures: [
        expect.objectContaining({
          host: 'google.com',
          bucket: 'direct_ip_fallback_failed',
          phase: 'fallback_fetch',
          requestShape: expect.objectContaining({
            method: 'POST',
            hasBody: true,
            contentType: 'application/json',
          }),
        }),
      ],
    });
  });

  it('recreates the IPN after a runtime panic so the next fetch can recover', async () => {
    const firstIpn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      fetch: vi.fn(async () => {
        throw new Error('panic: ValueOf: invalid value');
      }),
    };
    const secondIpn = {
      run: vi.fn(),
      login: vi.fn(),
      logout: vi.fn(),
      fetch: vi.fn(async (url: string) => ({
        url,
        status: 200,
        statusText: 'OK',
        headers: { 'content-type': 'text/plain' },
        bodyBase64: Buffer.from('tailnet-response').toString('base64'),
        text: async () => 'tailnet-response',
      })),
    };
    createIPNMock
      .mockResolvedValueOnce(firstIpn)
      .mockResolvedValueOnce(secondIpn);

    await import('../src/network/tailscale-connect-worker');

    const firstFetchPromise = workerScope.dispatch({
      id: 1,
      type: 'fetch',
      request: {
        url: 'https://db.ts.net/status',
        method: 'GET',
        headers: {},
      },
    });
    await vi.runAllTimersAsync();
    await firstFetchPromise;

    expect(getResponseMessages(workerScope).at(-1)).toMatchObject({
      id: 1,
      ok: false,
      error: {
        code: 'runtime_panic',
        message: expect.stringContaining('ValueOf: invalid value'),
      },
    });

    await expect(requestDiagnostics(workerScope, 301)).resolves.toMatchObject({
      counters: expect.objectContaining({
        totalFetches: 1,
        tailnetFetches: 1,
        runtimeResets: 1,
        failures: 1,
      }),
      failureBuckets: expect.objectContaining({
        runtime_panic: 1,
      }),
      dominantFailureBucket: 'runtime_panic',
      recentFailures: [
        expect.objectContaining({
          host: 'db.ts.net',
          bucket: 'runtime_panic',
          requestShape: expect.objectContaining({
            method: 'GET',
            hasBody: false,
          }),
        }),
      ],
    });

    const secondFetchPromise = workerScope.dispatch({
      id: 2,
      type: 'fetch',
      request: {
        url: 'https://db.ts.net/status',
        method: 'GET',
        headers: {},
      },
    });
    await vi.runAllTimersAsync();
    await secondFetchPromise;

    expect(createIPNMock).toHaveBeenCalledTimes(2);
    expect(secondIpn.run).toHaveBeenCalledTimes(1);
    expect(secondIpn.fetch).toHaveBeenCalledWith('https://db.ts.net/status');
    expect(getResponseMessages(workerScope).at(-1)).toMatchObject({
      id: 2,
      ok: true,
      value: expect.objectContaining({
        url: 'https://db.ts.net/status',
        status: 200,
      }),
    });
  });
});
