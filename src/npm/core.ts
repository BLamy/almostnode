import { VirtualFS } from '../virtual-fs';
import { Registry } from './registry';
import {
  resolveDependencies,
  resolveFromPackageJson,
  ResolvedPackage,
} from './resolver';
import { downloadAndExtract } from './tarball';
import * as path from '../shims/path';
import type {
  InstallOptions,
  InstallRequest,
  InstallResult,
  PackageManagerSettings,
  SerializedInstallResult,
} from './types';

/**
 * Normalize a package.json bin field into a consistent Record<string, string>.
 * Handles both string form ("bin": "cli.js") and object form ("bin": {"cmd": "cli.js"}).
 */
export function normalizeBin(pkgName: string, bin?: Record<string, string> | string): Record<string, string> {
  if (!bin) return {};
  if (typeof bin === 'string') {
    const cmdName = pkgName.includes('/') ? pkgName.split('/').pop()! : pkgName;
    return { [cmdName]: bin };
  }
  return bin;
}

/**
 * Parse a package specifier into name and version.
 * Examples: "express", "express@4.18.2", "@types/node@18"
 */
export function parsePackageSpec(spec: string): { name: string; version?: string } {
  if (spec.startsWith('@')) {
    const slashIndex = spec.indexOf('/');
    if (slashIndex === -1) {
      throw new Error(`Invalid package spec: ${spec}`);
    }

    const afterSlash = spec.slice(slashIndex + 1);
    const atIndex = afterSlash.indexOf('@');

    if (atIndex === -1) {
      return { name: spec };
    }

    return {
      name: spec.slice(0, slashIndex + 1 + atIndex),
      version: afterSlash.slice(atIndex + 1),
    };
  }

  const atIndex = spec.indexOf('@');
  if (atIndex === -1) {
    return { name: spec };
  }

  return {
    name: spec.slice(0, atIndex),
    version: spec.slice(atIndex + 1),
  };
}

export function serializeInstallResult(result: InstallResult): SerializedInstallResult {
  return {
    installed: Array.from(result.installed.entries()),
    added: [...result.added],
  };
}

export function deserializeInstallResult(result: SerializedInstallResult): InstallResult {
  return {
    installed: new Map(result.installed),
    added: [...result.added],
  };
}

export function toSerializableInstallOptions(options: InstallOptions): Omit<InstallOptions, 'onProgress'> {
  const { onProgress: _onProgress, ...serializable } = options;
  return serializable;
}

export async function executeInstallRequest(
  vfs: VirtualFS,
  settings: PackageManagerSettings,
  request: InstallRequest,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const registry = new Registry({
    registry: options.registry || settings.registry,
    cache: settings.cache,
  });

  if (request.kind === 'packageJson') {
    return installFromPackageJson(vfs, settings.cwd, registry, options);
  }

  return installPackage(vfs, settings.cwd, registry, request.packageSpec, options);
}

export function listInstalledPackages(vfs: VirtualFS, cwd: string): Record<string, string> {
  const nodeModulesPath = path.join(cwd, 'node_modules');

  if (!vfs.existsSync(nodeModulesPath)) {
    return {};
  }

  const packages: Record<string, string> = {};
  const entries = vfs.readdirSync(nodeModulesPath);

  for (const entry of entries) {
    if (entry.startsWith('.')) continue;

    if (entry.startsWith('@')) {
      const scopePath = path.join(nodeModulesPath, entry);
      const scopedPkgs = vfs.readdirSync(scopePath);

      for (const scopedPkg of scopedPkgs) {
        const pkgJsonPath = path.join(scopePath, scopedPkg, 'package.json');
        if (vfs.existsSync(pkgJsonPath)) {
          const pkgJson = JSON.parse(vfs.readFileSync(pkgJsonPath, 'utf8'));
          packages[`${entry}/${scopedPkg}`] = pkgJson.version;
        }
      }
    } else {
      const pkgJsonPath = path.join(nodeModulesPath, entry, 'package.json');
      if (vfs.existsSync(pkgJsonPath)) {
        const pkgJson = JSON.parse(vfs.readFileSync(pkgJsonPath, 'utf8'));
        packages[entry] = pkgJson.version;
      }
    }
  }

  return packages;
}

async function installPackage(
  vfs: VirtualFS,
  cwd: string,
  registry: Registry,
  packageSpec: string,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const { onProgress } = options;
  const { name, version } = parsePackageSpec(packageSpec);

  onProgress?.(`Resolving ${name}@${version || 'latest'}...`);

  const resolved = await resolveDependencies(name, version || 'latest', {
    registry,
    includeDev: options.includeDev,
    includeOptional: options.includeOptional,
    onProgress,
  });

  const added = await installResolved(vfs, cwd, resolved, options);

  if (options.save || options.saveDev) {
    const pkgToAdd = resolved.get(name);
    if (pkgToAdd) {
      await updatePackageJson(vfs, cwd, name, `^${pkgToAdd.version}`, options.saveDev || false);
    }
  }

  onProgress?.(`Installed ${resolved.size} packages`);
  return { installed: resolved, added };
}

