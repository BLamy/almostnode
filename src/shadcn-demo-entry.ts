import { createContainer } from './index';

const COMMAND = 'npx shadcn@latest create';
const WORK_DIR = '/workspace';

const terminalElement = document.getElementById('terminal') as HTMLDivElement;
const statusElement = document.getElementById('status') as HTMLSpanElement;
const statusDot = document.getElementById('statusDot') as HTMLDivElement;
const commandReadout = document.getElementById('commandReadout') as HTMLDivElement;
const fileTreeElement = document.getElementById('fileTree') as HTMLPreElement;

const runButton = document.getElementById('runBtn') as HTMLButtonElement;
const seedButton = document.getElementById('seedBtn') as HTMLButtonElement;
const abortButton = document.getElementById('abortBtn') as HTMLButtonElement;
const refreshButton = document.getElementById('refreshBtn') as HTMLButtonElement;
const clearButton = document.getElementById('clearBtn') as HTMLButtonElement;

const container = createContainer();

let terminal: any = null;
let fitAddon: any = null;
let isRunning = false;
let activeRunController: AbortController | null = null;
let commandBuffer = '';
let historyIndex = -1;
let skipPrompt = false;

const commandHistory: string[] = [];

function setStatus(text: string, running = false) {
  statusElement.textContent = text;
  statusElement.style.color = 'var(--text)';
  if (running) {
    statusDot.classList.add('running');
    statusDot.classList.remove('error');
  } else {
    statusDot.classList.remove('running');
    statusDot.classList.remove('error');
  }
}

function setErrorStatus(message: string) {
  statusElement.textContent = message;
  statusElement.style.color = 'var(--error)';
  statusDot.classList.remove('running');
  statusDot.classList.add('error');
  terminalElement.style.color = 'var(--error)';
  terminalElement.style.padding = '10px';
  terminalElement.style.whiteSpace = 'pre-wrap';
}

function write(text: string) {
  if (!terminal) return;
  terminal.write(text.replace(/\n/g, '\r\n'));
}

function writeError(text: string) {
  if (!terminal) {
    const safeText = text.replace(/\r\n/g, '');
    setErrorStatus(safeText);
    terminalElement.textContent = safeText;
    return;
  }

  write(`\x1b[31m${text}\x1b[0m`);
}

function showPrompt() {
  if (!terminal) return;
  terminal.write('\x1b[32m$ \x1b[0m');
}

function redrawInputLine() {
  if (!terminal) return;
  terminal.write('\r\x1b[K');
  showPrompt();
  if (commandBuffer) {
    terminal.write(commandBuffer);
  }
}

function normalizePath(path: string) {
  return path.replace(/\/+/g, '/');
}

function shouldSkipEntry(name: string) {
  return [
    'node_modules',
    '.git',
    '.next',
    '.turbo',
    '.pnpm-store',
    '.npm',
    'dist',
    'build',
    '.cache',
  ].includes(name);
}

function listFolderTree(folder: string, depth: number, prefix: string, lines: string[]) {
  if (depth > 4) return;

  let children: string[];
  try {
    children = container.vfs.readdirSync(folder);
  } catch {
    return;
  }

  const filtered = children
    .filter((name) => !shouldSkipEntry(name))
    .sort((a, b) => {
      const aPath = `${folder}/${a}`;
      const bPath = `${folder}/${b}`;
      const aIsDir = container.vfs.statSync(aPath).isDirectory();
      const bIsDir = container.vfs.statSync(bPath).isDirectory();
      if (aIsDir === bIsDir) return a.localeCompare(b);
      return aIsDir ? -1 : 1;
    });

  for (const name of filtered) {
    const fullPath = normalizePath(`${folder}/${name}`);
    let isDir = false;

    try {
      isDir = container.vfs.statSync(fullPath).isDirectory();
    } catch {
      // ignore stale entries
    }

    lines.push(`${prefix}${isDir ? '▸' : '•'} ${name}`);

    if (isDir) {
      listFolderTree(fullPath, depth + 1, `${prefix}  `, lines);
    }
  }
}

function refreshWorkspaceTree() {
  const lines: string[] = [`${WORK_DIR}/`];
  listFolderTree(WORK_DIR, 0, '  ', lines);
  fileTreeElement.textContent = lines.join('\n');
}

function removePathRecursive(targetPath: string) {
  const normalized = normalizePath(targetPath);
  let isDir = false;
  try {
    isDir = container.vfs.statSync(normalized).isDirectory();
  } catch {
    return;
  }

  if (!isDir) {
    try {
      container.vfs.unlinkSync(normalized);
    } catch {
      // Ignore stale entries.
    }
    return;
  }

  let children: string[] = [];
  try {
    children = container.vfs.readdirSync(normalized);
  } catch {
    // ignore
  }

  for (const child of children) {
    removePathRecursive(`${normalized}/${child}`);
  }

  try {
    container.vfs.rmdirSync(normalized);
  } catch {
    // ignore non-empty / race cases
  }
}

