/**
 * npm Scripts Demo — Entry Point
 * Interactive terminal for running npm scripts and bash commands
 */

import { createContainer } from '../src/index';

// DOM elements
const pkgEditor = document.getElementById('pkgEditor') as HTMLTextAreaElement;
const terminalOutput = document.getElementById('terminalOutput') as HTMLDivElement;
const terminalInput = document.getElementById('terminalInput') as HTMLInputElement;
const statusEl = document.getElementById('status') as HTMLSpanElement;

// State
const commandHistory: string[] = [];
let historyIndex = -1;
let isRunning = false;
let activeRunController: AbortController | null = null;

// Create the container
const container = createContainer();

// Default server.js for "npm start"
container.vfs.writeFileSync('/server.js', `console.log('Server starting on port 3000...');
console.log('Ready to accept connections');
`);

// Write initial package.json
syncPackageJson();

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sanitizeTerminalText(text: string): string {
  return text
    // Strip ANSI escape sequences from interactive CLIs.
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    // Drop carriage returns used to redraw prompt lines.
    .replace(/\r/g, '');
}

function appendToTerminal(text: string, className: string = 'stdout', appendNewline: boolean = true) {
  const span = document.createElement('span');
  span.className = className;
  const sanitized = sanitizeTerminalText(text);
  span.innerHTML = escapeHtml(sanitized);
  if (appendNewline && !sanitized.endsWith('\n')) span.innerHTML += '\n';
  terminalOutput.appendChild(span);
  terminalOutput.scrollTop = terminalOutput.scrollHeight;
}

function syncPackageJson() {
  try {
    // Validate JSON before writing
    JSON.parse(pkgEditor.value);
    container.vfs.writeFileSync('/package.json', pkgEditor.value);
  } catch {
    // Invalid JSON — skip sync, will error on npm run
  }
}

async function executeCommand(command: string) {
  if (!command.trim()) return;
  if (isRunning) return;

  isRunning = true;
  statusEl.textContent = 'Running...';
  activeRunController = new AbortController();

  // Add to history
  commandHistory.push(command);
  historyIndex = commandHistory.length;

  // Show the command
  appendToTerminal(`$ ${command}`, 'cmd');

  // Sync package.json from editor to VFS
  syncPackageJson();

  try {
    const result = await container.run(command, {
      onStdout: (data: string) => appendToTerminal(data, 'stdout', false),
      onStderr: (data: string) => appendToTerminal(data, 'stderr', false),
      signal: activeRunController.signal,
    });
    if (result.exitCode !== 0) {
      appendToTerminal(`exit code: ${result.exitCode}`, 'dim');
    }
  } catch (error) {
    appendToTerminal(`Error: ${error}`, 'stderr');
  }

  isRunning = false;
  activeRunController = null;
  terminalInput.focus();
  statusEl.textContent = 'Ready';
}

// Terminal input handling
terminalInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c' && isRunning) {
    e.preventDefault();
    activeRunController?.abort();
    appendToTerminal('^C', 'dim');
    return;
  }

  if (e.key === 'Enter') {
    const value = terminalInput.value;
    terminalInput.value = '';
    if (isRunning) {
      container.sendInput(value + '\n');
      return;
    }

    const command = value.trim();
    executeCommand(command);
    return;
  } else if (e.key === 'ArrowUp') {
    if (isRunning) return;
    e.preventDefault();
    if (historyIndex > 0) {
      historyIndex--;
      terminalInput.value = commandHistory[historyIndex];
    }
  } else if (e.key === 'ArrowDown') {
    if (isRunning) return;
    e.preventDefault();
    if (historyIndex < commandHistory.length - 1) {
      historyIndex++;
      terminalInput.value = commandHistory[historyIndex];
    } else {
      historyIndex = commandHistory.length;
      terminalInput.value = '';
    }
  }
});

// Show welcome message
appendToTerminal('almostnode npm scripts demo', 'info');
appendToTerminal('Type a command below, e.g. npm run build\n', 'dim');

// Focus the input
terminalInput.focus();
