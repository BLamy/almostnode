import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";

export function resolveCodexSource(repoRoot) {
  return process.env.CODEX_SOURCE_DIR
    ? resolve(repoRoot, process.env.CODEX_SOURCE_DIR)
    : resolve(repoRoot, "vendor/codex");
}

export function prepareAdapterSource({ packageRoot, repoRoot, codexRoot }) {
  const rustRoot = resolve(packageRoot, "rust");
  const defaultCodexRoot = resolve(repoRoot, "vendor/codex");

  if (codexRoot === defaultCodexRoot) {
    return { rustRoot, cleanup: () => {} };
  }

  const stagingKey = process.env.CODEX_ADAPTER_STAGING_KEY;
  if (stagingKey && !/^[A-Za-z0-9_-]+$/.test(stagingKey)) {
    throw new Error(
      "CODEX_ADAPTER_STAGING_KEY may contain only letters, numbers, underscores, and hyphens.",
    );
  }
  const stagingRoot = stagingKey
    ? join(tmpdir(), `almostnode-codex-wasm-${stagingKey}`)
    : mkdtempSync(join(tmpdir(), "almostnode-codex-wasm-"));
  if (stagingKey) {
    rmSync(stagingRoot, { recursive: true, force: true });
    mkdirSync(stagingRoot, { recursive: true });
  }
  const stagedRustRoot = resolve(stagingRoot, "packages/codex-wasm/rust");
  const stagedVendorRoot = resolve(stagingRoot, "vendor");
  mkdirSync(resolve(stagingRoot, "packages/codex-wasm"), { recursive: true });
  mkdirSync(stagedVendorRoot, { recursive: true });
  cpSync(rustRoot, stagedRustRoot, {
    recursive: true,
    filter: (source) => basename(source) !== "target",
  });

  for (const [name, source] of [
    ["codex", codexRoot],
    ["crossterm-wasm", resolve(repoRoot, "vendor/crossterm-wasm")],
    ["tokio-wasm", resolve(repoRoot, "vendor/tokio-wasm")],
  ]) {
    if (!existsSync(source)) {
      rmSync(stagingRoot, { recursive: true, force: true });
      throw new Error(`Codex WASM adapter dependency not found at ${source}.`);
    }
    symlinkSync(
      source,
      resolve(stagedVendorRoot, name),
      process.platform === "win32" ? "junction" : "dir",
    );
  }

  return {
    rustRoot: stagedRustRoot,
    cleanup: () => rmSync(stagingRoot, { recursive: true, force: true }),
  };
}
