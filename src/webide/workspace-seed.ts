import type { ReturnTypeOfCreateContainer } from "./workbench-host";

export const WORKSPACE_ROOT = "/project";
export const DEFAULT_FILE = `${WORKSPACE_ROOT}/src/App.tsx`;
export const DEFAULT_RUN_COMMAND = "npm run dev";

const DIRECTORIES = [
  `${WORKSPACE_ROOT}/.vscode`,
  `${WORKSPACE_ROOT}/src`,
  `${WORKSPACE_ROOT}/src/components`,
  `${WORKSPACE_ROOT}/src/components/ui`,
  `${WORKSPACE_ROOT}/src/hooks`,
  `${WORKSPACE_ROOT}/src/lib`,
];

const FILES: Record<string, string> = {
  [`${WORKSPACE_ROOT}/package.json`]: JSON.stringify(
    {
      name: "almostnode-webide-tailwind-starter",
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
        react: "^18.2.0",
        "react-dom": "^18.2.0",
      },
      devDependencies: {
        "@types/react": "^18.2.0",
        "@types/react-dom": "^18.2.0",
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
        baseUrl: ".",
        paths: {
          "@/*": ["./src/*"],
        },
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
<html lang="en" class="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>almostnode tailwind starter</title>
    <script type="importmap">
{
  "imports": {
    "react": "https://esm.sh/react@18.2.0?dev",
    "react/": "https://esm.sh/react@18.2.0&dev/",
    "react-dom": "https://esm.sh/react-dom@18.2.0?dev",
    "react-dom/": "https://esm.sh/react-dom@18.2.0&dev/",
    "@/": "./src/"
  }
}
    </script>
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
      "claudeCode.useTerminal": false,
      "claudeCode.preferredLocation": "sidebar",
      "claudeCode.claudeProcessWrapper": "/usr/local/bin/claude-wrapper",
    },
    null,
    2,
  ),
  [`${WORKSPACE_ROOT}/README.md`]: `# almostnode webide starter

This seeded workspace is already wired for Tailwind-style utility classes and shadcn aliases.

- edit \`src/App.tsx\`
- run \`npm run dev\`
- preview the app in the host pane
- use \`npx shadcn@latest add dropdown-menu\` once you want more components

Tailwind is served through the Vite preview via the CDN plus \`tailwind.config.ts\`, so the app starts without a build-time Tailwind install step.
`,
  [`${WORKSPACE_ROOT}/components.json`]: JSON.stringify(
    {
      "$schema": "https://ui.shadcn.com/schema.json",
      style: "new-york",
      rsc: false,
      tsx: true,
      tailwind: {
        config: "tailwind.config.ts",
        css: "src/index.css",
        baseColor: "zinc",
        cssVariables: true,
        prefix: "",
      },
      aliases: {
        components: "@/components",
        utils: "@/lib/utils",
        ui: "@/components/ui",
        lib: "@/lib",
        hooks: "@/hooks",
      },
      iconLibrary: "lucide",
    },
    null,
    2,
  ),
  [`${WORKSPACE_ROOT}/tailwind.config.ts`]: `export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['"Avenir Next"', '"Segoe UI"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', '"SFMono-Regular"', 'monospace'],
      },
    },
  },
};
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
import { Button } from '@/components/ui/button';

const PILLARS = [
  {
    title: 'Tailwind ready',
    detail: 'Utility classes are live immediately through the preview. No bootstrap command is required to start styling.',
  },
  {
    title: 'shadcn aliases',
    detail: 'The workspace already has components.json, @/ imports, CSS variables, and a local Button primitive wired up.',
  },
  {
    title: 'Terminal first',
    detail: 'Keep the preview open while you add packages or components from the same project root in the terminal panel.',
  },
];

const NOTES = [
  {
    title: 'Next useful command',
    body: 'Run npx shadcn@latest add dropdown-menu after you want a real shadcn component. The project is already configured for it.',
  },
  {
    title: 'Tailwind config',
    body: 'Edit tailwind.config.ts to extend colors, spacing, and radii. The Vite preview injects that config automatically.',
  },
  {
    title: 'Theme toggle',
    body: 'This starter uses the standard .dark class so shadcn-style color variables and utility classes stay aligned.',
  },
];

function App() {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    root.style.colorScheme = theme;
  }, [theme]);

  return (
    <main className="min-h-screen bg-transparent text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_22rem]">
          <div className="relative overflow-hidden rounded-[2rem] border border-border/60 bg-background/82 p-6 shadow-[0_40px_120px_-40px_rgba(15,23,42,0.65)] backdrop-blur-xl sm:p-8">
            <div className="absolute inset-x-0 top-0 h-40 bg-[radial-gradient(circle_at_top,rgba(249,115,22,0.22),transparent_62%)]" />
            <div className="relative flex flex-col gap-6">
              <div className="space-y-4">
                <span className="inline-flex w-fit items-center rounded-full border border-border/60 bg-secondary/70 px-3 py-1 font-mono text-[0.72rem] uppercase tracking-[0.28em] text-muted-foreground">
                  Tailwind + shadcn starter
                </span>
                <div className="space-y-4">
                  <h1 className="max-w-4xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                    Style the Web IDE app immediately instead of bootstrapping Tailwind by hand.
                  </h1>
                  <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
                    The preview is already configured for Tailwind utility classes, CSS variables, and shadcn-style aliases.
                    Use this screen as a real starter instead of a plain CSS placeholder.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button onClick={() => setTheme((value) => (value === 'dark' ? 'light' : 'dark'))}>
                  {theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    window.location.hash = '#starter-notes';
                  }}
                >
                  Open starter notes
                </Button>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                {PILLARS.map((pillar) => (
                  <article
                    key={pillar.title}
                    className="rounded-3xl border border-border/60 bg-card/75 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
                  >
                    <p className="text-sm font-semibold tracking-tight">{pillar.title}</p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{pillar.detail}</p>
                  </article>
                ))}
              </div>
            </div>
          </div>

          <aside className="rounded-[2rem] border border-border/60 bg-card/82 p-5 shadow-[0_28px_90px_-45px_rgba(15,23,42,0.7)] backdrop-blur-xl">
            <div className="space-y-5">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">Start here</p>
                <code className="mt-3 block rounded-2xl border border-border/70 bg-secondary/70 px-4 py-3 font-mono text-sm text-foreground">
                  npm run dev
                </code>
              </div>

              <div className="rounded-3xl border border-border/60 bg-background/70 p-4">
                <p className="text-sm font-semibold tracking-tight">Suggested next command</p>
                <p className="mt-2 font-mono text-xs leading-6 text-muted-foreground">
                  npx shadcn@latest add dropdown-menu
                </p>
              </div>

              <div className="space-y-3 text-sm leading-6 text-muted-foreground">
                <p>The app already includes components.json, tailwind.config.ts, and a working @/ import map.</p>
                <p>Edit <span className="font-mono text-foreground">src/App.tsx</span> or drop new files into <span className="font-mono text-foreground">src/components</span>.</p>
              </div>

              <div className="rounded-3xl border border-border/60 bg-secondary/55 p-4">
                <p className="text-sm font-semibold tracking-tight">Aliases</p>
                <ul className="mt-3 space-y-2 font-mono text-xs text-muted-foreground">
                  <li>@/components</li>
                  <li>@/components/ui</li>
                  <li>@/lib/utils</li>
                </ul>
              </div>
            </div>
          </aside>
        </section>

        <section id="starter-notes" className="grid gap-4 md:grid-cols-3">
          {NOTES.map((note) => (
            <article
              key={note.title}
              className="rounded-[1.75rem] border border-border/60 bg-card/75 p-5 shadow-[0_22px_70px_-42px_rgba(15,23,42,0.65)] backdrop-blur-xl"
            >
              <p className="text-xs font-medium uppercase tracking-[0.24em] text-muted-foreground">Starter note</p>
              <h2 className="mt-3 text-xl font-semibold tracking-tight">{note.title}</h2>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{note.body}</p>
            </article>
          ))}
        </section>

        <section className="rounded-[2rem] border border-border/60 bg-background/80 p-5 shadow-[0_28px_90px_-48px_rgba(15,23,42,0.72)] backdrop-blur-xl">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-[0.28em] text-muted-foreground">Preview stack</p>
              <h2 className="text-2xl font-semibold tracking-tight">A Vite-flavored workspace with Tailwind semantics built in.</h2>
            </div>
            <div className="rounded-2xl border border-border/60 bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">
              Edit <span className="font-mono text-foreground">tailwind.config.ts</span> to extend the design tokens.
            </div>
          </div>

          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <div className="rounded-3xl border border-border/60 bg-card/70 p-4">
              <p className="text-sm font-semibold tracking-tight">What changed from the old seed</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                <li>Tailwind utility classes work without a manual init step.</li>
                <li>shadcn aliases and CSS variables are already in place.</li>
                <li>The starter now looks like a real app instead of a plain CSS scaffold.</li>
              </ul>
            </div>

            <div className="rounded-3xl border border-border/60 bg-card/70 p-4">
              <p className="text-sm font-semibold tracking-tight">Useful files</p>
              <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                <li><span className="font-mono text-foreground">src/App.tsx</span> for the landing surface.</li>
                <li><span className="font-mono text-foreground">src/components/ui/button.tsx</span> for a local shadcn-style primitive.</li>
                <li><span className="font-mono text-foreground">src/lib/utils.ts</span> for the shared cn helper.</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
`,
  [`${WORKSPACE_ROOT}/src/lib/utils.ts`]: `export function cn(...inputs: Array<string | false | null | undefined>) {
  return inputs.filter(Boolean).join(' ');
}
`,
  [`${WORKSPACE_ROOT}/src/components/ui/button.tsx`]: `import type { ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'default' | 'secondary' | 'outline';
type ButtonSize = 'default' | 'sm' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const baseStyles =
  'inline-flex items-center justify-center rounded-full font-medium transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-60';

const variantStyles: Record<ButtonVariant, string> = {
  default:
    'bg-primary text-primary-foreground shadow-[0_20px_45px_-24px_rgba(249,115,22,0.85)] hover:-translate-y-0.5 hover:bg-primary/90',
  secondary:
    'bg-secondary text-secondary-foreground hover:-translate-y-0.5 hover:bg-secondary/80',
  outline:
    'border border-border bg-background/70 text-foreground hover:-translate-y-0.5 hover:bg-secondary/70',
};

const sizeStyles: Record<ButtonSize, string> = {
  default: 'h-11 px-5 text-sm',
  sm: 'h-9 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};

export function Button({
  className,
  type = 'button',
  variant = 'default',
  size = 'default',
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(baseStyles, variantStyles[variant], sizeStyles[size], className)}
      {...props}
    />
  );
}
`,
  [`${WORKSPACE_ROOT}/src/index.css`]: `:root {
  --background: 36 40% 96%;
  --foreground: 222 39% 11%;
  --card: 0 0% 100%;
  --card-foreground: 222 39% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 39% 11%;
  --primary: 23 92% 58%;
  --primary-foreground: 24 28% 10%;
  --secondary: 210 32% 92%;
  --secondary-foreground: 222 39% 18%;
  --muted: 210 22% 89%;
  --muted-foreground: 222 15% 40%;
  --accent: 198 69% 47%;
  --accent-foreground: 0 0% 100%;
  --destructive: 0 72% 54%;
  --destructive-foreground: 0 0% 100%;
  --border: 215 25% 84%;
  --input: 215 25% 84%;
  --ring: 23 92% 58%;
  --radius: 1.4rem;
  font-family: "Avenir Next", "Segoe UI", sans-serif;
}

.dark {
  --background: 224 36% 9%;
  --foreground: 36 43% 96%;
  --card: 223 33% 13%;
  --card-foreground: 36 43% 96%;
  --popover: 223 33% 13%;
  --popover-foreground: 36 43% 96%;
  --primary: 24 96% 63%;
  --primary-foreground: 20 28% 10%;
  --secondary: 222 24% 18%;
  --secondary-foreground: 36 43% 96%;
  --muted: 223 21% 17%;
  --muted-foreground: 218 19% 72%;
  --accent: 198 72% 54%;
  --accent-foreground: 224 36% 9%;
  --destructive: 0 74% 58%;
  --destructive-foreground: 0 0% 100%;
  --border: 222 17% 23%;
  --input: 222 17% 23%;
  --ring: 24 96% 63%;
}

* {
  box-sizing: border-box;
  border-color: hsl(var(--border));
}

html,
body,
#root {
  min-height: 100%;
}

body {
  margin: 0;
  font-family: "Avenir Next", "Segoe UI", sans-serif;
  color: hsl(var(--foreground));
  background-color: hsl(var(--background));
  background-image:
    radial-gradient(circle at top left, rgba(249, 115, 22, 0.22), transparent 28rem),
    radial-gradient(circle at bottom right, rgba(56, 189, 248, 0.16), transparent 32rem),
    linear-gradient(180deg, rgba(255, 255, 255, 0.65), rgba(255, 255, 255, 0));
}

.dark body {
  background-image:
    radial-gradient(circle at top left, rgba(249, 115, 22, 0.2), transparent 28rem),
    radial-gradient(circle at bottom right, rgba(56, 189, 248, 0.14), transparent 32rem),
    linear-gradient(180deg, rgba(15, 23, 42, 0.45), rgba(15, 23, 42, 0));
}

button,
input,
textarea,
select {
  font: inherit;
}

code {
  font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
}

::selection {
  background: rgba(249, 115, 22, 0.24);
}
`,
};

const CLAUDE_WRAPPER_PATH = '/usr/local/bin/claude-wrapper';
const CLAUDE_WRAPPER_SCRIPT = '#!/bin/sh\nexec claude "$@"\n';
const SETTINGS_PATH = `${WORKSPACE_ROOT}/.vscode/settings.json`;

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
    // Guard settings file: only seed if it doesn't already exist (preserve user changes on IDB-backed sessions)
    if (path === SETTINGS_PATH && container.vfs.existsSync(path)) {
      continue;
    }
    container.vfs.writeFileSync(path, content);
  }

  // Write Claude wrapper executable
  ensureDirectory(container, '/usr/local/bin');
  container.vfs.writeFileSync(CLAUDE_WRAPPER_PATH, CLAUDE_WRAPPER_SCRIPT);
}
