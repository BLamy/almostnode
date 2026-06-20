import { test, expect } from '@playwright/test';

const WORKSPACE = '/project';

type ShadcnTemplateCase = {
  template: string;
  expectedAfterCreate: string[];
  expectedAfterAdd: string[];
};

const TEMPLATE_CASES: ShadcnTemplateCase[] = [
  {
    template: 'next',
    expectedAfterCreate: [
      'components.json',
      'package.json',
    ],
    expectedAfterAdd: ['components/ui/card.tsx'],
  },
  {
    template: 'start',
    expectedAfterCreate: [
      'components.json',
      'package.json',
    ],
    expectedAfterAdd: ['src/components/ui/card.tsx'],
  },
  {
    template: 'vite',
    expectedAfterCreate: [
      'components.json',
      'package.json',
    ],
    expectedAfterAdd: ['src/components/ui/card.tsx'],
  },
  {
    template: 'react-router',
    expectedAfterCreate: [
      'components.json',
      'package.json',
    ],
    expectedAfterAdd: ['app/components/ui/card.tsx'],
  },
  {
    template: 'astro',
    expectedAfterCreate: [
      'components.json',
      'package.json',
    ],
    expectedAfterAdd: ['src/components/ui/card.tsx'],
  },
];

type TemplateRunResult = {
  template: string;
  appName: string;
  createCommand: string;
  addCommand: string;
  createExitCode: number;
  addExitCode: number;
  createTimedOut: boolean;
  addTimedOut: boolean;
  createError: string;
  addError: string;
  createStdoutTail: string;
  createStderrTail: string;
  addStdoutTail: string;
  addStderrTail: string;
  rootEntries: string[];
  exists: Record<string, boolean>;
};

test.describe('shadcn create/add in VFS', () => {
  test('creates JS/TS template scaffolds and adds components through bunx', async ({ page }) => {
    test.setTimeout(25 * 60 * 1000);

    await page.goto('/examples/shadcn-demo.html');
    await page.waitForFunction(() => Boolean((window as any).__shadcnContainer), { timeout: 45000 });

    const results: TemplateRunResult[] = [];

    for (const templateCase of TEMPLATE_CASES) {
      const result = await page.evaluate(async ({ workspace, templateCase }) => {
        const waitForContainer = async () => {
          const deadline = Date.now() + 30000;
          while (Date.now() < deadline) {
            const active = (window as any).__shadcnContainer;
            if (active) {
              return active;
            }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          return null;
        };

        const compactTail = (value: string, length = 3000) => String(value || '')
          .replace(/\x1B\[[0-9;?]*[A-Za-z]/g, '')
          .replace(/\r/g, '\n')
          .slice(-length);

        const runWithTimeout = async (command: string, cwd: string, timeoutMs: number) => {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          try {
            const result = await container.run(command, {
              cwd,
              signal: controller.signal,
            });
            return {
              exitCode: result.exitCode,
              timedOut: false,
              error: '',
              stdout: result.stdout || '',
              stderr: result.stderr || '',
            };
          } catch (error) {
            return {
              exitCode: controller.signal.aborted ? -2 : -1,
              timedOut: controller.signal.aborted,
              error: String((error as Error)?.stack || error),
              stdout: '',
              stderr: '',
            };
          } finally {
            clearTimeout(timer);
          }
        };

        const container = await waitForContainer();
        if (!container) {
          return {
            template: templateCase.template,
            appName: '',
            createCommand: '',
            addCommand: '',
            createExitCode: -1,
            addExitCode: -1,
            createTimedOut: false,
            addTimedOut: false,
            createError: '',
            addError: '',
            createStdoutTail: '',
            createStderrTail: 'Demo container not initialized',
            addStdoutTail: '',
            addStderrTail: '',
            rootEntries: [],
            exists: {},
          } satisfies TemplateRunResult;
        }

        try {
          container.vfs.mkdirSync(workspace, { recursive: true });
        } catch {}

        const appName = `${templateCase.template}-bunx-${Date.now()}`.replace(/[^a-z0-9-]/g, '-');
        const projectPath = `${workspace}/${appName}`;
        const createCommand = [
          'bunx shadcn@latest create',
          `--template ${templateCase.template}`,
          '--base radix',
          '--preset nova',
          `--name ${appName}`,
          '--no-monorepo',
          '--yes',
        ].join(' ');
        const addCommand = 'bunx shadcn@latest add card --yes';

        const create = await runWithTimeout(createCommand, workspace, 6 * 60 * 1000);
        const add = create.exitCode === 0
          ? await runWithTimeout(addCommand, projectPath, 3 * 60 * 1000)
          : { exitCode: -1, timedOut: false, error: 'create failed', stdout: '', stderr: '' };

        const expectedPaths = [
          ...templateCase.expectedAfterCreate,
          ...templateCase.expectedAfterAdd,
        ];
        const exists = Object.fromEntries(
          expectedPaths.map((relativePath) => [
            relativePath,
            container.vfs.existsSync(`${projectPath}/${relativePath}`),
          ]),
        );

        let rootEntries: string[] = [];
        try {
          rootEntries = container.vfs.readdirSync(projectPath);
        } catch {}

        return {
          template: templateCase.template,
          appName,
          createCommand,
          addCommand,
          createExitCode: create.exitCode,
          addExitCode: add.exitCode,
          createTimedOut: create.timedOut,
          addTimedOut: add.timedOut,
          createError: compactTail(create.error),
          addError: compactTail(add.error),
          createStdoutTail: compactTail(create.stdout),
          createStderrTail: compactTail(create.stderr),
          addStdoutTail: compactTail(add.stdout),
          addStderrTail: compactTail(add.stderr),
          rootEntries,
          exists,
        } satisfies TemplateRunResult;
      }, { workspace: WORKSPACE, templateCase });

      results.push(result);

      const summary = [
        `template=${result.template}`,
        `appName=${result.appName}`,
        `createCommand=${result.createCommand}`,
        `addCommand=${result.addCommand}`,
        `createExitCode=${result.createExitCode}`,
        `addExitCode=${result.addExitCode}`,
        `createTimedOut=${result.createTimedOut}`,
        `addTimedOut=${result.addTimedOut}`,
        `rootEntries=${result.rootEntries.join(',')}`,
        `exists=${JSON.stringify(result.exists)}`,
        `createError=${result.createError}`,
        `addError=${result.addError}`,
        `createStdoutTail=${result.createStdoutTail}`,
        `createStderrTail=${result.createStderrTail}`,
        `addStdoutTail=${result.addStdoutTail}`,
        `addStderrTail=${result.addStderrTail}`,
      ].join('\n');

      expect(result.createExitCode, summary).toBe(0);
      expect(result.addExitCode, summary).toBe(0);
      for (const [relativePath, exists] of Object.entries(result.exists)) {
        expect(exists, `${summary}\nmissing=${relativePath}`).toBe(true);
      }
    }
  });
});
