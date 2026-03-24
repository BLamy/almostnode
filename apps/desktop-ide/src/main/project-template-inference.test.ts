import { describe, expect, it } from 'vitest';
import {
  inferTemplateIdFromProjectFiles,
  inferTitleFromProjectFiles,
  normalizeTemplateId,
  titleFromProjectPath,
} from './project-template-inference';

function createReader(files: Record<string, string>) {
  return (projectPath: string) => files[projectPath] ?? null;
}

describe('project template inference', () => {
  it('normalizes supported template ids', () => {
    expect(normalizeTemplateId('vite')).toBe('vite');
    expect(normalizeTemplateId('nextjs')).toBe('nextjs');
    expect(normalizeTemplateId('tanstack')).toBe('tanstack');
    expect(normalizeTemplateId('unknown')).toBeNull();
  });

  it('infers nextjs and tanstack projects from files and dependencies', () => {
    expect(
      inferTemplateIdFromProjectFiles(
        ['/project/app/page.tsx'],
        createReader({}),
      ),
    ).toBe('nextjs');

    expect(
      inferTemplateIdFromProjectFiles(
        ['/project/package.json'],
        createReader({
          '/project/package.json': JSON.stringify({
            dependencies: {
              '@tanstack/react-router': '^1.0.0',
            },
          }),
        }),
      ),
    ).toBe('tanstack');
  });

  it('falls back to vite and derives readable project titles', () => {
    expect(
      inferTemplateIdFromProjectFiles(
        ['/project/src/main.tsx', '/project/package.json'],
        createReader({
          '/project/package.json': JSON.stringify({ name: '@scope/my_saved-app' }),
        }),
      ),
    ).toBe('vite');

    expect(
      inferTitleFromProjectFiles(
        'Fallback Title',
        createReader({
          '/project/package.json': JSON.stringify({ name: '@scope/my_saved-app' }),
        }),
      ),
    ).toBe('my saved app');

    expect(titleFromProjectPath('/tmp/almostnode-projects/reopened-demo')).toBe('reopened demo');
  });

  it('prefers persisted project metadata when present', () => {
    expect(
      inferTemplateIdFromProjectFiles(
        [],
        createReader({
          '/project/.almostnode/project.json': JSON.stringify({ templateId: 'nextjs' }),
        }),
      ),
    ).toBe('nextjs');
  });
});
