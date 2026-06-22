#!/usr/bin/env bash
# Stage 1b/1c: rename almostnode-sdk -> @agent-wasm/sdk, almostnode-react ->
# @agent-wasm/react, codex-wasm -> @agent-wasm/codex.
# Anchored to import/alias contexts so it never touches the /codex-wasm/ asset
# URL, the packages/codex-wasm/ dir paths, or string-literal test data.
set -euo pipefail
cd /Users/brettlamy/Dev/almostnode

echo "== rewriting import specifiers + vi.mock + find: aliases =="
rg -l "(from|import|require\(|vi\.mock\(|import\(|find:)\s*['\"](almostnode-sdk(/auth)?|almostnode-react|codex-wasm(/(cli|app-server)-browser-worker)?)['\"]" \
   -g '!node_modules' -g '!dist' apps packages scripts | while IFS= read -r f; do
  perl -0pi -e '
    for my $ctx ("from", "import", "require\\(", "import\\(", "vi\\.mock\\(", "find:") {
      s{(\b$ctx\s*)(["'"'"'])almostnode-sdk/auth\2}{$1$2\@agent-wasm/sdk/auth$2}g;
      s{(\b$ctx\s*)(["'"'"'])almostnode-sdk\2}{$1$2\@agent-wasm/sdk$2}g;
      s{(\b$ctx\s*)(["'"'"'])almostnode-react\2}{$1$2\@agent-wasm/react$2}g;
      s{(\b$ctx\s*)(["'"'"'])codex-wasm/cli-browser-worker\2}{$1$2\@agent-wasm/codex/cli-browser-worker$2}g;
      s{(\b$ctx\s*)(["'"'"'])codex-wasm/app-server-browser-worker\2}{$1$2\@agent-wasm/codex/app-server-browser-worker$2}g;
      s{(\b$ctx\s*)(["'"'"'])codex-wasm\2}{$1$2\@agent-wasm/codex$2}g;
    }
  ' "$f"
  echo "  $f"
done

echo "== package.json names =="
perl -0pi -e 's{"name":\s*"almostnode-sdk"}{"name": "\@agent-wasm/sdk"}'   packages/almostnode-sdk/package.json
perl -0pi -e 's{"name":\s*"almostnode-react"}{"name": "\@agent-wasm/react"}' packages/almostnode-react/package.json
perl -0pi -e 's{"name":\s*"codex-wasm"}{"name": "\@agent-wasm/codex"}'       packages/codex-wasm/package.json

echo "== package.json dependency keys =="
rg -l '"(almostnode-sdk|almostnode-react|codex-wasm)":\s*"workspace' apps packages --glob 'package.json' | while IFS= read -r pj; do
  perl -0pi -e '
    s{"almostnode-sdk"(\s*:\s*"workspace)}{"\@agent-wasm/sdk"$1}g;
    s{"almostnode-react"(\s*:\s*"workspace)}{"\@agent-wasm/react"$1}g;
    s{"codex-wasm"(\s*:\s*"workspace)}{"\@agent-wasm/codex"$1}g;
  ' "$pj"
  echo "  $pj"
done

echo "== verify no stray import-context occurrences =="
rg -n "(from|import|require\(|vi\.mock\(|import\(|find:)\s*['\"](almostnode-sdk|almostnode-react|codex-wasm)" \
   -g '!node_modules' -g '!dist' apps packages scripts && echo "  !! STRAY" || echo "  (clean)"
