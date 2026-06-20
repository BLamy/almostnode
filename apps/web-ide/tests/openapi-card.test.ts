import { describe, expect, it } from 'vitest';
import { parseMarkdown, type OpenApiOperationNode } from '@brett_lamy/docstream';

function parseOperation(markdown: string): OpenApiOperationNode {
  const operation = parseMarkdown(markdown).children.find(
    (block): block is OpenApiOperationNode => block.type === 'openapi-operation',
  );
  if (!operation) throw new Error('OpenAPI operation was not parsed');
  return operation;
}

describe('docstream OpenAPI operation parsing', () => {
  it('preserves the packaged operation fields', () => {
    const operation = parseOperation([
      '{% openapi-operation spec="petstore" method="get" path="/store/orders" %}',
      '[Petstore API](https://petstore.example.com/openapi.yaml)',
      '{% endopenapi-operation %}',
    ].join('\n'));

    expect(operation.spec).toBe('petstore');
    expect(operation.method).toBe('get');
    expect(operation.path).toBe('/store/orders');
    expect(operation.specUrl).toBe('https://petstore.example.com/openapi.yaml');
    expect(operation.label).toBe('Petstore API');
  });

  it('supports the legacy openapi tag alias', () => {
    const operation = parseOperation([
      '{% openapi method="patch" path="/todos/{id}" %}',
      '[Todo API](https://api.example.com/openapi.yaml)',
      '{% endopenapi %}',
    ].join('\n'));

    expect(operation.spec).toBe('');
    expect(operation.method).toBe('patch');
    expect(operation.path).toBe('/todos/{id}');
    expect(operation.specUrl).toBe('https://api.example.com/openapi.yaml');
    expect(operation.label).toBe('Todo API');
  });
});
