import type { IExtensionManifest } from '@codingame/monaco-vscode-api/extensions';

const ALLOWED_DECLARATIVE_CONTRIBUTIONS = new Set([
  'commands',
  'configuration',
  'configurationDefaults',
  'grammars',
  'iconThemes',
  'jsonValidation',
  'keybindings',
  'languages',
  'menus',
  'productIconThemes',
  'snippets',
  'themes',
]);

const DISALLOWED_CONTRIBUTIONS = new Map<string, string>([
  ['customEditors', 'custom editors are out of scope for the browser workbench'],
  ['debuggers', 'debuggers are not supported in v1'],
  ['notebooks', 'notebooks are not supported in v1'],
  ['scm', 'scm providers are not supported in v1'],
  ['taskDefinitions', 'task providers are not supported in v1'],
  ['terminal', 'terminal providers are not supported in v1'],
  ['terminalProfiles', 'terminal providers are not supported in v1'],
  ['viewsWelcome', 'webview-style extension surfaces are not supported in v1'],
  ['webviewPanels', 'webviews are not supported in v1'],
]);

export type ExtensionCompatibilityResult = {
  compatible: boolean;
  reason?: string;
  mode: 'declarative' | 'web-worker';
  unsupportedContributions: string[];
};

function hasAllowedDeclarativeContributions(manifest: IExtensionManifest): boolean {
  const keys = Object.keys(manifest.contributes || {});
  return keys.every((key) => ALLOWED_DECLARATIVE_CONTRIBUTIONS.has(key));
}

export function assessExtensionManifest(manifest: IExtensionManifest): ExtensionCompatibilityResult {
  const contributes = manifest.contributes || {};
  const contributionKeys = Object.keys(contributes);
  const unsupportedContributions = contributionKeys.filter((key) => DISALLOWED_CONTRIBUTIONS.has(key));

  if (manifest.main && !manifest.browser) {
    return {
      compatible: false,
      reason: 'This extension requires a Node entrypoint (`main`) and does not ship a browser entry.',
      mode: 'declarative',
      unsupportedContributions,
    };
  }

  if (unsupportedContributions.length > 0) {
    const first = unsupportedContributions[0];
    return {
      compatible: false,
      reason: DISALLOWED_CONTRIBUTIONS.get(first),
      mode: manifest.browser ? 'web-worker' : 'declarative',
      unsupportedContributions,
    };
  }

  if (manifest.browser) {
    return {
      compatible: true,
      mode: 'web-worker',
      unsupportedContributions,
    };
  }

  if (contributionKeys.length === 0) {
    return {
      compatible: false,
      reason: 'The extension has no browser entry and no supported declarative contributions.',
      mode: 'declarative',
      unsupportedContributions,
    };
  }

  if (!hasAllowedDeclarativeContributions(manifest)) {
    const unsupported = contributionKeys.find((key) => !ALLOWED_DECLARATIVE_CONTRIBUTIONS.has(key));
    return {
      compatible: false,
      reason: unsupported ? `Contribution point \`${unsupported}\` is not supported in v1.` : 'Unsupported contribution point.',
      mode: 'declarative',
      unsupportedContributions,
    };
  }

  return {
    compatible: true,
    mode: 'declarative',
    unsupportedContributions,
  };
}
