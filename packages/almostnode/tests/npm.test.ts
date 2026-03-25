import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { VirtualFS } from '../src/virtual-fs';
import { createContainer } from '../src';
import {
  parseVersion,
  compareVersions,
  satisfies,
  findBestVersion,
} from '../src/npm/resolver';
import { extractTarball, decompress } from '../src/npm/tarball';
import { parsePackageSpec, PackageManager } from '../src/npm';
import { executeInstallRequest, serializeInstallResult } from '../src/npm/core';
import { applyVfsPatch, diffVfsSnapshots } from '../src/npm/vfs-patch';
import type { InstallWorkerPayload, PackageManagerWorkerClient } from '../src/npm/types';
import pako from 'pako';

describe('npm', () => {
  describe('semver', () => {
    describe('parseVersion', () => {
      it('should parse standard versions', () => {
        expect(parseVersion('1.2.3')).toEqual({
          major: 1,
          minor: 2,
          patch: 3,
          prerelease: undefined,
        });
      });

      it('should parse prerelease versions', () => {
        expect(parseVersion('1.0.0-alpha.1')).toEqual({
          major: 1,
          minor: 0,
          patch: 0,
          prerelease: 'alpha.1',
        });
      });

      it('should return null for invalid versions', () => {
        expect(parseVersion('invalid')).toBeNull();
        expect(parseVersion('1.2')).toBeNull();
        expect(parseVersion('v1.2.3')).toBeNull();
      });
    });

    describe('compareVersions', () => {
      it('should compare major versions', () => {
        expect(compareVersions('2.0.0', '1.0.0')).toBeGreaterThan(0);
        expect(compareVersions('1.0.0', '2.0.0')).toBeLessThan(0);
      });

      it('should compare minor versions', () => {
        expect(compareVersions('1.2.0', '1.1.0')).toBeGreaterThan(0);
        expect(compareVersions('1.1.0', '1.2.0')).toBeLessThan(0);
      });

      it('should compare patch versions', () => {
        expect(compareVersions('1.0.2', '1.0.1')).toBeGreaterThan(0);
        expect(compareVersions('1.0.1', '1.0.2')).toBeLessThan(0);
      });

      it('should return 0 for equal versions', () => {
        expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
      });

      it('should rank prerelease lower than release', () => {
        expect(compareVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
        expect(compareVersions('1.0.0', '1.0.0-alpha')).toBeGreaterThan(0);
      });
    });

    describe('satisfies', () => {
      it('should match exact versions', () => {
        expect(satisfies('1.2.3', '1.2.3')).toBe(true);
        expect(satisfies('1.2.3', '1.2.4')).toBe(false);
      });

      it('should match caret ranges', () => {
        expect(satisfies('1.2.3', '^1.0.0')).toBe(true);
        expect(satisfies('1.9.9', '^1.0.0')).toBe(true);
        expect(satisfies('2.0.0', '^1.0.0')).toBe(false);
        expect(satisfies('0.9.0', '^1.0.0')).toBe(false);
      });

      it('should match tilde ranges', () => {
        expect(satisfies('1.2.3', '~1.2.0')).toBe(true);
        expect(satisfies('1.2.9', '~1.2.0')).toBe(true);
        expect(satisfies('1.3.0', '~1.2.0')).toBe(false);
      });

      it('should match >= ranges', () => {
        expect(satisfies('1.2.3', '>=1.0.0')).toBe(true);
        expect(satisfies('1.0.0', '>=1.0.0')).toBe(true);
        expect(satisfies('0.9.9', '>=1.0.0')).toBe(false);
      });

      it('should match > ranges', () => {
        expect(satisfies('1.0.1', '>1.0.0')).toBe(true);
        expect(satisfies('1.0.0', '>1.0.0')).toBe(false);
      });

      it('should match <= ranges', () => {
        expect(satisfies('1.0.0', '<=1.0.0')).toBe(true);
        expect(satisfies('0.9.9', '<=1.0.0')).toBe(true);
        expect(satisfies('1.0.1', '<=1.0.0')).toBe(false);
      });

      it('should match < ranges', () => {
        expect(satisfies('0.9.9', '<1.0.0')).toBe(true);
        expect(satisfies('1.0.0', '<1.0.0')).toBe(false);
      });

      it('should match * and latest', () => {
        expect(satisfies('1.0.0', '*')).toBe(true);
        expect(satisfies('999.0.0', '*')).toBe(true);
        expect(satisfies('1.0.0', 'latest')).toBe(true);
      });

      it('should match || ranges', () => {
        expect(satisfies('1.0.0', '1.0.0 || 2.0.0')).toBe(true);
        expect(satisfies('2.0.0', '1.0.0 || 2.0.0')).toBe(true);
        expect(satisfies('3.0.0', '1.0.0 || 2.0.0')).toBe(false);
      });

      it('should handle incomplete version ranges (2-part)', () => {
        // ^3.25 should match 3.25.0, 3.26.0, etc. but not 4.0.0
        expect(satisfies('3.25.0', '^3.25')).toBe(true);
        expect(satisfies('3.26.0', '^3.25')).toBe(true);
        expect(satisfies('3.24.9', '^3.25')).toBe(false);
        expect(satisfies('4.0.0', '^3.25')).toBe(false);
        // ^4.0 should match 4.0.0, 4.1.0, etc. but not 5.0.0
        expect(satisfies('4.0.0', '^4.0')).toBe(true);
        expect(satisfies('4.3.6', '^4.0')).toBe(true);
        expect(satisfies('5.0.0', '^4.0')).toBe(false);
        // || with incomplete versions (shadcn's zod dep)
        expect(satisfies('3.25.0', '^3.25 || ^4.0')).toBe(true);
        expect(satisfies('4.3.6', '^3.25 || ^4.0')).toBe(true);
        expect(satisfies('3.24.0', '^3.25 || ^4.0')).toBe(false);
        // ~2.1 should match 2.1.x
        expect(satisfies('2.1.5', '~2.1')).toBe(true);
        expect(satisfies('2.2.0', '~2.1')).toBe(false);
        // >=3.25 with 2 parts
        expect(satisfies('3.25.0', '>=3.25')).toBe(true);
        expect(satisfies('3.24.9', '>=3.25')).toBe(false);
      });

      it('should match hyphen ranges', () => {
        expect(satisfies('1.5.0', '1.0.0 - 2.0.0')).toBe(true);
        expect(satisfies('1.0.0', '1.0.0 - 2.0.0')).toBe(true);
        expect(satisfies('2.0.0', '1.0.0 - 2.0.0')).toBe(true);
        expect(satisfies('2.0.1', '1.0.0 - 2.0.0')).toBe(false);
      });

      it('should skip prerelease versions by default', () => {
        expect(satisfies('1.0.0-alpha', '^1.0.0')).toBe(false);
      });
    });

    describe('findBestVersion', () => {
      const versions = ['1.0.0', '1.1.0', '1.2.0', '2.0.0', '2.1.0'];

      it('should find highest matching version for caret', () => {
        expect(findBestVersion(versions, '^1.0.0')).toBe('1.2.0');
      });

      it('should find highest matching version for tilde', () => {
        expect(findBestVersion(versions, '~1.0.0')).toBe('1.0.0');
        expect(findBestVersion(versions, '~1.1.0')).toBe('1.1.0');
      });

      it('should return null if no match', () => {
        expect(findBestVersion(versions, '^3.0.0')).toBeNull();
      });

      it('should prefer leftmost sub-range for || ranges', () => {
        // Simulates zod scenario: "^3.25 || ^4.0" should prefer v3 over v4
        const zodVersions = ['3.24.0', '3.25.0', '3.25.1', '4.0.0', '4.3.6'];
        expect(findBestVersion(zodVersions, '^3.25 || ^4.0')).toBe('3.25.1');
        // If only v4 matches, should still return v4
        const onlyV4 = ['4.0.0', '4.1.0'];
        expect(findBestVersion(onlyV4, '^3.25 || ^4.0')).toBe('4.1.0');
        // Simple OR with exact versions
        expect(findBestVersion(versions, '1.0.0 || 2.0.0')).toBe('1.0.0');
      });
    });
  });

  describe('parsePackageSpec', () => {
    it('should parse package name only', () => {
      expect(parsePackageSpec('express')).toEqual({ name: 'express' });
    });

    it('should parse package with version', () => {
      expect(parsePackageSpec('express@4.18.2')).toEqual({
        name: 'express',
        version: '4.18.2',
      });
    });

    it('should parse scoped package', () => {
      expect(parsePackageSpec('@types/node')).toEqual({
        name: '@types/node',
      });
    });

    it('should parse scoped package with version', () => {
      expect(parsePackageSpec('@types/node@18.0.0')).toEqual({
        name: '@types/node',
        version: '18.0.0',
      });
    });

    it('should parse version ranges', () => {
      expect(parsePackageSpec('express@^4.0.0')).toEqual({
        name: 'express',
        version: '^4.0.0',
      });
    });

    it('should parse npm alias package specs', () => {
      expect(parsePackageSpec('ink@npm:@jrichman/ink@6.4.11')).toEqual({
        name: 'ink',
        version: 'npm:@jrichman/ink@6.4.11',
      });
    });
  });

  describe('tarball extraction', () => {
    let vfs: VirtualFS;

    beforeEach(() => {
      vfs = new VirtualFS();
    });

    it('should decompress gzipped data', () => {
      const original = new TextEncoder().encode('hello world');
      const compressed = pako.gzip(original);
      const decompressed = decompress(compressed);
      expect(new TextDecoder().decode(decompressed)).toBe('hello world');
    });

    it('should extract tarball to VFS', () => {
      // Create a minimal tar archive with package/ prefix
      const tarball = createMinimalTarball({
        'package/package.json': '{"name":"test","version":"1.0.0"}',
        'package/index.js': 'module.exports = 42;',
      });

      // Gzip it
      const compressed = pako.gzip(tarball);

      // Extract to /node_modules/test
      const files = extractTarball(compressed, vfs, '/node_modules/test');

      expect(vfs.existsSync('/node_modules/test/package.json')).toBe(true);
      expect(vfs.existsSync('/node_modules/test/index.js')).toBe(true);

      const pkgJson = JSON.parse(
        vfs.readFileSync('/node_modules/test/package.json', 'utf8')
      );
      expect(pkgJson.name).toBe('test');
      expect(pkgJson.version).toBe('1.0.0');

      expect(vfs.readFileSync('/node_modules/test/index.js', 'utf8')).toBe(
        'module.exports = 42;'
      );
    });

    it('should strip leading path components', () => {
      const tarball = createMinimalTarball({
        'package/lib/utils.js': 'exports.util = true;',
      });
      const compressed = pako.gzip(tarball);

      extractTarball(compressed, vfs, '/pkg', { stripComponents: 1 });

      expect(vfs.existsSync('/pkg/lib/utils.js')).toBe(true);
      expect(vfs.existsSync('/pkg/package')).toBe(false);
    });

    it('should apply filter function', () => {
      const tarball = createMinimalTarball({
        'package/index.js': 'code',
        'package/test.js': 'test code',
        'package/README.md': 'readme',
      });
      const compressed = pako.gzip(tarball);

      extractTarball(compressed, vfs, '/pkg', {
        stripComponents: 1,
        filter: (path) => path.endsWith('.js'),
      });

      expect(vfs.existsSync('/pkg/index.js')).toBe(true);
      expect(vfs.existsSync('/pkg/test.js')).toBe(true);
      expect(vfs.existsSync('/pkg/README.md')).toBe(false);
    });
  });

  describe('PackageManager', () => {
    let vfs: VirtualFS;
    let pm: PackageManager;

    beforeEach(() => {
      vfs = new VirtualFS();
      pm = new PackageManager(vfs);
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should list installed packages', () => {
      // Manually set up installed packages
      vfs.writeFileSync(
        '/node_modules/express/package.json',
        '{"name":"express","version":"4.18.2"}'
      );
      vfs.writeFileSync(
        '/node_modules/lodash/package.json',
        '{"name":"lodash","version":"4.17.21"}'
      );

      const packages = pm.list();

      expect(packages).toEqual({
        express: '4.18.2',
        lodash: '4.17.21',
      });
    });

    it('should list scoped packages', () => {
      vfs.writeFileSync(
        '/node_modules/@types/node/package.json',
        '{"name":"@types/node","version":"18.0.0"}'
      );

      const packages = pm.list();

      expect(packages).toEqual({
        '@types/node': '18.0.0',
      });
    });

    it('should return empty object when no packages installed', () => {
      expect(pm.list()).toEqual({});
    });

    it('should install package with mocked fetch', async () => {
      // Mock fetch responses
      const mockManifest = {
        name: 'tiny-pkg',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'tiny-pkg',
            version: '1.0.0',
            dist: {
              tarball: 'https://registry.npmjs.org/tiny-pkg/-/tiny-pkg-1.0.0.tgz',
              shasum: 'abc123',
            },
            dependencies: {},
          },
        },
      };

      const tarballContent = createMinimalTarball({
        'package/package.json': '{"name":"tiny-pkg","version":"1.0.0"}',
        'package/index.js': 'module.exports = "tiny";',
      });
      const compressedTarball = pako.gzip(tarballContent);

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes('registry.npmjs.org/tiny-pkg') && !urlStr.includes('.tgz')) {
          return new Response(JSON.stringify(mockManifest), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('.tgz')) {
          return new Response(compressedTarball, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });

      const result = await pm.install('tiny-pkg');

      expect(result.installed.size).toBe(1);
      expect(result.installed.has('tiny-pkg')).toBe(true);
      expect(vfs.existsSync('/node_modules/tiny-pkg/package.json')).toBe(true);
      expect(vfs.existsSync('/node_modules/tiny-pkg/index.js')).toBe(true);

      const pkgJson = JSON.parse(
        vfs.readFileSync('/node_modules/tiny-pkg/package.json', 'utf8')
      );
      expect(pkgJson.version).toBe('1.0.0');
    });

    it('should create bin stubs in /node_modules/.bin/ for packages with bin field', async () => {
      const mockManifest = {
        name: 'my-cli',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'my-cli',
            version: '1.0.0',
            dist: {
              tarball: 'https://registry.npmjs.org/my-cli/-/my-cli-1.0.0.tgz',
              shasum: 'abc123',
            },
            dependencies: {},
          },
        },
      };

      const tarballContent = createMinimalTarball({
        'package/package.json': '{"name":"my-cli","version":"1.0.0","bin":{"mycli":"bin/cli.js"}}',
        'package/bin/cli.js': 'console.log("hello from cli");',
      });
      const compressedTarball = pako.gzip(tarballContent);

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes('registry.npmjs.org/my-cli') && !urlStr.includes('.tgz')) {
          return new Response(JSON.stringify(mockManifest), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('.tgz')) {
          return new Response(compressedTarball, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });

      await pm.install('my-cli');

      // Bin stub should exist
      expect(vfs.existsSync('/node_modules/.bin/mycli')).toBe(true);

      // Bin stub should be a bash script calling node with the entry point
      const stubContent = vfs.readFileSync('/node_modules/.bin/mycli', 'utf8');
      expect(stubContent).toContain('node');
      expect(stubContent).toContain('/node_modules/my-cli/bin/cli.js');
    });

    it('should handle string bin field (command name = package name)', async () => {
      const mockManifest = {
        name: 'simple-tool',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'simple-tool',
            version: '1.0.0',
            dist: {
              tarball: 'https://registry.npmjs.org/simple-tool/-/simple-tool-1.0.0.tgz',
              shasum: 'abc123',
            },
            dependencies: {},
          },
        },
      };

      const tarballContent = createMinimalTarball({
        'package/package.json': '{"name":"simple-tool","version":"1.0.0","bin":"./index.js"}',
        'package/index.js': 'console.log("simple");',
      });
      const compressedTarball = pako.gzip(tarballContent);

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes('registry.npmjs.org/simple-tool') && !urlStr.includes('.tgz')) {
          return new Response(JSON.stringify(mockManifest), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (urlStr.includes('.tgz')) {
          return new Response(compressedTarball, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });

      await pm.install('simple-tool');

      // Bin stub should use package name as command name
      expect(vfs.existsSync('/node_modules/.bin/simple-tool')).toBe(true);
      const stubContent = vfs.readFileSync('/node_modules/.bin/simple-tool', 'utf8');
      expect(stubContent).toContain('node');
      expect(stubContent).toContain('/node_modules/simple-tool/index.js');
    });

    it('should resolve and install dependencies', async () => {
      const manifestA = {
        name: 'pkg-a',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'pkg-a',
            version: '1.0.0',
            dist: {
              tarball: 'https://registry.npmjs.org/pkg-a/-/pkg-a-1.0.0.tgz',
              shasum: 'abc',
            },
            dependencies: {
              'pkg-b': '^1.0.0',
            },
          },
        },
      };

      const manifestB = {
        name: 'pkg-b',
        'dist-tags': { latest: '1.2.0' },
        versions: {
          '1.0.0': {
            name: 'pkg-b',
            version: '1.0.0',
            dist: {
              tarball: 'https://registry.npmjs.org/pkg-b/-/pkg-b-1.0.0.tgz',
              shasum: 'def',
            },
            dependencies: {},
          },
          '1.2.0': {
            name: 'pkg-b',
            version: '1.2.0',
            dist: {
              tarball: 'https://registry.npmjs.org/pkg-b/-/pkg-b-1.2.0.tgz',
              shasum: 'ghi',
            },
            dependencies: {},
          },
        },
      };

      const tarballA = pako.gzip(
        createMinimalTarball({
          'package/package.json': '{"name":"pkg-a","version":"1.0.0"}',
        })
      );

      const tarballB = pako.gzip(
        createMinimalTarball({
          'package/package.json': '{"name":"pkg-b","version":"1.2.0"}',
        })
      );

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes('/pkg-a') && !urlStr.includes('.tgz')) {
          return new Response(JSON.stringify(manifestA), { status: 200 });
        }
        if (urlStr.includes('/pkg-b') && !urlStr.includes('.tgz')) {
          return new Response(JSON.stringify(manifestB), { status: 200 });
        }
        if (urlStr.includes('pkg-a-1.0.0.tgz')) {
          return new Response(tarballA, { status: 200 });
        }
        if (urlStr.includes('pkg-b-1.2.0.tgz')) {
          return new Response(tarballB, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });

      const result = await pm.install('pkg-a');

      expect(result.installed.size).toBe(2);
      expect(result.installed.has('pkg-a')).toBe(true);
      expect(result.installed.has('pkg-b')).toBe(true);

      // Should install the highest compatible version of pkg-b
      const pkgB = result.installed.get('pkg-b');
      expect(pkgB?.version).toBe('1.2.0');

      expect(vfs.existsSync('/node_modules/pkg-a/package.json')).toBe(true);
      expect(vfs.existsSync('/node_modules/pkg-b/package.json')).toBe(true);
    });

    it('should resolve npm alias dependencies', async () => {
      const manifestHost = {
        name: 'alias-host',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'alias-host',
            version: '1.0.0',
            dist: {
              tarball: 'https://registry.npmjs.org/alias-host/-/alias-host-1.0.0.tgz',
              shasum: 'host',
            },
            dependencies: {
              ink: 'npm:@jrichman/ink@6.4.11',
            },
          },
        },
      };

      const manifestInk = {
        name: '@jrichman/ink',
        'dist-tags': { latest: '6.4.11' },
        versions: {
          '6.4.11': {
            name: '@jrichman/ink',
            version: '6.4.11',
            dist: {
              tarball: 'https://registry.npmjs.org/@jrichman/ink/-/ink-6.4.11.tgz',
              shasum: 'ink',
            },
            dependencies: {},
          },
        },
      };

      const tarballHost = pako.gzip(
        createMinimalTarball({
          'package/package.json': '{"name":"alias-host","version":"1.0.0"}',
        })
      );

      const tarballInk = pako.gzip(
        createMinimalTarball({
          'package/package.json': '{"name":"@jrichman/ink","version":"6.4.11"}',
        })
      );

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes('/alias-host') && !urlStr.includes('.tgz')) {
          return new Response(JSON.stringify(manifestHost), { status: 200 });
        }
        if (urlStr.includes('/@jrichman%2fink') && !urlStr.includes('.tgz')) {
          return new Response(JSON.stringify(manifestInk), { status: 200 });
        }
        if (urlStr.includes('alias-host-1.0.0.tgz')) {
          return new Response(tarballHost, { status: 200 });
        }
        if (urlStr.includes('ink-6.4.11.tgz')) {
          return new Response(tarballInk, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });

      const result = await pm.install('alias-host');

      expect(result.installed.has('alias-host')).toBe(true);
      expect(result.installed.has('ink')).toBe(true);
      expect(result.installed.get('ink')?.version).toBe('6.4.11');
      expect(vfs.existsSync('/node_modules/ink/package.json')).toBe(true);

      const installedAliasPkg = JSON.parse(
        vfs.readFileSync('/node_modules/ink/package.json', 'utf8')
      );
      expect(installedAliasPkg.name).toBe('@jrichman/ink');

      const requestedUrls = fetchSpy.mock.calls.map(([url]) => url.toString());
      expect(
        requestedUrls.some(
          (url) => url.includes('/@jrichman%2fink') && !url.includes('.tgz')
        )
      ).toBe(true);
    });

    it('should apply worker-mode installs with the same filesystem results as main-thread installs', async () => {
      const manifest = {
        name: 'worker-cli',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'worker-cli',
            version: '1.0.0',
            dist: {
              tarball: 'https://registry.npmjs.org/worker-cli/-/worker-cli-1.0.0.tgz',
              shasum: 'worker',
            },
            dependencies: {
              helper: '^1.0.0',
            },
            bin: {
              workercli: 'bin/cli.js',
            },
          },
        },
      };

      const helperManifest = {
        name: 'helper',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'helper',
            version: '1.0.0',
            dist: {
              tarball: 'https://registry.npmjs.org/helper/-/helper-1.0.0.tgz',
              shasum: 'helper',
            },
            dependencies: {},
          },
        },
      };

      const workerCliTarball = pako.gzip(createMinimalTarball({
        'package/package.json': JSON.stringify({
          name: 'worker-cli',
          version: '1.0.0',
          bin: {
            workercli: 'bin/cli.js',
          },
        }),
        'package/bin/cli.js': 'console.log("worker cli");',
      }));
      const helperTarball = pako.gzip(createMinimalTarball({
        'package/package.json': '{"name":"helper","version":"1.0.0"}',
        'package/index.js': 'module.exports = "helper";',
      }));

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes('/worker-cli') && !urlStr.includes('.tgz')) {
          return new Response(JSON.stringify(manifest), { status: 200 });
        }
        if (urlStr.includes('/helper') && !urlStr.includes('.tgz')) {
          return new Response(JSON.stringify(helperManifest), { status: 200 });
        }
        if (urlStr.includes('worker-cli-1.0.0.tgz')) {
          return new Response(workerCliTarball, { status: 200 });
        }
        if (urlStr.includes('helper-1.0.0.tgz')) {
          return new Response(helperTarball, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });

      const workerVfs = new VirtualFS();
      workerVfs.mkdirSync('/project', { recursive: true });
      workerVfs.writeFileSync('/project/package.json', '{"name":"demo","version":"1.0.0"}');

      const mainVfs = new VirtualFS();
      mainVfs.mkdirSync('/project', { recursive: true });
      mainVfs.writeFileSync('/project/package.json', '{"name":"demo","version":"1.0.0"}');

      const workerPm = new PackageManager(workerVfs, {
        cwd: '/project',
        installMode: 'worker',
        workerClientFactory: () => new FakeInstallWorkerClient(),
      });
      const mainPm = new PackageManager(mainVfs, {
        cwd: '/project',
        installMode: 'main-thread',
      });

      const workerResult = await workerPm.install('worker-cli', { save: true });
      const mainResult = await mainPm.install('worker-cli', { save: true });

      expect(workerResult.added.sort()).toEqual(mainResult.added.sort());
      expect(workerPm.list()).toEqual(mainPm.list());
      expect(workerVfs.readFileSync('/project/package.json', 'utf8')).toEqual(
        mainVfs.readFileSync('/project/package.json', 'utf8'),
      );
      expect(workerVfs.readFileSync('/project/node_modules/.bin/workercli', 'utf8')).toEqual(
        mainVfs.readFileSync('/project/node_modules/.bin/workercli', 'utf8'),
      );
      expect(workerVfs.readFileSync('/project/node_modules/.package-lock.json', 'utf8')).toEqual(
        mainVfs.readFileSync('/project/node_modules/.package-lock.json', 'utf8'),
      );
      expect(workerVfs.readFileSync('/project/node_modules/helper/package.json', 'utf8')).toEqual(
        mainVfs.readFileSync('/project/node_modules/helper/package.json', 'utf8'),
      );
    });

    it('falls back to the main thread when Worker is unavailable', async () => {
      const manifest = {
        name: 'fallback-pkg',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'fallback-pkg',
            version: '1.0.0',
            dist: {
              tarball: 'https://registry.npmjs.org/fallback-pkg/-/fallback-pkg-1.0.0.tgz',
              shasum: 'fallback',
            },
            dependencies: {},
          },
        },
      };

      const tarball = pako.gzip(createMinimalTarball({
        'package/package.json': '{"name":"fallback-pkg","version":"1.0.0"}',
      }));

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = url.toString();
        if (urlStr.includes('/fallback-pkg') && !urlStr.includes('.tgz')) {
          return new Response(JSON.stringify(manifest), { status: 200 });
        }
        if (urlStr.includes('fallback-pkg-1.0.0.tgz')) {
          return new Response(tarball, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });

      const originalWorker = globalThis.Worker;
      let workerFactoryCalled = false;
      // @ts-expect-error - test intentionally removes Worker support.
      delete globalThis.Worker;

      try {
        const fallbackPm = new PackageManager(vfs, {
          installMode: 'worker',
          workerClientFactory: () => {
            workerFactoryCalled = true;
            return new FakeInstallWorkerClient();
          },
        });

        await fallbackPm.install('fallback-pkg');

        expect(workerFactoryCalled).toBe(false);
        expect(vfs.existsSync('/node_modules/fallback-pkg/package.json')).toBe(true);
      } finally {
        globalThis.Worker = originalWorker;
      }
    });

    it('terminates a failed worker client, retries on the main thread, and recreates the worker for the next install', async () => {
      const manifests = new Map([
        ['recover-one', {
          name: 'recover-one',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              name: 'recover-one',
              version: '1.0.0',
              dist: {
                tarball: 'https://registry.npmjs.org/recover-one/-/recover-one-1.0.0.tgz',
                shasum: 'recover-one',
              },
              dependencies: {},
            },
          },
        }],
        ['recover-two', {
          name: 'recover-two',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              name: 'recover-two',
              version: '1.0.0',
              dist: {
                tarball: 'https://registry.npmjs.org/recover-two/-/recover-two-1.0.0.tgz',
                shasum: 'recover-two',
              },
              dependencies: {},
            },
          },
        }],
      ]);

      const tarballs = new Map([
        ['recover-one', pako.gzip(createMinimalTarball({
          'package/package.json': '{"name":"recover-one","version":"1.0.0"}',
          'package/index.js': 'module.exports = "recover-one";',
        }))],
        ['recover-two', pako.gzip(createMinimalTarball({
          'package/package.json': '{"name":"recover-two","version":"1.0.0"}',
          'package/index.js': 'module.exports = "recover-two";',
        }))],
      ]);

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = url.toString();

        for (const [pkgName, manifest] of manifests) {
          if (urlStr.includes(`/${pkgName}`) && !urlStr.includes('.tgz')) {
            return new Response(JSON.stringify(manifest), { status: 200 });
          }
          if (urlStr.includes(`${pkgName}-1.0.0.tgz`)) {
            return new Response(tarballs.get(pkgName), { status: 200 });
          }
        }

        return new Response('Not found', { status: 404 });
      });

      const createdClients: RecoveryInstallWorkerClient[] = [];
      const progress: string[] = [];
      let failNextWorkerRun = true;
      const originalWorker = globalThis.Worker;
      globalThis.Worker = class {} as typeof Worker;

      try {
        const pm = new PackageManager(vfs, {
          installMode: 'worker',
          workerClientFactory: () => {
            const client = new RecoveryInstallWorkerClient(failNextWorkerRun);
            failNextWorkerRun = false;
            createdClients.push(client);
            return client;
          },
        });

        await pm.install('recover-one', {
          onProgress: (message) => progress.push(message),
        });

        expect(progress.join('\n')).toContain('npm: worker install failed; retrying on main thread...');
        expect(vfs.existsSync('/node_modules/recover-one/package.json')).toBe(true);
        expect(createdClients).toHaveLength(1);
        expect(createdClients[0]?.terminateCalls).toBe(1);

        await pm.install('recover-two');

        expect(vfs.existsSync('/node_modules/recover-two/package.json')).toBe(true);
        expect(createdClients).toHaveLength(2);
        expect(createdClients[1]?.runCalls).toBe(1);
      } finally {
        globalThis.Worker = originalWorker;
      }
    });

    it('streams progress through container.run for npm install', async () => {
      const manifest = {
        name: 'stream-pkg',
        'dist-tags': { latest: '1.0.0' },
        versions: {
          '1.0.0': {
            name: 'stream-pkg',
            version: '1.0.0',
            dist: {
              tarball: 'https://registry.npmjs.org/stream-pkg/-/stream-pkg-1.0.0.tgz',
              shasum: 'stream',
            },
            dependencies: {},
          },
        },
      };

      const tarball = pako.gzip(createMinimalTarball({
        'package/package.json': '{"name":"stream-pkg","version":"1.0.0"}',
      }));

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = url.toString();
        if ((urlStr.includes('/stream-pkg') || urlStr.includes(encodeURIComponent('https://registry.npmjs.org/stream-pkg'))) && !urlStr.includes('.tgz')) {
          return new Response(JSON.stringify(manifest), { status: 200 });
        }
        if (urlStr.includes('stream-pkg-1.0.0.tgz') || urlStr.includes(encodeURIComponent('https://registry.npmjs.org/stream-pkg/-/stream-pkg-1.0.0.tgz'))) {
          return new Response(tarball, { status: 200 });
        }
        return new Response('Not found', { status: 404 });
      });

      const container = createContainer({ installMode: 'main-thread' });
      const streamed: string[] = [];

      const result = await container.run('npm install stream-pkg', {
        onStdout: (chunk) => streamed.push(chunk),
      });

      expect(result.exitCode).toBe(0);
      expect(streamed.join('')).toContain('Resolving stream-pkg@latest');
      expect(streamed.join('')).toContain('Installed 1 packages');
      expect(result.stdout).toContain('added 1 packages');
      expect(container.vfs.existsSync('/node_modules/stream-pkg/package.json')).toBe(true);
    });

    it('installs devDependencies for npm install with no package args', async () => {
      const manifests = new Map([
        ['runtime-pkg', {
          name: 'runtime-pkg',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              name: 'runtime-pkg',
              version: '1.0.0',
              dist: {
                tarball: 'https://registry.npmjs.org/runtime-pkg/-/runtime-pkg-1.0.0.tgz',
                shasum: 'runtime',
              },
              dependencies: {},
            },
          },
        }],
        ['dev-only-pkg', {
          name: 'dev-only-pkg',
          'dist-tags': { latest: '1.0.0' },
          versions: {
            '1.0.0': {
              name: 'dev-only-pkg',
              version: '1.0.0',
              dist: {
                tarball: 'https://registry.npmjs.org/dev-only-pkg/-/dev-only-pkg-1.0.0.tgz',
                shasum: 'dev-only',
              },
              dependencies: {},
            },
          },
        }],
      ]);

      const tarballs = new Map([
        ['runtime-pkg', pako.gzip(createMinimalTarball({
          'package/package.json': '{"name":"runtime-pkg","version":"1.0.0"}',
        }))],
        ['dev-only-pkg', pako.gzip(createMinimalTarball({
          'package/package.json': '{"name":"dev-only-pkg","version":"1.0.0"}',
        }))],
      ]);

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
        const urlStr = url.toString();

        for (const [pkgName, manifest] of manifests) {
          const encodedManifestUrl = encodeURIComponent(`https://registry.npmjs.org/${pkgName}`);
          const encodedTarballUrl = encodeURIComponent(`https://registry.npmjs.org/${pkgName}/-/${pkgName}-1.0.0.tgz`);
          if ((urlStr.includes(`/${pkgName}`) || urlStr.includes(encodedManifestUrl)) && !urlStr.includes('.tgz')) {
            return new Response(JSON.stringify(manifest), { status: 200 });
          }
          if (urlStr.includes(`${pkgName}-1.0.0.tgz`) || urlStr.includes(encodedTarballUrl)) {
            return new Response(tarballs.get(pkgName), { status: 200 });
          }
        }

        return new Response('Not found', { status: 404 });
      });

      const container = createContainer({
        cwd: '/project',
        installMode: 'main-thread',
      });
      container.vfs.mkdirSync('/project', { recursive: true });
      container.vfs.writeFileSync(
        '/project/package.json',
        JSON.stringify({
          name: 'demo-project',
          version: '1.0.0',
          dependencies: {
            'runtime-pkg': '^1.0.0',
          },
          devDependencies: {
            'dev-only-pkg': '^1.0.0',
          },
        }),
      );

      const result = await container.run('npm install');

      expect(result.exitCode).toBe(0);
      expect(result.stdout).toContain('added 2 packages');
      expect(container.vfs.existsSync('/project/node_modules/runtime-pkg/package.json')).toBe(true);
      expect(container.vfs.existsSync('/project/node_modules/dev-only-pkg/package.json')).toBe(true);
    });
  });
});

