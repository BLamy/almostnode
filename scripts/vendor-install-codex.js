import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const codexRoot = resolve(repoRoot, "vendor/codex");
const buildAdapterScript = resolve(repoRoot, "packages/codex-wasm/scripts/build-adapter.mjs");
const codexUrl = process.env.CODEX_VENDOR_URL ?? "https://github.com/BLamy/codex.git";
// Pinned to a specific commit on the BLamy/codex fork (branch
// almostnode-browser-wasm) so CI builds the exact codex that
// packages/codex-wasm/rust/src/cli.rs was written against. That commit carries
// the browser-wasm patches the adapter needs (apply_patch_grammar, scrollback,
// login/wasm); the plain release branch does not. Override with CODEX_VENDOR_REF
// (accepts a sha, branch, or tag).
const codexRef = process.env.CODEX_VENDOR_REF ?? "76685598def751be4c94390438713d597be663f1";

if (!existsSync(codexRoot)) {
  // `git clone --branch` only accepts ref names, not commit SHAs, so fetch the
  // pinned commit into a fresh repo instead (works for a sha, branch, or tag).
  run("git", ["init", "-q", codexRoot], repoRoot);
  run("git", ["-C", codexRoot, "fetch", "--depth", "1", codexUrl, codexRef], repoRoot);
  run("git", ["-C", codexRoot, "checkout", "-q", "FETCH_HEAD"], repoRoot);
} else {
  const dirty = spawnSync("git", ["-C", codexRoot, "diff", "--quiet"], {
    cwd: repoRoot,
    stdio: "ignore",
  });
  if (dirty.status !== 0) {
    console.error(`Refusing to update dirty Codex checkout at ${codexRoot}.`);
    process.exit(dirty.status ?? 1);
  }

  run("git", ["-C", codexRoot, "fetch", "--depth", "1", codexUrl, codexRef], repoRoot);
  run("git", ["-C", codexRoot, "checkout", "FETCH_HEAD"], repoRoot);
}

run(process.execPath, [buildAdapterScript], repoRoot);

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
  });

  if (result.error) {
    console.error(`Failed to run ${command}:`, result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
