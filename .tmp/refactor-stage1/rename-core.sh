#!/usr/bin/env bash
# Stage 1a: rename `almostnode` package -> `@agent-wasm/core`.
# Import-context-anchored so it never touches: almostnode-sdk/-react, the
# `packages/almostnode/...` directory path strings, the /almostnode/ GH-pages
# base, or the /codex-wasm/ public asset URL.
set -euo pipefail
cd /Users/brettlamy/Dev/almostnode

echo "Rewriting import specifiers..."
rg -l "(from|import|require\()\s*['\"]almostnode(/(internal|vite|next))?['\"]" \
   -g '!node_modules' -g '!dist' -g '!*.md' \
   -g '!scripts/run-headscale-wasm-demo.ts' \
   apps packages scripts | while IFS= read -r f; do
  perl -0pi -e '
    s{(\bfrom\s+)(["'"'"'])almostnode(/(?:internal|vite|next))?\2}{$1$2\@agent-wasm/core$3$2}g;
    s{(\brequire\(\s*)(["'"'"'])almostnode(/(?:internal|vite|next))?\2}{$1$2\@agent-wasm/core$3$2}g;
    s{(\bimport\(\s*)(["'"'"'])almostnode(/(?:internal|vite|next))?\2}{$1$2\@agent-wasm/core$3$2}g;
    s{(\bimport\s+)(["'"'"'])almostnode(/(?:internal|vite|next))?\2}{$1$2\@agent-wasm/core$3$2}g;
  ' "$f"
  echo "  $f"
done

echo "Updating package.json dependency keys (almostnode -> @agent-wasm/core)..."
for pj in apps/desktop-ide/package.json apps/sdk-showcase/package.json \
          packages/opencode-mobile-runtime/package.json \
          packages/almostnode-sdk/package.json apps/web-ide/package.json; do
  perl -0pi -e 's{"almostnode"(\s*:\s*"workspace)}{"\@agent-wasm/core"$1}g' "$pj"
done

echo "Setting package name in packages/almostnode/package.json..."
perl -0pi -e 's{"name":\s*"almostnode"}{"name": "\@agent-wasm/core"}' packages/almostnode/package.json

echo "Verifying no stray bare 'almostnode' import specifiers remain:"
rg -n "(from|import|require\()\s*['\"]almostnode(/(internal|vite|next))?['\"]" \
   -g '!node_modules' -g '!dist' -g '!*.md' apps packages scripts && echo "  !! STRAY FOUND" || echo "  (none — clean)"
