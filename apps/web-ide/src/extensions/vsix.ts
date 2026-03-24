import type { IFileService } from '@codingame/monaco-vscode-api';
import type { IExtensionManifest } from '@codingame/monaco-vscode-api/extensions';
import { VSBuffer } from '@codingame/monaco-vscode-api/vscode/vs/base/common/buffer';
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri';
import { strFromU8, unzipSync } from 'fflate';

export interface ExtensionArchive {
  manifest: IExtensionManifest;
  files: Map<string, Uint8Array>;
  readmePath?: string;
  changelogPath?: string;
}

function normalizeArchivePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '');
}

function stripVsixRoot(path: string): string | null {
  const normalized = normalizeArchivePath(path);
  if (normalized.startsWith('extension/')) {
    return normalized.slice('extension/'.length);
  }
  if (normalized.startsWith('package/')) {
    return normalized.slice('package/'.length);
  }
  return null;
}

export function unpackVsix(bytes: Uint8Array | ArrayBuffer): ExtensionArchive {
  const archive = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const entries = unzipSync(archive);
  const files = new Map<string, Uint8Array>();
  let manifest: IExtensionManifest | null = null;

  for (const [entryPath, content] of Object.entries(entries)) {
    const relativePath = stripVsixRoot(entryPath);
    if (!relativePath) {
      continue;
    }

    files.set(relativePath, content);
    if (relativePath === 'package.json') {
      manifest = JSON.parse(strFromU8(content)) as IExtensionManifest;
    }
  }

  if (!manifest) {
    throw new Error('VSIX archive is missing extension/package.json');
  }

  const readmePath = [...files.keys()].find((path) => /^readme(\.[^.]+)?$/i.test(path));
  const changelogPath = [...files.keys()].find((path) => /^changelog(\.[^.]+)?$/i.test(path));

  return {
    manifest,
    files,
    readmePath,
    changelogPath,
  };
}

export async function writeExtensionArchive(
  fileService: IFileService,
  location: URI,
  archive: ExtensionArchive,
): Promise<void> {
  const directories = new Set<string>(['']);

  for (const path of archive.files.keys()) {
    const parts = path.split('/');
    parts.pop();
    let current = '';
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      directories.add(current);
    }
  }

  for (const directory of [...directories].sort((left, right) => left.length - right.length)) {
    if (!directory) continue;
    await fileService.createFolder(URI.joinPath(location, directory));
  }

  for (const [path, content] of archive.files) {
    await fileService.writeFile(URI.joinPath(location, path), VSBuffer.wrap(content));
  }
}
