import * as React from 'react';

// @brett_lamy/docstream currently ships TSX source. In some dependency-transform
// paths (and in tests) that source compiles to bare React.createElement calls,
// so ensure a global React is present before importing it.
(globalThis as typeof globalThis & { React?: typeof React }).React ??= React;

export { MarkdownContent } from '@brett_lamy/docstream';