describe('VFS patch helpers', () => {
  it('applies large patches in chunks and yields between slices', async () => {
    const vfs = new VirtualFS();
    const encoder = new TextEncoder();
    const patch = {
      operations: Array.from({ length: 5 }, (_, index) => ({
        type: 'writeFile' as const,
        path: `/files/file-${index}.txt`,
        content: Buffer.from(`payload-${index}`).toString('base64'),
      })),
      changedPaths: [],
      touchesNodeModules: false,
      touchesPackageJson: false,
    };
    let yields = 0;

    await applyVfsPatch(vfs, patch, {
      chunkSize: 2,
      yieldControl: async () => {
        yields += 1;
      },
    });

    expect(yields).toBe(2);
    expect(vfs.readFileSync('/files/file-4.txt')).toEqual(encoder.encode('payload-4'));
  });
});

class FakeInstallWorkerClient implements PackageManagerWorkerClient {
  async runInstall(payload: InstallWorkerPayload, onProgress?: ((message: string) => void) | null) {
    const workerVfs = VirtualFS.fromSnapshot(payload.snapshot);
    const result = await executeInstallRequest(
      workerVfs,
      payload.settings,
      payload.request,
      {
        ...payload.options,
        onProgress: onProgress || undefined,
      },
    );
    return {
      patch: diffVfsSnapshots(payload.snapshot, workerVfs.toSnapshot()),
      result: serializeInstallResult(result),
    };
  }
}

