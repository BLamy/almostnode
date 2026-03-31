import { createContainer } from '../src/index';

const COMMAND = 'npx shadcn@latest create';
const WORK_DIR = '/project';

const terminalElement = document.getElementById('terminal') as HTMLDivElement;
const statusElement = document.getElementById('status') as HTMLSpanElement;
const statusDot = document.getElementById('statusDot') as HTMLDivElement;
const commandReadout = document.getElementById('commandReadout') as HTMLDivElement;
const fileTreeElement = document.getElementById('fileTree') as HTMLPreElement;

const runButton = document.getElementById('runBtn') as HTMLButtonElement;
const gitSettingsButton = document.getElementById('gitSettingsBtn') as HTMLButtonElement;
const seedButton = document.getElementById('seedBtn') as HTMLButtonElement;
const abortButton = document.getElementById('abortBtn') as HTMLButtonElement;
const refreshButton = document.getElementById('refreshBtn') as HTMLButtonElement;
const clearButton = document.getElementById('clearBtn') as HTMLButtonElement;
const gitSettingsOverlay = document.getElementById('gitSettingsOverlay') as HTMLDivElement;
const gitPatInput = document.getElementById('gitPatInput') as HTMLInputElement;
const gitCorsInput = document.getElementById('gitCorsInput') as HTMLInputElement;
const gitUnlockButton = document.getElementById('gitUnlockBtn') as HTMLButtonElement;
const gitLoadEncryptedButton = document.getElementById('gitLoadEncryptedBtn') as HTMLButtonElement;
const gitSaveEncryptedButton = document.getElementById('gitSaveEncryptedBtn') as HTMLButtonElement;
const gitApplySessionButton = document.getElementById('gitApplySessionBtn') as HTMLButtonElement;
const gitClearButton = document.getElementById('gitClearBtn') as HTMLButtonElement;
const gitCloseButton = document.getElementById('gitCloseBtn') as HTMLButtonElement;
const gitSettingsStatus = document.getElementById('gitSettingsStatus') as HTMLDivElement;

const container = createContainer();

const RUNTIME_CORS_PROXY_STORAGE_KEY = '__corsProxyUrl';
const DEFAULT_GIT_CORS_PROXY = 'https://almostnode-cors-proxy.langtail.workers.dev/?url=';
const GIT_AUTH_STORAGE_KEY = 'almostnode.shadcn.gitAuth.encrypted';
const GIT_CORS_STORAGE_KEY = 'almostnode.shadcn.gitAuth.corsProxy';

let terminal: any = null;
let fitAddon: any = null;
let isRunning = false;
let activeRunController: AbortController | null = null;
let commandBuffer = '';
let historyIndex = -1;
let skipPrompt = false;

const commandHistory: string[] = [];
let gitEncryptionKey: CryptoKey | null = null;

function normalizeDemoCorsProxyStorage() {
  try {
    const stored = localStorage.getItem(RUNTIME_CORS_PROXY_STORAGE_KEY)?.trim();
    const localWorkbenchProxy = `${window.location.origin}/__api/cors-proxy?url=`;
    if (stored === localWorkbenchProxy) {
      localStorage.setItem(RUNTIME_CORS_PROXY_STORAGE_KEY, DEFAULT_GIT_CORS_PROXY);
    }
  } catch {
    // Ignore storage failures.
  }
}

normalizeDemoCorsProxyStorage();

function setGitSettingsStatus(message: string, type: 'info' | 'error' | 'success' = 'info') {
  gitSettingsStatus.textContent = message;
  if (type === 'error') {
    gitSettingsStatus.style.color = 'var(--error)';
    return;
  }
  if (type === 'success') {
    gitSettingsStatus.style.color = 'var(--accent)';
    return;
  }
  gitSettingsStatus.style.color = 'var(--text-dim)';
}

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
  const binary = atob(padded);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    buffer[i] = binary.charCodeAt(i);
  }
  return buffer.buffer;
}

async function deriveEncryptionKey(source: ArrayBuffer): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    source,
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: new TextEncoder().encode('almostnode-git-auth-salt'),
      iterations: 100000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptText(key: CryptoKey, value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(value);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
  const payload = new Uint8Array(iv.length + encrypted.byteLength);
  payload.set(iv);
  payload.set(new Uint8Array(encrypted), iv.length);
  return toBase64Url(payload.buffer);
}

