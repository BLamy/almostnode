import pathShim from '../shims/path';
import type { VirtualFS } from '../virtual-fs';
import type { ResolvedNetworkPolicy } from './types';
import { NETWORK_CA_BUNDLE_PATH } from './policy';

export function materializeNetworkCaBundle(
  vfs: VirtualFS,
  policy: ResolvedNetworkPolicy,
): void {
  const caBundlePath = policy.proxy.caBundlePath;
  if (!caBundlePath || !policy.proxy.caBundlePem) {
    if (vfs.existsSync(NETWORK_CA_BUNDLE_PATH)) {
      try {
        vfs.unlinkSync(NETWORK_CA_BUNDLE_PATH);
      } catch {
        // Ignore cleanup failures for synthetic trust bundles.
      }
    }
    return;
  }

  vfs.mkdirSync(pathShim.dirname(caBundlePath), { recursive: true });
  vfs.writeFileSync(caBundlePath, policy.proxy.caBundlePem);
}

export function syncProjectedNetworkEnv(
  env: Record<string, string>,
  explicitEnvKeys: ReadonlySet<string>,
  previousProjectedEnv: Record<string, string>,
  nextProjectedEnv: Record<string, string>,
): Record<string, string> {
  const keys = new Set([
    ...Object.keys(previousProjectedEnv),
    ...Object.keys(nextProjectedEnv),
  ]);

  for (const key of keys) {
    if (explicitEnvKeys.has(key)) {
      continue;
    }

    const previousValue = previousProjectedEnv[key];
    const nextValue = nextProjectedEnv[key];
    const currentValue = env[key];

    if (nextValue === undefined) {
      if (currentValue === previousValue) {
        delete env[key];
      }
      continue;
    }

    if (currentValue === undefined || currentValue === previousValue) {
      env[key] = nextValue;
    }
  }

  return { ...nextProjectedEnv };
}
