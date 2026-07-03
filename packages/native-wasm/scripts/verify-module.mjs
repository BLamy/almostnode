#!/usr/bin/env node
/**
 * Node-side smoke: instantiate a built `.wasm` under `@napi-rs/wasm-runtime`
 * (emnapi) and exercise a minimal operation, proving the artifact loads outside
 * the browser before it's shipped. Runs in CI after `build-module.mjs`.
 *
 * Usage: node scripts/verify-module.mjs <module> [--version X.Y.Z]
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(packageRoot, "dist");

const moduleName = process.argv[2] ?? "better-sqlite3";
const vIndex = process.argv.indexOf("--version");
const versionOverride = vIndex >= 0 ? process.argv[vIndex + 1] : null;

async function main() {
  const config = (await import(join(packageRoot, "modules", `${moduleName}.mjs`))).default;
  const version = versionOverride ?? config.version;
  const wasmPath = join(distDir, `${config.npmName}@${version}.wasm`);

  if (!existsSync(wasmPath)) {
    console.error(
      `No artifact at ${wasmPath}. Run \`node scripts/build-module.mjs ${moduleName}\` first (needs emsdk).`,
    );
    process.exit(2);
  }

  const { instantiateNapiModuleSync, getDefaultContext, WASI } = await import(
    "@napi-rs/wasm-runtime"
  );
  const wasi = new WASI({ version: "preview1" });
  const { napiModule } = instantiateNapiModuleSync(readFileSync(wasmPath), {
    context: getDefaultContext(),
    wasi,
    overwriteImports(importObject) {
      importObject.env = { ...importObject.env, ...importObject.napi, ...importObject.emnapi };
      return importObject;
    },
  });

  const exports = napiModule.exports;
  if (typeof config.smoke === "function") {
    await config.smoke(exports);
  } else if (!exports || typeof exports !== "object") {
    throw new Error(`instantiated module has no exports object`);
  }
  console.log(`verify OK: ${config.npmName}@${version} instantiated (${Object.keys(exports).join(", ")})`);
}

main().catch((err) => {
  console.error(`verify FAILED: ${err.message}`);
  process.exit(1);
});
