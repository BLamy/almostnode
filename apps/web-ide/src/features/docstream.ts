import * as React from 'react';

// The published docstream packages currently expose TSX source. In Vitest and
// some dependency-transform paths that source can compile to React.createElement.
(globalThis as typeof globalThis & { React?: typeof React }).React ??= React;

export { GitbookStreamdown, MarkdownContent } from '@brett_lamy/docstream';
export { GitbookEditor } from '@brett_lamy/docstream-editor';
