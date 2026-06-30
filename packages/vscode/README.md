# @agent-wasm/vscode

Reusable VS Code-shaped shell primitives for agent-wasm harnesses.

Use this package when a host wants the same workspace VFS, command registry,
runtime panels, custom editors, and plugin contributions across Web IDE,
desktop, mobile, docs demos, or custom product shells.

```tsx
import { createWorkspace } from "@agent-wasm/sdk";
import { PluginRegistry } from "@agent-wasm/sdk/plugins";
import {
  VSCode,
  defineVSCodeCustomEditor,
  defineVSCodePanel,
} from "@agent-wasm/vscode";

const workspace = createWorkspace();
await workspace.ready;
const plugins = PluginRegistry.fromManifests([
  {
    id: "docs",
    vscode: {
      panels: {
        outline: { title: "Outline", location: "sidebar" },
      },
      customEditors: {
        markdownPreview: {
          displayName: "Markdown Preview",
          filePatterns: ["**/*.md"],
        },
      },
    },
  },
]);

export function App() {
  return (
    <VSCode
      workspace={workspace}
      plugins={plugins}
      panels={[
        defineVSCodePanel({
          id: "outline",
          title: "Outline",
          location: "sidebar",
          render({ container }) {
            container.textContent = "Plugin outline";
          },
        }),
      ]}
      customEditors={[
        defineVSCodeCustomEditor({
          id: "markdownPreview",
          displayName: "Markdown Preview",
          filePatterns: ["**/*.md"],
          render({ container, resource, workspace }) {
            container.textContent = workspace.readFile(resource);
          },
        }),
      ]}
    />
  );
}
```

The non-React `createVSCodeShell()` API owns the shared registry, command
registry, VFS file provider, file-pattern routing, and Playwright target
metadata for mounted custom editors.

## Public APIs

- **`<VSCode workspace plugins panels customEditors />`** — React wrapper that
  renders registered panels plus either a matching custom editor or the
  VFS-backed text fallback.
- **`createVSCodeShell()`** — non-React shell for harnesses that mount their own
  UI but still want contribution registration, command routing, file-pattern
  matching, and Playwright metadata.
- **`defineVSCodePanel()`** — helper for runtime panel definitions. Panels map
  to `sidebar`, `panel`, or `auxiliarybar`.
- **`defineVSCodeCustomEditor()`** — helper for file-pattern based editor
  definitions. Custom editors write through the same workspace VFS as agents.
- **`useVSCodeShell()`** — React hook for code rendered inside the wrapper.

## Plugin contributions

`@agent-wasm/vscode` consumes `PluginRegistry` from `@agent-wasm/sdk/plugins`.
Plugin manifests can contribute UI under:

```json
{
  "vscode": {
    "panels": {
      "designInspector": {
        "title": "Design Inspector",
        "location": "sidebar",
        "module": "./panels/design-inspector.tsx"
      }
    },
    "customEditors": {
      "schemaEditor": {
        "displayName": "Schema Editor",
        "filePatterns": ["**/*.schema.json"],
        "module": "./editors/schema-editor.tsx"
      }
    }
  }
}
```

The shell registers plugin panels and custom editors first, then host-provided
runtime definitions can override by id.

## Playwright targets

Every mounted custom editor root gets stable metadata:

- `data-agent-wasm-plugin-id`
- `data-agent-wasm-vscode-editor-id`
- `data-agent-wasm-resource`
- `data-testid`

Harnesses can expose that root to an agent with raw Playwright:

```ts
const shell = createVSCodeShell({ workspace, plugins });
const opened = shell.openResource("/project/schema.graph.json");

if (opened.kind === "customEditor") {
  const target = shell.getPlaywrightTarget({
    editorId: opened.customEditor.id,
    resource: opened.resource,
  });

  await page.locator(target!.selector).getByRole("button", { name: "Add" }).click();
}
```

This keeps the first AI/UI bridge simple: agents can operate against the real
custom editor DOM. A higher-level action DSL can be added later if raw
Playwright proves too brittle.
