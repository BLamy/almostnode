import { describe, expect, it } from 'vitest';
import { assessExtensionManifest } from '../src/webide/extension-compat';
import { FixtureMarketplaceClient, buildFixtureVsixBytes, listFixtureDefinitions } from '../src/webide/fixture-extensions';
import { unpackVsix } from '../src/webide/vsix';

describe('sidebar-view fixture extension', () => {
  it('passes assessExtensionManifest with mode container-node', async () => {
    const client = new FixtureMarketplaceClient();
    const detail = await client.getLatest('almostnode-fixtures', 'sidebar-view');
    const manifest = await client.getManifest(detail);
    const result = assessExtensionManifest(manifest!);

    expect(result.compatible).toBe(true);
    expect(result.mode).toBe('container-node');
  });

  it('has a main entry and no browser entry', () => {
    const definitions = listFixtureDefinitions();
    const sidebar = definitions.find((d) => d.name === 'sidebar-view');
    expect(sidebar).toBeDefined();
    expect(sidebar!.manifest.main).toBe('./dist/extension.js');
    expect(sidebar!.manifest.browser).toBeUndefined();
  });

  it('contributes viewsContainers and views', () => {
    const definitions = listFixtureDefinitions();
    const sidebar = definitions.find((d) => d.name === 'sidebar-view');
    const contributes = sidebar!.manifest.contributes as Record<string, unknown>;

    expect(contributes.viewsContainers).toBeDefined();
    expect(contributes.views).toBeDefined();
  });

  it('can be built and unpacked as a VSIX archive', async () => {
    const definitions = listFixtureDefinitions();
    const sidebar = definitions.find((d) => d.name === 'sidebar-view')!;
    const bytes = buildFixtureVsixBytes(sidebar);
    const archive = unpackVsix(bytes);

    expect(archive.manifest.name).toBe('sidebar-view');
    expect(archive.manifest.main).toBe('./dist/extension.js');
    expect(archive.files.has('dist/extension.js')).toBe(true);
    expect(archive.files.has('icon.svg')).toBe(true);
  });
});
