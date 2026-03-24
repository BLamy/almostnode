import { describe, expect, it } from 'vitest';
import { filterStoredWorkbenchExtensions, shouldPruneStoredWorkbenchExtension } from '../src/features/persisted-extensions';

describe('persisted webide extensions', () => {
  it('prunes file-backed JS/TS language overrides', () => {
    const entry = {
      identifier: { id: 'ms-vscode.vscode-typescript-next' },
      location: {
        scheme: 'file',
        external: 'file:///.almostnode-vscode/extensions/ms-vscode.vscode-typescript-next-5.3.20230808',
      },
      manifest: {
        contributes: {
          grammars: [
            { language: 'typescript' },
            { language: 'javascript' },
          ],
          languages: [
            { id: 'typescript' },
            { id: 'javascript' },
          ],
        },
      },
    };

    expect(shouldPruneStoredWorkbenchExtension(entry)).toBe(true);
  });

  it('keeps builtin extension-file entries intact', () => {
    const entry = {
      identifier: { id: 'vscode.typescript' },
      location: {
        scheme: 'extension-file',
        external: 'extension-file://vscode.typescript/extension',
      },
      manifest: {
        contributes: {
          grammars: [{ language: 'typescript' }],
        },
      },
    };

    expect(shouldPruneStoredWorkbenchExtension(entry)).toBe(false);
  });

  it('keeps unrelated user extensions', () => {
    const { prunedExtensionIds, retainedEntries } = filterStoredWorkbenchExtensions([
      {
        identifier: { id: 'almostnode-fixtures.sunburst-paper' },
        location: {
          scheme: 'file',
          external: 'file:///.almostnode-vscode/extensions/almostnode-fixtures.sunburst-paper-1.0.0',
        },
        manifest: {
          contributes: {
            themes: [{ path: './themes/theme.json' }],
          },
        },
      },
      {
        identifier: { id: 'ms-vscode.vscode-typescript-next' },
        location: {
          scheme: 'file',
          external: 'file:///.almostnode-vscode/extensions/ms-vscode.vscode-typescript-next-5.3.20230808',
        },
        manifest: {
          contributes: {
            grammars: [{ language: 'typescript' }],
          },
        },
      },
    ]);

    expect(prunedExtensionIds).toEqual(['ms-vscode.vscode-typescript-next']);
    expect(retainedEntries).toHaveLength(1);
    expect((retainedEntries[0] as { identifier: { id: string } }).identifier.id).toBe('almostnode-fixtures.sunburst-paper');
  });
});
