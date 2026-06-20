#!/usr/bin/env node

import { copyFileSync, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tailscaleRoot = join(repoRoot, 'vendor', 'tailscale');
const packageRoot = join(repoRoot, 'packages', 'tailscale-connect');
const tempRoot = mkdtempSync(join(tmpdir(), 'almostnode-tailscale-connect-'));
const tempTailscaleRoot = join(tempRoot, 'tailscale');
const tempPackageRoot = join(tempRoot, 'pkg');
const syncPackage = process.argv.includes('--sync-package');

if (!existsSync(join(tailscaleRoot, 'go.mod'))) {
  console.error(
    'Missing vendor/tailscale. Run `git submodule update --init vendor/tailscale` first.',
  );
  process.exit(1);
}

const run = (cmd, args, cwd) => {
  const result = spawnSync(cmd, args, {
    cwd,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

try {
  run('git', ['worktree', 'add', '--detach', tempTailscaleRoot, 'HEAD'], tailscaleRoot);

  const diff = spawnSync('git', ['diff', '--binary', 'HEAD'], {
    cwd: tailscaleRoot,
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
  });
  if (diff.status !== 0) {
    process.exit(diff.status ?? 1);
  }
  if (diff.stdout.trim().length > 0) {
    const apply = spawnSync('git', ['apply'], {
      cwd: tempTailscaleRoot,
      input: diff.stdout,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    if (apply.status !== 0) {
      process.exit(apply.status ?? 1);
    }
  }

  run(
    './tool/go',
    ['run', './cmd/tsconnect', '-pkgdir', tempPackageRoot, 'build-pkg'],
    tempTailscaleRoot,
  );

  const generatedWasm = join(tempPackageRoot, 'main.wasm');
  const targetWasm = join(packageRoot, 'main.wasm');
  copyFileSync(generatedWasm, targetWasm);

  if (syncPackage) {
    for (const file of [
      'README.md',
      'package.json',
      'pkg.css',
      'pkg.css.map',
      'pkg.d.ts',
      'pkg.js',
    ]) {
      copyFileSync(join(tempPackageRoot, file), join(packageRoot, file));
    }
  }

  const size = statSync(targetWasm).size;
  console.log(`Built ${targetWasm} (${size.toLocaleString()} bytes)`);
  if (!syncPackage) {
    console.log('Kept existing @tailscale/connect JS wrapper; pass --sync-package to replace it.');
  }
} finally {
  spawnSync('git', ['worktree', 'remove', '--force', tempTailscaleRoot], {
    cwd: tailscaleRoot,
    stdio: 'ignore',
  });
  rmSync(tempRoot, { force: true, recursive: true });
}