function writeSeedFiles() {
  if (!container.vfs.existsSync(WORK_DIR)) {
    container.vfs.mkdirSync(WORK_DIR, { recursive: true });
    return;
  }

  let entries: string[] = [];
  try {
    entries = container.vfs.readdirSync(WORK_DIR);
  } catch {
    // ignore
  }

  for (const entry of entries) {
    removePathRecursive(`${WORK_DIR}/${entry}`);
  }
}

function commandComplete() {
  isRunning = false;
  activeRunController = null;
  skipPrompt = false;
  abortButton.disabled = true;
  setStatus('Ready', false);
  refreshWorkspaceTree();
  write('\r\n');
  showPrompt();
}

async function executeCommand(command: string) {
  const trimmed = command.trim();
  if (!trimmed || isRunning) return;

  if (!skipPrompt) {
    commandHistory.push(trimmed);
    historyIndex = commandHistory.length;
  }

  skipPrompt = true;
  isRunning = true;
  setStatus(`Running: ${trimmed}`, true);
  write(`\x1b[2m[${trimmed}]\x1b[0m\r\n`);
  commandReadout.textContent = trimmed;
  activeRunController = new AbortController();
  abortButton.disabled = false;
  let sawStreamedStderr = false;

  try {
    const result = await container.run(trimmed, {
      cwd: WORK_DIR,
      onStdout: (text: string) => write(text),
      onStderr: (text: string) => {
        sawStreamedStderr = true;
        write(text);
      },
      signal: activeRunController.signal,
    });

    if (result.exitCode !== 0) {
      if (!sawStreamedStderr && result.stderr.trim()) {
        const stderrText = result.stderr.endsWith('\n') ? result.stderr : `${result.stderr}\n`;
        write(stderrText);
      } else if (!result.stderr.trim() && result.stdout.trim()) {
        const tail = result.stdout
          .trimEnd()
          .split(/\r?\n/)
          .slice(-12)
          .join('\r\n');
        if (tail) {
          write(`\x1b[2mnon-zero exit without stderr; stdout tail:\x1b[0m\r\n${tail}\r\n`);
        }
      }
      write(`\x1b[2mexit code: ${result.exitCode}\x1b[0m\r\n`);
    }
  } catch (error) {
    writeError(`Error: ${String(error)}\r\n`);
  } finally {
    commandComplete();
  }
}

function submitCommand(command: string, echo = true) {
  const trimmed = command.trim();
  if (!trimmed || isRunning) return;

  if (echo) {
    write(`\r\n`);
    write(`\x1b[32m$ \x1b[0m${trimmed}\r\n`);
  }
  executeCommand(trimmed);
}

function handleHistoryDirection(delta: number) {
  if (!terminal || commandHistory.length === 0) return;

  if (delta < 0) {
    if (historyIndex === -1) historyIndex = commandHistory.length;
    historyIndex = Math.max(0, historyIndex - 1);
  } else {
    if (historyIndex === -1) return;
    historyIndex = Math.min(commandHistory.length - 1, historyIndex + 1);
    if (historyIndex === commandHistory.length - 1 && delta > 0) {
      // move to new line
      historyIndex = -1;
      commandBuffer = '';
      redrawInputLine();
      return;
    }
  }

  commandBuffer = commandHistory[historyIndex] || '';
  redrawInputLine();
}

function clearTerminalContent() {
  if (!terminal) return;
  terminal.reset();
}

