import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..");
const rustRoot = resolve(packageRoot, "rust");
const outDir = resolve(packageRoot, "dist/pkg");
const rustToolchain = "1.95.0";

if (!existsSync(resolve(rustRoot, "Cargo.toml"))) {
  console.error(`Codex WASM Rust crate not found at ${rustRoot}.`);
  process.exit(1);
}

run("rustup", ["target", "add", "wasm32-unknown-unknown"], {
  cwd: rustRoot,
  stdio: "inherit",
});

rmSync(outDir, { recursive: true, force: true });
run(
  "wasm-pack",
  [
    "build",
    rustRoot,
    "--target",
    "web",
    "--out-dir",
    outDir,
    "--out-name",
    "codex_wasm",
    "--features",
    "real-codex",
  ],
  {
    cwd: packageRoot,
    stdio: "inherit",
  },
);

rmSync(resolve(outDir, ".gitignore"), { force: true });

function run(command, args, options) {
  const wasmRustFlags = [
    process.env.CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS,
    '--cfg getrandom_backend="wasm_js"',
    "-C link-arg=-zstack-size=8388608",
  ]
    .filter(Boolean)
    .join(" ");
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: {
      ...process.env,
      CARGO_TARGET_WASM32_UNKNOWN_UNKNOWN_RUSTFLAGS: wasmRustFlags,
      RUSTUP_TOOLCHAIN: rustToolchain,
    },
    stdio: options.stdio,
  });

  if (result.error) {
    console.error(`Failed to run ${command}: ${result.error.message}`);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
