# Playwright CLI Reference

Built-in command for interacting with the preview iframe. No installation needed.

## Core

```bash
playwright-cli snapshot
playwright-cli click e3
playwright-cli fill e5 "user@example.com"
playwright-cli type "search terms"
playwright-cli press Enter
playwright-cli hover e4
playwright-cli eval "document.title"
playwright-cli console
playwright-cli console warning
playwright-cli resize 1920 1080
playwright-cli screenshot
playwright-cli screenshot /project/debug.png
playwright-cli close
playwright-cli network
playwright-cli cookie-list
playwright-cli cookie-list --domain myapp
playwright-cli cookie-get session_id
playwright-cli cookie-set name value
playwright-cli cookie-delete name
playwright-cli cookie-clear
playwright-cli localstorage-list
playwright-cli localstorage-get key
playwright-cli localstorage-set key value
playwright-cli localstorage-delete key
playwright-cli localstorage-clear
playwright-cli sessionstorage-list
playwright-cli sessionstorage-get key
playwright-cli sessionstorage-set key value
playwright-cli sessionstorage-delete key
playwright-cli sessionstorage-clear
```

## Navigation

```bash
playwright-cli open https://example.com
```

## Keyboard

```bash
playwright-cli press Enter
playwright-cli press ArrowDown
playwright-cli press Tab
playwright-cli press Escape
```

## Commands in detail

### snapshot
Builds an accessibility tree of the preview iframe. Assigns refs (e1, e2, ...) to interactive and text elements.

### click <ref>
Clicks an element by its ref. Scrolls into view first.

### fill <ref> <text>
Fills an input or textarea. Uses React-compatible native setter for controlled inputs.

### type <text>
Types text character-by-character into the currently focused element.

### press <key>
Dispatches keydown/keypress/keyup for the given key name.

### hover <ref>
Dispatches mouseover + mouseenter on the element.

### eval <expression>
Evaluates a JavaScript expression in the preview iframe's window context.

### console [level]
Shows captured console messages. Optional level filter: error, warning, info, debug.

### resize <width> <height>
Resizes the preview iframe to the given pixel dimensions.

### open <url>
Navigates the preview iframe to the given URL and waits for load.

### screenshot [path]
Captures the preview iframe as a PNG image. Default path: `/tmp/screenshot.png`. Read the file to see the page visually.

### network
Shows captured network requests (fetch and XHR). Each entry shows method, URL, status, duration, and size.

### cookie-list [--domain <filter>]
Lists all cookies in the preview iframe. Optional `--domain` filters by name substring.

### cookie-get <name>
Returns the value of a specific cookie.

### cookie-set <name> <value>
Sets a cookie with `path=/`.

### cookie-delete <name>
Deletes a cookie by expiring it.

### cookie-clear
Deletes all cookies.

### localstorage-list / sessionstorage-list
Lists all key-value pairs in localStorage or sessionStorage.

### localstorage-get / sessionstorage-get <key>
Returns the value for a specific storage key.

### localstorage-set / sessionstorage-set <key> <value>
Sets a key-value pair in storage.

### localstorage-delete / sessionstorage-delete <key>
Removes a key from storage.

### localstorage-clear / sessionstorage-clear
Clears all entries in the storage.

### close
Clears element ref map, console messages, and network requests.
