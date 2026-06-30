import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = resolve(new URL("..", import.meta.url).pathname);
const tempRoot = mkdtempSync(join(tmpdir(), "agent-wasm-package-publish-"));

const publishOrder = [
  ["packages/tailscale-connect", "@agent-wasm/tailscale-connect"],
  ["packages/almostnode", "@agent-wasm/core"],
  ["packages/chat-core", "@agent-wasm/chat-core"],
  ["packages/almostnode-sdk", "@agent-wasm/sdk"],
  ["packages/keychain", "@agent-wasm/keychain"],
  ["packages/code", "@agent-wasm/code"],
  ["packages/codex-wasm", "@agent-wasm/codex"],
  ["packages/almostnode-react", "@agent-wasm/react"],
  ["packages/vscode", "@agent-wasm/vscode"],
];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run") || process.env.PUBLISH_DRY_RUN === "true";
const npmTag = process.env.NPM_TAG || "latest";
const useProvenance = process.env.NPM_PROVENANCE === "true" && !dryRun;

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function run(command, args, cwd = workspaceRoot) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 100,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(output || `${command} ${args.join(" ")} failed`);
  }

  return result.stdout;
}

function packPackage(dir) {
  const packDestination = join(tempRoot, dir.replaceAll("/", "__"));
  mkdirSync(packDestination, { recursive: true });

  const output = run("pnpm", [
    "--dir",
    dir,
    "pack",
    "--pack-destination",
    packDestination,
    "--json",
  ]);
  const result = JSON.parse(output.trim());
  const tarball = Array.isArray(result) ? result[0].filename : result.filename;
  statSync(tarball);
  return tarball;
}

function publishTarball(tarball) {
  const args = [
    "publish",
    tarball,
    "--access",
    "public",
    "--tag",
    npmTag,
  ];

  if (dryRun) args.push("--dry-run");
  if (useProvenance) args.push("--provenance");

  return run("npm", args);
}

try {
  console.log(`Publishing ${publishOrder.length} packages with npm tag "${npmTag}"${dryRun ? " (dry run)" : ""}.`);

  for (const [dir, expectedName] of publishOrder) {
    const manifest = readJson(join(workspaceRoot, dir, "package.json"));
    if (manifest.name !== expectedName) {
      throw new Error(`${dir} package name is ${manifest.name}; expected ${expectedName}`);
    }
    if (manifest.private === true) {
      throw new Error(`${expectedName} is private and cannot be published`);
    }

    console.log(`\n# ${expectedName}@${manifest.version}`);
    console.log(`Packing ${dir}...`);
    const tarball = packPackage(dir);
    console.log(`Publishing ${tarball}...`);
    const output = publishTarball(tarball).trim();
    if (output) console.log(output);
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
