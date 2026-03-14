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

function createIslandsDarkThemeExtension(): FixtureDefinition {
  return {
    namespace: 'almostnode-fixtures',
    name: 'islands-dark',
    version: '0.0.1',
    displayName: 'Islands Dark',
    description: 'A polished dark theme with deep charcoal backgrounds and soft borders.',
    categories: ['Themes'],
    tags: ['__web_extension', 'theme'],
    manifest: {
      name: 'islands-dark',
      publisher: 'almostnode-fixtures',
      version: '0.0.1',
      displayName: 'Islands Dark',
      description: 'A polished dark theme with deep charcoal backgrounds and soft borders.',
      engines: { vscode: '^1.90.0' },
      contributes: {
        themes: [
          {
            id: 'islands-dark',
            label: 'Islands Dark',
            uiTheme: 'vs-dark',
            path: './themes/islands-dark-color-theme.json',
          },
        ],
      },
    },
    files: {
      'themes/islands-dark-color-theme.json': JSON.stringify(
        {
          name: 'Islands Dark',
          type: 'dark',
          colors: {
            'editor.background': '#191a1c',
            'editor.foreground': '#d4d4d4',
            'editorGroupHeader.tabsBackground': '#191a1c',
            'editorGutter.background': '#191a1c',
            'tab.activeBackground': '#191a1c',
            'tab.inactiveBackground': '#17181a',
            'tab.activeForeground': '#e0e0e0',
            'tab.inactiveForeground': '#808080',
            'tab.border': '#121216',
            'activityBar.background': '#121216',
            'activityBar.foreground': '#c0c0c0',
            'activityBar.border': '#121216',
            'activityBarBadge.background': '#007acc',
            'sideBar.background': '#17181a',
            'sideBar.foreground': '#cccccc',
            'sideBar.border': '#121216',
            'sideBarTitle.foreground': '#bbbbbb',
            'sideBarSectionHeader.background': '#17181a',
            'sideBarSectionHeader.foreground': '#cccccc',
            'panel.background': '#191a1c',
            'panel.border': '#121216',
            'panelTitle.activeBorder': '#007acc',
            'panelTitle.activeForeground': '#e0e0e0',
            'panelTitle.inactiveForeground': '#808080',
            'statusBar.background': '#121216',
            'statusBar.foreground': '#808080',
            'statusBar.border': '#121216',
            'titleBar.activeBackground': '#121216',
            'titleBar.activeForeground': '#cccccc',
            'titleBar.border': '#121216',
            'input.background': '#191a1c',
            'input.foreground': '#cccccc',
            'input.border': '#2a2b2e',
            'dropdown.background': '#191a1c',
            'dropdown.border': '#2a2b2e',
            'list.activeSelectionBackground': '#2a2d32',
            'list.hoverBackground': '#22242a',
            'list.inactiveSelectionBackground': '#222428',
            'focusBorder': '#007acc80',
            'widget.shadow': '#00000040',
            'editorWidget.background': '#191a1c',
            'editorWidget.border': '#2a2b2e',
            'quickInput.background': '#191a1c',
            'quickInputList.focusBackground': '#2a2d32',
            'badge.background': '#007acc',
            'badge.foreground': '#ffffff',
            'scrollbarSlider.background': '#79797950',
            'scrollbarSlider.hoverBackground': '#64646480',
            'scrollbarSlider.activeBackground': '#bfbfbf40',
            'terminal.background': '#191a1c',
            'terminal.foreground': '#cccccc',
            'breadcrumb.background': '#191a1c',
            'breadcrumb.foreground': '#a0a0a0',
          },
          tokenColors: [
            {
              scope: ['comment', 'punctuation.definition.comment'],
              settings: { foreground: '#6A9955' },
            },
            {
              scope: ['string', 'string.quoted'],
              settings: { foreground: '#CE9178' },
            },
            {
              scope: ['keyword', 'storage.type', 'storage.modifier'],
              settings: { foreground: '#569CD6' },
            },
            {
              scope: ['entity.name.function', 'support.function'],
              settings: { foreground: '#DCDCAA' },
            },
            {
              scope: ['entity.name.type', 'support.type'],
              settings: { foreground: '#4EC9B0' },
            },
            {
              scope: ['variable', 'variable.other'],
              settings: { foreground: '#9CDCFE' },
            },
            {
              scope: ['constant.numeric'],
              settings: { foreground: '#B5CEA8' },
            },
            {
              scope: ['constant.language'],
              settings: { foreground: '#569CD6' },
            },
            {
              scope: ['entity.name.tag'],
              settings: { foreground: '#569CD6' },
            },
            {
              scope: ['entity.other.attribute-name'],
              settings: { foreground: '#9CDCFE' },
            },
            {
              scope: ['punctuation'],
              settings: { foreground: '#d4d4d4' },
            },
            {
              scope: ['meta.jsx.children', 'meta.embedded.expression'],
              settings: { foreground: '#d4d4d4' },
            },
          ],
        },
        null,
        2,
      ),
    },
  };
}

