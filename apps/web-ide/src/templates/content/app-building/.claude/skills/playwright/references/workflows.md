# Playwright CLI Workflows

Use `playwright-cli` to interact with the preview iframe. Snapshot often.

## Standard interaction loop

```bash
playwright-cli snapshot
playwright-cli click e3
playwright-cli snapshot
```

## Form submission

```bash
playwright-cli snapshot
playwright-cli fill e1 "user@example.com"
playwright-cli fill e2 "password123"
playwright-cli click e3
playwright-cli snapshot
```

## Data extraction

```bash
playwright-cli snapshot
playwright-cli eval "document.title"
playwright-cli eval "document.querySelector('h1').textContent"
```

## Debugging and inspection

Capture console messages after reproducing an issue:

```bash
playwright-cli console warning
playwright-cli console error
```

## Visual inspection

```bash
playwright-cli screenshot
# Then read /tmp/screenshot.png to see the page
```

## Quick smoke test after changes

Run these after any code change to catch obvious breakage:

```bash
playwright-cli console error
playwright-cli network
playwright-cli snapshot
```

If console errors appear or the snapshot is empty, something broke — delegate to the Debugging Engineer.

## Checking app state (cookies & storage)

```bash
playwright-cli cookie-list
playwright-cli localstorage-list
playwright-cli sessionstorage-list
```

## Troubleshooting

- If an element ref fails, run `playwright-cli snapshot` again and retry.
- If the preview is blank, make sure your dev server is running (`npm run dev`).
- Use `playwright-cli eval "location.href"` to check the current URL.
