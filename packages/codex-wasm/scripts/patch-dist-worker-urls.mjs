import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const distRoot = resolve(new URL("..", import.meta.url).pathname, "dist");
const files = [
  "app-server-browser-session.js",
  "cli-browser-session.js",
  "index.js",
];

const replacements = [
  ["./app-server-browser-worker.ts", "./app-server-browser-worker.js"],
  ["./cli-browser-worker.ts", "./cli-browser-worker.js"],
];

for (const file of files) {
  const path = resolve(distRoot, file);
  let source;
  try {
    source = readFileSync(path, "utf8");
  } catch {
    continue;
  }

  let next = source;
  for (const [from, to] of replacements) {
    next = next.split(from).join(to);
  }

  if (next !== source) {
    writeFileSync(path, next);
  }
}
