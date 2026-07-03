/**
 * Browser-side registration for the CI-built native-module WASM artifacts.
 *
 * The compiled `.wasm` files live in `dist/` (produced by `scripts/build-module.mjs`
 * in CI). This module carries only the *metadata* — which package@version maps to
 * an artifact — and registers it into `@agent-wasm/core`'s `nativeWasmModules`
 * table via dependency injection, so it neither statically imports the (possibly
 * absent) wasm nor reaches into core internals.
 */

/** Shape of the entry `@agent-wasm/core`'s `registerNativeWasm` accepts. */
export interface NativeWasmEntryInput {
  packageName: string;
  versionRange: string;
  artifactUrl: (version: string) => string;
  sha256?: string;
  bindingWrapper?: (napiExports: unknown) => unknown;
}

/** Resolve where a built artifact is served, given module + concrete version. */
export type ArtifactResolver = (module: string, version: string) => string;

/**
 * Registry metadata. `npmVersion` is the exact version the CI build pins/produces;
 * `versionRange` is what the runtime matches installed packages against. Add a row
 * per module as its CI build goes green.
 */
export const NATIVE_WASM_ARTIFACTS: Array<{
  packageName: string;
  versionRange: string;
  npmVersion: string;
  sha256?: string;
}> = [
  {
    packageName: "better-sqlite3",
    versionRange: "^11",
    npmVersion: "11.10.0",
    // sha256 filled in from the build manifest once the artifact is produced.
  },
];

/**
 * Register every artifact into core's native-wasm table.
 * @param register  core's `registerNativeWasm`.
 * @param resolveArtifactUrl  maps (module, version) → the served `.wasm` URL.
 */
export function registerNativeWasmArtifacts(
  register: (entry: NativeWasmEntryInput) => void,
  resolveArtifactUrl: ArtifactResolver,
): void {
  for (const artifact of NATIVE_WASM_ARTIFACTS) {
    register({
      packageName: artifact.packageName,
      versionRange: artifact.versionRange,
      artifactUrl: (version) => resolveArtifactUrl(artifact.packageName, version),
      sha256: artifact.sha256,
      // better-sqlite3's JS wrapper expects the addon export object directly, which
      // is exactly what the N-API exports are — identity (no wrapper needed).
    });
  }
}