async function decryptText(key: CryptoKey, payload: string): Promise<string> {
  const data = new Uint8Array(fromBase64Url(payload));
  const iv = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new TextDecoder().decode(decrypted);
}

function isWebAuthnAvailable(): boolean {
  return typeof window.PublicKeyCredential !== 'undefined' && !!navigator.credentials;
}

async function startAuthenticationCredential(): Promise<PublicKeyCredential> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge,
      timeout: 60000,
      userVerification: 'required',
      rpId: window.location.hostname,
    },
  });

  if (!assertion || !(assertion instanceof PublicKeyCredential)) {
    throw new Error('Passkey authentication was not completed');
  }

  return assertion;
}

async function startRegistrationCredential(): Promise<PublicKeyCredential> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const credential = await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: {
        name: 'almostnode',
        id: window.location.hostname,
      },
      user: {
        id: userId,
        name: 'git-auth@almostnode.local',
        displayName: 'almostnode Git Auth',
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: {
        userVerification: 'required',
        residentKey: 'required',
      },
    },
  });

  if (!credential || !(credential instanceof PublicKeyCredential)) {
    throw new Error('Passkey registration was not completed');
  }

  return credential;
}

async function ensureGitEncryptionKey(): Promise<CryptoKey> {
  if (!isWebAuthnAvailable()) {
    throw new Error('WebAuthn is unavailable in this browser');
  }

  try {
    const assertion = await startAuthenticationCredential();
    return deriveEncryptionKey(assertion.rawId);
  } catch {
    const credential = await startRegistrationCredential();
    return deriveEncryptionKey(credential.rawId);
  }
}

function applyGitAuthFromInputs(tokenOverride?: string | null) {
  const token = typeof tokenOverride === 'string'
    ? tokenOverride.trim()
    : gitPatInput.value.trim();
  const corsProxy = gitCorsInput.value.trim();

  container.setGitAuth({
    token: token ? token : null,
    corsProxy: corsProxy ? corsProxy : null,
  });
}

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