class RecoveryInstallWorkerClient implements PackageManagerWorkerClient {
  runCalls = 0;
  terminateCalls = 0;

  constructor(private readonly shouldFail: boolean) {}

  async runInstall(payload: InstallWorkerPayload, onProgress?: ((message: string) => void) | null) {
    this.runCalls += 1;
    if (this.shouldFail) {
      throw new Error('worker exploded');
    }

    const workerVfs = VirtualFS.fromSnapshot(payload.snapshot);
    const result = await executeInstallRequest(
      workerVfs,
      payload.settings,
      payload.request,
      {
        ...payload.options,
        onProgress: onProgress || undefined,
      },
    );

    return {
      patch: diffVfsSnapshots(payload.snapshot, workerVfs.toSnapshot()),
      result: serializeInstallResult(result),
    };
  }

  terminate(): void {
    this.terminateCalls += 1;
  }
}

/**
 * Create a minimal tar archive for testing
 */
function createMinimalTarball(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];

  for (const [filename, content] of Object.entries(files)) {
    const contentBytes = encoder.encode(content);

    // Create 512-byte header
    const header = new Uint8Array(512);

    // Filename (0-100)
    const nameBytes = encoder.encode(filename);
    header.set(nameBytes.slice(0, 100), 0);

    // File mode (100-108) - octal "0000644\0"
    header.set(encoder.encode('0000644\0'), 100);

    // UID (108-116) - octal "0000000\0"
    header.set(encoder.encode('0000000\0'), 108);

    // GID (116-124) - octal "0000000\0"
    header.set(encoder.encode('0000000\0'), 116);

    // Size (124-136) - octal, 11 digits + space
    const sizeOctal = contentBytes.length.toString(8).padStart(11, '0') + ' ';
    header.set(encoder.encode(sizeOctal), 124);

    // Mtime (136-148) - octal "00000000000\0"
    header.set(encoder.encode('00000000000\0'), 136);

    // Initially set checksum field to spaces for calculation
    header.set(encoder.encode('        '), 148);

    // Type flag (156) - '0' for regular file
    header[156] = 48; // '0'

    // Calculate checksum (sum of all bytes in header)
    let checksum = 0;
    for (let i = 0; i < 512; i++) {
      checksum += header[i];
    }
    // Write checksum as 6 octal digits + null + space
    const checksumStr = checksum.toString(8).padStart(6, '0') + '\0 ';
    header.set(encoder.encode(checksumStr), 148);

    chunks.push(header);

    // Add content padded to 512-byte boundary
    const paddedSize = Math.ceil(contentBytes.length / 512) * 512;
    const paddedContent = new Uint8Array(paddedSize);
    paddedContent.set(contentBytes);
    chunks.push(paddedContent);
  }

  // Add two 512-byte blocks of zeros to mark end of archive
  chunks.push(new Uint8Array(1024));

  // Concatenate all chunks
  const totalSize = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const result = new Uint8Array(totalSize);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  return result;
}
