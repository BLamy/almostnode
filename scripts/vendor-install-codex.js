import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const codexRoot = resolve(
  repoRoot,
  process.env.CODEX_VENDOR_DIR ?? "vendor/codex",
);
const codexUrl =
  process.env.CODEX_VENDOR_URL ?? "https://github.com/BLamy/codex.git";
const officialCodexVersion = "0.145.0";
const officialCodexBase = "25af12f7e61572b0bc18ddb1008be543b91519b0";
// Pinned to a clean, single-commit browser port whose direct parent is the
// official OpenAI rust-v0.145.0 release. Override with CODEX_VENDOR_REF for
// development against another commit, branch, or tag.
const codexRef =
  process.env.CODEX_VENDOR_REF ?? "f734cacd239155ace2c304f8e8ae108a0e6ea869";
const usingDefaultRef = process.env.CODEX_VENDOR_REF === undefined;

if (!existsSync(codexRoot)) {
  // `git clone --branch` only accepts ref names, not commit SHAs, so fetch the
  // pinned commit into a fresh repo instead (works for a sha, branch, or tag).
  run("git", ["init", "-q", codexRoot], repoRoot);
  fetchCodexRef();
  run("git", ["-C", codexRoot, "checkout", "-q", "FETCH_HEAD"], repoRoot);
} else {
  const status = capture("git", [
    "-C",
    codexRoot,
    "status",
    "--porcelain",
    "--untracked-files=all",
  ]);
  if (status.trim() !== "") {
    console.error(`Refusing to update dirty Codex checkout at ${codexRoot}.`);
    console.error(status);
    process.exit(1);
  }

  fetchCodexRef();
  run("git", ["-C", codexRoot, "checkout", "--detach", "FETCH_HEAD"], repoRoot);
}

const installedHead = capture("git", [
  "-C",
  codexRoot,
  "rev-parse",
  "HEAD",
]).trim();
if (usingDefaultRef && installedHead !== codexRef) {
  fail(`Expected pinned Codex commit ${codexRef}, found ${installedHead}.`);
}

const installedVersion = readWorkspaceVersion(
  resolve(codexRoot, "codex-rs/Cargo.toml"),
);
if (installedVersion !== officialCodexVersion) {
  fail(
    `Expected Codex ${officialCodexVersion}, found ${installedVersion ?? "no workspace version"}.`,
  );
}

const baseCheck = spawnSync(
  "git",
  ["-C", codexRoot, "merge-base", "--is-ancestor", officialCodexBase, "HEAD"],
  { cwd: repoRoot, stdio: "ignore" },
);
if (baseCheck.status !== 0) {
  fail(
    `Codex ${installedHead} is not based on official rust-v${officialCodexVersion} (${officialCodexBase}).`,
  );
}

if (usingDefaultRef) {
  const installedParent = capture("git", [
    "-C",
    codexRoot,
    "rev-parse",
    "HEAD^",
  ]).trim();
  if (installedParent !== officialCodexBase) {
    fail(
      `Pinned browser port must be one clean commit on official rust-v${officialCodexVersion}; found parent ${installedParent}.`,
    );
  }
}

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
run(
  pnpmCommand,
  ["nx", "build-adapter", "codex-wasm", "--skip-nx-cache"],
  repoRoot,
  {
    CODEX_SOURCE_DIR: codexRoot,
    NX_DAEMON: "false",
  },
);

function fetchCodexRef() {
  run(
    "git",
    ["-C", codexRoot, "fetch", "--depth", "256", codexUrl, codexRef],
    repoRoot,
  );
}

function readWorkspaceVersion(cargoTomlPath) {
  const cargoToml = readFileSync(cargoTomlPath, "utf8");
  const workspacePackage = cargoToml.match(
    /^\[workspace\.package\][^\S\r\n]*\r?\n([\s\S]*?)(?=^\[|(?![\s\S]))/m,
  )?.[1];
  return workspacePackage?.match(/^\s*version\s*=\s*"([^"]+)"/m)?.[1];
}

function capture(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
  });
  if (result.error) {
    fail(`Failed to run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    if (result.stderr) {
      console.error(result.stderr.trim());
    }
    process.exit(result.status ?? 1);
  }
  return result.stdout ?? "";
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, cwd, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      ...extraEnv,
    },
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
