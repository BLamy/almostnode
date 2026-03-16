import * as monaco from 'monaco-editor';
import type { TestMetadata } from './test-spec-generator';

const COMMAND_ID = 'almostnode.runTestFromCodeLens';
const TEST_PATTERN = /\btest\(\s*(['"`])(.+?)\1/g;

interface TestCodeLensOptions {
  getTests: () => TestMetadata[];
  onRunTest: (id: string) => void;
}

export function registerTestCodeLens(opts: TestCodeLensOptions): void {
  monaco.editor.registerCommand(COMMAND_ID, (_accessor, testId: string) => {
    opts.onRunTest(testId);
  });

  monaco.languages.registerCodeLensProvider(['typescript', 'typescriptreact'], {
    provideCodeLenses(model) {
      const uri = model.uri.path;
      const tests = opts.getTests();
      const knownPaths = new Set(tests.map((t) => t.specPath));

      if (!knownPaths.has(uri)) return { lenses: [], dispose() {} };

      const text = model.getValue();
      const lenses: monaco.languages.CodeLens[] = [];

      let match: RegExpExecArray | null;
      TEST_PATTERN.lastIndex = 0;
      while ((match = TEST_PATTERN.exec(text)) !== null) {
        const pos = model.getPositionAt(match.index);
        const range = {
          startLineNumber: pos.lineNumber,
          startColumn: 1,
          endLineNumber: pos.lineNumber,
          endColumn: 1,
        };

        const testName = match[2];
        const metadata = tests.find((t) => t.specPath === uri && t.name === testName);
        if (!metadata) continue;

        lenses.push({
          range,
          command: {
            id: COMMAND_ID,
            title: '\u25B6 Run Test',
            arguments: [metadata.id],
          },
        });

        if (metadata.status === 'passed' || metadata.status === 'failed') {
          lenses.push({
            range,
            command: {
              id: '',
              title: metadata.status === 'passed' ? '\u2705 Passed' : '\u274C Failed',
            },
          });
        }
      }

      return { lenses, dispose() {} };
    },
  });
}
