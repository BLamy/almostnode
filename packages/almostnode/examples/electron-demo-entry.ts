/**
 * Entry for examples/electron-demo.html — boots the Electron demo and reflects
 * status/log into the page.
 */
import { initElectronDemo } from './electron-demo';

const windows = document.getElementById('windows') as HTMLElement;
const logEl = document.getElementById('log') as HTMLElement;
const statusEl = document.getElementById('status') as HTMLElement;

function log(message: string): void {
  const line = document.createElement('div');
  line.textContent = message;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(text: string, state: string): void {
  statusEl.textContent = text;
  statusEl.dataset.state = state;
}

async function main(): Promise<void> {
  try {
    setStatus('launching…', 'launching');
    await initElectronDemo(windows, log);
    setStatus('running', 'running');
  } catch (error) {
    setStatus('error', 'error');
    log(`ERROR: ${error instanceof Error ? error.message : String(error)}`);
    console.error(error);
  }
}

void main();
