import { DevServer, type DevServerOptions, type ResponseData } from '../dev-server';
import type { VirtualFS } from '../virtual-fs';
import * as path from '../shims/path';
import { Buffer } from '../shims/stream';

export interface CloudflarePagesDevServerOptions extends DevServerOptions {
  assetsDir: string;
}

function badMethod(method: string): ResponseData {
  const body = `Method not allowed: ${method}`;
  return {
    statusCode: 405,
    statusMessage: 'Method Not Allowed',
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Content-Length': String(Buffer.byteLength(body)),
    },
    body: Buffer.from(body),
  };
}

export class CloudflarePagesDevServer extends DevServer {
  private readonly assetsDir: string;

  constructor(vfs: VirtualFS, options: CloudflarePagesDevServerOptions) {
    super(vfs, {
      ...options,
      root: options.assetsDir,
    });
    this.assetsDir = options.assetsDir;
  }

  startWatching(): void {
    // Static assets are read directly from the VFS on each request.
  }

  async handleRequest(
    method: string,
    url: string,
    _headers: Record<string, string>,
  ): Promise<ResponseData> {
    if (method !== 'GET' && method !== 'HEAD') {
      return badMethod(method);
    }

    const parsedUrl = new URL(url, `http://localhost:${this.port}`);
    let pathname = parsedUrl.pathname;
    try {
      pathname = decodeURIComponent(pathname);
    } catch {
      // Keep the original path if decoding fails.
    }

    const filePath = this.resolveAssetPath(pathname);
    if (filePath) {
      const response = this.serveFile(filePath);
      return method === 'HEAD'
        ? { ...response, body: Buffer.from('') }
        : response;
    }

    const notFoundPage = path.join(this.assetsDir, '404.html');
    if (this.exists(notFoundPage)) {
      const response = this.serveFile(notFoundPage);
      return {
        ...response,
        statusCode: 404,
        statusMessage: 'Not Found',
        body: method === 'HEAD' ? Buffer.from('') : response.body,
      };
    }

    return this.notFound(pathname);
  }

  private resolveAssetPath(requestPath: string): string | null {
    const normalizedPath = path.normalize(requestPath || '/');
    const resolved = path.normalize(path.join(this.assetsDir, normalizedPath));
    if (!(resolved === this.assetsDir || resolved.startsWith(`${this.assetsDir}/`))) {
      return null;
    }

    if (this.exists(resolved) && !this.isDirectory(resolved)) {
      return resolved;
    }

    const directoryIndex = path.join(resolved, 'index.html');
    if (this.exists(directoryIndex)) {
      return directoryIndex;
    }

    if (!path.extname(resolved)) {
      const htmlFile = `${resolved}.html`;
      if (this.exists(htmlFile)) {
        return htmlFile;
      }
    }

    return null;
  }
}
