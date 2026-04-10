type WorkbenchTerminalKind = 'user' | 'preview' | 'agent';

export interface OpenCodeLaunchArgs {
  continue?: boolean;
  sessionID?: string;
  fork?: boolean;
}

const OPEN_CODE_LAUNCH_PATTERNS = [
  /^(?:\.\/)?(?:node_modules\/\.bin\/)?opencode(?:\s|$)/,
  /^(?:\.\/)?(?:node_modules\/\.bin\/)?opencode-ai(?:\s|$)/,
  /^npx(?:\s+[-\w=]+)*(?:\s+opencode-ai|\s+opencode)(?:\s|$)/,
  /^npm\s+exec(?:\s+(?:[-\w=]+|--))*(?:\s+opencode-ai|\s+opencode)(?:\s|$)/,
];

const CLAUDE_LAUNCH_PATTERNS = [
  /^(?:\.\/)?(?:node_modules\/\.bin\/)?claude(?:\s|$)/,
  /^(?:\.\/|\/usr\/local\/bin\/)?claude-wrapper(?:\s|$)/,
  /^npx(?:\s+[-\w=]+)*(?:\s+@anthropic-ai\/claude-code(?:\s+--dangerous-skip-permissions-check)?|\s+claude)(?:\s|$)/,
  /^npm\s+exec(?:\s+(?:[-\w=]+|--))*(?:\s+@anthropic-ai\/claude-code|\s+claude)(?:\s|$)/,
];

function normalizeCommandSegment(segment: string): string {
  let normalized = segment.trim();

  while (normalized) {
    const withoutEnvAssignments = normalized.replace(
      /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*/,
      '',
    );
    if (withoutEnvAssignments !== normalized) {
      normalized = withoutEnvAssignments.trimStart();
      continue;
    }

    const withoutPrefix = normalized.replace(/^(?:env|command|time)\s+/, '');
    if (withoutPrefix !== normalized) {
      normalized = withoutPrefix.trimStart();
      continue;
    }

    break;
  }

  return normalized;
}

function findMatchingSegment(command: string, patterns: RegExp[]): string | null {
  for (const segment of command.split(/\s*(?:&&|\|\||;)\s*/)) {
    const normalized = normalizeCommandSegment(segment);
    if (!normalized) {
      continue;
    }

    if (patterns.some((pattern) => pattern.test(normalized))) {
      return normalized;
    }
  }

  return null;
}

function matchesSegment(command: string, patterns: RegExp[]): boolean {
  return findMatchingSegment(command, patterns) !== null;
}

function unquoteToken(token: string): string {
  if (
    (token.startsWith('"') && token.endsWith('"'))
    || (token.startsWith("'") && token.endsWith("'"))
  ) {
    return token.slice(1, -1);
  }

  return token;
}

function tokenizeCommand(command: string): string[] {
  return (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map(unquoteToken);
}

function normalizeExecutableToken(token: string): string {
  const base = token.split('/').pop()?.toLowerCase() ?? token.toLowerCase();
  return base.endsWith('.exe') ? base.slice(0, -4) : base;
}

function findLaunchCommandIndex(tokens: string[]): number {
  if (tokens.length === 0) {
    return -1;
  }

  const first = normalizeExecutableToken(tokens[0]!);
  if (first === 'npx') {
    for (let index = 1; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (token === '--') {
        continue;
      }
      if (!token.startsWith('-')) {
        return index;
      }
    }
    return -1;
  }

  if (first === 'npm' && tokens[1] === 'exec') {
    for (let index = 2; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      if (token === '--') {
        continue;
      }
      if (!token.startsWith('-')) {
        return index;
      }
    }
    return -1;
  }

  return 0;
}

export function parseOpenCodeLaunchCommand(command: string): OpenCodeLaunchArgs | null {
  const segment = findMatchingSegment(command, OPEN_CODE_LAUNCH_PATTERNS);
  if (!segment) {
    return null;
  }

  const tokens = tokenizeCommand(segment);
  const commandIndex = findLaunchCommandIndex(tokens);
  if (commandIndex === -1) {
    return {};
  }

  const args: OpenCodeLaunchArgs = {};
  for (let index = commandIndex + 1; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === '--') {
      continue;
    }
    if (token === '--continue' || token === '-c') {
      args.continue = true;
      continue;
    }
    if (token === '--fork') {
      args.fork = true;
      continue;
    }
    if (token.startsWith('--session=')) {
      const value = token.slice('--session='.length);
      if (value) {
        args.sessionID = value;
      }
      continue;
    }
    if (token === '--session' || token === '-s') {
      const value = tokens[index + 1];
      if (value) {
        args.sessionID = value;
        index += 1;
      }
    }
  }

  return args;
}

export function matchesClaudeLaunchCommand(command: string): boolean {
  return command
    .split(/\s*(?:&&|\|\||;)\s*/)
    .some((segment) => matchesSegment(segment, CLAUDE_LAUNCH_PATTERNS));
}

export function matchesOpenCodeLaunchCommand(command: string): boolean {
  return matchesSegment(command, OPEN_CODE_LAUNCH_PATTERNS);
}

export function matchesShadcnLaunchCommand(command: string): boolean {
  const patterns = [
    /^(?:\.\/)?(?:node_modules\/\.bin\/)?shadcn(?:\s|$)/,
    /^npx(?:\s+[-\w=]+)*(?:\s+shadcn(?:@latest)?)(?:\s|$)/,
    /^npm\s+exec(?:\s+(?:[-\w=]+|--))*(?:\s+shadcn(?:@latest)?)(?:\s|$)/,
  ];

  return command
    .split(/\s*(?:&&|\|\||;)\s*/)
    .some((segment) => matchesSegment(segment, patterns));
}

function hasClaudeMcpConfigArg(tokens: string[]): boolean {
  return tokens.some(
    (token) => token === '--mcp-config' || token.startsWith('--mcp-config='),
  );
}

export function augmentClaudeLaunchCommand(
  command: string,
  mcpConfigJson: string,
  quoteShellArg: (value: string) => string,
): string {
  if (!command.trim()) {
    return command;
  }

  const parts = command.split(/(\s*(?:&&|\|\||;)\s*)/);
  let changed = false;

  for (let index = 0; index < parts.length; index += 2) {
    const segment = parts[index];
    if (!segment) {
      continue;
    }

    const normalized = normalizeCommandSegment(segment);
    if (
      !normalized ||
      !CLAUDE_LAUNCH_PATTERNS.some((pattern) => pattern.test(normalized))
    ) {
      continue;
    }

    const tokens = tokenizeCommand(segment);
    const commandIndex = findLaunchCommandIndex(tokens);
    if (commandIndex === -1 || hasClaudeMcpConfigArg(tokens)) {
      continue;
    }

    parts[index] = `${segment}${segment.endsWith(' ') ? '' : ' '}--mcp-config ${quoteShellArg(mcpConfigJson)}`;
    changed = true;
  }

  return changed ? parts.join('') : command;
}

export function shouldRunWorkbenchCommandInteractively(
  command: string,
  terminalKind: WorkbenchTerminalKind,
): boolean {
  if (terminalKind === 'agent') {
    return true;
  }

  if (terminalKind === 'preview') {
    return false;
  }

  return matchesClaudeLaunchCommand(command)
    || matchesOpenCodeLaunchCommand(command)
    || matchesShadcnLaunchCommand(command);
}
