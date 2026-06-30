import { afterEach, describe, expect, it } from 'vitest';
import { ServerBridge, resetServerBridge } from '../src/server-bridge';
import {
  createFetchVirtualServer,
  registerFetchVirtualServer,
} from '../src/fetch-virtual-server';

describe('fetch virtual server adapter', () => {
  afterEach(() => {
    resetServerBridge();
  });

  it('adapts virtual server requests to Fetch API requests', async () => {
    const bridge = new ServerBridge({ baseUrl: 'http://localhost:5173' });
    registerFetchVirtualServer(bridge, {
      port: 4901,
      baseUrl: 'http://stripe.emulate.localhost',
      fetch: async (request) => {
        const url = new URL(request.url);
        return Response.json({
          method: request.method,
          origin: url.origin,
          pathname: url.pathname,
          search: url.search,
          auth: request.headers.get('authorization'),
        });
      },
      metadata: {
        purpose: 'auxiliary',
        framework: 'emulate',
        name: 'emulate:stripe',
      },
    });

    const response = await bridge.createFetchHandler()(
      new Request(
        'http://localhost:5173/__virtual__/4901/v1/checkout/sessions?limit=1',
        { headers: { authorization: 'Bearer test_token_admin' } },
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      method: 'GET',
      origin: 'http://stripe.emulate.localhost',
      pathname: '/v1/checkout/sessions',
      search: '?limit=1',
      auth: 'Bearer test_token_admin',
    });
  });

  it('preserves non-GET request bodies', async () => {
    const bridge = new ServerBridge({ baseUrl: 'http://localhost:5173' });
    registerFetchVirtualServer(bridge, {
      port: 4902,
      fetch: async (request) => {
        return Response.json({
          method: request.method,
          contentType: request.headers.get('content-type'),
          body: await request.text(),
        });
      },
    });

    const response = await bridge.createFetchHandler()(
      new Request('http://localhost:5173/__virtual__/4902/oauth/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'grant_type=authorization_code&code=abc',
      }),
    );

    await expect(response.json()).resolves.toEqual({
      method: 'POST',
      contentType: 'application/x-www-form-urlencoded',
      body: 'grant_type=authorization_code&code=abc',
    });
  });

  it('returns an unregister handle for bridge cleanup', async () => {
    const bridge = new ServerBridge({ baseUrl: 'http://localhost:5173' });
    const registration = registerFetchVirtualServer(bridge, {
      port: 4903,
      fetch: () => new Response('ok'),
    });

    expect(registration.url).toBe('http://localhost:5173/__virtual__/4903');
    expect(bridge.getServerPorts()).toContain(4903);

    registration.unregister();

    expect(bridge.getServerPorts()).not.toContain(4903);
  });

  it('rewrites hosted checkout HTML actions to the virtual server path', async () => {
    const bridge = new ServerBridge({ baseUrl: 'http://localhost:5173' });
    registerFetchVirtualServer(bridge, {
      port: 4904,
      rewriteAbsolutePaths: true,
      fetch: () => new Response(
        '<style>body{font-family:test;src:url(\'/_emulate/fonts/test.woff2\')}</style><form method="post" action="/checkout/cs_test/complete"><button>Pay $89.00</button></form>',
        { headers: { 'content-type': 'text/html; charset=utf-8' } },
      ),
    });

    const response = await bridge.createFetchHandler()(
      new Request('http://localhost:5173/__virtual__/4904/checkout/cs_test'),
    );
    const html = await response.text();

    expect(html).toContain(
      'action="/__virtual__/4904/checkout/cs_test/complete"',
    );
    expect(html).toContain(
      "url('/__virtual__/4904/_emulate/fonts/test.woff2')",
    );
  });

  it('rewrites absolute redirect locations to the virtual server path', async () => {
    const bridge = new ServerBridge({ baseUrl: 'http://localhost:5173' });
    registerFetchVirtualServer(bridge, {
      port: 4905,
      rewriteAbsolutePaths: true,
      fetch: () => new Response(null, {
        status: 302,
        headers: { location: '/checkout/cs_test' },
      }),
    });

    const response = await bridge.createFetchHandler()(
      new Request('http://localhost:5173/__virtual__/4905/checkout/cs_test/complete', {
        method: 'POST',
      }),
    );

    expect(response.headers.get('location')).toBe('/__virtual__/4905/checkout/cs_test');
  });

  it('can create a standalone virtual server', async () => {
    const server = createFetchVirtualServer({
      port: 4906,
      fetch: (request) => new Response(request.url),
    });

    expect(server.listening).toBe(true);
    expect(server.address()).toEqual({
      port: 4906,
      address: '0.0.0.0',
      family: 'IPv4',
    });

    const response = await server.handleRequest('GET', '/status', {}, undefined);

    expect(response.statusCode).toBe(200);
    expect(response.body.toString()).toBe('http://localhost:4906/status');
  });
});