function createIslandsLightThemeExtension(): FixtureDefinition {
  return {
    namespace: 'almostnode-fixtures',
    name: 'islands-light',
    version: '0.0.1',
    displayName: 'Islands Light',
    description: 'A polished light theme with warm off-white backgrounds and soft borders.',
    categories: ['Themes'],
    tags: ['__web_extension', 'theme'],
    manifest: {
      name: 'islands-light',
      publisher: 'almostnode-fixtures',
      version: '0.0.1',
      displayName: 'Islands Light',
      description: 'A polished light theme with warm off-white backgrounds and soft borders.',
      engines: { vscode: '^1.90.0' },
      contributes: {
        themes: [
          {
            id: 'islands-light',
            label: 'Islands Light',
            uiTheme: 'vs',
            path: './themes/islands-light-color-theme.json',
          },
        ],
      },
    },
    files: {
      'themes/islands-light-color-theme.json': JSON.stringify(
        {
          name: 'Islands Light',
          type: 'light',
          colors: {
            'editor.background': '#ffffff',
            'editor.foreground': '#24292f',
            'editorGroupHeader.tabsBackground': '#f6f7f9',
            'editorGutter.background': '#ffffff',
            'tab.activeBackground': '#ffffff',
            'tab.inactiveBackground': '#f0f1f3',
            'tab.activeForeground': '#24292f',
            'tab.inactiveForeground': '#8b949e',
            'tab.border': '#e8e9eb',
            'activityBar.background': '#f0f1f3',
            'activityBar.foreground': '#57606a',
            'activityBar.border': '#e8e9eb',
            'activityBarBadge.background': '#0969da',
            'sideBar.background': '#f6f7f9',
            'sideBar.foreground': '#24292f',
            'sideBar.border': '#e8e9eb',
            'sideBarTitle.foreground': '#57606a',
            'sideBarSectionHeader.background': '#f6f7f9',
            'sideBarSectionHeader.foreground': '#24292f',
            'panel.background': '#ffffff',
            'panel.border': '#e8e9eb',
            'panelTitle.activeBorder': '#0969da',
            'panelTitle.activeForeground': '#24292f',
            'panelTitle.inactiveForeground': '#8b949e',
            'statusBar.background': '#f0f1f3',
            'statusBar.foreground': '#57606a',
            'statusBar.border': '#e8e9eb',
            'titleBar.activeBackground': '#f0f1f3',
            'titleBar.activeForeground': '#24292f',
            'titleBar.border': '#e8e9eb',
            'input.background': '#ffffff',
            'input.foreground': '#24292f',
            'input.border': '#d0d7de',
            'dropdown.background': '#ffffff',
            'dropdown.border': '#d0d7de',
            'list.activeSelectionBackground': '#ddf4ff',
            'list.hoverBackground': '#f3f4f6',
            'list.inactiveSelectionBackground': '#eef1f4',
            'focusBorder': '#0969da80',
            'widget.shadow': '#00000018',
            'editorWidget.background': '#ffffff',
            'editorWidget.border': '#d0d7de',
            'quickInput.background': '#ffffff',
            'quickInputList.focusBackground': '#ddf4ff',
            'badge.background': '#0969da',
            'badge.foreground': '#ffffff',
            'scrollbarSlider.background': '#8b949e30',
            'scrollbarSlider.hoverBackground': '#8b949e50',
            'scrollbarSlider.activeBackground': '#8b949e70',
            'terminal.background': '#ffffff',
            'terminal.foreground': '#24292f',
            'breadcrumb.background': '#ffffff',
            'breadcrumb.foreground': '#57606a',
          },
          tokenColors: [
            {
              scope: ['comment', 'punctuation.definition.comment'],
              settings: { foreground: '#6e7781' },
            },
            {
              scope: ['string', 'string.quoted'],
              settings: { foreground: '#0a3069' },
            },
            {
              scope: ['keyword', 'storage.type', 'storage.modifier'],
              settings: { foreground: '#cf222e' },
            },
            {
              scope: ['entity.name.function', 'support.function'],
              settings: { foreground: '#8250df' },
            },
            {
              scope: ['entity.name.type', 'support.type'],
              settings: { foreground: '#0550ae' },
            },
            {
              scope: ['variable', 'variable.other'],
              settings: { foreground: '#24292f' },
            },
            {
              scope: ['constant.numeric'],
              settings: { foreground: '#0550ae' },
            },
            {
              scope: ['constant.language'],
              settings: { foreground: '#0550ae' },
            },
            {
              scope: ['entity.name.tag'],
              settings: { foreground: '#116329' },
            },
            {
              scope: ['entity.other.attribute-name'],
              settings: { foreground: '#0550ae' },
            },
            {
              scope: ['punctuation'],
              settings: { foreground: '#24292f' },
            },
            {
              scope: ['meta.jsx.children', 'meta.embedded.expression'],
              settings: { foreground: '#24292f' },
            },
          ],
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
  createIslandsDarkThemeExtension(),
  createIslandsLightThemeExtension(),
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
