import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';

const USER_EXTENSIONS_RESOURCE = URI.from({ scheme: 'vscode-userdata', path: '/User/extensions.json' });
const CORE_WORKBENCH_LANGUAGE_IDS = new Set([
  'javascript',
  'javascriptreact',
  'typescript',
  'typescriptreact',
]);

type StoredWorkbenchExtension = {
  identifier?: {
    id?: string;
  };
  location?: {
    external?: string;
    scheme?: string;
  } | string | null;
  manifest?: {
    contributes?: {
      grammars?: Array<{
        language?: string;
      }>;
      languages?: Array<{
        id?: string;
      }>;
    };
  };
};

type UserDataFileProvider = {
  readFile(resource: URI): Promise<Uint8Array>;
  writeFile(
    resource: URI,
    content: Uint8Array,
    opts: {
      atomic: boolean;
      create: boolean;
      overwrite: boolean;
      unlock: boolean;
    },
  ): Promise<void>;
};

function getStoredExtensionLocationScheme(location: StoredWorkbenchExtension['location']): string | null {
  if (typeof location === 'string') {
    const separator = location.indexOf(':');
    return separator > 0 ? location.slice(0, separator) : null;
  }

  if (location && typeof location === 'object') {
    if (typeof location.scheme === 'string' && location.scheme.length > 0) {
      return location.scheme;
    }
    if (typeof location.external === 'string') {
      const separator = location.external.indexOf(':');
      return separator > 0 ? location.external.slice(0, separator) : null;
    }
  }

  return null;
}

function contributesCoreWorkbenchLanguages(extension: StoredWorkbenchExtension): boolean {
  const languages = extension.manifest?.contributes?.languages || [];
  const grammars = extension.manifest?.contributes?.grammars || [];

  for (const contribution of languages) {
    if (contribution?.id && CORE_WORKBENCH_LANGUAGE_IDS.has(contribution.id)) {
      return true;
    }
  }

  for (const contribution of grammars) {
    if (contribution?.language && CORE_WORKBENCH_LANGUAGE_IDS.has(contribution.language)) {
      return true;
    }
  }

  return false;
}

export function shouldPruneStoredWorkbenchExtension(entry: unknown): entry is StoredWorkbenchExtension {
  if (!entry || typeof entry !== 'object') {
    return false;
  }

  const extension = entry as StoredWorkbenchExtension;
  if (getStoredExtensionLocationScheme(extension.location) !== 'file') {
    return false;
  }

  return contributesCoreWorkbenchLanguages(extension);
}

export function filterStoredWorkbenchExtensions(entries: unknown[]): {
  prunedExtensionIds: string[];
  retainedEntries: unknown[];
} {
  const prunedExtensionIds: string[] = [];
  const retainedEntries = entries.filter((entry) => {
    if (!shouldPruneStoredWorkbenchExtension(entry)) {
      return true;
    }

    const extension = entry as StoredWorkbenchExtension;
    if (extension.identifier?.id) {
      prunedExtensionIds.push(extension.identifier.id);
    }
    return false;
  });

  return {
    prunedExtensionIds,
    retainedEntries,
  };
}

export async function prunePersistedWorkbenchExtensions(userDataProvider: UserDataFileProvider): Promise<string[]> {
  let storedEntries: unknown;

  try {
    const raw = await userDataProvider.readFile(USER_EXTENSIONS_RESOURCE);
    storedEntries = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return [];
  }

  if (!Array.isArray(storedEntries)) {
    return [];
  }

  const { prunedExtensionIds, retainedEntries } = filterStoredWorkbenchExtensions(storedEntries);
  if (prunedExtensionIds.length === 0) {
    return [];
  }

  await userDataProvider.writeFile(
    USER_EXTENSIONS_RESOURCE,
    new TextEncoder().encode(JSON.stringify(retainedEntries)),
    {
      atomic: false,
      create: true,
      overwrite: true,
      unlock: false,
    },
  );

  return prunedExtensionIds;
}
