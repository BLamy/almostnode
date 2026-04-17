import { DevServer, type DevServerOptions, type ResponseData } from '../dev-server';
import { Runtime } from '../runtime';
import type { VirtualFS } from '../virtual-fs';
import { Buffer } from '../shims/stream';
import * as path from '../shims/path';
import { simpleHash } from '../utils/hash';

export interface CloudflareWorkerDevServerOptions extends DevServerOptions {
  entry: string;
  envBindings?: Record<string, unknown>;
  localProtocol?: 'http' | 'https';
  runtimeEnv?: Record<string, string>;
}

type CloudflareFetchHandler = (
  request: Request,
  env: Record<string, unknown>,
  ctx: ExecutionContext,
) => Response | Promise<Response>;

interface CloudflareModuleNamespace {
  default?: {
    fetch?: CloudflareFetchHandler;
  } | CloudflareFetchHandler;
  fetch?: CloudflareFetchHandler;
}

let typescriptModulePromise: Promise<typeof import('typescript')> | null = null;

class ExecutionContext {
  private readonly pending = new Set<Promise<unknown>>();

  waitUntil(promise: Promise<unknown>): void {
    this.pending.add(promise);
    promise.finally(() => {
      this.pending.delete(promise);
    }).catch(() => {});
  }

  passThroughOnException(): void {
    // No-op in the browser dev server mock.
  }

  flush(): void {
    if (this.pending.size === 0) {
      return;
    }
    void Promise.allSettled(Array.from(this.pending)).catch(() => {});
  }
}

function toRuntimeEnv(
  runtimeEnv: Record<string, string> | undefined,
  bindings: Record<string, unknown>,
): Record<string, string> {
  const next: Record<string, string> = { ...(runtimeEnv ?? {}) };

  for (const [key, value] of Object.entries(bindings)) {
    if (typeof value === 'string') {
      next[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      next[key] = String(value);
    }
  }

  return next;
}

function getFetchHandler(namespace: CloudflareModuleNamespace): CloudflareFetchHandler | null {
  if (typeof namespace.fetch === 'function') {
    return namespace.fetch.bind(namespace);
  }

  const defaultExport = namespace.default;
  if (typeof defaultExport === 'function') {
    return defaultExport.bind(namespace);
  }
  if (defaultExport && typeof defaultExport === 'object' && typeof defaultExport.fetch === 'function') {
    return defaultExport.fetch.bind(defaultExport);
  }

  return null;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  headers.forEach((value, key) => {
    output[key] = value;
  });
  return output;
}

async function getTypeScriptModule(): Promise<typeof import('typescript')> {
  if (!typescriptModulePromise) {
    typescriptModulePromise = import('typescript');
  }
  return typescriptModulePromise;
}

async function transpileWorkerSource(sourcePath: string, sourceText: string): Promise<string> {
  const typescript = await getTypeScriptModule();
  const result = typescript.transpileModule(sourceText, {
    compilerOptions: {
      allowJs: true,
      esModuleInterop: true,
      isolatedModules: true,
      jsx: typescript.JsxEmit.Preserve,
      module: typescript.ModuleKind.CommonJS,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
    reportDiagnostics: false,
  });

  return result.outputText || sourceText;
}

export class CloudflareWorkerDevServer extends DevServer {
  private readonly entry: string;
  private readonly envBindings: Record<string, unknown>;
  private readonly localProtocol: 'http' | 'https';
  private readonly runtimeEnv: Record<string, string>;

  constructor(vfs: VirtualFS, options: CloudflareWorkerDevServerOptions) {
    super(vfs, options);
    this.entry = options.entry;
    this.envBindings = { ...(options.envBindings ?? {}) };
    this.localProtocol = options.localProtocol ?? 'http';
    this.runtimeEnv = toRuntimeEnv(options.runtimeEnv, this.envBindings);
  }

  private getCompiledModulePath(): string {
    const directory = path.dirname(this.entry);
    return path.join(directory, `.almostnode-wrangler-${simpleHash(this.entry)}.cjs`);
  }

  startWatching(): void {
    // File watching is not required because each request reloads the worker module.
  }

  async handleRequest(
    method: string,
    url: string,
    headers: Record<string, string>,
    body?: Buffer,
  ): Promise<ResponseData> {
    try {
      const runtime = new Runtime(this.vfs, {
        cwd: this.root,
        env: this.runtimeEnv,
      });

      try {
        const sourceText = String(this.vfs.readFileSync(this.entry, 'utf8'));
        const compiledPath = this.getCompiledModulePath();
        const compiledSource = await transpileWorkerSource(this.entry, sourceText);
        this.vfs.writeFileSync(compiledPath, compiledSource);

        const imported = await runtime.execute(compiledSource, compiledPath);
        const namespace = imported.namespace as CloudflareModuleNamespace;
        const fetchHandler = getFetchHandler(namespace);
        if (!fetchHandler) {
          throw new Error(
            `Wrangler worker entry ${this.entry} does not export a fetch handler.`,
          );
        }

        const request = new Request(
          new URL(url, `${this.localProtocol}://localhost:${this.port}`).toString(),
          {
            method,
            headers,
            body: method === 'GET' || method === 'HEAD' ? undefined : body,
          },
        );
        const ctx = new ExecutionContext();
        const response = await fetchHandler(request, { ...this.envBindings }, ctx);
        ctx.flush();

        if (!(response instanceof Response)) {
          throw new Error('Cloudflare fetch handlers must return a Response.');
        }

        const responseBody = Buffer.from(await response.arrayBuffer());
        return {
          statusCode: response.status,
          statusMessage: response.statusText || 'OK',
          headers: headersToRecord(response.headers),
          body: responseBody,
        };
      } finally {
        runtime.clearCache();
      }
    } catch (error) {
      return this.serverError(error);
    }
  }
}
