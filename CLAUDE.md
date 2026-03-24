# almostnode

## What This Is

almostnode is a **real competitor to WebContainers (StackBlitz)**. It runs Node.js natively in the browser — virtual filesystem, npm package installation, dev servers, the works.

## Monorepo Structure

This is an **Nx monorepo** with two projects:

```
almostnode/
├── packages/almostnode/     # npm-publishable library
│   ├── src/                 # Library source code
│   ├── tests/               # Unit tests (~2250)
│   ├── e2e/                 # Library E2E tests
│   ├── examples/            # Demo HTML files + entry scripts
│   └── docs/                # Documentation pages
└── apps/web-ide/            # Web IDE application (private)
    ├── src/
    │   ├── workbench/       # Workbench host + surfaces
    │   ├── extensions/      # Monaco extension services
    │   ├── features/        # Keychain, test-runner, VFS provider, etc.
    │   ├── plugins/         # Vite plugins (workspace-templates, reference-apps)
    │   └── templates/       # Workspace templates (vite, nextjs, tanstack)
    ├── tests/               # Web IDE unit tests
    └── e2e/                 # Web IDE E2E tests
```

## Core Principle

**Never write library-specific shim code. Fix the platform instead.**

When a package doesn't work, the fix goes into the generic shims (fs, path, crypto, etc.), not into a package-specific adapter. Every demo should use real npm packages installed via `PackageManager`, served via `/_npm/` bundling, and running through the standard runtime. No CDN shortcuts, no manual protocol reimplementations, no fake adapters.

## Architecture

### Library (`packages/almostnode/`)

- **Runtime** (`src/runtime.ts`) — JS execution engine with `require()`, ESM-to-CJS transforms, 43 built-in module shims
- **VirtualFS** (`src/virtual-fs.ts`) — In-memory filesystem, exposed as `require('fs')`
- **PackageManager** (`src/npm/`) — Real npm packages downloaded, extracted, ESM-to-CJS transformed via esbuild-wasm
- **Service Worker** — Network interception for HTTP servers (`/__virtual__/{port}/`)
- **Dev Servers** — `NextDevServer` (Pages + App Router), `ViteDevServer` (React + HMR)
- **just-bash** — Bash emulator with custom commands (`node`, `npm`, `convex`)
- **Code Transforms** (`src/frameworks/code-transforms.ts`) — CSS Modules (css-tree AST), ESM-to-CJS (acorn AST), React Refresh, npm import redirect

#### Next.js Dev Server (split across files)

- `src/frameworks/next-dev-server.ts` — Orchestrator (~1360 lines)
- `src/frameworks/next-route-resolver.ts` — Route resolution (~600 lines)
- `src/frameworks/next-api-handler.ts` — API route handlers (~350 lines)
- `src/frameworks/next-shims.ts` — Shim string constants (~1040 lines)
- `src/frameworks/next-html-generator.ts` — HTML page generation (~560 lines)
- `src/frameworks/next-config-parser.ts` — next.config.js parsing (AST + regex fallback)

### Web IDE (`apps/web-ide/`)

The web IDE imports the library via `"almostnode": "workspace:*"`. Internal-only exports (e.g. `createNodeError`, `PlaywrightCommandListener`) use `from 'almostnode/internal'`.

## Commands

```bash
# Root workspace commands
pnpm nx serve-examples almostnode   # Dev server for library examples (port 5173)
pnpm nx dev web-ide                 # Dev server for web IDE
pnpm nx run-many -t test            # Run all unit tests
pnpm nx run-many -t build           # Build all projects
pnpm nx run-many -t e2e             # Run all E2E tests

# Library-specific
pnpm nx build almostnode            # Build library (ESM + CJS)
pnpm nx build-types almostnode      # Generate type declarations
pnpm nx test almostnode             # Run library unit tests
pnpm nx e2e almostnode              # Run library E2E tests
pnpm nx type-check almostnode       # Type check library

# Web IDE-specific
pnpm nx dev web-ide                 # Start web IDE dev server
pnpm nx build web-ide               # Build web IDE for production
pnpm nx test web-ide                # Run web IDE unit tests
pnpm nx e2e web-ide                 # Run web IDE E2E tests
```

## Testing

- Library unit tests: `packages/almostnode/tests/`, run with `pnpm nx test almostnode`
- Library E2E tests: `packages/almostnode/e2e/`, run with `pnpm nx e2e almostnode`
- Web IDE unit tests: `apps/web-ide/tests/`, run with `pnpm nx test web-ide`
- Web IDE E2E tests: `apps/web-ide/e2e/`, run with `pnpm nx e2e web-ide`
- Test harnesses live in `packages/almostnode/examples/` (HTML files with VFS setup)

## Key Technical Details

- **`/_npm/` endpoint**: Bundles npm packages from VFS as ESM for browser consumption via esbuild
- **`/_next/route-info`**: Server endpoint returning resolved route info (page, layouts, params) — used by client-side navigation
- **Virtual prefix**: `/__virtual__/{port}/` — all imports go through this for service worker interception
- **`isBrowser` flag**: In test env (jsdom), `isBrowser=false` — transforms run differently
- **ESM-to-CJS**: Happens both at install time (esbuild-wasm) and at runtime (in `loadModule()`)
- **Route groups**: `(groupName)` directories are transparent in URLs, resolved server-side

## Where to Find More Context

- **`README.md`** — Public API docs, usage examples, comparison with WebContainers, sandbox setup
- **`CHANGELOG.md`** — Version history and what changed
- **`packages/almostnode/examples/`** — Working demo HTML files (next-demo, vite-demo, express-demo, etc.)
- **`packages/almostnode/e2e/`** — Playwright E2E tests that exercise each demo

When working on a specific demo or feature, read the corresponding example HTML and E2E test first.

## Release Process

Always bump version in `packages/almostnode/package.json` and update `CHANGELOG.md` before pushing. Follow [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format, Semantic Versioning.
