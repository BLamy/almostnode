import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { TemplateId } from './project-types';

const TEMPLATES_ROOT = fileURLToPath(new URL('../../../web-ide/src/templates/content', import.meta.url));
const SHARED_TEMPLATE_DIRECTORY = path.join(TEMPLATES_ROOT, '_shared');
const PROJECT_METADATA_DIRECTORY = '.almostnode';
const PROJECT_METADATA_PATH = path.join(PROJECT_METADATA_DIRECTORY, 'project.json');

function walkFiles(directoryPath: string): string[] {
  const entries = fs.readdirSync(directoryPath, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolutePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

function copyTreeIntoDirectory(sourceDirectory: string, targetDirectory: string): void {
  if (!fs.existsSync(sourceDirectory)) {
    return;
  }

  for (const absoluteSourcePath of walkFiles(sourceDirectory)) {
    const relativePath = path.relative(sourceDirectory, absoluteSourcePath);
    if (!relativePath || relativePath === 'template.json') {
      continue;
    }

    const absoluteTargetPath = path.join(targetDirectory, relativePath);
    if (fs.existsSync(absoluteTargetPath)) {
      continue;
    }

    fs.mkdirSync(path.dirname(absoluteTargetPath), { recursive: true });
    fs.copyFileSync(absoluteSourcePath, absoluteTargetPath);
  }
}

export function seedProjectDirectoryFromTemplate(
  projectDirectory: string,
  templateId: TemplateId,
): void {
  const absoluteProjectDirectory = path.resolve(projectDirectory);
  fs.mkdirSync(absoluteProjectDirectory, { recursive: true });

  copyTreeIntoDirectory(SHARED_TEMPLATE_DIRECTORY, absoluteProjectDirectory);
  copyTreeIntoDirectory(path.join(TEMPLATES_ROOT, templateId), absoluteProjectDirectory);

  const metadataPath = path.join(absoluteProjectDirectory, PROJECT_METADATA_PATH);
  if (!fs.existsSync(metadataPath)) {
    fs.mkdirSync(path.dirname(metadataPath), { recursive: true });
    fs.writeFileSync(metadataPath, JSON.stringify({ templateId }, null, 2), 'utf8');
  }
}

export function getWorkspaceTemplatesRootForTesting(): string {
  return TEMPLATES_ROOT;
}

export function createTemporaryProjectDirectoryForTesting(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'almostnode-template-seed-'));
}
