import type { ReturnTypeOfCreateContainer } from "./workbench-host";

export const WORKSPACE_ROOT = "/project";
export const DEFAULT_FILE = `${WORKSPACE_ROOT}/src/App.tsx`;
export const DEFAULT_RUN_COMMAND = "npm run dev";

const DIRECTORIES = [
  `${WORKSPACE_ROOT}/.vscode`,
  `${WORKSPACE_ROOT}/src`,
  `${WORKSPACE_ROOT}/src/components`,
  `${WORKSPACE_ROOT}/src/components/ui`,
];

const FILES: Record<string, string> = {
  [`${WORKSPACE_ROOT}/package.json`]: JSON.stringify(
    {
      name: "almostnode-webide-vite-starter",
      private: true,
      version: "0.0.1",
      type: "module",
      scripts: {
        dev: "vite --port 3000",
        build: "vite build",
        preview: "vite preview",
        typecheck: "tsc --noEmit",
      },
      dependencies: {
        react: "^19.2.0",
        "react-dom": "^19.2.0",
      },
      devDependencies: {
        "@types/react": "^19.2.0",
        "@types/react-dom": "^19.2.0",
        typescript: "^5.9.3",
        vite: "^5.4.0",
      },
    },
    null,
    2,
  ),
  [`${WORKSPACE_ROOT}/tsconfig.json`]: JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        useDefineForClassFields: true,
        lib: ["DOM", "DOM.Iterable", "ES2022"],
        allowJs: false,
        skipLibCheck: true,
        esModuleInterop: true,
        allowSyntheticDefaultImports: true,
        strict: true,
        forceConsistentCasingInFileNames: true,
        module: "ESNext",
        moduleResolution: "Bundler",
        resolveJsonModule: true,
        isolatedModules: true,
        noEmit: true,
        jsx: "react-jsx",
      },
      include: ["src"],
    },
    null,
    2,
  ),
  [`${WORKSPACE_ROOT}/index.html`]: `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>almostnode webide starter</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
`,
  [`${WORKSPACE_ROOT}/.vscode/settings.json`]: JSON.stringify(
    {
      "workbench.colorTheme": "Default Dark Modern",
      "editor.minimap.enabled": false,
      "files.autoSave": "afterDelay",
      "search.exclude": {
        "**/.git": true,
      },
    },
    null,
    2,
  ),
  [`${WORKSPACE_ROOT}/README.md`]: `# almostnode webide starter

This seeded workspace uses a Vite + React shell inspired by the shadcn Vite starter.

- edit \`src/App.tsx\`
- run \`npm run dev\`
- preview the app in the host pane

The styling stays plain CSS so it can boot inside almostnode's browser Vite runtime without a Tailwind plugin pass.
`,
  [`${WORKSPACE_ROOT}/src/main.tsx`]: `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Missing #root');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
`,
  [`${WORKSPACE_ROOT}/src/App.tsx`]: `import { useEffect, useState } from 'react';
import { Button } from './components/ui/button.tsx';

const PANELS = [
  {
    name: 'Starter shell',
    detail: 'React + Vite with plain CSS and a tiny component layer that works inside almostnode today.',
  },
  {
    name: 'Terminal-first',
    detail: 'The preview stays live while you run commands in the same virtual project from the terminal panel.',
  },
  {
    name: 'Easy to replace',
    detail: 'Swap this shell for your own app once you are ready to bring in extra packages or framework tooling.',
  },
];

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <main className="starter-shell">
      <section className="hero-card">
        <div className="hero-copy">
          <p className="eyebrow">Web IDE starter</p>
          <h1>Project ready!</h1>
          <p className="lede">
            A Vite + React shell based on the shadcn starter, trimmed to run inside almostnode without extra plugin setup.
          </p>
          <p className="caption">
            VS Code-style editing on top of almostnode, now with a faster default preview loop.
          </p>
          <div className="hero-actions">
            <Button onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}>
              Toggle theme
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                window.location.hash = '#starter-notes';
              }}
            >
              Jump to notes
            </Button>
          </div>
        </div>
        <aside className="command-card">
          <p className="command-label">Start here</p>
          <code>npm run dev</code>
          <ul>
            <li>Edit <span>src/App.tsx</span> to reshape the shell.</li>
            <li>Keep <span>src/components/ui/button.tsx</span> if you want a small UI primitive to build from.</li>
            <li>Replace the whole project once your framework runtime is ready.</li>
          </ul>
        </aside>
      </section>

      <section className="panel-grid" aria-label="Starter capabilities">
        {PANELS.map((panel) => (
          <article key={panel.name} className="feature-card">
            <p className="feature-kicker">{panel.name}</p>
            <p>{panel.detail}</p>
          </article>
        ))}
      </section>

      <section id="starter-notes" className="notes-card">
        <p className="notes-kicker">Compatibility notes</p>
        <h2>Built for the current browser runtime</h2>
        <p>
          This starter intentionally avoids a Tailwind compile step so preview boot stays immediate. It gives the Web IDE a
          Vite-shaped default app today while leaving room to swap in a fuller shadcn stack later.
        </p>
      </section>
    </main>
  );
}

export default App;
`,
  [`${WORKSPACE_ROOT}/src/components/ui/button.tsx`]: `import type { ButtonHTMLAttributes } from 'react';

type ButtonVariant = 'default' | 'secondary';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ className = '', type = 'button', variant = 'default', ...props }: ButtonProps) {
  const classes = ['ui-button', \`ui-button--\${variant}\`, className].filter(Boolean).join(' ');

  return <button type={type} className={classes} {...props} />;
}
`,
  [`${WORKSPACE_ROOT}/src/index.css`]: `:root {
  --font-sans: "Avenir Next", "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", "SFMono-Regular", monospace;
  --radius-lg: 28px;
  --radius-md: 18px;
  --radius-sm: 999px;
  --surface: #131722;
  --surface-strong: #191f2d;
  --surface-soft: rgba(255, 255, 255, 0.04);
  --border: rgba(255, 255, 255, 0.1);
  --text: #f6f2eb;
  --muted: #b5b8c7;
  --accent: #ff8e5b;
  --accent-strong: #ff6b2c;
  --accent-soft: rgba(255, 142, 91, 0.18);
  --shadow: 0 30px 80px rgba(0, 0, 0, 0.35);
  color-scheme: dark;
}

[data-theme='light'] {
  --surface: #f8f0e2;
  --surface-strong: #fffaf2;
  --surface-soft: rgba(48, 30, 12, 0.06);
  --border: rgba(48, 30, 12, 0.12);
  --text: #1d1c1a;
  --muted: #5d5a54;
  --accent: #e4692d;
  --accent-strong: #bb4a11;
  --accent-soft: rgba(228, 105, 45, 0.14);
  --shadow: 0 24px 60px rgba(70, 45, 24, 0.12);
  color-scheme: light;
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  min-height: 100%;
}

body {
  margin: 0;
  font-family: var(--font-sans);
  color: var(--text);
  background:
    radial-gradient(circle at top left, rgba(255, 142, 91, 0.24), transparent 28rem),
    radial-gradient(circle at bottom right, rgba(110, 154, 255, 0.18), transparent 30rem),
    linear-gradient(180deg, #0d1117 0%, #111522 45%, #171d2e 100%);
}

[data-theme='light'] body {
  background:
    radial-gradient(circle at top left, rgba(255, 164, 104, 0.26), transparent 28rem),
    radial-gradient(circle at bottom right, rgba(255, 229, 198, 0.8), transparent 30rem),
    linear-gradient(180deg, #fffaf3 0%, #f3eadc 100%);
}

button,
input,
textarea,
select {
  font: inherit;
}

.starter-shell {
  width: min(1120px, calc(100vw - 2rem));
  margin: 0 auto;
  padding: 2rem 0 3rem;
}

.hero-card,
.feature-card,
.notes-card,
.command-card {
  border: 1px solid var(--border);
  background: linear-gradient(180deg, var(--surface-soft), transparent), var(--surface);
  box-shadow: var(--shadow);
  backdrop-filter: blur(16px);
}

.hero-card {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(18rem, 0.9fr);
  gap: 1rem;
  padding: 1rem;
  border-radius: var(--radius-lg);
}

.hero-copy {
  padding: 1.25rem;
}

.eyebrow,
.command-label,
.feature-kicker,
.notes-kicker {
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 0.72rem;
  color: var(--accent);
}

.hero-copy h1 {
  margin: 0.75rem 0 0;
  font-size: clamp(2.8rem, 7vw, 5.8rem);
  line-height: 0.92;
}

.lede {
  max-width: 44rem;
  margin: 1rem 0 0;
  font-size: 1.05rem;
  line-height: 1.65;
  color: var(--muted);
}

.caption {
  margin: 1rem 0 0;
  color: var(--text);
  opacity: 0.82;
}

.hero-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 1.5rem;
}

.command-card {
  border-radius: calc(var(--radius-lg) - 4px);
  padding: 1.25rem;
  align-self: stretch;
}

.command-card code {
  display: inline-block;
  margin-top: 0.9rem;
  padding: 0.7rem 0.9rem;
  border-radius: 14px;
  background: rgba(0, 0, 0, 0.22);
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 0.92rem;
}

.command-card ul {
  margin: 1rem 0 0;
  padding-left: 1rem;
  color: var(--muted);
  line-height: 1.6;
}

.command-card span {
  color: var(--text);
  font-family: var(--font-mono);
  font-size: 0.92rem;
}

.panel-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 1rem;
  margin-top: 1rem;
}

.feature-card,
.notes-card {
  border-radius: var(--radius-md);
  padding: 1.2rem;
}

.feature-card p:last-child,
.notes-card p:last-child {
  margin-bottom: 0;
  color: var(--muted);
  line-height: 1.65;
}

.notes-card {
  margin-top: 1rem;
}

.notes-card h2 {
  margin: 0.7rem 0 0;
  font-size: clamp(1.7rem, 4vw, 2.4rem);
}

.ui-button {
  appearance: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  padding: 0.8rem 1.15rem;
  font-weight: 700;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition:
    transform 140ms ease,
    border-color 140ms ease,
    background 140ms ease,
    color 140ms ease,
    box-shadow 140ms ease;
}

.ui-button:hover {
  transform: translateY(-1px);
}

.ui-button:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.ui-button--default {
  background: linear-gradient(180deg, var(--accent), var(--accent-strong));
  color: #1d1c1a;
  box-shadow: 0 16px 36px var(--accent-soft);
}

.ui-button--secondary {
  border-color: var(--border);
  background: rgba(255, 255, 255, 0.02);
  color: var(--text);
}

.ui-button--secondary:hover {
  background: rgba(255, 255, 255, 0.08);
}

@media (max-width: 860px) {
  .hero-card {
    grid-template-columns: 1fr;
  }

  .panel-grid {
    grid-template-columns: 1fr;
  }

  .starter-shell {
    width: min(100vw - 1rem, 1120px);
    padding-top: 0.5rem;
  }

  .hero-copy,
  .command-card,
  .feature-card,
  .notes-card {
    padding: 1rem;
  }
}
`,
};

function ensureDirectory(
  container: ReturnTypeOfCreateContainer,
  path: string,
): void {
  if (!container.vfs.existsSync(path)) {
    container.vfs.mkdirSync(path, { recursive: true });
  }
}

export function seedWorkspace(container: ReturnTypeOfCreateContainer): void {
  for (const directory of DIRECTORIES) {
    ensureDirectory(container, directory);
  }

  for (const [path, content] of Object.entries(FILES)) {
    container.vfs.writeFileSync(path, content);
  }
}
