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
    expect(fs.existsSync(path.join(projectDirectory, '.claude-plugin', 'plugin.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectDirectory, '.claude-plugin', '.lsp.json'))).toBe(true);
    expect(fs.existsSync(path.join(projectDirectory, 'AGENTS.md'))).toBe(true);
    expect(fs.existsSync(path.join(projectDirectory, '.opencode', 'opencode.jsonc'))).toBe(true);
    expect(fs.existsSync(path.join(projectDirectory, '.opencode', 'agent', 'frontend-engineer.md'))).toBe(true);
    expect(fs.readFileSync(path.join(projectDirectory, '.almostnode', 'project.json'), 'utf8')).toContain('"templateId": "vite"');

    const claudeSettings = fs.readFileSync(
      path.join(projectDirectory, '.claude', 'settings.json'),
      'utf8',
    );
    const claudePlugin = fs.readFileSync(
      path.join(projectDirectory, '.claude-plugin', '.lsp.json'),
      'utf8',
    );
    const opencodeConfig = fs.readFileSync(
      path.join(projectDirectory, '.opencode', 'opencode.jsonc'),
      'utf8',
    );
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(projectDirectory, 'package.json'), 'utf8'),
    ) as {
      devDependencies?: Record<string, string>;
    };

    expect(claudeSettings).toContain('.claude/hooks/task-git.sh');
    expect(claudeSettings).toContain('Bash(almostnode-lsp-bridge *)');
    expect(claudePlugin).toContain('"command": "almostnode-lsp-bridge"');
    expect(claudePlugin).toContain('"tsgo"');
    expect(opencodeConfig).toContain('"command": ["almostnode-lsp-bridge", "oxlint"]');
    expect(opencodeConfig).toContain('"command": ["almostnode-lsp-bridge", "tsgo"]');
    expect(packageJson.devDependencies?.oxfmt).toBe('^0.43.0');
    expect(packageJson.devDependencies?.oxlint).toBe('^1.58.0');
    expect(packageJson.devDependencies?.['@typescript/native-preview']).toBe('^7.0.0-dev.20260401.1');
    expect(packageJson.devDependencies?.['tsgo-wasm']).toBe('^2026.4.2');
  });

  it('points at a real templates root in this workspace', () => {
    expect(fs.existsSync(getWorkspaceTemplatesRootForTesting())).toBe(true);
  });
});
