import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createTemporaryProjectDirectoryForTesting,
  getWorkspaceTemplatesRootForTesting,
  seedProjectDirectoryFromTemplate,
} from './project-template-seed';

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop();
    if (!directory) continue;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('seedProjectDirectoryFromTemplate', () => {
  it('copies shared and template files into the managed host project directory', () => {
    const projectDirectory = createTemporaryProjectDirectoryForTesting();
    temporaryDirectories.push(projectDirectory);

    seedProjectDirectoryFromTemplate(projectDirectory, 'vite');

    expect(fs.existsSync(path.join(projectDirectory, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectDirectory, 'src', 'App.tsx'))).toBe(true);
    expect(fs.existsSync(path.join(projectDirectory, '.vscode', 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectDirectory, '.claude', 'settings.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectDirectory, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(projectDirectory, '.opencode', 'opencode.jsonc'))).toBe(true);
    expect(fs.existsSync(path.join(projectDirectory, '.opencode', 'agent', 'frontend-engineer.md'))).toBe(true);
    expect(fs.readFileSync(path.join(projectDirectory, '.almostnode', 'project.json'), 'utf8')).toContain('"templateId": "vite"');
  });

  it('points at a real templates root in this workspace', () => {
    expect(fs.existsSync(getWorkspaceTemplatesRootForTesting())).toBe(true);
  });
});
