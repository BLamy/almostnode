#!/usr/bin/env node
/**
 * Build a native npm module to a `wasm32-wasi` N-API artifact (emscripten +
 * emnapi), loadable in the browser by `@agent-wasm/core`'s `loadNapiWasm`.
 *
 * Orchestrator only — the per-module emcc recipe lives in `modules/<name>.mjs`.
 * Runs in CI (needs `emcc` on PATH via emsdk + the `emnapi` npm package). Emits
 * rr-dash-style phase markers (`@@PHASE:<name>@@`) and, on failure, a structured
 * `dist/failures/<name>@<version>.json` for the issue-filer.
 *
 * Usage: node scripts/build-module.mjs <module> [--version X.Y.Z]
 */
import {
  mkdirSync,
  mkdtempSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const distDir = join(packageRoot, "dist");
const failuresDir = join(distDir, "failures");

const moduleName = process.argv[2];
const versionFlagIndex = process.argv.indexOf("--version");
const versionOverride = versionFlagIndex >= 0 ? process.argv[versionFlagIndex + 1] : null;

if (!moduleName) {
  console.error("usage: build-module.mjs <module> [--version X.Y.Z]");
  process.exit(2);
}

let currentPhase = "init";
function phase(name) {
  currentPhase = name;
  process.stdout.write(`@@PHASE:${name}@@\n`);
}
function log(msg) {
  process.stdout.write(`[native-wasm:${moduleName}] ${msg}\n`);
}

/** Run a command; throws on non-zero with a tail for the failure artifact. Returns the spawnSync result. */
function run(cmd, args, opts = {}) {
  log(`$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  if (result.status !== 0) {
    const err = new Error(`${cmd} exited ${result.status}`);
    err.logTail = out.split("\n").slice(-60).join("\n");
    err.exitCode = result.status ?? 1;
    throw err;
  }
  return result;
}

function writeFailure(err, version) {
  mkdirSync(failuresDir, { recursive: true });
  const artifact = {
    module: moduleName,
    version: version ?? versionOverride ?? "unknown",
    toolchain: probeToolchain(),
    phase: currentPhase,
    exitCode: err.exitCode ?? 1,
    message: err.message,
    logTail: err.logTail ?? String(err.stack ?? err),
  };
  const path = join(failuresDir, `${moduleName}@${artifact.version}.json`);
  writeFileSync(path, JSON.stringify(artifact, null, 2));
  log(`wrote failure artifact ${path}`);
  return artifact;
}

function probeToolchain() {
  const emcc = spawnSync("emcc", ["--version"], { encoding: "utf8" });
  const clang = process.env.WASI_SDK
    ? spawnSync(`${process.env.WASI_SDK}/bin/clang`, ["--version"], { encoding: "utf8" })
    : { stdout: "" };
  return {
    emcc: (emcc.stdout ?? "").split("\n")[0] || "missing",
    "wasi-clang": (clang.stdout ?? "").split("\n")[0] || "missing",
    node: process.version,
  };
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

async function main() {
  const configPath = join(packageRoot, "modules", `${moduleName}.mjs`);
  if (!existsSync(configPath)) {
    console.error(`No module config at ${configPath}`);
    process.exit(2);
  }
  const config = (await import(configPath)).default;
  const version = versionOverride ?? config.version;
  const artifactName = config.npmName ?? config.name ?? moduleName;

  const tmp = mkdtempSync(join(tmpdir(), `native-wasm-${moduleName}-`));
  try {
    // ── fetch ────────────────────────────────────────────────────────────
    phase("fetch");
    const srcDir = join(tmp, "src");
    mkdirSync(srcDir, { recursive: true });
    if (config.npmName) {
      // `npm pack --json` downloads the exact tarball; stdout is a JSON array
      // with the produced filename (notices go to stderr, so parse stdout only).
      const packResult = run("npm", [
        "pack",
        `${config.npmName}@${version}`,
        "--pack-destination",
        tmp,
        "--json",
      ]);
      let tgz;
      try {
        tgz = JSON.parse(packResult.stdout)[0].filename;
      } catch {
        throw Object.assign(new Error("could not parse `npm pack --json` output"), {
          exitCode: 1,
          logTail: packResult.stdout,
        });
      }
      run("tar", ["-xzf", join(tmp, tgz), "-C", srcDir, "--strip-components=1"]);
    }
    // Inline/synthetic modules (no npm package) write their own sources.
    if (typeof config.prepare === "function") {
      await config.prepare({ srcDir, run, log });
    }

    // ── patch ────────────────────────────────────────────────────────────
    phase("patch");
    const patchRel = config.patch;
    if (patchRel) {
      const patchPath = join(packageRoot, patchRel);
      if (existsSync(patchPath)) {
        run("git", ["apply", "--directory", srcDir, patchPath], { cwd: packageRoot });
        log(`applied ${patchRel}`);
      } else {
        log(`no patch file at ${patchRel} (skipping)`);
      }
    }

    // ── build ────────────────────────────────────────────────────────────
    phase("build");
    mkdirSync(distDir, { recursive: true });
    const outWasm = join(distDir, `${artifactName}@${version}.wasm`);
    // emnapi ships headers + a js library; resolve from this package's deps.
    const emnapiDir = resolveEmnapiDir();
    await config.build({ srcDir, outWasm, emnapiDir, run, phase, log, tmp });
    if (!existsSync(outWasm)) {
      throw Object.assign(new Error("build produced no wasm output"), { exitCode: 1 });
    }

    // ── verify ───────────────────────────────────────────────────────────
    phase("verify");
    if (typeof config.verify === "function") {
      await config.verify({ outWasm, run, log });
    }

    // ── manifest ─────────────────────────────────────────────────────────
    const wasmBytes = readFileSync(outWasm);
    const manifest = {
      module: artifactName,
      version,
      wasm: `${artifactName}@${version}.wasm`,
      sha256: sha256(wasmBytes),
      bytes: wasmBytes.length,
      toolchain: probeToolchain(),
    };
    writeFileSync(
      join(distDir, `${artifactName}@${version}.manifest.json`),
      JSON.stringify(manifest, null, 2),
    );
    log(`OK ${artifactName}@${version} (${wasmBytes.length} bytes, sha256 ${manifest.sha256.slice(0, 12)}…)`);
  } catch (err) {
    const artifact = writeFailure(err, version);
    console.error(`FAILED at phase '${artifact.phase}': ${err.message}`);
    process.exitCode = 1;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function resolveEmnapiDir() {
  // emnapi is a devDependency; its package root holds include/ + lib/.
  try {
    return dirname(require.resolve("emnapi/package.json"));
  } catch {
    log("warning: emnapi not resolvable; the module build must provide its own include/lib paths");
    return "";
  }
}

main();
