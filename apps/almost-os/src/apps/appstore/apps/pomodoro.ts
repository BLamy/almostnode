/**
 * Pomodoro Timer — a minimal Electron app.
 *
 * Inspired by duggiemitchell/electron-app-pomodoro-timer. The main process owns
 * the countdown (setInterval) and streams ticks to the renderer via
 * webContents.send; the renderer drives it through ipcRenderer.invoke.
 */
export const files: Record<string, string> = {
  'package.json': JSON.stringify(
    { name: 'pomodoro', version: '1.0.0', main: 'main.js' },
    null,
    2,
  ),

  'main.js': `const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const WORK = 25 * 60;
const BREAK = 5 * 60;

let remaining = WORK;
let running = false;
let mode = 'work';
let timer = null;
let win = null;

function state() {
  return { remaining, running, mode };
}
function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send('timer:tick', state());
}
function tick() {
  if (!running) return;
  remaining -= 1;
  if (remaining <= 0) {
    mode = mode === 'work' ? 'break' : 'work';
    remaining = mode === 'work' ? WORK : BREAK;
    running = false;
  }
  broadcast();
}

ipcMain.handle('timer:toggle', () => {
  running = !running;
  broadcast();
  return state();
});
ipcMain.handle('timer:reset', () => {
  running = false;
  mode = 'work';
  remaining = WORK;
  broadcast();
  return state();
});
ipcMain.handle('timer:state', () => state());

app.whenReady().then(() => {
  win = new BrowserWindow({
    width: 340,
    height: 420,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadURL(process.env.ELECTRON_RENDERER_URL);
  timer = setInterval(tick, 1000);
  win.on('closed', () => {
    if (timer) clearInterval(timer);
    win = null;
  });
});

app.on('window-all-closed', () => app.quit());
`,

  'preload.js': `const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pomodoro', {
  toggle: () => ipcRenderer.invoke('timer:toggle'),
  reset: () => ipcRenderer.invoke('timer:reset'),
  getState: () => ipcRenderer.invoke('timer:state'),
  onTick: (cb) => ipcRenderer.on('timer:tick', (_event, s) => cb(s)),
});
`,

  'src/renderer/index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Pomodoro</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0; height: 100vh; display: grid; place-items: center;
        font-family: system-ui, sans-serif;
        background: radial-gradient(circle at 50% 0%, #7f1d1d, #450a0a 70%);
        color: #fff; user-select: none;
      }
      .card { text-align: center; }
      .mode { text-transform: uppercase; letter-spacing: .3em; font-size: 12px; opacity: .8; }
      .time { font-size: 84px; font-weight: 700; font-variant-numeric: tabular-nums; margin: 8px 0 20px; }
      .row { display: flex; gap: 12px; justify-content: center; }
      button {
        border: none; border-radius: 999px; padding: 12px 22px; font-size: 15px; font-weight: 600;
        cursor: pointer; background: rgba(255,255,255,.15); color: #fff; backdrop-filter: blur(6px);
      }
      button.primary { background: #fff; color: #7f1d1d; }
      button:active { transform: translateY(1px); }
    </style>
  </head>
  <body>
    <div class="card">
      <div class="mode" id="mode">work</div>
      <div class="time" id="time">25:00</div>
      <div class="row">
        <button class="primary" id="toggle">Start</button>
        <button id="reset">Reset</button>
      </div>
    </div>
    <script type="module" src="./main.js"></script>
  </body>
</html>
`,

  'src/renderer/main.js': `const timeEl = document.getElementById('time');
const modeEl = document.getElementById('mode');
const toggleEl = document.getElementById('toggle');
const resetEl = document.getElementById('reset');

function fmt(s) {
  const m = Math.floor(s / 60).toString().padStart(2, '0');
  const sec = (s % 60).toString().padStart(2, '0');
  return m + ':' + sec;
}
function render(s) {
  timeEl.textContent = fmt(s.remaining);
  modeEl.textContent = s.mode;
  toggleEl.textContent = s.running ? 'Pause' : 'Start';
  document.body.style.filter = s.mode === 'break' ? 'hue-rotate(120deg)' : 'none';
}

window.pomodoro.onTick(render);
window.pomodoro.getState().then(render);
toggleEl.addEventListener('click', () => window.pomodoro.toggle().then(render));
resetEl.addEventListener('click', () => window.pomodoro.reset().then(render));
`,
};
