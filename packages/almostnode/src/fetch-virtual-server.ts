import type { ResponseData } from './shims/http';
import { Buffer } from './shims/stream';
import type {
  IVirtualServer,
  ServerBridge,
  ServerRegistrationMetadata,
} from './server-bridge';

export type FetchHandler = (request: Request) => Response | Promise<Response>;

export interface FetchVirtualServerOptions {
  port: number;
  fetch: FetchHandler;
  baseUrl?: string;
  hostname?: string;
  rewriteAbsolutePaths?:
    | boolean
    | {
        prefix: string;
      };
}

export interface RegisterFetchVirtualServerOptions
  extends FetchVirtualServerOptions {
  metadata?: ServerRegistrationMetadata;
}

export interface RegisteredFetchVirtualServer {
  port: number;
  url: string;
  server: IVirtualServer;
  unregister(): void;
}

const EMPTY_STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  201: 'Created',
  202: 'Accepted',
  204: 'No Content',
  301: 'Moved Permanently',
  302: 'Found',
  304: 'Not Modified',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
};

function toBodyInit(body?: Buffer | string): BodyInit | undefined {
  if (body == null) return undefined;
  if (typeof body === 'string') return body;

  const bytes = new Uint8Array(body);
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function responseHeadersToRecord(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function makeRequestUrl(url: string, baseUrl: string): string {
  return new URL(url, baseUrl).toString();
}

function normalizePathPrefix(prefix: string): string {
  if (!prefix || prefix === '/') return '';
  return prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
}

function prefixAbsolutePath(path: string, prefix: string): string {
  if (
    !prefix
    || !path.startsWith('/')
    || path.startsWith('//')
    || path === prefix
    || path.startsWith(`${prefix}/`)
  ) {
    return path;
  }

  return `${prefix}${path}`;
}

function rewriteHtmlAbsolutePaths(html: string, prefix: string): string {
  return html
    .replace(
      /\b(action|formaction|href|src)=(["'])(\/(?!\/)[^"']*)\2/gi,
      (_match, attr: string, quote: string, path: string) =>
        `${attr}=${quote}${prefixAbsolutePath(path, prefix)}${quote}`,
    )
    .replace(
      /url\((["'])(\/(?!\/)[^"']*)\1\)/gi,
      (_match, quote: string, path: string) =>
        `url(${quote}${prefixAbsolutePath(path, prefix)}${quote})`,
    );
}

function getRewritePrefix(
  rewriteAbsolutePaths: FetchVirtualServerOptions['rewriteAbsolutePaths'],
  fallbackPrefix: string,
): string | undefined {
  if (!rewriteAbsolutePaths) return undefined;
  if (rewriteAbsolutePaths === true) return normalizePathPrefix(fallbackPrefix);
  return normalizePathPrefix(rewriteAbsolutePaths.prefix);
}

async function responseToData(
  response: Response,
  rewritePrefix?: string,
): Promise<ResponseData> {
  const headers = responseHeadersToRecord(response.headers);

  if (rewritePrefix && headers.location) {
    headers.location = prefixAbsolutePath(headers.location, rewritePrefix);
  }

  const contentType = response.headers.get('content-type') || '';
  const shouldRewriteHtml =
    Boolean(rewritePrefix) && contentType.toLowerCase().includes('text/html');

  const body = shouldRewriteHtml
    ? Buffer.from(rewriteHtmlAbsolutePaths(await response.text(), rewritePrefix!))
    : response.body
      ? Buffer.from(new Uint8Array(await response.arrayBuffer()))
      : Buffer.from('');

  if (shouldRewriteHtml) {
    delete headers['content-length'];
  }

  return {
    statusCode: response.status,
    statusMessage:
      response.statusText || EMPTY_STATUS_TEXT[response.status] || '',
    headers,
    body,
  };
}

export function createFetchVirtualServer(
  options: FetchVirtualServerOptions,
): IVirtualServer {
  const hostname = options.hostname || '0.0.0.0';
  const baseUrl =
    options.baseUrl || `http://localhost:${options.port}`;
  const rewritePrefix = getRewritePrefix(
    options.rewriteAbsolutePaths,
    new URL(baseUrl).pathname,
  );

  return {
    listening: true,
    address: () => ({
      port: options.port,
      address: hostname,
      family: 'IPv4',
    }),
    async handleRequest(method, url, headers, body) {
      const hasBody = method !== 'GET' && method !== 'HEAD';
      const request = new Request(makeRequestUrl(url, baseUrl), {
        method,
        headers,
        body: hasBody ? toBodyInit(body) : undefined,
        duplex: 'half',
      } as RequestInit & { duplex: 'half' });

      return responseToData(await options.fetch(request), rewritePrefix);
    },
  };
}

export function registerFetchVirtualServer(
  bridge: ServerBridge,
  options: RegisterFetchVirtualServerOptions,
): RegisteredFetchVirtualServer {
  const virtualUrl = bridge.getServerUrl(options.port);
  const server = createFetchVirtualServer({
    ...options,
    rewriteAbsolutePaths:
      options.rewriteAbsolutePaths === true
        ? { prefix: new URL(virtualUrl).pathname }
        : options.rewriteAbsolutePaths,
  });
  const hostname = options.hostname || '0.0.0.0';
  bridge.registerServer(server, options.port, hostname, options.metadata);

  return {
    port: options.port,
    url: virtualUrl,
    server,
    unregister: () => bridge.unregisterServer(options.port),
  };
}