async function ensureGitRepoInitialized() {
  if (!container.vfs.existsSync(WORK_DIR)) {
    container.vfs.mkdirSync(WORK_DIR, { recursive: true });
  }
  if (container.vfs.existsSync(`${WORK_DIR}/.git`)) {
    return;
  }

  const result = await container.run('git init', { cwd: WORK_DIR });
  if (result.exitCode !== 0) {
    const reason = (result.stderr || result.stdout || 'git init failed').trim();
    throw new Error(reason);
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
  setStatus(``, true);
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
      interactive: true,
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

function openGitSettings() {
  gitSettingsOverlay.classList.remove('hidden');
  setGitSettingsStatus(
    'Session-only auth works without passkey. Use passkey to encrypt/decrypt stored PAT.',
    'info'
  );
}

function closeGitSettings() {
  gitSettingsOverlay.classList.add('hidden');
}

function hydrateGitSettingsFromStorage() {
  const savedCors = localStorage.getItem(GIT_CORS_STORAGE_KEY);
  gitCorsInput.value = savedCors || DEFAULT_GIT_CORS_PROXY;

  if (savedCors) {
    container.setGitAuth({ corsProxy: savedCors });
  }

  if (localStorage.getItem(GIT_AUTH_STORAGE_KEY)) {
    setGitSettingsStatus('Encrypted PAT detected. Click \"Use Passkey\" then \"Load Encrypted\".', 'info');
  }
}

async function handleGitUnlock() {
  try {
    gitEncryptionKey = await ensureGitEncryptionKey();
    setGitSettingsStatus('Passkey verified. You can now load/save encrypted PAT.', 'success');
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    setGitSettingsStatus(`Passkey unavailable (${msg}). Session-only mode still works.`, 'error');
  }
}

async function handleGitSaveEncrypted() {
  const token = gitPatInput.value.trim();
  const corsProxy = gitCorsInput.value.trim();

  localStorage.setItem(GIT_CORS_STORAGE_KEY, corsProxy || DEFAULT_GIT_CORS_PROXY);
  applyGitAuthFromInputs(token);

  if (!token) {
    setGitSettingsStatus('PAT is empty. Session auth cleared and proxy saved.', 'success');
    return;
  }

  if (!gitEncryptionKey) {
    setGitSettingsStatus('No passkey key in memory. Use \"Apply Session Only\" or unlock passkey first.', 'error');
    return;
  }

  const payload = JSON.stringify({ token, corsProxy: corsProxy || DEFAULT_GIT_CORS_PROXY });
  const encrypted = await encryptText(gitEncryptionKey, payload);
  localStorage.setItem(GIT_AUTH_STORAGE_KEY, encrypted);
  setGitSettingsStatus('Encrypted PAT saved locally and applied to current session.', 'success');
}

async function handleGitLoadEncrypted() {
  const stored = localStorage.getItem(GIT_AUTH_STORAGE_KEY);
  if (!stored) {
    setGitSettingsStatus('No encrypted PAT found in local storage.', 'error');
    return;
  }
  if (!gitEncryptionKey) {
    setGitSettingsStatus('Unlock with passkey before loading encrypted PAT.', 'error');
    return;
  }

  const decrypted = await decryptText(gitEncryptionKey, stored);
  const parsed = JSON.parse(decrypted) as { token?: string; corsProxy?: string };
  gitPatInput.value = parsed.token || '';
  gitCorsInput.value = parsed.corsProxy || DEFAULT_GIT_CORS_PROXY;
  applyGitAuthFromInputs(parsed.token || null);
  localStorage.setItem(GIT_CORS_STORAGE_KEY, gitCorsInput.value.trim() || DEFAULT_GIT_CORS_PROXY);
  setGitSettingsStatus('Encrypted PAT loaded and applied to the running container.', 'success');
}

function handleGitApplySessionOnly() {
  const token = gitPatInput.value.trim();
  const corsProxy = gitCorsInput.value.trim();
  localStorage.setItem(GIT_CORS_STORAGE_KEY, corsProxy || DEFAULT_GIT_CORS_PROXY);
  applyGitAuthFromInputs(token);
  setGitSettingsStatus('Session-only git auth applied to running container.', 'success');
}

function handleGitClearAuth() {
  gitPatInput.value = '';
  localStorage.removeItem(GIT_AUTH_STORAGE_KEY);
  container.setGitAuth({ token: null, username: null, password: null });
  setGitSettingsStatus('Stored PAT cleared. Session git token removed.', 'success');
}

function bindUiControls() {
  runButton.onclick = () => {
    if (isRunning) return;
    submitCommand(COMMAND, true);
  };

  gitSettingsButton.onclick = () => {
    openGitSettings();
  };

  seedButton.onclick = async () => {
    if (isRunning) return;
    writeSeedFiles();
    try {
      await ensureGitRepoInitialized();
      refreshWorkspaceTree();
      write('\x1b[2mworkspace reset complete (git initialized in /project)\x1b[0m\r\n');
      showPrompt();
    } catch (error) {
      write(`\x1b[31mworkspace reset failed: ${String(error)}\x1b[0m\r\n`);
      showPrompt();
    }
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

  gitCloseButton.onclick = () => {
    closeGitSettings();
  };
  gitSettingsOverlay.onclick = (event) => {
    if (event.target === gitSettingsOverlay) {
      closeGitSettings();
    }
  };

  gitUnlockButton.onclick = () => {
    handleGitUnlock().catch((error) => {
      setGitSettingsStatus(`Passkey unlock failed: ${String(error)}`, 'error');
    });
  };
  gitSaveEncryptedButton.onclick = () => {
    handleGitSaveEncrypted().catch((error) => {
      setGitSettingsStatus(`Unable to save encrypted PAT: ${String(error)}`, 'error');
    });
  };
  gitLoadEncryptedButton.onclick = () => {
    handleGitLoadEncrypted().catch((error) => {
      setGitSettingsStatus(`Unable to load encrypted PAT: ${String(error)}`, 'error');
    });
  };
  gitApplySessionButton.onclick = () => {
    handleGitApplySessionOnly();
  };
  gitClearButton.onclick = () => {
    handleGitClearAuth();
  };
}

async function init() {
  writeSeedFiles();
  await ensureGitRepoInitialized();
  setupTerminal();
  bindUiControls();
  hydrateGitSettingsFromStorage();

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