async function installFromPackageJson(
  vfs: VirtualFS,
  cwd: string,
  registry: Registry,
  options: InstallOptions = {},
): Promise<InstallResult> {
  const { onProgress } = options;
  const pkgJsonPath = path.join(cwd, 'package.json');

  if (!vfs.existsSync(pkgJsonPath)) {
    throw new Error('No package.json found');
  }

  const pkgJson = JSON.parse(vfs.readFileSync(pkgJsonPath, 'utf8'));

  onProgress?.('Resolving dependencies...');

  const resolved = await resolveFromPackageJson(pkgJson, {
    registry,
    includeDev: options.includeDev,
    includeOptional: options.includeOptional,
    onProgress,
  });

  const added = await installResolved(vfs, cwd, resolved, options);

  onProgress?.(`Installed ${resolved.size} packages`);
  return { installed: resolved, added };
}

async function installResolved(
  vfs: VirtualFS,
  cwd: string,
  resolved: Map<string, ResolvedPackage>,
  options: InstallOptions,
): Promise<string[]> {
  const { onProgress } = options;
  const added: string[] = [];
  const nodeModulesPath = path.join(cwd, 'node_modules');
  vfs.mkdirSync(nodeModulesPath, { recursive: true });

  const toInstall: Array<{ name: string; pkg: ResolvedPackage; pkgPath: string }> = [];

  for (const [name, pkg] of resolved) {
    const pkgPath = path.join(nodeModulesPath, name);
    const existingPkgJson = path.join(pkgPath, 'package.json');
    if (vfs.existsSync(existingPkgJson)) {
      try {
        const existing = JSON.parse(vfs.readFileSync(existingPkgJson, 'utf8'));
        if (existing.version === pkg.version) {
          onProgress?.(`Skipping ${name}@${pkg.version} (already installed)`);
          continue;
        }
      } catch {
        // Continue with installation if package.json is invalid.
      }
    }

    toInstall.push({ name, pkg, pkgPath });
  }

  const concurrency = 6;
  onProgress?.(`Installing ${toInstall.length} packages...`);

  for (let i = 0; i < toInstall.length; i += concurrency) {
    const batch = toInstall.slice(i, i + concurrency);

    await Promise.all(
      batch.map(async ({ name, pkg, pkgPath }) => {
        onProgress?.(`  Downloading ${name}@${pkg.version}...`);

        await downloadAndExtract(pkg.tarballUrl, vfs, pkgPath, {
          stripComponents: 1,
        });

        try {
          const pkgJsonPath = path.join(pkgPath, 'package.json');
          if (vfs.existsSync(pkgJsonPath)) {
            const pkgJson = JSON.parse(vfs.readFileSync(pkgJsonPath, 'utf8'));
            const binEntries = normalizeBin(name, pkgJson.bin);
            const binDir = path.join(nodeModulesPath, '.bin');
            for (const [cmdName, entryPath] of Object.entries(binEntries)) {
              vfs.mkdirSync(binDir, { recursive: true });
              const targetPath = path.join(pkgPath, entryPath);
              vfs.writeFileSync(
                path.join(binDir, cmdName),
                `node "${targetPath}" "$@"\n`,
              );
            }
          }
        } catch {
          // Non-critical — skip if bin stub creation fails.
        }

        added.push(name);
      }),
    );
  }

  await writeLockfile(vfs, cwd, resolved);
  return added;
}

async function writeLockfile(
  vfs: VirtualFS,
  cwd: string,
  resolved: Map<string, ResolvedPackage>,
): Promise<void> {
  const lockfile: Record<string, { version: string; resolved: string }> = {};

  for (const [name, pkg] of resolved) {
    lockfile[name] = {
      version: pkg.version,
      resolved: pkg.tarballUrl,
    };
  }

  const lockfilePath = path.join(cwd, 'node_modules', '.package-lock.json');
  vfs.writeFileSync(lockfilePath, JSON.stringify(lockfile, null, 2));
}

async function updatePackageJson(
  vfs: VirtualFS,
  cwd: string,
  packageName: string,
  version: string,
  isDev: boolean,
): Promise<void> {
  const pkgJsonPath = path.join(cwd, 'package.json');
  let pkgJson: Record<string, unknown> = {};

  if (vfs.existsSync(pkgJsonPath)) {
    pkgJson = JSON.parse(vfs.readFileSync(pkgJsonPath, 'utf8'));
  }

  const field = isDev ? 'devDependencies' : 'dependencies';
  if (!pkgJson[field]) {
    pkgJson[field] = {};
  }

  (pkgJson[field] as Record<string, string>)[packageName] = version;
  vfs.writeFileSync(pkgJsonPath, JSON.stringify(pkgJson, null, 2));
}
