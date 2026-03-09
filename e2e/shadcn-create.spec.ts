import { test, expect } from '@playwright/test';

const CREATE_COMMAND = 'npx shadcn@latest create --template next --base radix --preset nova --name next-app --no-monorepo --yes';
const WORKSPACE = '/project';
const PROJECT_PATH = '/project/next-app';

type AttemptResult = {
  attempt: number;
  exitCode: number;
  stdoutTail: string;
  stderrTail: string;
  streamTail: string;
  rootEntries: string[];
  projectEntries: string[];
  exists: {
    projectDir: boolean;
    componentsJson: boolean;
    button: boolean;
    utils: boolean;
    globalsCss: boolean;
  };
};

test.describe('shadcn create in VFS', () => {
  test('creates a project scaffold in /project', async ({ page }) => {
    test.setTimeout(5 * 60 * 1000);

    await page.goto('/examples/shadcn-demo.html');
    await page.waitForFunction(() => Boolean((window as any).__shadcnContainer), { timeout: 45000 });

    const maxAttempts = 4;
    const attempts: AttemptResult[] = [];

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const result = await page.evaluate(async ({ command, workspace, projectPath, attemptNo }) => {
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

        const container = await waitForContainer();
        if (!container) {
          return {
            attempt: attemptNo,
            exitCode: -1,
            stdoutTail: '',
            stderrTail: 'Demo container not initialized',
            streamTail: '',
            rootEntries: [],
            projectEntries: [],
            exists: {
              projectDir: false,
              componentsJson: false,
              button: false,
              utils: false,
              globalsCss: false,
            },
          } satisfies AttemptResult;
        }

        const removeRecursive = (path: string) => {
          let stat;
          try {
            stat = container.vfs.statSync(path);
          } catch {
            return;
          }

          if (!stat.isDirectory()) {
            try { container.vfs.unlinkSync(path); } catch {}
            return;
          }

          let entries: string[] = [];
          try {
            entries = container.vfs.readdirSync(path);
          } catch {}
          for (const entry of entries) {
            removeRecursive(`${path}/${entry}`.replace(/\/+/g, '/'));
          }
          try { container.vfs.rmdirSync(path); } catch {}
        };

        // Reset workspace to a deterministic empty state for each attempt.
        try {
          const rootEntries = container.vfs.readdirSync(workspace);
          for (const entry of rootEntries) {
            removeRecursive(`${workspace}/${entry}`.replace(/\/+/g, '/'));
          }
        } catch {
          container.vfs.mkdirSync(workspace, { recursive: true });
        }

        const streamOutput: string[] = [];
        const runResult = await container.run(command, {
          cwd: workspace,
          onStdout: (text: string) => streamOutput.push(`O:${text}`),
          onStderr: (text: string) => streamOutput.push(`E:${text}`),
        });

        const exists = {
          projectDir: container.vfs.existsSync(projectPath),
          componentsJson: container.vfs.existsSync(`${projectPath}/components.json`),
          button: container.vfs.existsSync(`${projectPath}/components/ui/button.tsx`),
          utils: container.vfs.existsSync(`${projectPath}/lib/utils.ts`),
          globalsCss: container.vfs.existsSync(`${projectPath}/app/globals.css`),
        };

        let rootEntries: string[] = [];
        try {
          rootEntries = container.vfs.readdirSync(workspace);
        } catch {}

        let projectEntries: string[] = [];
        try {
          projectEntries = container.vfs.readdirSync(projectPath);
        } catch {}

        const stdoutTail = String(runResult.stdout || '').slice(-4000);
        const stderrTail = String(runResult.stderr || '').slice(-4000);
        const streamTail = streamOutput.join('').slice(-12000);

        return {
          attempt: attemptNo,
          exitCode: runResult.exitCode,
          stdoutTail,
          stderrTail,
          streamTail,
          rootEntries,
          projectEntries,
          exists,
        } satisfies AttemptResult;
      }, { command: CREATE_COMMAND, workspace: WORKSPACE, projectPath: PROJECT_PATH, attemptNo: attempt });

      attempts.push(result);

      const success = result.exitCode === 0
        && result.exists.projectDir
        && result.exists.componentsJson
        && result.exists.button
        && result.exists.utils
        && result.exists.globalsCss;

      if (success) {
        break;
      }
    }

    const last = attempts[attempts.length - 1];
    const lastSummary = [
      `attempt=${last.attempt}`,
      `exitCode=${last.exitCode}`,
      `rootEntries=${last.rootEntries.join(',')}`,
      `projectEntries=${last.projectEntries.join(',')}`,
      `exists=${JSON.stringify(last.exists)}`,
      `stderrTail=${last.stderrTail}`,
      `stdoutTail=${last.stdoutTail}`,
      `streamTail=${last.streamTail}`,
    ].join('\n');

    expect(last.exitCode, lastSummary).toBe(0);
    expect(last.exists.projectDir, lastSummary).toBe(true);
    expect(last.exists.componentsJson, lastSummary).toBe(true);
    expect(last.exists.button, lastSummary).toBe(true);
    expect(last.exists.utils, lastSummary).toBe(true);
    expect(last.exists.globalsCss, lastSummary).toBe(true);
  });
});
