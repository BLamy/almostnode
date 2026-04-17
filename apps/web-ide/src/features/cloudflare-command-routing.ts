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

function normalizePackageToken(token: string): string {
  const lower = normalizeExecutableToken(token);
  return lower === 'wrangler' || lower.startsWith('wrangler@') ? 'wrangler' : lower;
}

function resolveWranglerTokens(tokens: string[]): string[] | null {
  const executable = normalizeExecutableToken(tokens[0] ?? '');
  if (executable === 'wrangler') {
    return tokens;
  }

  if (executable !== 'npx') {
    return null;
  }

  let index = 1;
  while (index < tokens.length) {
    const token = tokens[index] ?? '';
    if (!token) {
      return null;
    }

    if (token === '--') {
      index += 1;
      break;
    }

    if (token === '-y' || token === '--yes' || token === '--no') {
      index += 1;
      continue;
    }

    if (token === '-p' || token === '--package' || token === '-c' || token === '--call') {
      index += 2;
      continue;
    }

    if (
      token.startsWith('--package=')
      || token.startsWith('--call=')
      || token.startsWith('-p=')
      || token.startsWith('-c=')
    ) {
      index += 1;
      continue;
    }

    if (token.startsWith('-')) {
      index += 1;
      continue;
    }

    if (normalizePackageToken(token) === 'wrangler') {
      return ['wrangler', ...tokens.slice(index + 1)];
    }

    return null;
  }

  const commandToken = tokens[index];
  if (commandToken && normalizePackageToken(commandToken) === 'wrangler') {
    return ['wrangler', ...tokens.slice(index + 1)];
  }

  return null;
}

export function isCloudflareLoginCommand(command: string): boolean {
  if (/(?:&&|\|\||;)/.test(command)) {
    return false;
  }

  const normalized = normalizeCommandSegment(command);
  if (!normalized) {
    return false;
  }

  const wranglerTokens = resolveWranglerTokens(tokenizeCommand(normalized));
  if (!wranglerTokens || wranglerTokens.length < 2) {
    return false;
  }

  return wranglerTokens[1] === 'login'
    || (wranglerTokens[1] === 'auth' && wranglerTokens[2] === 'login');
}
