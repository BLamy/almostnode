# Timeouts & Timing Issues

## PGlite Initialization

PGlite (in-browser PostgreSQL) takes 1-3 seconds to initialize on first load. Any database query before initialization completes will fail silently or throw.

**Symptom:** App loads but data is empty. Queries work on refresh.

**Fix:** Gate all database access on the ready state.

```tsx
const { db, isReady } = useDB();

if (!isReady) return <Loading />;

// Now safe to query
const data = await db.select().from(todos);
```

**Never do this:**
```tsx
// BAD — queries fire before PGlite is ready
useEffect(() => {
  db.select().from(todos).then(setData);
}, []); // db might not be initialized yet
```

## esbuild-wasm Bundling Delays

The first `npm install` or `/_npm/` request triggers esbuild-wasm initialization, which can take 3-5 seconds. Subsequent bundles are fast.

**Symptom:** First page load after install takes much longer than expected.

**This is normal behavior.** Don't add loading indicators for it — it only happens once per session.

## Service Worker Registration Timing

The service worker that intercepts `/__virtual__/{port}/` requests takes a moment to register. Requests made before registration will fail.

**Symptom:** First request after page load returns 404 or network error, but works on retry.

**Diagnosis:**
```bash
playwright-cli network           # Look for failed requests to /__virtual__/
playwright-cli console error     # Look for service worker errors
```

## Anti-Pattern: setTimeout Fixes

**Never fix a timing bug with setTimeout.** It hides the real issue and creates flaky behavior.

```tsx
// BAD — hides the real problem
useEffect(() => {
  setTimeout(() => {
    db.select().from(todos).then(setData);
  }, 2000); // "give it time to initialize"
}, []);

// GOOD — wait for the actual ready signal
const { db, isReady } = useDB();
useEffect(() => {
  if (!isReady) return;
  db.select().from(todos).then(setData);
}, [isReady]);
```

**The right fix is always to wait for the correct signal:**
- PGlite → wait for `isReady`
- Service worker → wait for `navigator.serviceWorker.ready`
- Async data → use loading states and cleanup flags

## Diagnosis Checklist

1. **When does it fail?** Only on first load? After a specific action? Intermittently?
2. **Does refresh fix it?** If yes, it's likely an initialization timing issue.
3. **Is there a ready signal being ignored?** Check if the code gates on `isReady`, `isLoading`, or similar flags.
4. **Are there setTimeout/setInterval calls?** These are often masking real timing bugs.
