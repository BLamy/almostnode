import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CommandContext } from 'just-bash';
import { runCurlCommand } from '../src/shims/curl-command';
import { VirtualFS } from '../src/virtual-fs';

// Mock server-bridge
const mockHandleRequest = vi.fn();
vi.mock('../src/server-bridge', () => ({
  getServerBridge: () => ({
    handleRequest: mockHandleRequest,
  }),
}));

function makeCtx(): CommandContext {
  return { cwd: '/', env: {} } as CommandContext;
}

function makeResponse(body: string, statusCode = 200, headers: Record<string, string> = {}) {
  return {
    statusCode,
    statusMessage: statusCode === 200 ? 'OK' : 'Error',
    headers: { 'content-type': 'text/plain', ...headers },
    body: new TextEncoder().encode(body),
  };
}

describe('curl command', () => {
  let vfs: VirtualFS;
  let ctx: CommandContext;

  beforeEach(() => {
    vfs = new VirtualFS();
    ctx = makeCtx();
    mockHandleRequest.mockReset();
  });

  it('shows help with --help', async () => {
    const result = await runCurlCommand(['--help'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Usage: curl');
  });

  it('shows version with --version', async () => {
    const result = await runCurlCommand(['--version'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('curl');
  });

  it('errors when no URL given', async () => {
    const result = await runCurlCommand([], ctx, vfs);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('no URL specified');
  });

  it('GET to localhost virtual server', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('Hello World'));

    const result = await runCurlCommand(['http://localhost:3000/api/users'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('Hello World');
    expect(mockHandleRequest).toHaveBeenCalledWith(
      3000,
      'GET',
      '/api/users',
      {},
      undefined,
    );
  });

  it('POST with JSON body and headers', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('{"id":1}'));

    const result = await runCurlCommand([
      '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-d', '{"name":"test"}',
      'http://localhost:3000/api/users',
    ], ctx, vfs);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('{"id":1}');
    expect(mockHandleRequest).toHaveBeenCalledWith(
      3000,
      'POST',
      '/api/users',
      { 'Content-Type': 'application/json' },
      expect.any(ArrayBuffer),
    );
  });

  it('auto-sets POST when -d is used without -X', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('ok'));

    await runCurlCommand(['-d', 'data=value', 'http://localhost:3000/'], ctx, vfs);

    expect(mockHandleRequest).toHaveBeenCalledWith(
      3000,
      'POST',
      '/',
      { 'Content-Type': 'application/x-www-form-urlencoded' },
      expect.any(ArrayBuffer),
    );
  });

  it('-i flag includes response headers', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('body', 200, { 'x-custom': 'val' }));

    const result = await runCurlCommand(['-i', 'http://localhost:3000/'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('HTTP/1.1 200 OK');
    expect(result.stdout).toContain('x-custom: val');
    expect(result.stdout).toContain('body');
  });

  it('-o writes body to VFS file', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('file content'));

    const result = await runCurlCommand(['-o', '/output.txt', 'http://localhost:3000/file'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('');
    const written = vfs.readFileSync('/output.txt');
    expect(typeof written === 'string' ? written : new TextDecoder().decode(written)).toBe('file content');
  });

  it('no server on port returns 503 body', async () => {
    mockHandleRequest.mockResolvedValue(
      makeResponse('No server listening on port 9999', 503),
    );

    const result = await runCurlCommand(['http://localhost:9999/'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('No server listening');
  });

  it('multiple -H flags', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('ok'));

    await runCurlCommand([
      '-H', 'Authorization: Bearer token123',
      '-H', 'Accept: application/json',
      'http://localhost:3000/',
    ], ctx, vfs);

    expect(mockHandleRequest).toHaveBeenCalledWith(
      3000,
      'GET',
      '/',
      { Authorization: 'Bearer token123', Accept: 'application/json' },
      undefined,
    );
  });

  it('-f with 4xx returns exit code 22', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('Not Found', 404));

    const result = await runCurlCommand(['-f', 'http://localhost:3000/missing'], ctx, vfs);
    expect(result.exitCode).toBe(22);
  });

  it('-sf with 4xx returns exit code 22 silently', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('Not Found', 404));

    const result = await runCurlCommand(['-sf', 'http://localhost:3000/missing'], ctx, vfs);
    expect(result.exitCode).toBe(22);
    expect(result.stderr).toBe('');
  });

  it('-d @file reads body from VFS', async () => {
    vfs.writeFileSync('/body.json', '{"key":"value"}');
    mockHandleRequest.mockResolvedValue(makeResponse('ok'));

    const result = await runCurlCommand([
      '-X', 'POST',
      '-H', 'Content-Type: application/json',
      '-d', '@/body.json',
      'http://localhost:3000/api',
    ], ctx, vfs);

    expect(result.exitCode).toBe(0);
    expect(mockHandleRequest).toHaveBeenCalledWith(
      3000,
      'POST',
      '/api',
      { 'Content-Type': 'application/json' },
      expect.any(ArrayBuffer),
    );
  });

  it('-d @file errors when file does not exist', async () => {
    const result = await runCurlCommand(['-d', '@/nonexistent.txt', 'http://localhost:3000/'], ctx, vfs);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Failed to open/read');
  });

  it('combined short flags -sL', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('ok'));

    const result = await runCurlCommand(['-sL', 'http://localhost:3000/'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok');
  });

  it('--request=POST long flag with equals', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('ok'));

    await runCurlCommand(['--request=POST', 'http://localhost:3000/'], ctx, vfs);

    expect(mockHandleRequest).toHaveBeenCalledWith(
      3000,
      'POST',
      '/',
      {},
      undefined,
    );
  });

  it('-v verbose output on stderr', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('body', 200, { 'x-foo': 'bar' }));

    const result = await runCurlCommand(['-v', 'http://localhost:3000/path'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('> GET /path HTTP/1.1');
    expect(result.stderr).toContain('< HTTP/1.1 200 OK');
    expect(result.stderr).toContain('< x-foo: bar');
    expect(result.stdout).toBe('body');
  });

  it('-w %{http_code} appends status code', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('ok'));

    const result = await runCurlCommand(['-w', '%{http_code}', 'http://localhost:3000/'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('ok200');
  });

  it('adds http:// if protocol missing', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('ok'));

    const result = await runCurlCommand(['localhost:3000/test'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(mockHandleRequest).toHaveBeenCalledWith(3000, 'GET', '/test', {}, undefined);
  });

  it('follows redirects with -L', async () => {
    mockHandleRequest
      .mockResolvedValueOnce(makeResponse('', 302, { location: 'http://localhost:3000/redirected' }))
      .mockResolvedValueOnce(makeResponse('final'));

    const result = await runCurlCommand(['-L', 'http://localhost:3000/start'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('final');
    expect(mockHandleRequest).toHaveBeenCalledTimes(2);
  });

  it('does not follow redirects without -L', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('', 302, { location: '/other' }));

    const result = await runCurlCommand(['http://localhost:3000/start'], ctx, vfs);
    expect(result.exitCode).toBe(0);
    expect(mockHandleRequest).toHaveBeenCalledTimes(1);
  });

  it('defaults port to 80 when none specified', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('ok'));

    await runCurlCommand(['http://localhost/test'], ctx, vfs);

    expect(mockHandleRequest).toHaveBeenCalledWith(80, 'GET', '/test', {}, undefined);
  });

  it('handles 127.0.0.1 as localhost', async () => {
    mockHandleRequest.mockResolvedValue(makeResponse('ok'));

    await runCurlCommand(['http://127.0.0.1:5000/api'], ctx, vfs);

    expect(mockHandleRequest).toHaveBeenCalledWith(5000, 'GET', '/api', {}, undefined);
  });
});
