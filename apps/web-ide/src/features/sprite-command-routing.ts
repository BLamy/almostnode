export interface SpriteConsoleLaunchArgs {
  org?: string;
  sprite?: string;
  apiUrl?: string;
  cwd?: string;
}

export interface ParsedSpriteConsoleCommand {
  args: SpriteConsoleLaunchArgs;
  error?: string;
}

function normalizeCommandSegment(segment: string): string {
  let normalized = segment.trim();

  while (normalized) {
    const withoutEnvAssignments = normalized.replace(
      /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|[^\s]+)\s+)*/,
      "",
    );
    if (withoutEnvAssignments !== normalized) {
      normalized = withoutEnvAssignments.trimStart();
      continue;
    }

    const withoutPrefix = normalized.replace(/^(?:env|command|time)\s+/, "");
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
  const base = token.split("/").pop()?.toLowerCase() ?? token.toLowerCase();
  return base.endsWith(".exe") ? base.slice(0, -4) : base;
}

export function parseSpriteConsoleCommand(
  command: string,
): ParsedSpriteConsoleCommand | null {
  if (/(?:&&|\|\||;)/.test(command)) {
    return null;
  }

  const normalized = normalizeCommandSegment(command);
  if (!normalized) {
    return null;
  }

  const tokens = tokenizeCommand(normalized);
  if (tokens.length < 2) {
    return null;
  }

  if (normalizeExecutableToken(tokens[0]!) !== "sprite" || tokens[1] !== "console") {
    return null;
  }

  const args: SpriteConsoleLaunchArgs = {};

  for (let index = 2; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (token === "--") {
      break;
    }
    if (token === "-o" || token === "--org") {
      const value = tokens[index + 1];
      if (!value) {
        return { args, error: "missing value for --org" };
      }
      args.org = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--org=")) {
      args.org = token.slice("--org=".length);
      continue;
    }
    if (token === "-s" || token === "--sprite") {
      const value = tokens[index + 1];
      if (!value) {
        return { args, error: "missing value for --sprite" };
      }
      args.sprite = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--sprite=")) {
      args.sprite = token.slice("--sprite=".length);
      continue;
    }
    if (token === "--api-url") {
      const value = tokens[index + 1];
      if (!value) {
        return { args, error: "missing value for --api-url" };
      }
      args.apiUrl = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--api-url=")) {
      args.apiUrl = token.slice("--api-url=".length);
      continue;
    }
    if (token === "--dir") {
      const value = tokens[index + 1];
      if (!value) {
        return { args, error: "missing value for --dir" };
      }
      args.cwd = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--dir=")) {
      args.cwd = token.slice("--dir=".length);
      continue;
    }
    if (!args.sprite) {
      args.sprite = token;
      continue;
    }
    return {
      args,
      error: `unexpected argument '${token}'`,
    };
  }

  return { args };
}
