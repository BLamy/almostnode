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

export function isNetlifyLoginCommand(command: string): boolean {
  if (/(?:&&|\|\||;)/.test(command)) {
    return false;
  }

  const normalized = normalizeCommandSegment(command);
  if (!normalized) {
    return false;
  }

  const tokens = tokenizeCommand(normalized);
  if (tokens.length < 2) {
    return false;
  }

  const executable = normalizeExecutableToken(tokens[0] ?? '');
  if (executable !== 'netlify') {
    return false;
  }

  return tokens[1] === 'login';
}
