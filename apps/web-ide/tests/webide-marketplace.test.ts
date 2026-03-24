import { describe, expect, it } from 'vitest';
import { unpackVsix } from '../src/extensions/vsix';
import { assessExtensionManifest } from '../src/extensions/extension-compat';
import { FixtureMarketplaceClient } from '../src/extensions/fixture-extensions';
import { OpenVSXClient, detailToGalleryExtension } from '../src/extensions/open-vsx';

describe('webide marketplace helpers', () => {
  it('accepts browser and declarative fixture extensions', async () => {
    const client = new FixtureMarketplaceClient();

    const theme = await client.getLatest('almostnode-fixtures', 'sunburst-paper');
    const browser = await client.getLatest('almostnode-fixtures', 'browser-hello');
    const themeManifest = await client.getManifest(theme);
    const browserManifest = await client.getManifest(browser);

    expect(assessExtensionManifest(themeManifest!).compatible).toBe(true);
    expect(assessExtensionManifest(browserManifest!).compatible).toBe(true);
  });

  it('rejects node-only extensions that require the Node runtime', async () => {
    const client = new FixtureMarketplaceClient();
    const nodeOnly = await client.getLatest('almostnode-fixtures', 'node-only');
    const manifest = await client.getManifest(nodeOnly);
    const compatibility = assessExtensionManifest(manifest!);

    expect(compatibility.compatible).toBe(false);
    expect(compatibility.reason).toContain('Node entrypoint');
  });

  it('builds and unpacks fixture VSIX archives', async () => {
    const client = new FixtureMarketplaceClient();
    const fixture = await client.getLatest('almostnode-fixtures', 'browser-hello');
    const bytes = await client.downloadVsix(fixture);
    const archive = unpackVsix(bytes);

    expect(archive.manifest.name).toBe('browser-hello');
    expect(archive.files.has('dist/extension.js')).toBe(true);
    expect(archive.readmePath).toBe('README.md');
    expect(archive.changelogPath).toBe('CHANGELOG.md');
  });

  it('maps Open VSX detail payloads into gallery extensions', async () => {
    const client = new FixtureMarketplaceClient();
    const detail = await client.getLatest('almostnode-fixtures', 'snippet-pack');
    const manifest = await client.getManifest(detail);
    const extension = detailToGalleryExtension(detail, manifest);

    expect(extension.identifier.id).toBe('almostnode-fixtures.snippet-pack');
    expect(extension.properties.targetPlatform).toBe('web');
    expect(extension.assets.download.uri).toContain('.vsix');
    expect(extension.tags).toContain('__web_extension');
  });

  it('uses the Open VSX marketplace endpoints for search, metadata, and downloads', async () => {
    const requests: string[] = [];
    const payload = {
      url: 'https://open-vsx.example/api/acme/demo/1.0.0',
      namespace: 'acme',
      name: 'demo',
      version: '1.0.0',
      displayName: 'Demo',
      description: 'Demo extension',
      files: {
        manifest: 'https://open-vsx.example/files/package.json',
        readme: 'https://open-vsx.example/files/README.md',
        changelog: 'https://open-vsx.example/files/CHANGELOG.md',
        download: 'https://open-vsx.example/files/demo.vsix',
      },
    };

    const client = new OpenVSXClient({
      baseUrl: 'https://open-vsx.example',
      fetch: async (input) => {
        const url = String(input);
        requests.push(url);

        if (url.includes('/api/-/search')) {
          return new Response(JSON.stringify({ offset: 0, totalSize: 1, extensions: [payload] }));
        }
        if (url.endsWith('/api/acme/demo/latest')) {
          return new Response(JSON.stringify(payload));
        }
        if (url.endsWith('/package.json')) {
          return new Response(JSON.stringify({
            name: 'demo',
            publisher: 'acme',
            version: '1.0.0',
            engines: { vscode: '^1.90.0' },
            browser: './dist/extension.js',
          }));
        }
        if (url.endsWith('/README.md')) {
          return new Response('# Demo\n');
        }
        if (url.endsWith('/CHANGELOG.md')) {
          return new Response('## 1.0.0\n');
        }
        if (url.endsWith('/demo.vsix')) {
          return new Response(new Uint8Array([1, 2, 3]));
        }

        throw new Error(`Unexpected request: ${url}`);
      },
    });

    const search = await client.search('demo', 5);
    const latest = await client.getLatest('acme', 'demo');
    const manifest = await client.getManifest(latest);
    const readme = await client.getReadme(latest);
    const changelog = await client.getChangelog(latest);
    const bytes = await client.downloadVsix(latest);

    expect(search.totalSize).toBe(1);
    expect(latest.version).toBe('1.0.0');
    expect(manifest?.browser).toBe('./dist/extension.js');
    expect(readme).toContain('# Demo');
    expect(changelog).toContain('## 1.0.0');
    expect(bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(requests).toEqual(
      expect.arrayContaining([
        expect.stringContaining('/api/-/search?query=demo&size=5'),
        'https://open-vsx.example/api/acme/demo/latest',
        'https://open-vsx.example/files/package.json',
        'https://open-vsx.example/files/README.md',
        'https://open-vsx.example/files/CHANGELOG.md',
        'https://open-vsx.example/files/demo.vsix',
      ]),
    );
  });
});
