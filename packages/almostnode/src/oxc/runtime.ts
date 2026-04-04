import * as path from "../shims/path";
import { parseJsoncObject } from "./jsonc";

export interface OxcFileAccessor {
  exists(path: string): boolean;
  readText(path: string): string | null;
}

export interface ResolvedOxcConfig {
  formatterConfigPath: string | null;
  formatterConfigText: string | null;
  linterConfigPath: string | null;
  linterConfigText: string | null;
}

export interface OxcDiagnostic {
  severity: "error" | "warning" | "info";
  message: string;
  start: number;
  end: number;
  helpMessage: string | null;
}

export interface RunOxcOnSourceOptions {
  filePath: string;
  sourceText: string;
  format?: boolean;
  lint?: boolean;
  formatterConfigText?: string | null;
  linterConfigText?: string | null;
}

export interface RunOxcOnSourceResult {
  formattedText: string | null;
  diagnostics: OxcDiagnostic[];
}

type OxcBindingModule = {
  Oxc: new () => {
    formattedText: string;
    formatterFormattedText: string;
    getDiagnostics(): unknown[];
    run(sourceText: string, options: unknown): void;
  };
};

interface RawOxcDiagnostic {
  severity?: string;
  message: string;
  helpMessage?: string | null;
  labels?: Array<{ start: number; end: number }>;
}

const FORMATTER_CONFIG_NAMES = [
  "oxfmtrc.json",
  "oxfmtrc.jsonc",
  ".oxfmtrc",
  ".oxfmtrc.json",
  ".oxfmtrc.jsonc",
] as const;

const LINTER_CONFIG_NAMES = [
  "oxlintrc.json",
  "oxlintrc.jsonc",
  ".oxlintrc",
  ".oxlintrc.json",
  ".oxlintrc.jsonc",
] as const;

const SUPPORTED_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

let oxcBindingPromise: Promise<OxcBindingModule> | null = null;

function isNodeLikeEnvironment(): boolean {
  return typeof process !== "undefined" && !!process.versions?.node && typeof window === "undefined";
}

async function loadOxcBinding(): Promise<OxcBindingModule> {
  if (isNodeLikeEnvironment()) {
    const { getOxcNodeBinding } = await import("./node-binding");
    const mod = await getOxcNodeBinding();
    return {
      Oxc: mod.exports.Oxc as OxcBindingModule["Oxc"],
    };
  }

  const { getOxcBrowserBinding } = await import("./browser-binding");
  const binding = await getOxcBrowserBinding();
  return {
    Oxc: binding.exports.Oxc,
  };
}

async function getOxcBinding(): Promise<OxcBindingModule> {
  oxcBindingPromise ??= loadOxcBinding();
  return oxcBindingPromise;
}

function normalizeAbsolutePath(filePath: string): string {
  if (!filePath) {
    return "/";
  }
  if (path.isAbsolute(filePath)) {
    return path.normalize(filePath);
  }
  return path.normalize(`/${filePath}`);
}

function findNearestConfigPath(
  accessor: OxcFileAccessor,
  startingDirectory: string,
  candidateNames: readonly string[],
): string | null {
  let currentDirectory = normalizeAbsolutePath(startingDirectory);

  while (true) {
    for (const candidateName of candidateNames) {
      const candidatePath = path.join(currentDirectory, candidateName);
      if (accessor.exists(candidatePath)) {
        return candidatePath;
      }
    }

    const parentDirectory = path.dirname(currentDirectory);
    if (parentDirectory === currentDirectory) {
      return null;
    }
    currentDirectory = parentDirectory;
  }
}

function resolveSeverity(input: string | undefined): OxcDiagnostic["severity"] {
  switch ((input || "").toLowerCase()) {
    case "error":
      return "error";
    case "warning":
      return "warning";
    default:
      return "info";
  }
}

function isRawOxcDiagnostic(value: unknown): value is RawOxcDiagnostic {
  if (!value || typeof value !== "object") {
    return false;
  }

  return typeof (value as Partial<RawOxcDiagnostic>).message === "string";
}

