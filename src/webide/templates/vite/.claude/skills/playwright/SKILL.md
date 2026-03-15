---
name: "playwright"
description: "Use when the task requires interacting with the preview iframe (navigation, form filling, snapshots, clicking, data extraction, UI-flow debugging) via the `playwright-cli` command."
---

# Playwright CLI Skill

Drive the preview iframe from the terminal using `playwright-cli`. This is a built-in command — no installation needed.

> [!NOTE]  
> You do not need to install playwright browser it's already installed

## Quick start

```bash
playwright-cli snapshot
playwright-cli click e3
playwright-cli fill e5 "hello world"
playwright-cli press Enter
playwright-cli eval "document.title"
```

## Core workflow

1. `playwright-cli snapshot` — get an accessibility tree with element refs.
2. Interact using refs from the latest snapshot.
3. Re-snapshot after navigation or significant DOM changes.

Minimal loop:

```bash
playwright-cli snapshot
playwright-cli click e3
playwright-cli snapshot
```

## When to snapshot again

Snapshot again after:
- Clicking elements that change the UI substantially
- Filling forms and submitting
- Any navigation

Refs can go stale. When a command fails due to a missing ref, snapshot again.

## Recommended patterns

### Form fill and submit

```bash
playwright-cli snapshot
playwright-cli fill e1 "user@example.com"
playwright-cli fill e2 "password123"
playwright-cli click e3
playwright-cli snapshot
```

### Evaluate page state

```bash
playwright-cli eval "document.title"
playwright-cli eval "document.querySelectorAll('li').length"
```

### Check console output

```bash
playwright-cli console
playwright-cli console error
```

## Taking screenshots

```bash
playwright-cli screenshot
```

Captures the preview as PNG at `/tmp/screenshot.png`. Read the file to see the page visually.
Custom path: `playwright-cli screenshot /project/debug.png`

## References

- CLI command reference: `references/cli.md`
- Practical workflows: `references/workflows.md`

## Guardrails

- Always snapshot before referencing element refs like `e12`.
- Re-snapshot when refs seem stale.
- Prefer explicit commands over `eval` unless needed.
