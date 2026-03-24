import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, type ReactNode } from 'react';
import type { TemplateId } from '../features/workspace-seed';

type IndexSearch = {
  template?: string;
  corsProxy?: string;
};

export const Route = createFileRoute('/')({
  validateSearch: (search: Record<string, unknown>): IndexSearch => ({
    template: typeof search.template === 'string' ? search.template : undefined,
    corsProxy: typeof search.corsProxy === 'string' ? search.corsProxy : undefined,
  }),
  component: TemplatePicker,
});

const TEMPLATES: Array<{
  id: TemplateId;
  title: string;
  description: string;
  tags: string[];
  logo: ReactNode;
}> = [
  {
    id: 'vite',
    title: 'Vite + React',
    description: 'Fast dev server with HMR, Tailwind CSS, and shadcn-ready aliases.',
    tags: ['React 18', 'Vite 5', 'Tailwind'],
    logo: (
      <svg className="template-picker__logo" viewBox="0 0 256 257" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <linearGradient id="viteA" x1="-.83%" y1="7.65%" x2="57.64%" y2="78.39%">
            <stop offset="0%" stopColor="#41D1FF" />
            <stop offset="100%" stopColor="#BD34FE" />
          </linearGradient>
          <linearGradient id="viteB" x1="43.38%" y1="2.24%" x2="50.32%" y2="60.15%">
            <stop offset="0%" stopColor="#FFBD4F" />
            <stop offset="100%" stopColor="#FF9640" />
          </linearGradient>
        </defs>
        <path d="M255.15 37.95 134.24 228.69c-2.13 3.36-7.01 3.49-9.32.25L1.58 38.17c-2.52-3.53.88-8.03 4.97-6.57l121.35 43.05a5.34 5.34 0 0 0 3.56-.01L251.94 31.3c4.06-1.5 7.52 2.92 5.02 6.46l-1.81.19Z" fill="url(#viteA)" />
        <path d="M185.58.64 96.35 17.53a2.67 2.67 0 0 0-2.14 2.24l-15.47 83.58a2.67 2.67 0 0 0 3.18 3.07l26.82-5.57c1.73-.36 3.27 1.14 2.96 2.89l-4.66 26.25a2.67 2.67 0 0 0 3.28 3.04l16.55-3.93c1.73-.41 3.29 1.1 2.97 2.86l-7.41 40.62c-.5 2.74 3.16 4.21 4.72 1.9l1.04-1.54 57.48-112.68c.9-1.77-.7-3.76-2.62-3.24l-27.94 7.54a2.67 2.67 0 0 1-3.18-3.34l18.27-62.23A2.67 2.67 0 0 0 167 .87L185.58.64Z" fill="url(#viteB)" />
      </svg>
    ),
  },
  {
    id: 'nextjs',
    title: 'Next.js',
    description: 'App Router with file-based routing, layouts, and Tailwind CSS.',
    tags: ['Next 14', 'App Router', 'Tailwind'],
    logo: (
      <svg className="template-picker__logo" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">
        <mask id="nextMask" style={{ maskType: 'alpha' }} maskUnits="userSpaceOnUse" x="0" y="0" width="180" height="180">
          <circle cx="90" cy="90" r="90" fill="black" />
        </mask>
        <g mask="url(#nextMask)">
          <circle cx="90" cy="90" r="90" fill="black" />
          <path d="M149.51 157.47L71.2 52H56v76.01h12.17V67.63l72.32 97.73A90.42 90.42 0 0 0 149.51 157.47Z" fill="url(#nextGradA)" />
          <rect x="113" y="52" width="12" height="76" fill="url(#nextGradB)" />
        </g>
        <defs>
          <linearGradient id="nextGradA" x1="109" y1="116.5" x2="144.5" y2="160.5" gradientUnits="userSpaceOnUse">
            <stop stopColor="white" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="nextGradB" x1="121" y1="52" x2="120.8" y2="116.5" gradientUnits="userSpaceOnUse">
            <stop stopColor="white" />
            <stop offset="1" stopColor="white" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    ),
  },
  {
    id: 'tanstack',
    title: 'TanStack Router',
    description: 'Type-safe file-based routing with SPA navigation on Vite.',
    tags: ['React 18', 'TanStack Router', 'Vite'],
    logo: (
      <svg className="template-picker__logo" viewBox="0 0 633 633" xmlns="http://www.w3.org/2000/svg">
        <path d="M316.5 0C142 0 0 142 0 316.5S142 633 316.5 633 633 491 633 316.5 491 0 316.5 0z" fill="#002B41" />
        <path d="M316.5 84c-58 0-105.5 90.4-105.5 200.5 0 8.8.3 17.4.9 25.8C152 327 117 358.5 117 395.5c0 58 90.4 105 200.5 105 8.2 0 16.2-.2 24.1-.7 16.5 56.6 47.7 90.7 82.9 90.7 58 0 105-90.4 105-200.5 0-7-.2-13.9-.5-20.7C584.5 352.3 617 321 617 285c0-58-90.4-105-200.5-105-9.5 0-18.8.3-27.9.8C372.3 126.5 341.8 84 316.5 84z" fill="#FFD94C" />
        <ellipse cx="316.5" cy="284.5" rx="105.5" ry="200.5" fill="#002B41" />
        <ellipse cx="316.5" cy="284.5" rx="105.5" ry="200.5" transform="rotate(60 316.5 316.5)" fill="#002B41" />
        <ellipse cx="316.5" cy="284.5" rx="105.5" ry="200.5" transform="rotate(-60 316.5 316.5)" fill="#002B41" />
        <circle cx="316.5" cy="316.5" r="45" fill="#FFD94C" />
      </svg>
    ),
  },
];

function TemplatePicker() {
  const navigate = useNavigate();
  const { template, corsProxy } = Route.useSearch();

  const templateFromQuery = TEMPLATES.find((candidate) => candidate.id === template)?.id;

  useEffect(() => {
    if (!templateFromQuery) {
      return;
    }

    void navigate({
      to: '/ide',
      replace: true,
      search: {
        template: templateFromQuery,
        ...(corsProxy !== undefined ? { corsProxy } : {}),
      },
    });
  }, [templateFromQuery, corsProxy, navigate]);

  const handleCardClick = (templateId: TemplateId) => {
    void navigate({
      to: '/ide',
      search: {
        template: templateId,
        ...(corsProxy !== undefined ? { corsProxy } : {}),
      },
    });
  };

  if (templateFromQuery) {
    return null;
  }

  return (
    <div className="template-picker">
      <div className="template-picker__header">
        <h1 className="template-picker__title">Start a new project</h1>
        <p className="template-picker__subtitle">
          Pick a template to seed the workspace and boot the IDE.
        </p>
      </div>
      <div className="template-picker__cards">
        {TEMPLATES.map((tmpl) => (
          <div
            key={tmpl.id}
            className="template-picker__card"
            onClick={() => handleCardClick(tmpl.id)}
          >
            {tmpl.logo}
            <h2 className="template-picker__card-title">{tmpl.title}</h2>
            <p className="template-picker__card-desc">{tmpl.description}</p>
            <div className="template-picker__tags">
              {tmpl.tags.map((tag) => (
                <span key={tag} className="template-picker__tag">{tag}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
