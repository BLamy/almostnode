#!/bin/sh

set -eu

REPO_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"

if [ ! -d "$REPO_DIR/.git" ]; then
  exit 0
fi

cd "$REPO_DIR"

git add .

if [ -z "$(git status --short)" ]; then
  exit 0
fi

git commit -m "Complete task"

if git remote get-url origin >/dev/null 2>&1; then
  BRANCH="$(git branch --show-current 2>/dev/null || true)"
  if [ -n "$BRANCH" ]; then
    git push -u origin "$BRANCH"
  fi
fi
