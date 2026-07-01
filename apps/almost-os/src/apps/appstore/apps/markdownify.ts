/**
 * Markdownify — a minimal live Markdown editor.
 *
 * Inspired by amitmerchant1990/electron-markdownify. The renderer edits text
 * with a live preview; the main process persists the note to the VFS via
 * ipcMain.handle + fs (the classic secure IPC pattern).
 */
export const files: Record<string, string> = {
  'package.json': JSON.stringify(
    { name: 'markdownify', version: '1.0.0', main: 'main.js' },
    null,
    2,
  ),

  'main.js': `const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');

const NOTE = path.join(__dirname, 'note.md');
const DEFAULT = '# Markdownify\\n\\nA *minimal* Markdown editor running inside **almostnode**.\\n\\n- Live preview\\n- Saved to the virtual filesystem over IPC\\n\\n> Edit me and reload — your note persists.\\n';

ipcMain.handle('note:load', () => {
  try {
    return fs.readFileSync(NOTE, 'utf8');
  } catch {
    return DEFAULT;
  }
});
ipcMain.handle('note:save', (_event, text) => {
  fs.writeFileSync(NOTE, text);
  return true;
});

app.whenReady().then(() => {
  const win = new BrowserWindow({
    width: 820,
    height: 520,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.loadURL(process.env.ELECTRON_RENDERER_URL);
});

app.on('window-all-closed', () => app.quit());
`,

  'preload.js': `const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notes', {
  load: () => ipcRenderer.invoke('note:load'),
  save: (text) => ipcRenderer.invoke('note:save', text),
});
`,

  'src/renderer/index.html': `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Markdownify</title>
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body { margin: 0; height: 100vh; display: flex; flex-direction: column; font-family: system-ui, sans-serif; color: #1e293b; }
      header { padding: 8px 14px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 10px; font-size: 13px; }
      header b { font-size: 14px; }
      #status { margin-left: auto; color: #64748b; font-size: 12px; }
      main { flex: 1; display: grid; grid-template-columns: 1fr 1fr; min-height: 0; }
      textarea {
        border: none; outline: none; resize: none; padding: 18px; font: 14px/1.6 ui-monospace, Menlo, monospace;
        background: #f8fafc; border-right: 1px solid #e2e8f0;
      }
      #preview { padding: 18px; overflow: auto; }
      #preview h1 { font-size: 24px; } #preview h2 { font-size: 19px; }
      #preview code { background: #f1f5f9; padding: 1px 5px; border-radius: 4px; }
      #preview blockquote { margin: 8px 0; padding-left: 12px; border-left: 3px solid #cbd5e1; color: #475569; }
    </style>
  </head>
  <body>
    <header><b>📝 Markdownify</b><span id="status">loading…</span></header>
    <main>
      <textarea id="editor" spellcheck="false"></textarea>
      <div id="preview"></div>
    </main>
    <script type="module" src="./main.js"></script>
  </body>
</html>
`,

  'src/renderer/main.js': `const editor = document.getElementById('editor');
const preview = document.getElementById('preview');
const status = document.getElementById('status');

// Tiny, dependency-free Markdown -> HTML (headings, bold, italic, code, quote, lists).
function md(src) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc(src)
    .replace(/^### (.*)$/gm, '<h3>$1</h3>')
    .replace(/^## (.*)$/gm, '<h2>$1</h2>')
    .replace(/^# (.*)$/gm, '<h1>$1</h1>')
    .replace(/^&gt; (.*)$/gm, '<blockquote>$1</blockquote>')
    .replace(/^- (.*)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\\/li>)/gs, '<ul>$1</ul>')
    .replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    .replace(/\\*(.+?)\\*/g, '<em>$1</em>')
    .replace(/\`(.+?)\`/g, '<code>$1</code>')
    .replace(/\\n\\n/g, '<br/><br/>');
}

let saveTimer = null;
function scheduleSave() {
  status.textContent = 'saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await window.notes.save(editor.value);
    status.textContent = 'saved';
  }, 500);
}

editor.addEventListener('input', () => {
  preview.innerHTML = md(editor.value);
  scheduleSave();
});

window.notes.load().then((text) => {
  editor.value = text;
  preview.innerHTML = md(text);
  status.textContent = 'saved';
});
`,
};
