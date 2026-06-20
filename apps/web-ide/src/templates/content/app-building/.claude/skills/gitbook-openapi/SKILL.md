---
name: gitbook-openapi
description: Author GitBook-compatible Markdown and OpenAPI-backed API documentation for plans, chats, README files, and generated docs. Use whenever writing Markdown that includes API contracts, endpoint behavior, request/response examples, or implementation plans.
---

# GitBook OpenAPI Authoring

Use this skill whenever you write Markdown for an agent chat, plan, README, generated documentation, or API contract.

## Required Format

- Write GitBook-compatible Markdown only.
- Prefer GitBook template blocks for rich structure: hints, tabs, steppers, code blocks with titles, and OpenAPI operation blocks.
- Use OpenAPI 3.1 as the source of truth for endpoint behavior.
- Every implementation plan must include an `API Contract` section.
- If the task touches an HTTP route, RPC endpoint, fetch call, server action, database-backed API, or request/response shape, include an OpenAPI 3.1 spec for the affected surface.
- If the task has no API impact, include a minimal OpenAPI 3.1 spec with `paths: {}` and an `x-notes.noApiChanges` explanation.

## Operation Blocks

For endpoint docs, wrap the operation in a GitBook block so the editor and chat can render it as a rich API reference.

````md
{% openapi-operation spec="todo-api" %}
{% code title="openapi.yaml" lineNumbers="true" %}
```yaml
openapi: 3.1.0
info:
  title: Todo API
  version: 1.0.0
servers:
  - url: https://api.example.com
paths:
  /todos/{id}:
    patch:
      operationId: toggleTodo
      summary: Toggle todo completion
      description: Flips a todo item between complete and incomplete.
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
          description: Todo ID.
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required:
                - completed
              properties:
                completed:
                  type: boolean
                  description: Current completion state.
      responses:
        "200":
          description: Todo completion status toggled.
          content:
            application/json:
              schema:
                type: object
                properties:
                  id:
                    type: integer
                    description: Todo ID.
                  completed:
                    type: boolean
                    description: Updated completion state.
        "404":
          description: Todo not found.
```
{% endcode %}
{% endopenapi-operation %}
````

## Planning Rules

- Start plans with goals, non-goals, assumptions, and an `API Contract` section.
- Put the OpenAPI spec before implementation steps so frontend and backend agents share the same contract.
- Keep operation summaries and descriptions human-readable; the renderer uses them as visible GitBook headings and descriptions.
- Include schemas, request bodies, response status codes, and error responses.
- Add examples with `example` or `examples` in the OpenAPI spec when sample payloads matter.
- Do not paste OpenAPI YAML as an unrelated response example; it must be inside an `openapi-operation` block or a titled `openapi.yaml` code block.
