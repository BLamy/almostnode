# Network & API Issues

## Service Worker Request Interception

All requests to `/__virtual__/{port}/` are intercepted by the service worker. If the service worker isn't registered or has stale routes, requests fail.

**Symptom:** 404 on page load, assets not loading, blank page.

**Diagnosis:**
```bash
playwright-cli network           # Look for failed /__virtual__/ requests
playwright-cli console error     # Service worker registration errors
```

**Common causes:**
- Service worker not yet registered (timing issue — see [timeouts.md](timeouts.md))
- Route not registered in the dev server
- Wrong port number in URL

## `/_npm/` Bundling Failures

The `/_npm/` endpoint bundles npm packages via esbuild-wasm for browser consumption. When bundling fails, imports break.

**Symptom:** Console error like "Failed to resolve import" or "Module not found" for an npm package.

**Diagnosis:**
```bash
playwright-cli console error     # Look for /_npm/ related errors
playwright-cli network           # Look for failed /_npm/ requests
```

**Common causes:**
1. **Package not installed** — Run `npm install <package>` first
2. **Package uses Node.js APIs** — Not all npm packages work in-browser. Packages that use `fs`, `net`, `child_process`, etc. won't work without shims.
3. **Circular dependency in package** — esbuild sometimes struggles with these. Check the console for cycle warnings.

## Don't Use fetch() for Database Access

In this environment, the database runs in-browser via PGlite. Don't use `fetch()` to hit API endpoints for data — query the database directly with Drizzle.

```tsx
// BAD — there's no backend server to handle this
const response = await fetch('/api/todos');
const data = await response.json();

// GOOD — query PGlite directly
import { db } from '../db';
import { todos } from '../db/schema';
const data = await db.select().from(todos);
```

**Exception:** External APIs (third-party services) still use `fetch()`, but be aware of CORS restrictions.

## CORS Restrictions

The app runs in a browser sandbox. External API requests may be blocked by CORS.

**Symptom:** Console error "Access to fetch at '...' has been blocked by CORS policy."

**Workarounds:**
1. Use APIs that support CORS (most public APIs do)
2. Use the `jina` command to proxy requests: `jina https://example.com/api`
3. Use `curl` from the shell (bypasses browser CORS since it runs outside the fetch API)

## Diagnosis Checklist

1. **Check network tab** — `playwright-cli network` shows all requests and their status
2. **Is it a /__virtual__/ failure?** — Service worker issue
3. **Is it a /_npm/ failure?** — Package not installed or can't be bundled
4. **Is it a fetch to /api/?** — Don't do this; use Drizzle directly
5. **Is it an external API?** — Check CORS headers
