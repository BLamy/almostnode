export interface SyntheticShellSpec {
  readonly names: readonly string[];
  readonly paths: readonly string[];
  readonly version: string;
}

const SHELL_SPECS: readonly SyntheticShellSpec[] = [
  {
    names: ['bash', 'sh'],
    paths: [
      '/bin/bash',
      '/bin/sh',
      '/usr/bin/bash',
      '/usr/bin/sh',
      '/usr/local/bin/bash',
      '/usr/local/bin/sh',
      '/opt/homebrew/bin/bash',
    ],
    version: 'GNU bash, version 5.2.15(1)-release (x86_64-pc-linux-gnu)\n',
  },
  {
    names: ['zsh'],
    paths: [
      '/bin/zsh',
      '/usr/bin/zsh',
      '/usr/local/bin/zsh',
      '/opt/homebrew/bin/zsh',
    ],
    version: 'zsh 5.9 (x86_64-unknown-linux-gnu)\n',
  },
] as const;

export const DEFAULT_POSIX_SHELL = '/bin/bash';

export const SYNTHETIC_SHELL_COMMAND_NAMES: readonly string[] = SHELL_SPECS.flatMap((spec) => {
  return [...spec.names, ...spec.paths];
});

export const SYNTHETIC_EXECUTABLE_PATHS = new Set<string>([
  ...SHELL_SPECS.flatMap((spec) => spec.paths),
  '/usr/bin/node',
  '/usr/local/bin/node',
  '/usr/bin/npm',
  '/usr/local/bin/npm',
  '/usr/bin/npx',
  '/usr/local/bin/npx',
  '/usr/bin/tar',
  '/usr/local/bin/tar',
  '/usr/local/bin/claude-wrapper',
]);

export function getSyntheticShellSpec(command: string): SyntheticShellSpec | null {
  const trimmed = command.trim();
  if (!trimmed) return null;

  const basename = trimmed.slice(trimmed.lastIndexOf('/') + 1);
  return SHELL_SPECS.find((spec) => {
    return spec.names.includes(trimmed)
      || spec.paths.includes(trimmed)
      || spec.names.includes(basename);
  }) ?? null;
}

export function getSyntheticShellVersion(command: string): string | null {
  return getSyntheticShellSpec(command)?.version ?? null;
}

export function isSyntheticExecutablePath(path: string): boolean {
  return SYNTHETIC_EXECUTABLE_PATHS.has(path);
}
