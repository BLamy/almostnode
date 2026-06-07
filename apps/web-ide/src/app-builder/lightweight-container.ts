import { createContainer, type ContainerInstance, type VirtualFS } from 'almostnode';
import { extractCredentials, type ExtractedCredentials } from './standalone-credentials';
import type { DecryptedFileMap } from './standalone-vault';

export interface CommandOutput {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface LightweightAppBuilderContainer {
  container: ContainerInstance;
  seedCredentials: (files: DecryptedFileMap) => void;
  readCurrentCredentials: () => ExtractedCredentials;
  runCommand: (command: string) => Promise<CommandOutput>;
  getDecryptedFiles: () => DecryptedFileMap;
  dispose: () => void;
  watch: (paths: string[], listener: () => void) => () => void;
}

function writeFileToVfs(vfs: VirtualFS, path: string, content: string): void {
  const dir = path.slice(0, path.lastIndexOf('/')) || '/';
  if (dir !== '/' && !vfs.existsSync(dir)) {
    vfs.mkdirSync(dir, { recursive: true });
  }
  vfs.writeFileSync(path, content);
}

function readFileMap(vfs: VirtualFS, paths: readonly string[]): DecryptedFileMap {
  const out: DecryptedFileMap = {};
  for (const path of paths) {
    try {
      if (!vfs.existsSync(path)) continue;
      if (!vfs.statSync(path).isFile()) continue;
      out[path] = vfs.readFileSync(path, 'utf8');
    } catch {
      // skip unreadable files
    }
  }
  return out;
}

/**
 * Boots a minimal almostnode runtime — just the VFS + registered shell commands
 * (gh / fly / netlify / neon / infisical / replayio / wrangler). No VS Code workbench,
 * no Monaco, no preview service worker. Used by the /app-builder screen to run auth
 * commands without the full IDE.
 */
export function createLightweightAppBuilderContainer(
  initialFiles: DecryptedFileMap,
): LightweightAppBuilderContainer {
  const container = createContainer({ env: { HOME: '/home/user' } });
  const vfs = container.vfs;

  const seedCredentials = (files: DecryptedFileMap) => {
    for (const [path, content] of Object.entries(files)) {
      writeFileToVfs(vfs, path, content);
    }
  };

  seedCredentials(initialFiles);

  const CREDENTIAL_PATHS_ALL = [
    '/home/user/.claude/.credentials.json',
    '/home/user/.claude/.config.json',
    '/home/user/.claude.json',
    '/home/user/.config/gh/hosts.yml',
    '/home/user/.replay/auth.json',
    '/home/user/.config/netlify/config.json',
    '/home/user/.netlify/config.json',
    '/home/user/.config/neonctl/credentials.json',
    '/home/user/.infisical/infisical-config.json',
    '/home/user/.infisical/auth.json',
    '/home/user/.fly/config.yml',
    '/home/user/.config/.wrangler/config/default.toml',
    '/home/user/.wrangler/config/default.toml',
  ] as const;

  return {
    container,
    seedCredentials,
    readCurrentCredentials: () => extractCredentials(readFileMap(vfs, CREDENTIAL_PATHS_ALL)),
    getDecryptedFiles: () => readFileMap(vfs, CREDENTIAL_PATHS_ALL),
    runCommand: async (command: string) => {
      const result = await container.run(command, { cwd: '/home/user' });
      return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        exitCode: result.exitCode,
      };
    },
    watch: (paths, listener) => {
      const watchers: Array<{ close?: () => void }> = [];
      const watchedDirs = new Set<string>();
      for (const path of paths) {
        const parentDir = path.slice(0, path.lastIndexOf('/')) || '/';
        if (watchedDirs.has(parentDir)) continue;
        watchedDirs.add(parentDir);
        try {
          if (parentDir === '/') {
            watchers.push(vfs.watch(path, () => listener()));
          } else {
            if (!vfs.existsSync(parentDir)) {
              vfs.mkdirSync(parentDir, { recursive: true });
            }
            watchers.push(
              vfs.watch(parentDir, { recursive: true }, (_event, filename) => {
                if (!filename) {
                  listener();
                  return;
                }
                const resolved = filename.startsWith('/') ? filename : `${parentDir}/${filename}`;
                if (paths.includes(resolved)) listener();
              }),
            );
          }
        } catch {
          // Swallow watch errors (path might not exist yet).
        }
      }
      return () => {
        for (const w of watchers) {
          try {
            w.close?.();
          } catch {
            // ignore
          }
        }
      };
    },
    dispose: () => {
      // almostnode containers don't currently expose a teardown hook; nothing to do.
    },
  };
}

export const SERVICE_COMMANDS = {
  github: { login: 'gh auth login', logout: 'gh auth logout' },
  replay: { login: 'replayio login', logout: 'replayio logout' },
  infisical: { login: 'infisical login', logout: 'infisical logout' },
  fly: { login: 'fly auth login', logout: 'fly auth logout' },
  netlify: { login: 'netlify login', logout: 'netlify logout' },
  neon: { login: 'neon auth login', logout: 'neon auth logout' },
} as const;

export type ServiceSlot = keyof typeof SERVICE_COMMANDS;
