type WorkbenchTerminalKind = 'user' | 'preview' | 'agent';

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

function matchesSegment(command: string, patterns: RegExp[]): boolean {
  const normalized = normalizeCommandSegment(command);
  if (!normalized) {
    return false;
  }

  return patterns.some((pattern) => pattern.test(normalized));
}

export function matchesClaudeLaunchCommand(command: string): boolean {
  const patterns = [
    /^(?:\.\/)?(?:node_modules\/\.bin\/)?claude(?:\s|$)/,
    /^npx(?:\s+[-\w=]+)*(?:\s+@anthropic-ai\/claude-code(?:\s+--dangerous-skip-permissions-check)?|\s+claude)(?:\s|$)/,
    /^npm\s+exec(?:\s+(?:[-\w=]+|--))*(?:\s+@anthropic-ai\/claude-code|\s+claude)(?:\s|$)/,
  ];

  return command
    .split(/\s*(?:&&|\|\||;)\s*/)
    .some((segment) => matchesSegment(segment, patterns));
}

export function matchesOpenCodeLaunchCommand(command: string): boolean {
  const patterns = [
    /^(?:\.\/)?(?:node_modules\/\.bin\/)?opencode(?:\s|$)/,
    /^(?:\.\/)?(?:node_modules\/\.bin\/)?opencode-ai(?:\s|$)/,
    /^npx(?:\s+[-\w=]+)*(?:\s+opencode-ai|\s+opencode)(?:\s|$)/,
    /^npm\s+exec(?:\s+(?:[-\w=]+|--))*(?:\s+opencode-ai|\s+opencode)(?:\s|$)/,
  ];

  return command
    .split(/\s*(?:&&|\|\||;)\s*/)
    .some((segment) => matchesSegment(segment, patterns));
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