function setupTerminal() {
  const TerminalCtor = (window as any).Terminal?.Terminal ?? (window as any).Terminal;
  const fitAddonModule = (window as any).FitAddon;
  const FitAddonCtor = fitAddonModule?.FitAddon || fitAddonModule?.default || fitAddonModule;

  if (!TerminalCtor || !FitAddonCtor) {
    writeError('xterm scripts from CDN failed to load. Refresh the page and try again.');
    return;
  }

  if (typeof TerminalCtor !== 'function') {
    writeError(`Terminal API is not callable: ${String(typeof TerminalCtor)}`);
    return;
  }

  if (typeof FitAddonCtor !== 'function') {
    writeError(`Fit addon API is not callable: ${String(typeof FitAddonCtor)}`);
    return;
  }

  try {
    terminal = new TerminalCtor({
      fontFamily: 'IBM Plex Mono, Menlo, monospace',
      fontSize: 12,
      theme: {
        background: '#0a0a0a',
        foreground: '#c0c0c0',
        cursor: '#00ff88',
        selectionBackground: 'rgba(0, 255, 136, 0.18)',
      },
      cursorBlink: true,
      allowProposedApi: true,
    });
  } catch (error) {
    writeError(`Terminal init failed: ${String(error)}\r\n`);
    return;
  }

  try {
    fitAddon = new FitAddonCtor();
    terminal.loadAddon(fitAddon);
    terminal.open(terminalElement);
  } catch (error) {
    writeError(`Failed to initialize terminal DOM: ${String(error)}\r\n`);
    return;
  }

  requestAnimationFrame(() => {
    fitAddon?.fit?.();
  });
  new ResizeObserver(() => fitAddon?.fit?.()).observe(terminalElement);

  const handleIdleInput = (data: string) => {
    if (!terminal) return;

    // Strip bracketed paste markers if present.
    const normalized = data
      .replace(/\u001b\[200~/g, '')
      .replace(/\u001b\[201~/g, '');

    let i = 0;
    while (i < normalized.length) {
      const seq3 = normalized.slice(i, i + 3);
      if (seq3 === '\u001b[A') {
        handleHistoryDirection(-1);
        i += 3;
        continue;
      }
      if (seq3 === '\u001b[B') {
        handleHistoryDirection(1);
        i += 3;
        continue;
      }

      const ch = normalized[i];

      if (ch === '\r' || ch === '\n') {
        if (ch === '\r' && normalized[i + 1] === '\n') {
          i += 1;
        }

        terminal.write('\r\n');
        const command = commandBuffer.trim();
        commandBuffer = '';
        historyIndex = -1;
        if (!command) {
          showPrompt();
          i += 1;
          continue;
        }
        executeCommand(command);
        i += 1;

        // Once command execution starts, leave remaining bytes for runtime stdin.
        if (isRunning) {
          return;
        }
        continue;
      }

      if (ch === '\u007f') {
        if (commandBuffer.length > 0) {
          commandBuffer = commandBuffer.slice(0, -1);
          terminal.write('\b \b');
        }
        i += 1;
        continue;
      }

      if (ch === '\u0003') {
        terminal.write('^C\r\n');
        commandBuffer = '';
        showPrompt();
        i += 1;
        continue;
      }

      if (ch === '\u001b') {
        i += 1;
        continue;
      }

      if (ch >= ' ') {
        commandBuffer += ch;
        terminal.write(ch);
      }
      i += 1;
    }
  };

  terminal.onData((data: string) => {
    if (!terminal) return;

    if (isRunning) {
      if (data === '\u0003') {
        activeRunController?.abort();
        container.sendInput(data);
        write('^C\r\n');
        return;
      }

      container.sendInput(data);
      return;
    }

    if (skipPrompt) {
      skipPrompt = false;
      commandBuffer = '';
      redrawInputLine();
      return;
    }

    handleIdleInput(data);
  });
}

function bindUiControls() {
  runButton.onclick = () => {
    if (isRunning) return;
    submitCommand(COMMAND, true);
  };

  seedButton.onclick = () => {
    writeSeedFiles();
    refreshWorkspaceTree();
    write('\x1b[2mworkspace reset\x1b[0m\r\n');
    showPrompt();
  };

  clearButton.onclick = () => {
    clearTerminalContent();
    showPrompt();
  };

  refreshButton.onclick = () => {
    refreshWorkspaceTree();
    write('\x1b[2mfile tree refreshed\x1b[0m\r\n');
  };

  abortButton.onclick = () => {
    if (!isRunning) return;
    activeRunController?.abort();
    container.sendInput('\u0003');
    write('^C\r\n');
  };
}

async function init() {
  writeSeedFiles();
  setupTerminal();
  bindUiControls();

  refreshWorkspaceTree();
  commandReadout.textContent = COMMAND;
  setStatus('Ready', false);
  historyIndex = commandHistory.length;
  abortButton.disabled = true;

  await new Promise<void>((resolve) => {
    setTimeout(resolve, 120);
  });

  if (!terminal || !terminal.element) {
    writeError('Terminal failed to initialize.\r\n');
    runButton.disabled = true;
    seedButton.disabled = true;
    refreshButton.disabled = true;
    clearButton.disabled = true;
    return;
  }

  showPrompt();
  terminal.focus();

  // Expose internals for the UI test harness.
  (window as any).__shadcnContainer = container;
  (window as any).__shadcnTerminal = terminal;
}

init().catch((error) => {
  writeError(`Initialization failed: ${String(error)}\r\n`);
});
