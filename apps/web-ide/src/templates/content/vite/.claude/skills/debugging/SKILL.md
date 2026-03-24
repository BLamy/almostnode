# Debugging Knowledge Base

## Pre-Debugging Triage

Before reaching for any tool, do these three things:

1. **Read the error message** — Really read it. Most errors tell you exactly what's wrong (file path, line number, expected vs actual type). Don't skip to tools.
2. **Classify the failure** — Use the table below to pick the right approach.
3. **Check infrastructure first** — Is the dev server running? Did migrations apply? Is PGlite initialized? Many "bugs" are just setup issues.

## Failure Classification

| Symptom | First Check | Tool | Rule File |
|---------|------------|------|-----------|
| Component won't render / blank page | Console errors, import paths | `playwright-cli console error` | [component-rendering.md](rules/component-rendering.md) |
| Stale data / wrong state | Re-render triggers, useEffect deps | `playwright-cli snapshot` | [react-state.md](rules/react-state.md) |
| Form not working | Controlled vs uncontrolled, handlers | `playwright-cli snapshot` | [forms-and-inputs.md](rules/forms-and-inputs.md) |
| DB query returns wrong results | Schema vs migrations, query logic | `pg "\d tablename"` | [data-issues.md](rules/data-issues.md) |
| Timeout / loading forever | PGlite init, esbuild bundling | `playwright-cli console error` | [timeouts.md](rules/timeouts.md) |
| Network request fails | Service worker, CORS, /_npm/ | `playwright-cli network` | [network-and-api.md](rules/network-and-api.md) |

## When NOT to Use Replay

**80%+ of issues are diagnosable from error output alone.** Skip Replay for:

- Import errors (the console tells you exactly what's missing)
- TypeScript type errors (read the error message)
- Missing database tables (check if migrations ran)
- Obvious logic bugs (wrong variable, typo, off-by-one)
- CSS/layout issues (use screenshot, not recording)

**Use Replay when:**

- The bug involves timing (race conditions, async ordering)
- State changes in unexpected ways between renders
- The issue is intermittent or hard to reproduce
- You need to see the exact sequence of events leading to a failure
- Console errors don't explain the behavior

## Cluster-Aware Debugging

When multiple tests or features fail at once:

1. **Don't debug them individually** — Find the shared root cause first
2. **Look for common infrastructure**: Did a migration fail? Is a shared component broken? Is a hook returning wrong data?
3. **Fix the root cause, then re-verify** — Most of the "individual" failures will resolve

## Debugging Rules

Detailed patterns for specific failure categories:

- [React State & Effects](rules/react-state.md) — useEffect races, stale closures, dirty flags
- [Timeouts & Timing](rules/timeouts.md) — PGlite init, esbuild delays, service worker timing
- [Component Rendering](rules/component-rendering.md) — Mount failures, blank pages, empty DOM
- [Data Issues](rules/data-issues.md) — PGlite queries, migration state, data contamination
- [Forms & Inputs](rules/forms-and-inputs.md) — Controlled components, submission, validation
- [Network & API](rules/network-and-api.md) — Service worker, /_npm/ bundling, CORS

## Quick Diagnostic Commands

```bash
# Is the app even running?
playwright-cli console error

# What does the user see?
playwright-cli snapshot

# Is the database set up?
pg "\dt"

# Are there network failures?
playwright-cli network

# What's the visual state?
playwright-cli screenshot
```
