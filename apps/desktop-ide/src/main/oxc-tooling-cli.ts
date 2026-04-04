import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

function getLocalBinPath(commandName: string): string {
  return path.join(app.getPath('home'), '.local', 'bin', commandName);
}

function getSharedShellPrelude(): string {
  return `find_project_root() {
  current="$PWD"
  while [ "$current" != "/" ]; do
    if [ -f "$current/package.json" ]; then
      printf '%s\\n' "$current"
      return 0
    fi
    current="$(dirname "$current")"
  done
  printf '%s\\n' "$PWD"
}

resolve_local_bin() {
  project_root="$(find_project_root)"
  candidate="$project_root/node_modules/.bin/$1"
  if [ -x "$candidate" ]; then
    printf '%s\\n' "$candidate"
    return 0
  fi
  return 1
}
`;
}

function getPassthroughWrapperSource(commandName: string): string {
  return `#!/bin/sh
set -eu
${getSharedShellPrelude()}

if bin_path="$(resolve_local_bin ${JSON.stringify(commandName)})"; then
  exec "$bin_path" "$@"
fi

exec npx --yes ${commandName} "$@"
`;
}

function getLspBridgeWrapperSource(): string {
  return `#!/bin/sh
set -eu
${getSharedShellPrelude()}

subcommand="\${1:-}"
shift || true

case "$subcommand" in
  oxlint)
    if bin_path="$(resolve_local_bin oxlint)"; then
      exec "$bin_path" --lsp "$@"
    fi
    exec npx --yes oxlint --lsp "$@"
    ;;
  tsgo)
    if bin_path="$(resolve_local_bin tsgo)"; then
      exec "$bin_path" --lsp --stdio "$@"
    fi
    if bin_path="$(resolve_local_bin tsgo-wasm)"; then
      exec "$bin_path" --lsp --stdio "$@"
    fi
    if npx --yes --package @typescript/native-preview tsgo --help >/dev/null 2>&1; then
      exec npx --yes --package @typescript/native-preview tsgo --lsp --stdio "$@"
    fi
    exec npx --yes --package tsgo-wasm tsgo-wasm --lsp --stdio "$@"
    ;;
  *)
    printf 'Usage: almostnode-lsp-bridge <oxlint|tsgo>\\n' >&2
    exit 64
    ;;
esac
`;
}

async function installExecutable(name: string, source: string): Promise<void> {
  const targetPath = getLocalBinPath(name);
  await fs.promises.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.promises.writeFile(targetPath, source, { encoding: 'utf8', mode: 0o755 });
  await fs.promises.chmod(targetPath, 0o755);
}

export async function ensureAlmostnodeToolingCliWrappers(): Promise<void> {
  await Promise.all([
    installExecutable('oxfmt', getPassthroughWrapperSource('oxfmt')),
    installExecutable('oxlint', getPassthroughWrapperSource('oxlint')),
    installExecutable('almostnode-lsp-bridge', getLspBridgeWrapperSource()),
  ]);
}
