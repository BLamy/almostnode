import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';

function ok(stdout: string): JustBashExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function err(stderr: string, exitCode = 1): JustBashExecResult {
  return { stdout: '', stderr, exitCode };
}

interface JinaArgs {
  url: string | null;
  outputFile: string | null;
  silent: boolean;
  help: boolean;
}

function parseArgs(args: string[]): JinaArgs {
  const result: JinaArgs = {
    url: null,
    outputFile: null,
    silent: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
    } else if (arg === '-s' || arg === '--silent') {
      result.silent = true;
    } else if (arg === '-o' || arg === '--output') {
      result.outputFile = args[++i] || null;
    } else if (!arg.startsWith('-')) {
      result.url = arg;
    }
  }

  return result;
}

const HELP_TEXT = `Usage: jina [options] <url>

Fetch a URL as markdown via r.jina.ai

Options:
  -o, --output <file>  Write output to file
  -s, --silent         Silent mode (no progress)
  -h, --help           Show this help
`;

export async function runJinaCommand(
  args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const parsed = parseArgs(args);

  if (parsed.help) {
    return ok(HELP_TEXT);
  }

  if (!parsed.url) {
    return err('jina: missing URL argument\nUsage: jina [options] <url>\n');
  }

  let url = parsed.url;
  if (!/^https?:\/\//i.test(url)) {
    url = 'https://' + url;
  }

  const jinaUrl = `https://r.jina.ai/${url}`;

  let responseBody: string;
  try {
    const resp = await fetch(jinaUrl);
    if (!resp.ok) {
      return err(`jina: HTTP error ${resp.status} from r.jina.ai\n`);
    }
    responseBody = await resp.text();
  } catch (fetchErr: any) {
    return err(`jina: failed to fetch: ${fetchErr.message || fetchErr}\n`);
  }

  if (parsed.outputFile) {
    try {
      vfs.writeFileSync(parsed.outputFile, responseBody);
      if (!parsed.silent) {
        return ok(`Saved to ${parsed.outputFile}\n`);
      }
      return ok('');
    } catch (writeErr: any) {
      return err(`jina: failed to write output: ${writeErr.message || writeErr}\n`);
    }
  }

  return ok(responseBody);
}
