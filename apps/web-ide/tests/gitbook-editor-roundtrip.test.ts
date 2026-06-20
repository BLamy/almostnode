import { describe, expect, it } from 'vitest';
import { parseMarkdown, serializeMarkdown } from '@brett_lamy/docstream';
import {
  astToTiptap,
  tiptapToAst,
  type PMNode,
} from '@brett_lamy/docstream-editor';

/** markdown → AST → TipTap JSON → AST → markdown */
function roundTrip(markdown: string): string {
  const tiptap = astToTiptap(parseMarkdown(markdown)) as PMNode;
  return serializeMarkdown(tiptapToAst(tiptap));
}

describe('gitbook editor markdown round-trip', () => {
  it('preserves basic GFM constructs', () => {
    const md = [
      '# Title',
      '',
      'A paragraph with **bold**, _italic_, ~~strike~~, `code`, and [a link](https://example.com).',
      '',
      '## Lists',
      '',
      '- one',
      '- two',
      '',
      '1. first',
      '2. second',
      '',
      '> A quote',
      '',
      '---',
      '',
      '| Col A | Col B |',
      '| ----- | ----- |',
      '| 1     | 2     |',
    ].join('\n');

    const out = roundTrip(md);
    // Serialization may normalize whitespace; a second pass must be stable.
    expect(roundTrip(out)).toBe(out);
    expect(out).toContain('# Title');
    expect(out).toContain('**bold**');
    expect(out).toContain('[a link](https://example.com)');
    expect(out).toContain('Col A');
  });

  it('preserves GitBook hint blocks', () => {
    const md = [
      '{% hint style="warning" %}',
      'Careful now.',
      '{% endhint %}',
    ].join('\n');

    const out = roundTrip(md);
    expect(out).toContain('{% hint style="warning" %}');
    expect(out).toContain('Careful now.');
    expect(out).toContain('{% endhint %}');
  });

  it('preserves GitBook tabs', () => {
    const md = [
      '{% tabs %}',
      '{% tab title="npm" %}',
      'npm install',
      '{% endtab %}',
      '{% tab title="pnpm" %}',
      'pnpm add',
      '{% endtab %}',
      '{% endtabs %}',
    ].join('\n');

    const out = roundTrip(md);
    expect(out).toContain('{% tab title="npm" %}');
    expect(out).toContain('pnpm add');
  });

  it('preserves code blocks with metadata', () => {
    const md = [
      '```ts',
      'const x = 1;',
      '```',
    ].join('\n');

    const out = roundTrip(md);
    expect(out).toContain('```ts');
    expect(out).toContain('const x = 1;');
  });

  it('preserves packaged OpenAPI operation blocks', () => {
    const md = [
      '{% openapi-operation spec="petstore" method="get" path="/store/orders" %}',
      '[Petstore API](https://petstore.example.com/openapi.yaml)',
      '{% endopenapi-operation %}',
    ].join('\n');

    const out = roundTrip(md);
    expect(out).toContain('spec="petstore"');
    expect(out).toContain('method="get"');
    expect(out).toContain('path="/store/orders"');
    expect(out).toContain('[Petstore API](https://petstore.example.com/openapi.yaml)');
    expect(roundTrip(out)).toBe(out);
  });

  it('is stable across repeated round-trips', () => {
    const md = '# Hello\n\nSome *content* here.\n';
    const once = roundTrip(md);
    expect(roundTrip(once)).toBe(once);
  });
});
