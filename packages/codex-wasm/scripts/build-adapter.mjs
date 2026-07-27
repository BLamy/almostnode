import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { prepareAdapterSource, resolveCodexSource } from "./adapter-source.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const packageRoot = resolve(__dirname, "..");
const repoRoot = resolve(packageRoot, "../..");
const codexRoot = resolveCodexSource(repoRoot);
const adapterSource = prepareAdapterSource({
  packageRoot,
  repoRoot,
  codexRoot,
});
const rustRoot = adapterSource.rustRoot;
const outDir = resolve(packageRoot, "dist/pkg");
const rustToolchain = "1.95.0";
const buildProfile = process.env.CODEX_WASM_BUILD_PROFILE ?? "release";
const profileFlag = {
  dev: "--dev",
  profiling: "--profiling",
  release: "--release",
}[buildProfile];
if (!profileFlag) {
  console.error(
    "CODEX_WASM_BUILD_PROFILE must be `dev`, `profiling`, or `release`.",
  );
  process.exit(1);
}
process.on("exit", adapterSource.cleanup);

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
    "--target",
    "web",
    "--out-dir",
    outDir,
    "--out-name",
    "codex_wasm",
    profileFlag,
    rustRoot,
    "--features",
    "real-codex",
    "--locked",
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
