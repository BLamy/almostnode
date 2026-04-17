const { chromium } = require('@playwright/test');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const consoleMessages = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', (error) => {
    pageErrors.push(String(error && error.stack ? error.stack : error));
  });

  try {
    await page.goto('http://localhost:5175/examples/shadcn-demo.html', {
      waitUntil: 'load',
      timeout: 60000,
    });
    await page.waitForFunction(
      () => Boolean(window.__shadcnContainer),
      { timeout: 60000 },
    );
    await page.waitForTimeout(3000);

    const inspectBuild = async () => page.evaluate(async () => {
      const runtime = window.__shadcnContainer.runtime;
      const loader = runtime.moduleLoader;
      const descriptor = loader.resolve('/node_modules/@anthropic-ai/claude-code/cli.js');
      try {
        const source = await loader.buildEsmModuleSource(descriptor);
        return {
          ok: true,
          format: descriptor.format,
          sourcePreview: source.slice(0, 400),
        };
      } catch (error) {
        return {
          ok: false,
          format: descriptor.format,
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : String(error),
        };
      }
    });

    const runInPage = async () => page.evaluate(async () => {
      const out = [];
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 30000);
      try {
        const runResult = await window.__shadcnContainer.run(
          'npx @anthropic-ai/claude-code',
          {
            signal: controller.signal,
            onStdout: (text) => out.push(`STDOUT:${text}`),
            onStderr: (text) => out.push(`STDERR:${text}`),
          },
        );

        return {
          exitCode: runResult.exitCode,
          stdout: runResult.stdout.slice(0, 4000),
          stderr: runResult.stderr.slice(0, 4000),
          out: out.slice(0, 300),
        };
      } finally {
        clearTimeout(timer);
      }
    });

    let result;
    try {
      result = await runInPage();
    } catch (error) {
      if (!String(error).includes('Execution context was destroyed')) {
        throw error;
      }
      await page.waitForFunction(
        () => Boolean(window.__shadcnContainer),
        { timeout: 60000 },
      );
      await page.waitForTimeout(3000);
      result = await runInPage();
    }

    const esmBuild = await inspectBuild();

    console.log(
      JSON.stringify(
        {
          esmBuild,
          result,
          consoleMessages,
          pageErrors,
        },
        null,
        2,
      ),
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
