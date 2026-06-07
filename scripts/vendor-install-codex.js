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
const codexRef = process.env.CODEX_VENDOR_REF ?? "codex/wasm-browser-release-2026-06-07";

if (!existsSync(codexRoot)) {
  run("git", ["clone", "--depth", "1", "--branch", codexRef, codexUrl, codexRoot], repoRoot);
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
