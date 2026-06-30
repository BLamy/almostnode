import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const workspaceRoot = resolve(new URL("..", import.meta.url).pathname);
const packagesRoot = join(workspaceRoot, "packages");
const tempRoot = mkdtempSync(join(tmpdir(), "agent-wasm-package-preflight-"));
const requiredPackedFiles = {
  "@agent-wasm/codex": [
    "dist/pkg/codex_wasm.js",
    "dist/pkg/codex_wasm_bg.wasm",
  ],
  "@agent-wasm/tailscale-connect": [
    "main.wasm",
  ],
};

const bytes = (value) => {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let size = value / 1024;
  let unit = units.shift();
  while (size >= 1024 && units.length > 0) {
    size /= 1024;
    unit = units.shift();
  }
  return `${size >= 10 ? size.toFixed(1) : size.toFixed(2)} ${unit}`;
};

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

const discoverPackageDirs = () => readdirSync(packagesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => join(packagesRoot, entry.name))
  .filter((dir) => {
    try {
      statSync(join(dir, "package.json"));
      return true;
    } catch {
      return false;
    }
  })
  .sort();

const run = (command, args, cwd) => {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 100,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(output || `${command} ${args.join(" ")} failed`);
  }
  return result.stdout;
};

const walkFiles = (root, base = root, files = []) => {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(path, base, files);
      continue;
    }
    if (!entry.isFile()) continue;
    const rel = relative(base, path).split(sep).join("/");
    files.push({ path: rel, size: statSync(path).size });
  }
  return files;
};

const flattenExportTargets = (value, targets = []) => {
  if (!value) return targets;
  if (typeof value === "string") {
    targets.push(value);
    return targets;
  }
  if (Array.isArray(value)) {
    for (const item of value) flattenExportTargets(item, targets);
    return targets;
  }
  if (typeof value === "object") {
    for (const item of Object.values(value)) flattenExportTargets(item, targets);
  }
  return targets;
};

const validateEntrypoints = (manifest, files) => {
  const fileSet = new Set(files.map((file) => file.path));
  const targets = [];
  for (const key of ["main", "module", "types", "browser"]) {
    if (typeof manifest[key] === "string") targets.push([key, manifest[key]]);
  }
  for (const target of flattenExportTargets(manifest.exports)) {
    targets.push(["exports", target]);
  }

  const issues = [];
  for (const [kind, target] of targets) {
    if (!target.startsWith("./")) continue;
    const path = target.slice(2);
    if (path.includes("*")) continue;
    if (!fileSet.has(path)) {
      issues.push(`${kind} points at missing ${target}`);
      continue;
    }
    if (path.startsWith("src/") || (path.endsWith(".ts") && !path.endsWith(".d.ts"))) {
      issues.push(`${kind} points at source ${target}`);
    }
  }
  return issues;
};

const workspaceDependencyIssues = (manifest) => {
  const issues = [];
  for (const field of ["dependencies", "peerDependencies", "optionalDependencies"]) {
    const deps = manifest[field] || {};
    for (const [name, range] of Object.entries(deps)) {
      if (String(range).startsWith("workspace:")) {
        issues.push(`${field}.${name} still uses ${range}`);
      }
    }
  }
  return issues;
};

const summarizeFiles = (files) => {
  const groups = new Map();
  for (const file of files) {
    const group = file.path.includes("/") ? file.path.split("/")[0] : file.path;
    groups.set(group, (groups.get(group) || 0) + file.size);
  }
  return {
    groups: [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
    files: [...files].sort((a, b) => b.size - a.size).slice(0, 12),
  };
};

const packageDirs = discoverPackageDirs();
const results = [];

try {
  for (const dir of packageDirs) {
    const sourceManifest = readJson(join(dir, "package.json"));
    if (sourceManifest.private === true) continue;

    const destination = join(tempRoot, sourceManifest.name.replaceAll("/", "__"));
    mkdirSync(destination, { recursive: true });

    const packJson = run("pnpm", ["--dir", dir, "pack", "--pack-destination", destination, "--json"], workspaceRoot);
    const packResult = JSON.parse(packJson.trim());
    const tarball = Array.isArray(packResult) ? packResult[0].filename : packResult.filename;
    const tarballSize = statSync(tarball).size;

    const extractRoot = join(destination, "extract");
    mkdirSync(extractRoot, { recursive: true });
    run("tar", ["-xzf", tarball, "-C", extractRoot], workspaceRoot);

    const packageRoot = join(extractRoot, "package");
    const packedManifest = readJson(join(packageRoot, "package.json"));
    const files = walkFiles(packageRoot);
    const fileSet = new Set(files.map((file) => file.path));
    const unpackedSize = files.reduce((sum, file) => sum + file.size, 0);
    const warnings = [];

    if (!packedManifest.description) warnings.push("missing description");
    if (!packedManifest.license) warnings.push("missing license");
    if (!files.some((file) => file.path.toLowerCase() === "readme.md")) warnings.push("missing README.md");
    for (const requiredFile of requiredPackedFiles[packedManifest.name] || []) {
      if (!fileSet.has(requiredFile)) {
        warnings.push(`missing required packed file ${requiredFile}`);
      }
    }
    warnings.push(...validateEntrypoints(packedManifest, files));
    warnings.push(...workspaceDependencyIssues(packedManifest));

    const sourceOnlyGroups = ["src", "tests", "scripts", "rust"].filter((group) => (
      files.some((file) => file.path === group || file.path.startsWith(`${group}/`))
    ));
    if (sourceOnlyGroups.length > 0) {
      warnings.push(`tarball includes ${sourceOnlyGroups.join(", ")}`);
    }

    results.push({
      name: packedManifest.name,
      version: packedManifest.version,
      dir: relative(workspaceRoot, dir),
      tarballSize,
      unpackedSize,
      fileCount: files.length,
      warnings,
      summary: summarizeFiles(files),
    });
  }

  console.log("# Package Preflight\n");
  console.log(`Generated from ${relative(workspaceRoot, process.cwd()) || "."} with ${results.length} publishable packages.\n`);
  console.log("| Package | Version | Packed | Unpacked | Files | Status |");
  console.log("| --- | --- | ---: | ---: | ---: | --- |");
  for (const result of results) {
    const status = result.warnings.length > 0 ? `warn: ${result.warnings.join("; ")}` : "ok";
    console.log(`| ${result.name} | ${result.version} | ${bytes(result.tarballSize)} | ${bytes(result.unpackedSize)} | ${result.fileCount} | ${status} |`);
  }

  for (const result of results) {
    console.log(`\n## ${result.name}`);
    console.log(`\nDirectory: \`${result.dir}\``);
    console.log(`Packed size: ${bytes(result.tarballSize)}; unpacked size: ${bytes(result.unpackedSize)}; files: ${result.fileCount}.`);
    if (result.warnings.length > 0) {
      console.log(`Warnings: ${result.warnings.join("; ")}.`);
    } else {
      console.log("Warnings: none.");
    }
    console.log("\nLargest groups:");
    for (const [group, size] of result.summary.groups) {
      console.log(`- \`${group}\`: ${bytes(size)}`);
    }
    console.log("\nLargest files:");
    for (const file of result.summary.files) {
      console.log(`- \`${file.path}\`: ${bytes(file.size)}`);
    }
  }
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
