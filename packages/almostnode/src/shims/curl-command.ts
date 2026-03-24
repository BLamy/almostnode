import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';

function ok(stdout: string): JustBashExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function err(stderr: string, exitCode = 1): JustBashExecResult {
  return { stdout: '', stderr, exitCode };
}

interface CurlArgs {
  url: string | null;
  method: string;
  headers: [string, string][];
  body: string | null;
  bodyFile: string | null;
  silent: boolean;
  includeHeaders: boolean;
  outputFile: string | null;
  verbose: boolean;
  followRedirects: boolean;
  failOnError: boolean;
  writeOut: string | null;
  help: boolean;
  version: boolean;
}

function parseArgs(args: string[]): CurlArgs {
  const result: CurlArgs = {
    url: null,
    method: 'GET',
    headers: [],
    body: null,
    bodyFile: null,
    silent: false,
    includeHeaders: false,
    outputFile: null,
    verbose: false,
    followRedirects: false,
    failOnError: false,
    writeOut: null,
    help: false,
    version: false,
  };

  let methodExplicit = false;
  let hasBody = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    // Long flags with = syntax
    if (arg.startsWith('--') && arg.includes('=')) {
      const eqIdx = arg.indexOf('=');
      const key = arg.slice(0, eqIdx);
      const val = arg.slice(eqIdx + 1);
      switch (key) {
        case '--request':
          result.method = val.toUpperCase();
          methodExplicit = true;
          break;
        case '--header':
          addHeader(result, val);
          break;
        case '--data':
          setBody(result, val);
          hasBody = true;
          break;
        case '--output':
          result.outputFile = val;
          break;
        case '--write-out':
          result.writeOut = val;
          break;
        default:
          break;
      }
      continue;
    }

    // Long flags
    if (arg.startsWith('--')) {
      switch (arg) {
        case '--help':
          result.help = true;
          break;
        case '--version':
          result.version = true;
          break;
        case '--silent':
          result.silent = true;
          break;
        case '--include':
          result.includeHeaders = true;
          break;
        case '--verbose':
          result.verbose = true;
          break;
        case '--location':
          result.followRedirects = true;
          break;
        case '--fail':
          result.failOnError = true;
          break;
        case '--request':
          result.method = (args[++i] || 'GET').toUpperCase();
          methodExplicit = true;
          break;
        case '--header':
          addHeader(result, args[++i] || '');
          break;
        case '--data':
          setBody(result, args[++i] || '');
          hasBody = true;
          break;
        case '--output':
          result.outputFile = args[++i] || null;
          break;
        case '--write-out':
          result.writeOut = args[++i] || null;
          break;
        default:
          break;
      }
      continue;
    }

    // Short flags
    if (arg.startsWith('-') && arg.length > 1) {
      // Check if it's a single flag that takes a value
      if (arg.length === 2) {
        switch (arg) {
          case '-X':
            result.method = (args[++i] || 'GET').toUpperCase();
            methodExplicit = true;
            continue;
          case '-H':
            addHeader(result, args[++i] || '');
            continue;
          case '-d':
            setBody(result, args[++i] || '');
            hasBody = true;
            continue;
          case '-o':
            result.outputFile = args[++i] || null;
            continue;
          case '-w':
            result.writeOut = args[++i] || null;
            continue;
          default:
            break;
        }
      }

      // Combined short flags (e.g. -sL, -siL) or single boolean flags
      const flags = arg.slice(1);
      let consumed = false;
      for (let j = 0; j < flags.length; j++) {
        const ch = flags[j];
        switch (ch) {
          case 's':
            result.silent = true;
            break;
          case 'i':
            result.includeHeaders = true;
            break;
          case 'v':
            result.verbose = true;
            break;
          case 'L':
            result.followRedirects = true;
            break;
          case 'f':
            result.failOnError = true;
            break;
          case 'X':
            result.method = (args[++i] || 'GET').toUpperCase();
            methodExplicit = true;
            consumed = true;
            break;
          case 'H':
            addHeader(result, args[++i] || '');
            consumed = true;
            break;
          case 'd':
            setBody(result, args[++i] || '');
            hasBody = true;
            consumed = true;
            break;
          case 'o':
            result.outputFile = args[++i] || null;
            consumed = true;
            break;
          case 'w':
            result.writeOut = args[++i] || null;
            consumed = true;
            break;
          default:
            break;
        }
        if (consumed) break;
      }
      continue;
    }

    // Positional argument = URL
    if (!result.url) {
      result.url = arg;
    }
  }

  // Auto-set POST when body is present and method wasn't explicitly set
  if (hasBody && !methodExplicit) {
    result.method = 'POST';
  }

  return result;
}

