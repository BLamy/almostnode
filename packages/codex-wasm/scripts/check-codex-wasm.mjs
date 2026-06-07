import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..");
const repoRoot = resolve(packageRoot, "../..");
const codexRoot = process.env.CODEX_SOURCE_DIR
  ? resolve(process.env.CODEX_SOURCE_DIR)
  : resolve(repoRoot, "vendor/codex");
const codexRsRoot = resolve(codexRoot, "codex-rs");
const rustToolchain = "1.95.0";

if (!existsSync(resolve(codexRsRoot, "Cargo.toml"))) {
  console.error(`Codex source not found at ${codexRoot}.`);
  console.error("Run `pnpm vendor:install:codex` or set CODEX_SOURCE_DIR=/path/to/openai/codex.");
  process.exit(1);
}

run("rustup", ["target", "add", "wasm32-unknown-unknown"], {
  cwd: codexRsRoot,
  stdio: "inherit",
  allowFailure: true,
});

for (const check of [
  ["codex-core", ["check", "-p", "codex-core", "--lib", "--target", "wasm32-unknown-unknown"]],
  ["codex-tui", ["check", "-p", "codex-tui", "--target", "wasm32-unknown-unknown", "--features", "real-tui-wasm"]],
  ["codex-cli", ["check", "-p", "codex-cli", "--target", "wasm32-unknown-unknown", "--features", "real-tui-wasm"]],
  ["codex-app-server", ["check", "-p", "codex-app-server", "--target", "wasm32-unknown-unknown"]],
]) {
  const [label, args] = check;
  const result = run("cargo", args, {
    cwd: codexRsRoot,
    stdio: "pipe",
    allowFailure: true,
  });

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.status === 0) {
    console.log(`${label} checked successfully for wasm32-unknown-unknown.`);
    continue;
  }

  console.error(output);
  process.exit(result.status ?? 1);
}

const adapterResult = run("cargo", ["check", "--target", "wasm32-unknown-unknown", "--features", "real-codex"], {
  cwd: resolve(packageRoot, "rust"),
  stdio: "pipe",
  allowFailure: true,
});
const adapterOutput = `${adapterResult.stdout ?? ""}\n${adapterResult.stderr ?? ""}`;
if (adapterResult.status !== 0) {
  console.error(adapterOutput);
  process.exit(adapterResult.status ?? 1);
}
console.log("codex-wasm adapter checked successfully for wasm32-unknown-unknown.");

function run(command, args, options) {
  const wasmRustFlags = [
    process.env.CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS,
    '--cfg getrandom_backend="wasm_js"',
  ]
    .filter(Boolean)
    .join(" ");
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS: wasmRustFlags,
      RUSTUP_TOOLCHAIN: rustToolchain,
    },
    stdio: options.stdio,
  });

  if (result.error) {
    if (options.allowFailure) {
      return {
        status: 1,
        stdout: "",
        stderr: result.error.message,
      };
    }
    console.error(`Failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }

  if (!options.allowFailure && result.status !== 0) {
    process.exit(result.status ?? 1);
  }

  return result;
}