export function isSupportedOxcPath(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

export function resolveOxcParserExtension(filePath: string): string {
  const extension = path.extname(filePath).toLowerCase();
  switch (extension) {
    case ".jsx":
      return "jsx";
    case ".tsx":
      return "tsx";
    case ".ts":
    case ".mts":
    case ".cts":
      return "ts";
    default:
      return "js";
  }
}

export function resolveOxcConfigForFile(
  accessor: OxcFileAccessor,
  filePath: string,
): ResolvedOxcConfig {
  const absoluteFilePath = normalizeAbsolutePath(filePath);
  const startingDirectory = path.dirname(absoluteFilePath);
  const formatterConfigPath = findNearestConfigPath(accessor, startingDirectory, FORMATTER_CONFIG_NAMES);
  const linterConfigPath = findNearestConfigPath(accessor, startingDirectory, LINTER_CONFIG_NAMES);

  return {
    formatterConfigPath,
    formatterConfigText: formatterConfigPath ? accessor.readText(formatterConfigPath) : null,
    linterConfigPath,
    linterConfigText: linterConfigPath ? accessor.readText(linterConfigPath) : null,
  };
}

export function formatOxcDiagnosticsForTerminal(
  filePath: string,
  sourceText: string,
  diagnostics: OxcDiagnostic[],
): string {
  if (diagnostics.length === 0) {
    return "";
  }

  const lineStarts = [0];
  for (let index = 0; index < sourceText.length; index += 1) {
    if (sourceText[index] === "\n") {
      lineStarts.push(index + 1);
    }
  }

  const offsetToPosition = (offset: number): { line: number; column: number } => {
    const safeOffset = Math.max(0, Math.min(offset, sourceText.length));
    let line = 0;
    while (line + 1 < lineStarts.length && lineStarts[line + 1]! <= safeOffset) {
      line += 1;
    }
    return {
      line: line + 1,
      column: safeOffset - lineStarts[line]! + 1,
    };
  };

  return diagnostics
    .map((diagnostic) => {
      const position = offsetToPosition(diagnostic.start);
      const suffix = diagnostic.helpMessage ? ` (${diagnostic.helpMessage})` : "";
      return `${filePath}:${position.line}:${position.column}: ${diagnostic.severity}: ${diagnostic.message}${suffix}`;
    })
    .join("\n");
}

export async function runOxcOnSource(
  options: RunOxcOnSourceOptions,
): Promise<RunOxcOnSourceResult> {
  const binding = await getOxcBinding();
  const oxc = new binding.Oxc();
  const formatterOptions = parseJsoncObject<Record<string, unknown>>(options.formatterConfigText);

  oxc.run(options.sourceText, {
    run: {
      lint: options.lint !== false,
      formatter: options.format !== false,
      transform: false,
      isolatedDeclarations: false,
      whitespace: false,
      compress: false,
      mangle: false,
      scope: false,
      symbol: false,
      cfg: false,
    },
    parser: {
      extension: resolveOxcParserExtension(options.filePath),
      allowReturnOutsideFunction: false,
      preserveParens: false,
      allowV8Intrinsics: false,
      semanticErrors: true,
    },
    linter: options.linterConfigText ? { config: options.linterConfigText } : {},
    formatter: formatterOptions ?? undefined,
  });

  const diagnostics = (oxc.getDiagnostics() || [])
    .filter(isRawOxcDiagnostic)
    .map((diagnostic) => {
      const firstLabel = diagnostic.labels?.[0];
      return {
        severity: resolveSeverity(diagnostic.severity),
        message: diagnostic.message,
        start: firstLabel?.start ?? 0,
        end: firstLabel?.end ?? firstLabel?.start ?? 0,
        helpMessage: diagnostic.helpMessage ?? null,
      } satisfies OxcDiagnostic;
    });

  const rawFormattedText = oxc.formatterFormattedText || oxc.formattedText || "";

  return {
    formattedText: options.format === false ? null : rawFormattedText,
    diagnostics: options.lint === false ? [] : diagnostics,
  };
}
