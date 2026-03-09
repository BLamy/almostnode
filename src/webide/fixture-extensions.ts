import type { IExtensionManifest } from '@codingame/monaco-vscode-api/extensions';
import type { IGalleryExtensionVersion } from '@codingame/monaco-vscode-api/vscode/vs/platform/extensionManagement/common/extensionManagement';
import { TargetPlatform } from '@codingame/monaco-vscode-api/vscode/vs/platform/extensions/common/extensions';
import { strToU8, zipSync } from 'fflate';
import type { OpenVSXClientLike, OpenVSXExtensionDetail, OpenVSXSearchResponse } from './open-vsx';

type FixtureDefinition = {
  namespace: string;
  name: string;
  version: string;
  displayName: string;
  description: string;
  categories?: string[];
  tags?: string[];
  manifest: IExtensionManifest;
  files: Record<string, string>;
};

function createBrowserCommandExtension(): FixtureDefinition {
  return {
    namespace: 'almostnode-fixtures',
    name: 'browser-hello',
    version: '0.0.1',
    displayName: 'Browser Hello',
    description: 'Registers a browser command through the worker extension host.',
    categories: ['Other'],
    tags: ['__web_extension'],
    manifest: {
      name: 'browser-hello',
      publisher: 'almostnode-fixtures',
      version: '0.0.1',
      displayName: 'Browser Hello',
      description: 'Registers a browser command through the worker extension host.',
      engines: { vscode: '^1.90.0' },
      browser: './dist/extension.js',
      activationEvents: ['onCommand:fixture.browserHello'],
      contributes: {
        commands: [
          {
            command: 'fixture.browserHello',
            title: 'Fixture: Browser Hello',
          },
        ],
      },
    },
    files: {
      'dist/extension.js': `import * as vscode from 'vscode';

export function activate(context) {
  context.subscriptions.push(
    vscode.commands.registerCommand('fixture.browserHello', async () => {
      await vscode.window.showInformationMessage('Fixture browser command ran');
    })
  );
}
`,
    },
  };
}

function createThemeExtension(): FixtureDefinition {
  return {
    namespace: 'almostnode-fixtures',
    name: 'sunburst-paper',
    version: '0.0.1',
    displayName: 'Sunburst Paper',
    description: 'A small theme-only extension for the mock marketplace.',
    categories: ['Themes'],
    tags: ['__web_extension', 'theme'],
    manifest: {
      name: 'sunburst-paper',
      publisher: 'almostnode-fixtures',
      version: '0.0.1',
      displayName: 'Sunburst Paper',
      description: 'A small theme-only extension for the mock marketplace.',
      engines: { vscode: '^1.90.0' },
      contributes: {
        themes: [
          {
            id: 'sunburst-paper',
            label: 'Sunburst Paper',
            uiTheme: 'vs-dark',
            path: './themes/sunburst-paper-color-theme.json',
          },
        ],
      },
    },
    files: {
      'themes/sunburst-paper-color-theme.json': JSON.stringify(
        {
          name: 'Sunburst Paper',
          type: 'dark',
          colors: {
            'editor.background': '#151b24',
            'editor.foreground': '#edf2fa',
            'activityBar.background': '#10161e',
            'sideBar.background': '#121924',
            'statusBar.background': '#ff7a59',
            'statusBar.foreground': '#10161e',
          },
          tokenColors: [],
        },
        null,
        2,
      ),
    },
  };
}

function createSnippetsExtension(): FixtureDefinition {
  return {
    namespace: 'almostnode-fixtures',
    name: 'snippet-pack',
    version: '0.0.1',
    displayName: 'Snippet Pack',
    description: 'Adds a language config, grammar, and snippets.',
    categories: ['Programming Languages'],
    tags: ['__web_extension', 'snippets'],
    manifest: {
      name: 'snippet-pack',
      publisher: 'almostnode-fixtures',
      version: '0.0.1',
      displayName: 'Snippet Pack',
      description: 'Adds a language config, grammar, and snippets.',
      engines: { vscode: '^1.90.0' },
      contributes: {
        languages: [
          {
            id: 'fixturelang',
            aliases: ['FixtureLang'],
            extensions: ['.fixture'],
            configuration: './language-configuration.json',
          },
        ],
        grammars: [
          {
            language: 'fixturelang',
            scopeName: 'source.fixturelang',
            path: './syntaxes/fixture.tmLanguage.json',
          },
        ],
        snippets: [
          {
            language: 'typescript',
            path: './snippets/typescript.json',
          },
        ],
      },
    },
    files: {
      'language-configuration.json': JSON.stringify(
        {
          comments: {
            lineComment: '//',
          },
          brackets: [['{', '}']],
          autoClosingPairs: [{ open: '{', close: '}' }],
        },
        null,
        2,
      ),
      'syntaxes/fixture.tmLanguage.json': JSON.stringify(
        {
          scopeName: 'source.fixturelang',
          patterns: [{ include: '#keywords' }],
          repository: {
            keywords: {
              patterns: [
                {
                  name: 'keyword.control.fixturelang',
                  match: '\\b(fixture|spark)\\b',
                },
              ],
            },
          },
        },
        null,
        2,
      ),
      'snippets/typescript.json': JSON.stringify(
        {
          'fixture card': {
            prefix: 'fixture-card',
            body: [
              'export function ${1:FeatureCard}() {',
              "  return '<section>${2:content}</section>';",
              '}',
            ],
            description: 'Insert a fixture card helper',
          },
        },
        null,
        2,
      ),
    },
  };
}

