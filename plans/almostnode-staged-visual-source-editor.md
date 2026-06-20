# Almostnode Staged Visual Source Editor Plan

## Summary

Build a staged full visual editor for almostnode by combining TanStack Devtools'
deterministic `data-tsd-source` model with Impeccable's review/apply UX. The
editor should not copy Impeccable's project-file script injection or
agent-mediated patching for v1. Almostnode already owns the preview iframe, VFS,
and HMR path, so source edits should be deterministic parser patches applied
through the existing VFS provider.

References:

- [TanStack Source Inspector](https://tanstack.com/devtools/latest/docs/source-inspector)
- [TanStack Architecture](https://tanstack.com/devtools/latest/docs/architecture)
- [TanStack inject-source.ts](https://raw.githubusercontent.com/TanStack/devtools/main/packages/devtools-vite/src/inject-source.ts)
- [Impeccable README](https://github.com/pbakaus/impeccable)
- [Impeccable live-browser.js](https://raw.githubusercontent.com/pbakaus/impeccable/main/skill/scripts/live-browser.js)
- [Impeccable live-server.mjs](https://raw.githubusercontent.com/pbakaus/impeccable/main/skill/scripts/live-server.mjs)

## Key Changes

- Add a dev-only JSX metadata pass before esbuild in
  `packages/almostnode/src/frameworks/vite-dev-server.ts`. Inject
  `data-tsd-source="file:line:column"` plus `data-child-source` for literal
  children, expression children, and simple loop/value-source metadata.
- Use browser-bundlable parser tooling. Add explicit dependencies on
  `@babel/parser`, `@babel/traverse`, `@babel/types`, and `magic-string`.
  Avoid `oxc-parser` for v1 because TanStack's Node/Vite plugin model does not
  match almostnode's browser-hosted dev server.
- Extend the existing iframe bridge in
  `apps/web-ide/src/workbench/workbench-host.ts` into a visual-editor bridge
  instead of mutating the user app entry file.
- Add an `Edit` toolbar mode beside the current preview controls in
  `apps/web-ide/src/workbench/workbench-surfaces.ts`.
- Define an internal `VisualEditOp` postMessage contract with these staged ops:
  `text`, `attribute`, `style`, `delete`, `insert`, and `move`.
- Require every op to include source anchors, original values, target path,
  source hash, and enough rollback data for preview-only DOM mutation.
- Keep edits staged in the host, with dirty count, review list, discard, and
  apply. Browser preview mutates optimistically after host ack; source is
  untouched until Apply.
- Refresh or navigation invalidates uncommitted staged edits unless the user
  discards or applies them.
- On Apply, group ops by source file, parse current source, resolve anchors by
  `data-tsd-source` and child metadata, compute all file outputs first, then
  write all-or-nothing through `VfsFileSystemProvider.writeFile()`.
- Preserve read-only sandbox behavior and let existing VFS/HMR refresh the
  preview after source writes.

## Operation Behavior

- `text`: update literal JSX text directly when `data-child-source` identifies
  the exact child. For simple array/object literal backing data, update the
  backing value when the metadata identifies a unique source value.
- `attribute`: update simple JSX attributes such as `className`, `id`, `title`,
  and string-valued props. Reject computed spreads and ambiguous expression
  props in v1.
- `style`: update inline style object literals and class-like style strings when
  the source target is exact. Do not infer Tailwind class rewrites from visual
  CSS properties in v1.
- `delete`: remove a JSX element only when the source anchor resolves to a
  unique JSX element.
- `insert`: insert a JSX snippet before, after, or inside a source-anchored
  element. Imports must be declared in the op and applied in the same file pass.
- `move`: represent as one delete plus one insert in a single staged batch, with
  both anchors validated before any file is written.

Loop behavior for v1:

- Structural, style, and prop edits on mapped JSX apply to the template and
  therefore all rendered instances.
- Per-instance text edits only apply when `data-child-source` resolves a simple
  backing array/object literal.
- Unsupported per-instance edits remain staged as failed ops and expose an
  open-source action instead of guessing.

## Interfaces

Metadata attributes:

- `data-tsd-source`: canonical element source location, compatible with
  TanStack naming.
- `data-child-source`: JSON metadata for editable literal/expression children
  and simple collection-backed values.
- `data-almostnode-edit-id`: stable hash of file, line, column, tag, and child
  index for staging and rollback only.

Internal apply success result:

```ts
{
  ok: true;
  writes: Array<{
    path: string;
    beforeHash: string;
    afterHash: string;
  }>;
}
```

Internal apply failure result:

```ts
{
  ok: false;
  errors: Array<{
    opId: string;
    type: "TargetNotFound" | "StaleSource" | "UnsupportedEdit" | "ReadOnly";
    message: string;
  }>;
}
```

Do not add a public almostnode API in v1. Keep the editor bridge and op schema
internal until the operation model stabilizes.

## Test Plan

- Unit test metadata injection for TSX/JSX, fragments, existing attributes,
  spreads, ignored files, literal text, expression text, and `.map()` cases.
- Unit test source apply for text edits, className/style/prop updates, insert
  before/after/inside, move, delete, imports, stale source conflicts, and
  all-or-nothing failure.
- Workbench tests for staged queue behavior: preview mutation, discard rollback,
  apply success, apply failure, and read-only fork-request path.
- E2E test a seeded Vite app in web-ide: enable Edit, stage multiple visual
  changes, apply, assert Monaco/VFS source changes and iframe HMR reflects
  committed source.
- Run:

```bash
pnpm nx test almostnode
pnpm nx test web-ide
pnpm nx e2e web-ide
pnpm nx build almostnode
pnpm nx build web-ide
```

## Assumptions

- Target almostnode's web-ide React/Vite preview first.
- Next and non-React frameworks come after the Vite path is stable.
- Staged apply means source writes happen only when the user clicks Apply, not
  after each edit.
- Agent-mediated patching is intentionally out of v1. It can be added later as a
  fallback for unsupported edits, but not as the primary sync path.
