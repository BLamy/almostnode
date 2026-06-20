/**
 * Pure helpers for translating OpenCode process-bridge invocations
 * (command + argv) into shell command strings for the container terminal.
 */

export function quoteShellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function getShellCommandFromInvocation(
  command: string,
  args: string[],
): string | null {
  const base = command.split("/").pop()?.toLowerCase() ?? command.toLowerCase();
  const normalizedBase = base.endsWith(".exe") ? base.slice(0, -4) : base;
  const isShell =
    normalizedBase === "sh" ||
    normalizedBase === "bash" ||
    normalizedBase === "zsh" ||
    normalizedBase === "fish" ||
    normalizedBase === "nu" ||
    normalizedBase === "cmd" ||
    normalizedBase === "powershell" ||
    normalizedBase === "pwsh";

  if (!isShell || args.length === 0) {
    return null;
  }

  if (normalizedBase === "bash" || normalizedBase === "zsh") {
    const script = args.at(-1);
    if (!script) {
      return null;
    }

    const evalMatch = /eval\s+("(?:(?:\\.|[^"])*)"|'(?:\\.|[^'])*')\s*$/s.exec(
      script,
    );
    if (!evalMatch) {
      return script;
    }

    const quotedCommand = evalMatch[1];
    if (quotedCommand.startsWith('"')) {
      try {
        return JSON.parse(quotedCommand) as string;
      } catch {
        return script;
      }
    }

    return quotedCommand.slice(1, -1);
  }

  const hasCommandFlag =
    args.includes("/c") ||
    args.includes("-Command") ||
    // POSIX shells accept -c combined with other single-letter flags
    // (e.g. `sh -lc <script>`). Pass the script through verbatim so it
    // isn't re-quoted and re-parsed lossily downstream.
    args.some((arg) => /^-[a-z]*c[a-z]*$/.test(arg));
  if (hasCommandFlag) {
    return args.at(-1) ?? null;
  }

  return null;
}
