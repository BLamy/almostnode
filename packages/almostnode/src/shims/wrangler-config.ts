import type { VirtualFS } from '../virtual-fs';
import { parseJsoncObject } from '../oxc/jsonc';
import * as path from './path';

export interface WranglerProjectConfig {
  dev: {
    ip: string | null;
    localProtocol: 'http' | 'https' | null;
    port: number | null;
  };
  directory: string;
  format: 'json' | 'jsonc' | 'toml' | null;
  main: string | null;
  name: string | null;
  pagesBuildOutputDir: string | null;
  path: string | null;
  vars: Record<string, unknown>;
}

interface ParsedTomlSection {
  [key: string]: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function coerceString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function coercePort(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 65535) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
      return parsed;
    }
  }
  return null;
}

function stripTomlComment(line: string): string {
  let result = '';
  let quote: '"' | '\'' | null = null;
  let escaped = false;

  for (const char of line) {
    if (quote) {
      result += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\' && quote === '"') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      result += char;
      continue;
    }

    if (char === '#') {
      break;
    }

    result += char;
  }

  return result.trim();
}

function parseTomlString(rawValue: string): string {
  const trimmed = rawValue.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    if (trimmed.startsWith('"')) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed.slice(1, -1);
      }
    }
    return trimmed.slice(1, -1).replace(/''/g, '\'');
  }
  return trimmed;
}

function splitTomlArrayItems(rawValue: string): string[] {
  const trimmed = rawValue.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) {
    return [];
  }

  const values: string[] = [];
  let current = '';
  let quote: '"' | '\'' | null = null;
  let escaped = false;

  for (const char of trimmed.slice(1, -1)) {
    if (quote) {
      current += char;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === '\\' && quote === '"') {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === '"' || char === '\'') {
      quote = char;
      current += char;
      continue;
    }

    if (char === ',') {
      if (current.trim()) {
        values.push(current.trim());
      }
      current = '';
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    values.push(current.trim());
  }

  return values;
}

function parseTomlValue(rawValue: string): unknown {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return '';
  }
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"'))
    || (trimmed.startsWith('\'') && trimmed.endsWith('\''))
  ) {
    return parseTomlString(trimmed);
  }
  if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
    return splitTomlArrayItems(trimmed).map(parseTomlValue);
  }
  if (trimmed === 'true') {
    return true;
  }
  if (trimmed === 'false') {
    return false;
  }
  if (/^-?\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^-?\d+\.\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  return trimmed;
}

function parseTomlObject(source: string): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  let currentSection: string[] = [];

  const ensureSection = (segments: string[]): ParsedTomlSection => {
    let cursor: Record<string, unknown> = root;
    for (const segment of segments) {
      const next = isRecord(cursor[segment]) ? cursor[segment] as Record<string, unknown> : {};
      cursor[segment] = next;
      cursor = next;
    }
    return cursor;
  };

  for (const rawLine of source.split(/\r?\n/)) {
    const line = stripTomlComment(rawLine);
    if (!line) {
      continue;
    }

    if (line.startsWith('[') && line.endsWith(']')) {
      currentSection = line.slice(1, -1)
        .split('.')
        .map((segment) => parseTomlString(segment))
        .map((segment) => segment.trim())
        .filter(Boolean);
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/);
    if (!match) {
      continue;
    }

    const key = match[1];
    const value = parseTomlValue(match[2]);
    const target = ensureSection(currentSection);
    target[key] = value;
  }

  return root;
}

function readRawConfig(vfs: VirtualFS, filePath: string): string | null {
  if (!vfs.existsSync(filePath)) {
    return null;
  }
  try {
    return String(vfs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function mapConfig(
  raw: Record<string, unknown>,
  configPath: string,
  format: WranglerProjectConfig['format'],
): WranglerProjectConfig {
  const dev = isRecord(raw.dev) ? raw.dev : {};
  const vars = isRecord(raw.vars) ? raw.vars : {};

  return {
    path: configPath,
    directory: path.dirname(configPath),
    format,
    name: coerceString(raw.name),
    main: coerceString(raw.main),
    pagesBuildOutputDir: coerceString(raw.pages_build_output_dir),
    vars: { ...vars },
    dev: {
      port: coercePort(dev.port),
      ip: coerceString(dev.ip),
      localProtocol: dev.local_protocol === 'http' || dev.local_protocol === 'https'
        ? dev.local_protocol
        : null,
    },
  };
}

export function readWranglerConfig(vfs: VirtualFS, cwd: string): WranglerProjectConfig {
  const normalizedCwd = path.normalize(cwd || '/');
  const candidates: Array<{
    filePath: string;
    format: WranglerProjectConfig['format'];
    parse: (source: string) => Record<string, unknown> | null;
  }> = [
    {
      filePath: path.join(normalizedCwd, 'wrangler.jsonc'),
      format: 'jsonc',
      parse: (source) => parseJsoncObject<Record<string, unknown>>(source),
    },
    {
      filePath: path.join(normalizedCwd, 'wrangler.json'),
      format: 'json',
      parse: (source) => {
        try {
          return JSON.parse(source) as Record<string, unknown>;
        } catch {
          return null;
        }
      },
    },
    {
      filePath: path.join(normalizedCwd, 'wrangler.toml'),
      format: 'toml',
      parse: (source) => parseTomlObject(source),
    },
  ];

  for (const candidate of candidates) {
    const rawText = readRawConfig(vfs, candidate.filePath);
    if (rawText == null) {
      continue;
    }

    const parsed = candidate.parse(rawText);
    if (parsed) {
      return mapConfig(parsed, candidate.filePath, candidate.format);
    }
  }

  return {
    path: null,
    directory: normalizedCwd,
    format: null,
    name: null,
    main: null,
    pagesBuildOutputDir: null,
    vars: {},
    dev: {
      port: null,
      ip: null,
      localProtocol: null,
    },
  };
}

export function resolveWranglerPath(baseDir: string, candidate: string): string {
  return path.isAbsolute(candidate)
    ? path.normalize(candidate)
    : path.normalize(path.join(baseDir, candidate));
}

export function resolveWranglerWorkerEntry(
  vfs: VirtualFS,
  cwd: string,
  config = readWranglerConfig(vfs, cwd),
  explicitEntry?: string | null,
): string | null {
  const explicit = explicitEntry?.trim();
  if (explicit) {
    return resolveWranglerPath(cwd, explicit);
  }

  if (config.main) {
    return resolveWranglerPath(config.directory, config.main);
  }

  const candidates = [
    'src/index.ts',
    'src/index.tsx',
    'src/index.js',
    'src/index.jsx',
    'index.ts',
    'index.js',
    'worker.ts',
    'worker.js',
  ];

  for (const candidate of candidates) {
    const resolved = resolveWranglerPath(cwd, candidate);
    if (vfs.existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
}

export function resolveWranglerPagesDirectory(
  vfs: VirtualFS,
  cwd: string,
  config = readWranglerConfig(vfs, cwd),
  explicitDir?: string | null,
): string | null {
  const explicit = explicitDir?.trim();
  if (explicit) {
    return resolveWranglerPath(cwd, explicit);
  }

  if (config.pagesBuildOutputDir) {
    return resolveWranglerPath(config.directory, config.pagesBuildOutputDir);
  }

  const fallbackDirs = ['dist', 'build', 'public'];
  for (const candidate of fallbackDirs) {
    const resolved = resolveWranglerPath(cwd, candidate);
    if (vfs.existsSync(resolved)) {
      return resolved;
    }
  }

  return null;
}
