import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");

const opentuiWasmCandidates = [
  resolve(repoRoot, "vendor/opentui/packages/core/src/zig/lib/wasm32-freestanding/libopentui.wasm"),
  resolve(repoRoot, "vendor/opentui/packages/core/src/zig/lib/wasm32-freestanding/opentui.wasm"),
];

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
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

run("git", ["submodule", "update", "--init", "--recursive", "vendor/opentui", "vendor/opencode"]);
run("bun", ["install", "--cwd", "vendor/opentui"]);

const existingWasm = opentuiWasmCandidates.find((candidate) => existsSync(candidate));
if (existingWasm) {
  console.log(`Reusing vendored OpenTUI wasm artifact at ${existingWasm}`);
} else {
  console.log("No vendored OpenTUI wasm artifact found; building with Zig.");
  run("bun", ["run", "--cwd", "vendor/opentui/packages/core", "build:wasm"]);
}

run("bun", ["install", "--cwd", "vendor/opencode"]);