function addHeader(result: CurlArgs, headerStr: string): void {
  const colonIdx = headerStr.indexOf(':');
  if (colonIdx > 0) {
    result.headers.push([
      headerStr.slice(0, colonIdx).trim(),
      headerStr.slice(colonIdx + 1).trim(),
    ]);
  }
}

function setBody(result: CurlArgs, val: string): void {
  if (val.startsWith('@')) {
    result.bodyFile = val.slice(1);
  } else {
    result.body = val;
  }
}

function isLocalhost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
}

function formatResponseHeaders(statusCode: number, statusMessage: string, headers: Record<string, string>): string {
  const lines: string[] = [`HTTP/1.1 ${statusCode} ${statusMessage}`];
  for (const [key, value] of Object.entries(headers)) {
    lines.push(`${key}: ${value}`);
  }
  lines.push('');
  return lines.join('\r\n');
}

export async function runCurlCommand(
  args: string[],
  _ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const parsed = parseArgs(args);

  if (parsed.help) {
    return ok(HELP_TEXT);
  }

  if (parsed.version) {
    return ok('curl 8.0.0 (almostnode)\n');
  }

  if (!parsed.url) {
    return err('curl: no URL specified\ncurl: try \'curl --help\' for more information\n');
  }

  // Resolve body from file if needed
  let body = parsed.body;
  if (parsed.bodyFile) {
    try {
      const raw = vfs.readFileSync(parsed.bodyFile);
      body = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
    } catch {
      return err(`curl: (26) Failed to open/read local data from file '${parsed.bodyFile}'\n`);
    }
  }

  // Build headers record
  const headers: Record<string, string> = {};
  for (const [key, value] of parsed.headers) {
    headers[key] = value;
  }

  // Auto-set Content-Type for POST with body
  if (body && !headers['Content-Type'] && !headers['content-type']) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }

  try {
    let url: URL;
    try {
      // Add protocol if missing
      let rawUrl = parsed.url;
      if (!rawUrl.match(/^https?:\/\//)) {
        rawUrl = 'http://' + rawUrl;
      }
      url = new URL(rawUrl);
    } catch {
      return err(`curl: (3) URL rejected: ${parsed.url}\n`);
    }

    let statusCode: number;
    let statusMessage: string;
    let responseHeaders: Record<string, string>;
    let responseBody: string;
    let redirectCount = 0;
    const maxRedirects = 10;

    // Request loop (for redirect following)
    while (true) {
      if (isLocalhost(url.hostname)) {
        // Route through ServerBridge
        const port = parseInt(url.port, 10) || 80;
        const path = url.pathname + url.search;
        const { getServerBridge } = await import('../server-bridge');
        const bridge = getServerBridge();
        const bodyBuffer = body ? new TextEncoder().encode(body).buffer : undefined;
        const response = await bridge.handleRequest(port, parsed.method, path, headers, bodyBuffer);

        statusCode = response.statusCode;
        statusMessage = response.statusMessage || '';
        responseHeaders = response.headers || {};
        responseBody = response.body
          ? (response.body instanceof Uint8Array
              ? new TextDecoder().decode(response.body)
              : String(response.body))
          : '';
      } else {
        // External URL — use fetch through CORS proxy
        try {
          const fetchHeaders = new Headers(headers);
          const fetchOpts: RequestInit = {
            method: parsed.method,
            headers: fetchHeaders,
            redirect: 'manual',
          };
          if (body && parsed.method !== 'GET' && parsed.method !== 'HEAD') {
            fetchOpts.body = body;
          }

          const resp = await fetch(url.toString(), fetchOpts);
          statusCode = resp.status;
          statusMessage = resp.statusText || '';
          responseHeaders = {};
          resp.headers.forEach((v, k) => {
            responseHeaders[k] = v;
          });
          responseBody = await resp.text();
        } catch (fetchErr: any) {
          return err(`curl: (7) Failed to connect to ${url.hostname}: ${fetchErr.message || fetchErr}\n`);
        }
      }

      // Handle redirects
      if (parsed.followRedirects && statusCode >= 300 && statusCode < 400 && responseHeaders['location']) {
        redirectCount++;
        if (redirectCount > maxRedirects) {
          return err(`curl: (47) Maximum redirects (${maxRedirects}) followed\n`);
        }
        try {
          url = new URL(responseHeaders['location'], url);
        } catch {
          return err(`curl: (3) Invalid redirect URL: ${responseHeaders['location']}\n`);
        }
        continue;
      }

      break;
    }

    // Write to file if -o specified
    if (parsed.outputFile) {
      try {
        vfs.writeFileSync(parsed.outputFile, responseBody);
      } catch (writeErr: any) {
        return err(`curl: (23) Failure writing output to destination: ${writeErr.message || writeErr}\n`);
      }
    }

    // Fail on HTTP errors
    if (parsed.failOnError && statusCode >= 400) {
      const msg = !parsed.silent
        ? `curl: (22) The requested URL returned error: ${statusCode}\n`
        : '';
      return { stdout: '', stderr: msg, exitCode: 22 };
    }

    // Build output
    let stdout = '';
    let stderr = '';

    if (parsed.verbose) {
      stderr += `> ${parsed.method} ${url.pathname}${url.search} HTTP/1.1\r\n`;
      stderr += `> Host: ${url.host}\r\n`;
      for (const [k, v] of Object.entries(headers)) {
        stderr += `> ${k}: ${v}\r\n`;
      }
      stderr += '>\r\n';
      stderr += `< HTTP/1.1 ${statusCode} ${statusMessage}\r\n`;
      for (const [k, v] of Object.entries(responseHeaders)) {
        stderr += `< ${k}: ${v}\r\n`;
      }
      stderr += '<\r\n';
    }

    if (parsed.includeHeaders) {
      stdout += formatResponseHeaders(statusCode, statusMessage, responseHeaders) + '\r\n';
    }

    if (!parsed.outputFile) {
      stdout += responseBody;
    }

    if (parsed.writeOut) {
      stdout += parsed.writeOut.replace(/%\{http_code\}/g, String(statusCode));
    }

    return { stdout, stderr, exitCode: 0 };
  } catch (error: any) {
    return err(`curl: ${error.message || String(error)}\n`);
  }
}

const HELP_TEXT = `Usage: curl [options...] <url>
Options:
 -X, --request <method>   HTTP method (GET, POST, PUT, DELETE, etc.)
 -H, --header <header>    Pass custom header(s) to the server
 -d, --data <data>         HTTP POST data (use @filename to read from file)
 -o, --output <file>       Write to file instead of stdout
 -s, --silent              Silent mode
 -i, --include             Include response headers in output
 -v, --verbose             Make the operation more talkative
 -L, --location            Follow redirects
 -f, --fail                Fail silently on HTTP errors
 -w, --write-out <format>  Output format after completion
     --help                Show this help
     --version             Show version
`;
