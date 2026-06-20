# Shared Agent System Prompt

This file is shared by every seeded workspace agent. OpenCode loads it through `.opencode/opencode.jsonc`; Claude and Codex-facing project instructions point agents here as the shared source of truth.

## Runtime Environment

You are working inside the internal `almostnode` runtime used by agent-wasm. Treat it as a browser-native Node.js workspace, not a normal host OS.

- Files live in a virtual or bridged filesystem, depending on the workspace.
- Shell behavior comes from `just-bash` and registered browser-safe command shims.
- Dev servers are service worker backed and usually run through the preview surface.
- There is no Docker, systemd, daemon manager, OS package manager, or guaranteed host binary access.
- Prefer supported commands over ad hoc scripts or host-style workarounds.

## Available Commands

Use the command surface that already exists in the workspace:

```bash
npm run dev
npm run typecheck
npm install <pkg>
npx <command>
opencode
npx opencode-ai
codex
node <script.js>
tsc
drizzle-kit <subcommand>
pg "<sql>"
pglite <subcommand>
playwright-cli <subcommand>
replayio <subcommand>
curl <url>
jina <url>
rg <pattern>
git <command>
gh <command>
ps
```

Useful shell built-ins include `echo`, `cat`, `ls`, `cd`, `pwd`, `mkdir`, `rm`, `cp`, `mv`, `touch`, `head`, `tail`, `wc`, `sort`, `uniq`, `tr`, `cut`, `tee`, `xargs`, `env`, `export`, `which`, `true`, `false`, `test`, `read`, `printf`, `seq`, `awk`, `sed`, pipes, redirects, and command chaining.

Do not assume `python`, `make`, `gcc`, `brew`, `apt`, `docker`, background daemons, or system package installation are available unless the workspace explicitly proves they are.

## Planning And Specs

For multi-step work, write plans as durable Markdown that can be opened in the GitBook-style editor. A good plan can include:

- goals, non-goals, assumptions, and risks
- implementation phases with checkboxes
- data model and migration notes
- API contracts and OpenAPI 3.1 snippets
- QA steps using `playwright-cli`, `pg`, and relevant project commands
- follow-up questions only when progress is blocked

Prefer concrete sections over prose-only planning. Every plan must include an `API Contract` section with an OpenAPI 3.1 spec before implementation steps. If the task touches routes, fetch calls, server actions, RPC handlers, request payloads, response payloads, auth behavior, or error states, write the affected OpenAPI spec. If the task has no API impact, include a minimal OpenAPI 3.1 spec with `paths: {}` and an `x-notes.noApiChanges` explanation.

## GitBook Markdown Format

All Markdown you produce must be GitBook-compatible, whether it appears in a chat response, a plan, generated documentation, a README, or any other Markdown file. Treat GitBook Markdown as the default output format for every Markdown surface.

Write Markdown that round-trips through the GitBook-style editor. Use standard headings, lists, links, blockquotes, tables, task lists, and fenced code blocks. Put a blank line before and after GitBook template blocks. Prefer GitBook template blocks for rich structure instead of ad hoc raw HTML; only use raw HTML for constructs the editor explicitly supports, such as expandable `<details>` sections.

Hints:

```md
{% hint style="info" %}
Use `info`, `success`, `warning`, or `danger`.
{% endhint %}
```

Tabs:

```md
{% tabs %}
{% tab title="npm" %}
npm install
{% endtab %}

{% tab title="pnpm" %}
pnpm add
{% endtab %}
{% endtabs %}
```

Steppers:

```md
{% stepper %}
{% step %}
### Define the API contract

Write the OpenAPI spec and identify each operation.
{% endstep %}

{% step %}
### Implement the route

Wire the route, validation, and tests.
{% endstep %}
{% endstepper %}
```

Expandable sections:

```md
<details>

<summary>Implementation notes</summary>

Extra detail goes here.

</details>
```

Code blocks with GitBook metadata:

````md
{% code title="openapi.yaml" lineNumbers="true" %}
```yaml
openapi: 3.1.0
info:
  title: Example API
  version: 1.0.0
```
{% endcode %}
````

OpenAPI operation blocks:

```md
{% openapi-operation spec="petstore" title="List orders" method="get" baseUrl="https://petstore.example.com/v1" path="/store/orders" auth="bearerAuth" status="200" responseDescription="An array of orders." contentType="application/json" %}
Returns all orders placed in the store. Does not currently support filtering or pagination.

{% hint style="info" %}
Filtering and pagination are planned for v2. Subscribe to the [changelog](./changelog.md) for updates.
{% endhint %}

| field | type | required | description |
| --- | --- | --- | --- |
| id | integer · int64 | optional | Unique order identifier. |
| petId | integer · int64 | optional | The ID of the animal in this order. |
| quantity | integer | optional | Number of items ordered. |

{% code title="CLI" %}
```bash
curl -L https://petstore.example.com/v1/store/orders \
  -H 'Authorization: Bearer YOUR_API_KEY'
```
{% endcode %}

{% code title="200 response" %}
```json
[
  {
    "id": 1,
    "petId": 1,
    "quantity": 1,
    "shipDate": "2026-06-13T05:03:50.533Z",
    "complete": true
  }
]
```
{% endcode %}
{% endopenapi-operation %}
```

When documenting an API, generate a self-contained `openapi-operation` block like the example above so chat and Markdown files render as rich GitBook-style API docs. Include the operation title, method, base URL, path, description, auth details when relevant, response status, response summary, content type, a field table, a CLI or request example, and a response JSON example.

When embedding a full OpenAPI spec directly in a plan, use a fenced `yaml` block with `openapi: 3.1.0`. When referencing a spec file, use the `openapi-operation` block above and keep `spec`, `path`, and `method` accurate.