function createNodeOnlyExtension(): FixtureDefinition {
  return {
    namespace: 'almostnode-fixtures',
    name: 'node-only',
    version: '0.0.1',
    displayName: 'Node Only',
    description: 'Intentionally unsupported because it only ships a Node entrypoint.',
    categories: ['Other'],
    tags: [],
    manifest: {
      name: 'node-only',
      publisher: 'almostnode-fixtures',
      version: '0.0.1',
      displayName: 'Node Only',
      description: 'Intentionally unsupported because it only ships a Node entrypoint.',
      engines: { vscode: '^1.90.0' },
      main: './dist/extension.js',
      activationEvents: ['*'],
    },
    files: {
      'dist/extension.js': `exports.activate = () => {};`,
    },
  };
}

const FIXTURES = [
  createThemeExtension(),
  createSnippetsExtension(),
  createBrowserCommandExtension(),
  createNodeOnlyExtension(),
];

function toDetail(definition: FixtureDefinition): OpenVSXExtensionDetail {
  const idBase = `https://fixtures.almostnode.invalid/api/${definition.namespace}/${definition.name}/${definition.version}`;
  return {
    url: `${idBase}`,
    name: definition.name,
    namespace: definition.namespace,
    namespaceDisplayName: definition.namespace,
    version: definition.version,
    timestamp: '2026-03-08T00:00:00.000Z',
    displayName: definition.displayName,
    description: definition.description,
    verified: true,
    downloadCount: 100,
    categories: definition.categories || [],
    tags: definition.tags || [],
    extensionKind: definition.manifest.browser ? ['workspace', 'web'] : ['ui', 'web'],
    engines: definition.manifest.engines,
    dependencies: definition.manifest.extensionDependencies || [],
    bundledExtensions: definition.manifest.extensionPack || [],
    localizedLanguages: [],
    preRelease: false,
    files: {
      download: `${idBase}/file/${definition.namespace}.${definition.name}-${definition.version}.vsix`,
      manifest: `${idBase}/file/package.json`,
      readme: `${idBase}/file/README.md`,
      changelog: `${idBase}/file/CHANGELOG.md`,
      icon: undefined,
      signature: `${idBase}/file/signature.sigzip`,
    },
    allVersions: {
      latest: `${idBase}`,
      [definition.version]: `${idBase}`,
    },
    targetPlatform: 'web',
  };
}

export function listFixtureDefinitions(): FixtureDefinition[] {
  return FIXTURES.map((fixture) => ({
    ...fixture,
    files: { ...fixture.files },
    manifest: structuredClone(fixture.manifest),
  }));
}

export function buildFixtureVsixBytes(definition: FixtureDefinition): Uint8Array {
  const entries: Record<string, Uint8Array> = {
    'extension/package.json': strToU8(JSON.stringify(definition.manifest, null, 2)),
    'extension/README.md': strToU8(`# ${definition.displayName}\n\n${definition.description}\n`),
    'extension/CHANGELOG.md': strToU8(`## ${definition.version}\n\n- Initial fixture release\n`),
  };

  for (const [path, content] of Object.entries(definition.files)) {
    entries[`extension/${path}`] = strToU8(content);
  }

  return zipSync(entries, { level: 6 });
}

export class FixtureMarketplaceClient implements OpenVSXClientLike {
  async search(query: string, size = 20): Promise<OpenVSXSearchResponse> {
    const normalized = query.trim().toLowerCase();
    const extensions = FIXTURES
      .filter((fixture) => {
        if (!normalized) return true;
        return `${fixture.namespace}.${fixture.name}`.toLowerCase().includes(normalized)
          || fixture.displayName.toLowerCase().includes(normalized)
          || fixture.description.toLowerCase().includes(normalized);
      })
      .slice(0, size)
      .map((fixture) => toDetail(fixture));

    return {
      offset: 0,
      totalSize: extensions.length,
      extensions,
    };
  }

  async getLatest(namespace: string, name: string): Promise<OpenVSXExtensionDetail> {
    const fixture = FIXTURES.find((candidate) => candidate.namespace === namespace && candidate.name === name);
    if (!fixture) {
      throw new Error(`Unknown fixture extension ${namespace}.${name}`);
    }

    return toDetail(fixture);
  }

  async getManifest(detail: OpenVSXExtensionDetail): Promise<IExtensionManifest | null> {
    const fixture = FIXTURES.find((candidate) => candidate.namespace === detail.namespace && candidate.name === detail.name);
    return fixture ? structuredClone(fixture.manifest) : null;
  }

  async getReadme(detail: OpenVSXExtensionDetail): Promise<string> {
    return `# ${detail.displayName || detail.name}\n`;
  }

  async getChangelog(detail: OpenVSXExtensionDetail): Promise<string> {
    return `## ${detail.version}\n`;
  }

  async downloadVsix(detail: OpenVSXExtensionDetail): Promise<Uint8Array> {
    const fixture = FIXTURES.find((candidate) => candidate.namespace === detail.namespace && candidate.name === detail.name);
    if (!fixture) {
      throw new Error(`Unknown fixture extension ${detail.namespace}.${detail.name}`);
    }

    return buildFixtureVsixBytes(fixture);
  }

  async getVersions(namespace: string, name: string): Promise<IGalleryExtensionVersion[]> {
    const fixture = FIXTURES.find((candidate) => candidate.namespace === namespace && candidate.name === name);
    if (!fixture) {
      return [];
    }

    return [
      {
        version: fixture.version,
        date: '2026-03-08T00:00:00.000Z',
        isPreReleaseVersion: false,
        targetPlatforms: [TargetPlatform.WEB],
      },
    ];
  }
}
