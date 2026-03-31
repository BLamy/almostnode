import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VirtualFS } from '../src/virtual-fs';
import { Runtime, execute } from '../src/runtime';

describe('Runtime', () => {
  let vfs: VirtualFS;
  let runtime: Runtime;

  beforeEach(() => {
    vfs = new VirtualFS();
    runtime = new Runtime(vfs);
  });

  describe('basic execution', () => {
    it('should execute simple code', async () => {
      const { exports } = await runtime.execute('module.exports = 42;');
      expect(exports).toBe(42);
    });

    it('should provide __filename and __dirname', async () => {
      const { exports } = await runtime.execute(`
        module.exports = { filename: __filename, dirname: __dirname };
      `, '/test/file.js');
      expect(exports).toEqual({
        filename: '/test/file.js',
        dirname: '/test',
      });
    });

    it('should handle exports object', async () => {
      const { exports } = await runtime.execute(`
        exports.foo = 'bar';
        exports.num = 123;
      `);
      expect(exports).toEqual({ foo: 'bar', num: 123 });
    });

    it('should handle module.exports object', async () => {
      const { exports } = await runtime.execute(`
        module.exports = { hello: 'world' };
      `);
      expect(exports).toEqual({ hello: 'world' });
    });

    it('should require transformed CommonJS files from type module packages', async () => {
      vfs.mkdirSync('/node_modules/string-width', { recursive: true });
      vfs.writeFileSync('/node_modules/string-width/package.json', JSON.stringify({
        name: 'string-width',
        type: 'module',
        exports: {
          default: './index.js',
        },
      }));
      vfs.writeFileSync(
        '/node_modules/string-width/index.js',
        `
          "use strict";
          const stripAnsi = require("strip-ansi");
          module.exports = (value) => stripAnsi(value);
        `
      );

      vfs.mkdirSync('/node_modules/strip-ansi', { recursive: true });
      vfs.writeFileSync('/node_modules/strip-ansi/package.json', JSON.stringify({
        name: 'strip-ansi',
        type: 'module',
        exports: './index.js',
      }));
      vfs.writeFileSync(
        '/node_modules/strip-ansi/index.js',
        `
          "use strict";
          module.exports = (value) => String(value).replace(/\\u001B\\[[0-9;]*m/g, "");
        `
      );

      const { exports } = await runtime.execute(`
        const strip = require('string-width');
        module.exports = strip('\\u001B[31mred\\u001B[39m');
      `, '/project/index.js');

      expect(exports).toBe('red');
    });

    it('should expose a constructible global console.Console with bound methods', async () => {
      const { exports } = await runtime.execute(`
        const redirected = [];
        const patched = new console.Console({
          stdout: { write: (text) => redirected.push(['out', text]) },
          stderr: { write: (text) => redirected.push(['err', text]) },
        });

        console.log = patched.log;
        console.error = patched.error;
        console.log('hello');
        console.error('boom');

        module.exports = {
          hasCtor: typeof console.Console === 'function',
          redirected,
        };
      `);

      expect(exports).toEqual({
        hasCtor: true,
        redirected: [
          ['out', 'hello\n'],
          ['err', 'boom\n'],
        ],
      });
    });

    it('should provide CommonJS global process aliases without mutating host globals', async () => {
      const hostProcess = globalThis.process;

      try {
        const { exports } = await runtime.execute(`
          module.exports = {
            sameProcess: process === globalThis.process,
            sameGlobalProcess: process === global.process,
            cwd: globalThis.process.cwd(),
          };
        `, '/entry.js');

        expect(exports).toEqual({
          sameProcess: true,
          sameGlobalProcess: true,
          cwd: '/',
        });
        expect(globalThis.process).toBe(hostProcess);
      } finally {
        globalThis.process = hostProcess;
      }
    });

    it('should proxy cross-origin XMLHttpRequest URLs and ignore forbidden headers', async () => {
      class MockXHR {
        openArgs: unknown[] | null = null;
        headers: Array<[string, string]> = [];

        open(...args: unknown[]) {
          this.openArgs = args;
        }

        setRequestHeader(name: string, value: string) {
          this.headers.push([name, value]);
        }
      }

      vi.stubGlobal('location', { host: 'localhost:5173' } as any);
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => key === '__corsProxyUrl' ? 'https://proxy.example/?url=' : null,
      } as any);
      vi.stubGlobal('XMLHttpRequest', MockXHR as any);

      try {
        new Runtime(vfs);

        const xhr = new (globalThis as any).XMLHttpRequest() as MockXHR;
        xhr.open('GET', 'https://api.anthropic.com/api/hello');
        xhr.setRequestHeader('User-Agent', 'almostnode-test');
        xhr.setRequestHeader('X-Test', '1');

        expect(xhr.openArgs).toEqual([
          'GET',
          'https://proxy.example/?url=' + encodeURIComponent('https://api.anthropic.com/api/hello'),
          true,
          null,
          null,
        ]);
        expect(xhr.headers).toEqual([['X-Test', '1']]);
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('should route Claude XMLHttpRequest traffic through the shared network controller when tailscale is selected', async () => {
      class MockXHR {
        openArgs: unknown[] | null = null;
        headers: Array<[string, string]> = [];
        readyState = 0;
        responseType: XMLHttpRequestResponseType = '';
        response: unknown = null;
        responseText = '';
        responseURL = '';
        status = 0;
        statusText = '';
        withCredentials = false;
        onreadystatechange: ((event: Event) => void) | null = null;
        private listeners = new Map<string, Array<(event: Event) => void>>();

        open(...args: unknown[]) {
          this.openArgs = args;
          this.readyState = 1;
        }

        setRequestHeader(name: string, value: string) {
          this.headers.push([name, value]);
        }

        send(_body?: unknown) {}

        abort() {}

        getResponseHeader(_name: string): string | null {
          return null;
        }

        getAllResponseHeaders(): string {
          return '';
        }

        addEventListener(type: string, listener: (event: Event) => void) {
          const listeners = this.listeners.get(type) || [];
          listeners.push(listener);
          this.listeners.set(type, listeners);
        }

        dispatchEvent(event: Event): boolean {
          const listeners = this.listeners.get(event.type) || [];
          for (const listener of listeners) {
            listener(event);
          }
          return true;
        }
      }

      vi.stubGlobal('location', { origin: 'https://blamy.github.io' } as any);
      vi.stubGlobal('localStorage', {
        getItem: () => null,
      } as any);
      vi.stubGlobal('XMLHttpRequest', MockXHR as any);

      const controller = {
        getConfig: () => ({
          provider: 'tailscale' as const,
          authMode: 'interactive' as const,
          useExitNode: true,
          exitNodeId: 'node-sfo',
          corsProxy: null,
          tailscaleConnected: true,
        }),
        fetch: vi.fn(async (request: { url: string; method?: string; headers?: Record<string, string> }) => ({
          url: request.url,
          status: 200,
          statusText: 'OK',
          headers: {
            'content-type': 'application/json',
            'x-runtime-route': 'tailscale',
          },
          bodyBase64: Buffer.from(JSON.stringify({ ok: true })).toString('base64'),
        })),
        configure: vi.fn(),
        getStatus: vi.fn(),
        login: vi.fn(),
        logout: vi.fn(),
        lookup: vi.fn(),
        subscribe: vi.fn(() => () => {}),
      };

      try {
        new Runtime(vfs, { networkController: controller as any });

        const xhr = new (globalThis as any).XMLHttpRequest() as MockXHR;
        const loadend = vi.fn();
        xhr.addEventListener('loadend', loadend);
        xhr.responseType = 'json';
        xhr.open('POST', 'https://platform.claude.com/oauth/token');
        xhr.setRequestHeader('content-type', 'application/json');
        xhr.send(JSON.stringify({ code: 'abc123' }));

        await vi.waitFor(() => {
          expect(loadend).toHaveBeenCalledTimes(1);
        });

        expect(controller.fetch).toHaveBeenCalledTimes(1);
        expect(controller.fetch).toHaveBeenCalledWith(
          expect.objectContaining({
            url: 'https://platform.claude.com/oauth/token',
            method: 'POST',
            headers: expect.objectContaining({
              'content-type': 'application/json',
            }),
          }),
        );
        expect(xhr.openArgs).toEqual([
          'POST',
          'https://platform.claude.com/oauth/token',
          true,
          null,
          null,
        ]);
        expect(xhr.status).toBe(200);
        expect(xhr.statusText).toBe('OK');
        expect(xhr.responseURL).toBe('https://platform.claude.com/oauth/token');
        expect(xhr.response).toEqual({ ok: true });
        expect(xhr.getResponseHeader('content-type')).toBe('application/json');
        expect(xhr.getResponseHeader('x-runtime-route')).toBe('tailscale');
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });

  describe('fs shim', () => {
    it('should provide fs module', async () => {
      const { exports } = await runtime.execute(`
        const fs = require('fs');
        module.exports = typeof fs.readFileSync;
      `);
      expect(exports).toBe('function');
    });

    it('should read and write files', async () => {
      await runtime.execute(`
        const fs = require('fs');
        fs.writeFileSync('/output.txt', 'hello from script');
      `);

      expect(vfs.readFileSync('/output.txt', 'utf8')).toBe('hello from script');
    });

    it('should check file existence', async () => {
      vfs.writeFileSync('/exists.txt', 'content');

      const { exports } = await runtime.execute(`
        const fs = require('fs');
        module.exports = {
          exists: fs.existsSync('/exists.txt'),
          notExists: fs.existsSync('/nonexistent.txt'),
        };
      `);

      expect(exports).toEqual({ exists: true, notExists: false });
    });

    it('should create directories', async () => {
      await runtime.execute(`
        const fs = require('fs');
        fs.mkdirSync('/mydir');
        fs.mkdirSync('/deep/nested/dir', { recursive: true });
      `);

      expect(vfs.existsSync('/mydir')).toBe(true);
      expect(vfs.existsSync('/deep/nested/dir')).toBe(true);
    });

    it('should expose disposable fs.promises file handles for transpiled await using helpers', async () => {
      vfs.writeFileSync('/handle.txt', 'hello world');

      const { exports } = await runtime.execute(`
        const fs = require('fs');

        function addDisposableResource(env, value, async) {
          if (value == null) return value;
          const asyncDispose = value[Symbol.asyncDispose];
          const dispose = value[Symbol.dispose];
          const disposeFn = async && typeof asyncDispose === 'function'
            ? asyncDispose
            : (typeof dispose === 'function' ? dispose : null);
          if (typeof disposeFn !== 'function') {
            throw new TypeError('Object not disposable.');
          }
          env.push({ value, async, dispose: () => disposeFn.call(value) });
          return value;
        }

        async function disposeResources(env) {
          while (env.length) {
            const resource = env.pop();
            if (!resource) continue;
            const result = resource.dispose();
            if (resource.async) {
              await result;
            }
          }
        }

        module.exports = (async () => {
          const env = [];
          try {
            const handle = addDisposableResource(env, await fs.promises.open('/handle.txt', 'r'), true);
            const stats = await handle.stat();
            const buffer = new Uint8Array(5);
            const { bytesRead } = await handle.read(buffer, 0, 5, 0);
            return {
              size: stats.size,
              bytesRead,
              text: new TextDecoder().decode(buffer),
              asyncDispose: typeof handle[Symbol.asyncDispose],
              dispose: typeof handle[Symbol.dispose],
            };
          } finally {
            await disposeResources(env);
          }
        })();
      `, '/test-dispose.js');

      expect(await exports).toEqual({
        size: 11,
        bytesRead: 5,
        text: 'hello',
        asyncDispose: 'function',
        dispose: 'function',
      });
    });

    it('should list directory contents', async () => {
      vfs.writeFileSync('/dir/a.txt', '');
      vfs.writeFileSync('/dir/b.txt', '');

      const { exports } = await runtime.execute(`
        const fs = require('fs');
        module.exports = fs.readdirSync('/dir').sort();
      `);

      expect(exports).toEqual(['a.txt', 'b.txt']);
    });
  });

  describe('path shim', () => {
    it('should provide path module', async () => {
      const { exports } = await runtime.execute(`
        const path = require('path');
        module.exports = {
          join: path.join('/foo', 'bar', 'baz'),
          dirname: path.dirname('/foo/bar/file.js'),
          basename: path.basename('/foo/bar/file.js'),
          extname: path.extname('/foo/bar/file.js'),
        };
      `);

      expect(exports).toEqual({
        join: '/foo/bar/baz',
        dirname: '/foo/bar',
        basename: 'file.js',
        extname: '.js',
      });
    });

    it('should resolve paths', async () => {
      const { exports } = await runtime.execute(`
        const path = require('path');
        module.exports = path.resolve('/foo/bar', '../baz', 'file.js');
      `);

      expect(exports).toBe('/foo/baz/file.js');
    });
  });

  describe('process shim', () => {
    it('should provide process object', async () => {
      const { exports } = await runtime.execute(`
        module.exports = {
          cwd: process.cwd(),
          platform: process.platform,
          hasEnv: typeof process.env === 'object',
        };
      `);

      expect(exports).toEqual({
        cwd: '/',
        platform: 'linux', // Pretend to be linux for Node.js compatibility
        hasEnv: true,
      });
    });

    it('should provide process via require', async () => {
      const { exports } = await runtime.execute(`
        const proc = require('process');
        module.exports = proc.cwd();
      `);

      expect(exports).toBe('/');
    });

    it('should have EventEmitter methods on process', async () => {
      const { exports } = await runtime.execute(`
        let called = false;
        process.once('test-event', (arg) => {
          called = arg;
        });
        process.emit('test-event', 'hello');
        module.exports = {
          called,
          hasOn: typeof process.on === 'function',
          hasOnce: typeof process.once === 'function',
          hasEmit: typeof process.emit === 'function',
          hasOff: typeof process.off === 'function',
        };
      `);

      expect(exports).toEqual({
        called: 'hello',
        hasOn: true,
        hasOnce: true,
        hasEmit: true,
        hasOff: true,
      });
    });

    it('should allow custom environment variables', async () => {
      const customRuntime = new Runtime(vfs, {
        env: { MY_VAR: 'my_value', NODE_ENV: 'test' },
      });

      const { exports } = await customRuntime.execute(`
        module.exports = {
          myVar: process.env.MY_VAR,
          nodeEnv: process.env.NODE_ENV,
        };
      `);

      expect(exports).toEqual({
        myVar: 'my_value',
        nodeEnv: 'test',
      });
    });
  });

  describe('module resolution', () => {
    it('should resolve stream/promises builtin module', async () => {
      const { exports } = await runtime.execute(`
        const streamPromises = require('stream/promises');
        const nodeStreamPromises = require('node:stream/promises');
        module.exports = {
          hasFinished: typeof streamPromises.finished,
          hasPipeline: typeof streamPromises.pipeline,
          nodeHasFinished: typeof nodeStreamPromises.finished,
        };
      `);

      expect(exports).toEqual({
        hasFinished: 'function',
        hasPipeline: 'function',
        nodeHasFinished: 'function',
      });
    });

    it('should resolve stream/consumers builtin module', async () => {
      const { exports } = await runtime.execute(`
        const { Readable } = require('stream');
        const consumers = require('stream/consumers');
        const nodeConsumers = require('node:stream/consumers');

        module.exports = (async () => {
          const textStream = new Readable();
          textStream.push('hello ');
          textStream.push(Buffer.from('world'));
          textStream.push(null);

          const binaryStream = new Readable();
          binaryStream.push(Buffer.from([0xde, 0xad, 0xbe, 0xef]));
          binaryStream.push(null);

          const arrayBufferStream = new Readable();
          arrayBufferStream.push(Buffer.from([1, 2, 3]));
          arrayBufferStream.push(null);

          const textValue = await consumers.text(textStream);
          const binaryValue = await nodeConsumers.buffer(binaryStream);
          const arrayBufferValue = await consumers.arrayBuffer(arrayBufferStream);

          return {
            textValue,
            binaryHex: binaryValue.toString('hex'),
            arrayBufferLength: arrayBufferValue.byteLength,
            hasJson: typeof consumers.json,
            hasBlob: typeof nodeConsumers.blob,
          };
        })();
      `);

      await expect(exports).resolves.toEqual({
        textValue: 'hello world',
        binaryHex: 'deadbeef',
        arrayBufferLength: 3,
        hasJson: 'function',
        hasBlob: 'function',
      });
    });

    it('should expose fs named exports to native ESM imports', async () => {
      vfs.writeFileSync('/existing.txt', 'hello');

      const { exports } = await runtime.execute(`
        import { appendFileSync, chmodSync, chownSync, existsSync, readFileSync } from 'node:fs';

        appendFileSync('/existing.txt', ' world');
        chmodSync('/existing.txt', 0o644);
        chownSync('/existing.txt', 1000, 1000);

        export default {
          exists: existsSync('/existing.txt'),
          content: readFileSync('/existing.txt', 'utf8'),
          appendFileSyncType: typeof appendFileSync,
          chmodSyncType: typeof chmodSync,
          chownSyncType: typeof chownSync,
        };
      `, '/entry.mjs');

      expect(exports).toEqual({
        exists: true,
        content: 'hello world',
        appendFileSyncType: 'function',
        chmodSyncType: 'function',
        chownSyncType: 'function',
      });
    });

    it('should expose fs/promises and fs watcher exports to native ESM imports', async () => {
      const { exports } = await runtime.execute(`
        import {
          constants,
          closeSync,
          fstat,
          openSync,
          readFileSync,
          watchFile,
          unwatchFile,
          writeFileSync,
        } from 'node:fs';
        import { link, readlink, symlink, truncate } from 'node:fs/promises';

        writeFileSync('/source.txt', 'hello world');
        await link('/source.txt', '/linked.txt');
        await symlink('/source.txt', '/alias.txt');
        await truncate('/linked.txt', 5);

        const fd = openSync('/linked.txt', 'r');
        const stats = await new Promise((resolve, reject) => {
          fstat(fd, (err, value) => {
            if (err) reject(err);
            else resolve(value);
          });
        });
        closeSync(fd);

        export default {
          linkedContent: readFileSync('/linked.txt', 'utf8'),
          aliasContent: readFileSync('/alias.txt', 'utf8'),
          aliasTarget: await readlink('/alias.txt'),
          constantsType: typeof constants,
          appendFlag: constants.O_APPEND,
          statsIsFile: stats.isFile(),
          watchFileType: typeof watchFile,
          unwatchFileType: typeof unwatchFile,
          truncateType: typeof truncate,
        };
      `, '/entry-fs-promises.mjs');

      expect(exports).toEqual({
        linkedContent: 'hello',
        aliasContent: 'hello world',
        aliasTarget: '/source.txt',
        constantsType: 'object',
        appendFlag: 1024,
        statsIsFile: true,
        watchFileType: 'function',
        unwatchFileType: 'function',
        truncateType: 'function',
      });
    });

    it('should expose util named exports to native ESM imports', async () => {
      const { exports } = await runtime.execute(`
        import { inspect, isDeepStrictEqual } from 'node:util';

        export default {
          inspectType: typeof inspect,
          equalObjects: isDeepStrictEqual({ a: 1, nested: [1, 2] }, { a: 1, nested: [1, 2] }),
          unequalObjects: isDeepStrictEqual({ a: 1 }, { a: 2 }),
        };
      `, '/entry-util.mjs');

      expect(exports).toEqual({
        inspectType: 'function',
        equalObjects: true,
        unequalObjects: false,
      });
    });

    it('should expose stream named exports to native ESM imports', async () => {
      const { exports } = await runtime.execute(`
        import Stream, { PassThrough, Readable } from 'node:stream';

        export default {
          defaultType: typeof Stream,
          passThroughType: typeof PassThrough,
          readableType: typeof Readable,
          streamHasPassThrough: Stream.PassThrough === PassThrough,
        };
      `, '/entry.mjs');

      expect(exports).toEqual({
        defaultType: 'function',
        passThroughType: 'function',
        readableType: 'function',
        streamHasPassThrough: true,
      });
    });

    it('should normalize signal-exit object exports to callable function', async () => {
      vfs.writeFileSync(
        '/node_modules/signal-exit/package.json',
        JSON.stringify({
          name: 'signal-exit',
          main: './index.js',
        })
      );
      vfs.writeFileSync(
        '/node_modules/signal-exit/index.js',
        `
module.exports = {
  onExit: () => () => {},
  load: () => {},
  unload: () => {},
};
`
      );

      const { exports } = await runtime.execute(`
        const onExit = require('signal-exit');
        const cleanup = onExit(() => {});
        module.exports = {
          type: typeof onExit,
          hasLoad: typeof onExit.load,
          hasUnload: typeof onExit.unload,
          cleanupType: typeof cleanup,
        };
      `);

      expect(exports).toEqual({
        type: 'function',
        hasLoad: 'function',
        hasUnload: 'function',
        cleanupType: 'function',
      });
    });

    it('should provide a default export for __esModule CJS packages missing default', async () => {
      vfs.writeFileSync(
        '/node_modules/@xterm/headless/package.json',
        JSON.stringify({
          name: '@xterm/headless',
          main: 'index.js',
        })
      );
      vfs.writeFileSync(
        '/node_modules/@xterm/headless/index.js',
        `
Object.defineProperty(exports, "__esModule", { value: true });
exports.Terminal = class Terminal {};
`
      );

      const { exports } = await runtime.execute(`
        var __create = Object.create;
        var __defProp = Object.defineProperty;
        var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
        var __getOwnPropNames = Object.getOwnPropertyNames;
        var __getProtoOf = Object.getPrototypeOf;
        var __hasOwnProp = Object.prototype.hasOwnProperty;
        var __copyProps = (to, from, except, desc) => {
          if (from && typeof from === "object" || typeof from === "function") {
            for (let key of __getOwnPropNames(from))
              if (!__hasOwnProp.call(to, key) && key !== except)
                __defProp(to, key, {
                  get: () => from[key],
                  enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
                });
          }
          return to;
        };
        var __toESM = (mod, isNodeMode, target) => (
          target = mod != null ? __create(__getProtoOf(mod)) : {},
          __copyProps(isNodeMode || !mod || !mod.__esModule
            ? __defProp(target, "default", { value: mod, enumerable: true })
            : target, mod)
        );

        var import_headless = __toESM(require('@xterm/headless'));
        const { Terminal } = import_headless.default;
        module.exports = typeof Terminal;
      `);

      expect(exports).toBe('function');
    });

    it('should resolve relative modules', async () => {
      vfs.writeFileSync('/lib/helper.js', 'module.exports = { value: 42 };');

      const { exports } = await runtime.execute(`
        const helper = require('./lib/helper');
        module.exports = helper.value;
      `);

      expect(exports).toBe(42);
    });

    it('should resolve legacy build/src deep imports to build/cjs/src fallback', async () => {
      vfs.writeFileSync(
        '/node_modules/gaxios/package.json',
        JSON.stringify({
          name: 'gaxios',
          version: '7.1.3',
          main: 'build/cjs/src/index.js',
          exports: {
            '.': {
              require: './build/cjs/src/index.js',
            },
          },
        })
      );
      vfs.writeFileSync('/node_modules/gaxios/build/cjs/src/common.js', 'module.exports = { ok: true };');
      vfs.writeFileSync('/node_modules/gaxios/build/cjs/src/index.js', 'module.exports = { index: true };');
      vfs.writeFileSync(
        '/node_modules/googleapis-common/build/src/http2.js',
        'module.exports = require("gaxios/build/src/common");'
      );

      const { exports } = await runtime.execute(`
        module.exports = require('googleapis-common/build/src/http2');
      `);

      expect(exports).toEqual({ ok: true });
    });

    it('should resolve package directories with index.json when main is absent', async () => {
      vfs.writeFileSync(
        '/node_modules/spdx-license-ids/package.json',
        JSON.stringify({
          name: 'spdx-license-ids',
          version: '3.0.22',
        })
      );
      vfs.writeFileSync(
        '/node_modules/spdx-license-ids/index.json',
        JSON.stringify(['MIT', 'Apache-2.0'])
      );

      const { exports } = await runtime.execute(`
        module.exports = require('spdx-license-ids');
      `);

      expect(exports).toEqual(['MIT', 'Apache-2.0']);
    });

    it('should resolve modules with .js extension', async () => {
      vfs.writeFileSync('/lib/mod.js', 'module.exports = "found";');

      const { exports } = await runtime.execute(`
        module.exports = require('./lib/mod.js');
      `);

      expect(exports).toBe('found');
    });

    it('should resolve modules without extension', async () => {
      vfs.writeFileSync('/lib/noext.js', 'module.exports = "no ext";');

      const { exports } = await runtime.execute(`
        module.exports = require('./lib/noext');
      `);

      expect(exports).toBe('no ext');
    });

    it('should resolve JSON modules', async () => {
      vfs.writeFileSync('/data.json', '{"key": "value", "num": 123}');

      const { exports } = await runtime.execute(`
        const data = require('./data.json');
        module.exports = data;
      `);

      expect(exports).toEqual({ key: 'value', num: 123 });
    });

    it('should resolve directory with index.js', async () => {
      vfs.writeFileSync('/lib/index.js', 'module.exports = "from index";');

      const { exports } = await runtime.execute(`
        module.exports = require('./lib');
      `);

      expect(exports).toBe('from index');
    });

    it('should resolve node_modules packages', async () => {
      vfs.writeFileSync(
        '/node_modules/my-pkg/package.json',
        '{"name": "my-pkg", "main": "main.js"}'
      );
      vfs.writeFileSync(
        '/node_modules/my-pkg/main.js',
        'module.exports = "from package";'
      );

      const { exports } = await runtime.execute(`
        module.exports = require('my-pkg');
      `);

      expect(exports).toBe('from package');
    });

    it('should resolve node_modules with index.js fallback', async () => {
      vfs.writeFileSync(
        '/node_modules/simple-pkg/index.js',
        'module.exports = "simple";'
      );

      const { exports } = await runtime.execute(`
        module.exports = require('simple-pkg');
      `);

      expect(exports).toBe('simple');
    });

    it('should load http2-wrapper js-stream-socket probe without crashing', async () => {
      vfs.writeFileSync(
        '/node_modules/http2-wrapper/package.json',
        JSON.stringify({
          name: 'http2-wrapper',
          main: 'source/utils/js-stream-socket.js',
        })
      );
      vfs.writeFileSync(
        '/node_modules/http2-wrapper/source/utils/js-stream-socket.js',
        `
const stream = require('stream');
const tls = require('tls');
const JSStreamSocket = (new tls.TLSSocket(new stream.PassThrough()))._handle._parentWrap.constructor;
module.exports = JSStreamSocket;
`
      );

      const { exports } = await runtime.execute(`
        const JSStreamSocket = require('http2-wrapper');
        const stream = require('stream');
        const socket = new JSStreamSocket(new stream.PassThrough());
        module.exports = {
          ctorType: typeof JSStreamSocket,
          hasHandle: typeof socket._handle,
        };
      `);

      expect(exports).toEqual({
        ctorType: 'function',
        hasHandle: 'object',
      });
    });

    it('should handle top-level await import syntax in transformed modules', async () => {
      vfs.writeFileSync(
        '/node_modules/tla-pkg/index.js',
        `
if (process.env['DEV'] === 'true') {
  await import('./devtools.js');
}
module.exports = 'ok';
`
      );
      vfs.writeFileSync(
        '/node_modules/tla-pkg/devtools.js',
        'module.exports = { enabled: true };'
      );

      const { exports } = await runtime.execute(`
        module.exports = require('tla-pkg');
      `);

      expect(exports).toBe('ok');
    });

    it('should handle awaited __dynamicImport syntax from partially transformed modules', async () => {
      vfs.writeFileSync(
        '/node_modules/tla-dyn/index.js',
        `
if (process.env['DEV'] === 'true') {
  await __dynamicImport('./devtools.js');
}
module.exports = 'ok';
`
      );
      vfs.writeFileSync(
        '/node_modules/tla-dyn/devtools.js',
        'module.exports = { enabled: true };'
      );

      const { exports } = await runtime.execute(`
        module.exports = require('tla-dyn');
      `);

      expect(exports).toBe('ok');
    });

    it('should execute direct entry files with arbitrary top-level await via an async wrapper', async () => {
      const stdout: string[] = [];
      runtime = new Runtime(vfs, {
        onStdout: (data) => {
          stdout.push(data);
        },
      });

      const result = await runtime.execute(`
import process from 'node:process';

const value = await Promise.resolve('codex-ok');
process.stdout.write(value);
export default value;
`, '/entry.js');

      await result.module.executionPromise;

      expect(result.exports).toBe('codex-ok');
      expect(stdout.join('')).toBe('codex-ok');
    });

    it('should resolve aliased package directories with exports field', async () => {
      vfs.writeFileSync(
        '/node_modules/ink/package.json',
        JSON.stringify({
          name: '@jrichman/ink',
          exports: {
            default: './build/index.js',
          },
        })
      );
      vfs.writeFileSync(
        '/node_modules/ink/build/index.js',
        'module.exports = "ink via alias";'
      );

      const { exports } = await runtime.execute(`
        module.exports = require('ink');
      `);

      expect(exports).toBe('ink via alias');
    });

    it('should use preloaded yoga-layout shim when available', async () => {
      const g = globalThis as any;
      const prevYoga = g.__almostnodeYogaLayout;
      const prevYogaError = g.__almostnodeYogaLayoutError;
      g.__almostnodeYogaLayout = {
        EDGE_LEFT: 0,
        Node: {
          create: () => 'ok',
        },
      };
      g.__almostnodeYogaLayoutError = undefined;

      try {
        const { exports } = await runtime.execute(`
          const yoga = require('yoga-layout');
          module.exports = {
            edge: yoga.EDGE_LEFT,
            created: yoga.Node.create(),
          };
        `);

        expect(exports).toEqual({ edge: 0, created: 'ok' });
      } finally {
        g.__almostnodeYogaLayout = prevYoga;
        g.__almostnodeYogaLayoutError = prevYogaError;
      }
    });

    it('should cache modules', async () => {
      vfs.writeFileSync('/counter.js', `
        let count = 0;
        module.exports = { increment: () => ++count, getCount: () => count };
      `);

      const { exports } = await runtime.execute(`
        const counter1 = require('./counter');
        const counter2 = require('./counter');
        counter1.increment();
        counter1.increment();
        module.exports = {
          sameInstance: counter1 === counter2,
          count: counter2.getCount(),
        };
      `);

      expect(exports).toEqual({ sameInstance: true, count: 2 });
    });

    it('should throw on missing module', async () => {
      await expect(runtime.execute('require("nonexistent-module");')).rejects.toThrow(/Cannot find module/);
    });
  });

  describe('console capture', () => {
    it('should capture console output', async () => {
      const logs: Array<{ method: string; args: unknown[] }> = [];

      const captureRuntime = new Runtime(vfs, {
        onConsole: (method, args) => logs.push({ method, args }),
      });

      await captureRuntime.execute(`
        console.log('hello', 'world');
        console.error('error message');
        console.warn('warning');
      `);

      expect(logs).toContainEqual({ method: 'log', args: ['hello', 'world'] });
      expect(logs).toContainEqual({ method: 'error', args: ['error message'] });
      expect(logs).toContainEqual({ method: 'warn', args: ['warning'] });
    });
  });

  describe('runFile', () => {
    it('should run a file from the virtual file system', async () => {
      vfs.writeFileSync('/app.js', 'module.exports = "app output";');

      const { exports } = await runtime.runFile('/app.js');

      expect(exports).toBe('app output');
    });
  });

  describe('execute helper function', () => {
    it('should execute code with a new runtime', async () => {
      const testVfs = new VirtualFS();
      const { exports } = await execute('module.exports = "executed";', testVfs);
      expect(exports).toBe('executed');
    });
  });

  describe('clearCache', () => {
    it('should allow reloading modules after cache clear', async () => {
      vfs.writeFileSync('/module.js', 'module.exports = 1;');

      const result1 = await runtime.execute('module.exports = require("./module");');
      expect(result1.exports).toBe(1);

      // Modify the file
      vfs.writeFileSync('/module.js', 'module.exports = 2;');

      // Without clearing cache, still returns old value
      const result2 = await runtime.execute('module.exports = require("./module");');
      expect(result2.exports).toBe(1);

      // After clearing cache, returns new value
      runtime.clearCache();
      const result3 = await runtime.execute('module.exports = require("./module");');
      expect(result3.exports).toBe(2);
    });
  });

  describe('module resolution caching', () => {
    it('should resolve the same module path consistently', async () => {
      vfs.writeFileSync('/lib/util.js', 'module.exports = { name: "util" };');

      // First require should resolve and cache the path
      const result1 = await runtime.execute(`
        const util1 = require('./lib/util');
        const util2 = require('./lib/util');
        module.exports = util1 === util2;
      `);

      // Both requires should return the same cached module
      expect(result1.exports).toBe(true);
    });

    it('should cache module resolution across multiple files', async () => {
      vfs.writeFileSync('/shared.js', 'module.exports = { count: 0 };');
      vfs.writeFileSync('/a.js', `
        const shared = require('./shared');
        shared.count++;
        module.exports = shared;
      `);
      vfs.writeFileSync('/b.js', `
        const shared = require('./shared');
        shared.count++;
        module.exports = shared;
      `);

      const result = await runtime.execute(`
        const a = require('./a');
        const b = require('./b');
        module.exports = { aCount: a.count, bCount: b.count, same: a === b };
      `);

      // Both should reference the same cached module
      expect((result.exports as any).same).toBe(true);
      expect((result.exports as any).bCount).toBe(2); // Incremented twice
    });

    it('should handle resolution cache for non-existent modules', async () => {
      // First attempt should fail
      await expect(runtime.execute('require("./nonexistent")')).rejects.toThrow(/Cannot find module/);

      // Second attempt should also fail (cached negative result)
      await expect(runtime.execute('require("./nonexistent")')).rejects.toThrow(/Cannot find module/);

      // Now create the module
      vfs.writeFileSync('/nonexistent.js', 'module.exports = "found";');

      // After cache clear, should find the module
      runtime.clearCache();
      const result = await runtime.execute('module.exports = require("./nonexistent");');
      expect(result.exports).toBe('found');
    });
  });

  describe('processed code caching', () => {
    it('should reuse processed code when module cache is cleared but content unchanged', async () => {
      // Create a simple CJS module
      vfs.writeFileSync('/cached-module.js', 'module.exports = { value: 42 };');

      // First execution
      const result1 = await runtime.execute(`
        const mod = require('./cached-module.js');
        module.exports = mod.value;
      `);
      expect(result1.exports).toBe(42);

      // Clear module cache
      runtime.clearCache();

      // Second execution - module needs to be re-required but code processing is cached
      const result2 = await runtime.execute(`
        const mod = require('./cached-module.js');
        module.exports = mod.value;
      `);
      expect(result2.exports).toBe(42);
    });

    it('should reprocess code when content changes', async () => {
      vfs.writeFileSync('/changeable.js', 'module.exports = { num: 1 };');

      const result1 = await runtime.execute(`
        const mod = require('./changeable.js');
        module.exports = mod.num;
      `);
      expect(result1.exports).toBe(1);

      // Modify the file
      vfs.writeFileSync('/changeable.js', 'module.exports = { num: 2 };');

      // Clear module cache to force re-require
      runtime.clearCache();

      // Should get new value (code was reprocessed due to content change)
      const result2 = await runtime.execute(`
        const mod = require('./changeable.js');
        module.exports = mod.num;
      `);
      expect(result2.exports).toBe(2);
    });

    it('should invalidate native ESM module URLs after cache clear', async () => {
      vfs.mkdirSync('/esm', { recursive: true });
      vfs.writeFileSync('/esm/helper.js', `
        export const multiply = (a, b) => a * b;
        export const add = (a, b) => a + b;
      `);

      const result1 = await runtime.execute(`
        import { multiply } from './esm/helper.js';
        export default multiply(3, 4);
      `, '/entry.mjs');
      expect(result1.exports).toBe(12);

      runtime.clearCache();

      const result2 = await runtime.execute(`
        import { add } from './esm/helper.js';
        export default add(10, 5);
      `, '/entry.mjs');
      expect(result2.exports).toBe(15);
    });
  });

  describe('createREPL', () => {
    it('should return expression values', async () => {
      const repl = runtime.createREPL();
      expect(await repl.eval('1 + 2')).toBe(3);
      expect(await repl.eval('"hello".toUpperCase()')).toBe('HELLO');
    });

    it('should persist variables across calls', async () => {
      const repl = runtime.createREPL();
      await repl.eval('var x = 42');
      expect(await repl.eval('x')).toBe(42);
    });

    it('should persist const/let as var', async () => {
      const repl = runtime.createREPL();
      await repl.eval('const a = 1');
      expect(await repl.eval('a')).toBe(1);
      await repl.eval('let b = 2');
      expect(await repl.eval('b')).toBe(2);
    });

    it('should have access to require', async () => {
      const repl = runtime.createREPL();
      expect(await repl.eval("require('path').join('/foo', 'bar')")).toBe('/foo/bar');
    });

    it('should have access to Buffer', async () => {
      const repl = runtime.createREPL();
      const result = await repl.eval("Buffer.from('hello').toString('base64')");
      expect(result).toBe('aGVsbG8=');
    });

    it('should have access to process', async () => {
      const repl = runtime.createREPL();
      expect(await repl.eval('typeof process')).toBe('object');
      expect(await repl.eval('typeof process.env')).toBe('object');
    });

    it('should handle require("fs") read/write', async () => {
      vfs.mkdirSync('/repl-test', { recursive: true });
      const repl = runtime.createREPL();
      await repl.eval("var fs = require('fs')");
      await repl.eval("fs.writeFileSync('/repl-test/hello.txt', 'Hello REPL!')");
      expect(await repl.eval("fs.readFileSync('/repl-test/hello.txt', 'utf8')")).toBe('Hello REPL!');
    });

    it('should throw on invalid code', async () => {
      const repl = runtime.createREPL();
      await expect(repl.eval('undefined_var')).rejects.toThrow();
    });

    it('should handle multi-statement code', async () => {
      const repl = runtime.createREPL();
      const result = await repl.eval("var a = 1; var b = 2; a + b");
      expect(result).toBe(3);
    });

    it('should capture console.log via onConsole', async () => {
      const logs: string[][] = [];
      const rt = new Runtime(vfs, {
        onConsole: (method, args) => { logs.push(args.map(String)); },
      });
      const repl = rt.createREPL();
      await repl.eval("console.log('hello from repl')");
      expect(logs).toHaveLength(1);
      expect(logs[0]).toContain('hello from repl');
    });

    it('should isolate separate REPL instances', async () => {
      const repl1 = runtime.createREPL();
      const repl2 = runtime.createREPL();
      await repl1.eval('var x = 100');
      expect(await repl1.eval('x')).toBe(100);
      await expect(repl2.eval('x')).rejects.toThrow();
    });
  });

  describe('browser field in package.json', () => {
    it('should prefer browser field (string) over main for package entry', async () => {
      // Simulate depd's package.json: "browser": "lib/browser/index.js"
      vfs.writeFileSync('/node_modules/testpkg/package.json', JSON.stringify({
        name: 'testpkg',
        browser: 'lib/browser/index.js',
        main: 'index.js',
      }));
      vfs.writeFileSync('/node_modules/testpkg/index.js', 'module.exports = "node";');
      vfs.writeFileSync('/node_modules/testpkg/lib/browser/index.js', 'module.exports = "browser";');

      const { exports } = await runtime.execute('module.exports = require("testpkg");');
      expect(exports).toBe('browser');
    });

    it('should fall back to main when browser field is not set', async () => {
      vfs.writeFileSync('/node_modules/nopkg/package.json', JSON.stringify({
        name: 'nopkg',
        main: 'lib/main.js',
      }));
      vfs.writeFileSync('/node_modules/nopkg/lib/main.js', 'module.exports = "main";');

      const { exports } = await runtime.execute('module.exports = require("nopkg");');
      expect(exports).toBe('main');
    });

    it('should fall back to index.js when neither browser nor main is set', async () => {
      vfs.writeFileSync('/node_modules/defpkg/package.json', JSON.stringify({
        name: 'defpkg',
      }));
      vfs.writeFileSync('/node_modules/defpkg/index.js', 'module.exports = "default";');

      const { exports } = await runtime.execute('module.exports = require("defpkg");');
      expect(exports).toBe('default');
    });
  });

  describe('Error.captureStackTrace polyfill', () => {
    it('should provide CallSite objects when prepareStackTrace is set', async () => {
      // Save and remove native captureStackTrace to test polyfill
      const origCapture = (Error as any).captureStackTrace;
      const origPrepare = (Error as any).prepareStackTrace;
      delete (Error as any).captureStackTrace;
      delete (Error as any).prepareStackTrace;

      try {
        // Create a fresh runtime which will install the polyfill
        const testVfs = new VirtualFS();
        new Runtime(testVfs);

        // Verify polyfill was installed
        expect(typeof (Error as any).captureStackTrace).toBe('function');

        // Test the depd pattern: set prepareStackTrace, call captureStackTrace, read .stack
        const obj: any = {};
        (Error as any).prepareStackTrace = (_err: any, stack: any[]) => stack;
        (Error as any).captureStackTrace(obj);

        // obj.stack should be an array of CallSite-like objects
        expect(Array.isArray(obj.stack)).toBe(true);
        if (obj.stack.length > 0) {
          const callSite = obj.stack[0];
          expect(typeof callSite.getFileName).toBe('function');
          expect(typeof callSite.getLineNumber).toBe('function');
          expect(typeof callSite.getColumnNumber).toBe('function');
          expect(typeof callSite.getFunctionName).toBe('function');
          expect(typeof callSite.isNative).toBe('function');
          expect(typeof callSite.isEval).toBe('function');
          expect(typeof callSite.toString).toBe('function');
        }
      } finally {
        // Restore native captureStackTrace
        (Error as any).captureStackTrace = origCapture;
        (Error as any).prepareStackTrace = origPrepare;
      }
    });

    it('should set stackTraceLimit when polyfilling', async () => {
      const origCapture = (Error as any).captureStackTrace;
      const origLimit = (Error as any).stackTraceLimit;
      delete (Error as any).captureStackTrace;
      delete (Error as any).stackTraceLimit;

      try {
        const testVfs = new VirtualFS();
        new Runtime(testVfs);
        expect((Error as any).stackTraceLimit).toBe(10);
      } finally {
        (Error as any).captureStackTrace = origCapture;
        (Error as any).stackTraceLimit = origLimit;
      }
    });
  });
});
