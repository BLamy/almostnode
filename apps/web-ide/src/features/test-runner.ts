import type { VirtualFS } from 'almostnode';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PwWebStep {
  type: string;
  action: string;
  description: string;
  status: 'passed' | 'failed';
  error?: string;
  timestamp?: number;
  index?: number;
}

export interface TestRunResult {
  testId: string;
  passed: boolean;
  steps: PwWebStep[];
  duration: number;
  error?: string;
}

export interface TestRunnerCallbacks {
  onTestStart: (testId: string) => void;
  onTestComplete: (testId: string, result: TestRunResult) => void;
  onProgress: (completed: number, total: number) => void;
}

// ── Transform ────────────────────────────────────────────────────────────────

export interface TransformedTest {
  fileName: string;
  testNames: string[];
  code: string;
}

/**
 * Strip a brace-delimited block starting at the `{` found at or after `blockStart`.
 */
function stripBalancedBlock(code: string, blockStart: number): string | null {
  const braceOpen = code.indexOf('{', blockStart);
  if (braceOpen === -1) return null;

  let depth = 1;
  let i = braceOpen + 1;
  while (i < code.length && depth > 0) {
    if (code[i] === '{') depth++;
    if (code[i] === '}') depth--;
    i++;
  }
  if (depth !== 0) return null;

  let lineStart = blockStart;
  while (lineStart > 0 && code[lineStart - 1] !== '\n') lineStart--;

  return code.slice(0, lineStart) + code.slice(i);
}

/**
 * Transform a Playwright spec file for in-browser execution:
 * strips imports, TS annotations, screenshots, and extracts test names.
 */
export function transformTestFile(fileName: string, raw: string): TransformedTest {
  let code = raw;

  // 1. Strip all import statements
  code = code.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/^import\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/^import\s+\w+\s+from\s+['"][^'"]+['"];?\s*$/gm, '');
  code = code.replace(/^const\s+\w+\s*=\s*require\([^)]+\);?\s*$/gm, '');

  // 2. Strip process.env.TEST_ARTIFACTS_DIR blocks
  const envPattern = /if\s*\(\s*process\.env\.TEST_ARTIFACTS_DIR\s*\)/g;
  let envMatch;
  while ((envMatch = envPattern.exec(code)) !== null) {
    const result = stripBalancedBlock(code, envMatch.index);
    if (result !== null) {
      code = result;
      envPattern.lastIndex = 0;
    }
  }

  // 3. Strip page.screenshot(...) calls
  const ssPattern = /await\s+page\.screenshot\s*\(/g;
  let ssMatch;
  while ((ssMatch = ssPattern.exec(code)) !== null) {
    const parenStart = code.indexOf('(', ssMatch.index);
    if (parenStart === -1) continue;
    let depth = 1;
    let i = parenStart + 1;
    while (i < code.length && depth > 0) {
      if (code[i] === '(') depth++;
      if (code[i] === ')') depth--;
      i++;
    }
    if (depth !== 0) continue;
    while (i < code.length && /[\s;]/.test(code[i])) i++;
    code = code.slice(0, ssMatch.index) + code.slice(i);
    ssPattern.lastIndex = 0;
  }

  // 4. Strip TypeScript type annotations
  code = code.replace(
    /(?:const|let|var)\s+(\w+)\s*:\s*[\w.]+(?:<[^>]*>)?(?:\[\])?\s*=/g,
    'const $1 =',
  );

  // 4b. Strip TypeScript non-null assertions
  code = code.replace(/(\w)!(?!=)(?=[.\[\)\]\,;\s])/g, '$1');

  // 5. Extract test names
  const testNames: string[] = [];
  const describeMatch = code.match(/test\.describe\(\s*["'`]([^"'`]+)["'`]/);
  const describePrefix = describeMatch ? describeMatch[1] + ' > ' : '';

  const testNameRegex = /test\(\s*["'`]([^"'`]+)["'`]/g;
  let m;
  while ((m = testNameRegex.exec(code)) !== null) {
    testNames.push(describePrefix + m[1]);
  }

  return { fileName, testNames, code };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function waitForIframeLoad(iframe: HTMLIFrameElement, timeoutMs = 10000): Promise<void> {
  return new Promise<void>((resolve) => {
    const onLoad = () => {
      iframe.removeEventListener('load', onLoad);
      resolve();
    };
    iframe.addEventListener('load', onLoad);
    setTimeout(resolve, timeoutMs);
  });
}

// ── TestRunner ───────────────────────────────────────────────────────────────

declare global {
  interface Window {
    playwrightWeb?: {
      createContext(): {
        test: (name: string, fn: (fixtures: any) => Promise<void>) => void;
        expect: (actual: any) => any;
        runSingleTest: (testName: string, options: any) => Promise<{
          name: string;
          status: string;
          error: Error | null;
          steps: any[];
        }>;
        clearTests: () => void;
        getTests: () => any[];
        getTestNames: () => string[];
      };
    };
  }
}

export class TestRunner {
  private callbacks: TestRunnerCallbacks | null = null;
  private hostContainer: HTMLElement | null = null;

  constructor(
    private readonly vfs: VirtualFS,
    private readonly devServerUrl: string,
  ) {}

  setCallbacks(callbacks: TestRunnerCallbacks): void {
    this.callbacks = callbacks;
  }

  setHostContainer(container: HTMLElement): void {
    this.hostContainer = container;
  }

  /**
   * Run a single test by reading its spec file from VFS and executing via pw-web.js.
   */
  async runTest(specPath: string, testName: string, testId: string): Promise<TestRunResult> {
    const startTime = performance.now();
    const steps: PwWebStep[] = [];
    let testPassed = true;
    let testError: string | undefined;

    try {
      // 1. Read spec from VFS
      const raw = this.vfs.readFileSync(specPath, 'utf8') as string;

      // 2. Transform: strip imports, TS annotations
      const transformed = transformTestFile(specPath, raw);

      // 3. Ensure pw-web.js is loaded
      if (!window.playwrightWeb) {
        throw new Error('pw-web.js not loaded — call loadPwWeb() first');
      }

      // 4. Create an isolated pw-web context
      const ctx = window.playwrightWeb.createContext();

      // 5. Create a test iframe
      const iframe = document.createElement('iframe');
      iframe.style.cssText = 'width:400px;height:300px;border:1px solid #333;border-radius:4px;background:#fff;';
      iframe.sandbox.add('allow-scripts', 'allow-same-origin', 'allow-forms');
      if (this.hostContainer) {
        this.hostContainer.appendChild(iframe);
      }

      // 6. Navigate iframe to dev server
      iframe.src = this.devServerUrl;
      await waitForIframeLoad(iframe);
      await delay(500); // allow app to mount

      // 7. Wrap transformed code in a function and register tests with the context
      const wrappedCode = `return function(__ctx) {
  const { test, expect } = __ctx;
  ${transformed.code}
}`;

      let registerFn: (ctx: any) => void;
      try {
        registerFn = new Function(wrappedCode)();
      } catch (err) {
        throw new Error(`Failed to compile spec: ${err instanceof Error ? err.message : String(err)}`);
      }

      // Register the test(s) into this context
      registerFn(ctx);

      // 8. Resolve the test name — use the first registered test if testName doesn't match exactly
      const registeredNames = ctx.getTestNames();
      const resolvedName = registeredNames.includes(testName)
        ? testName
        : registeredNames[0];

      if (!resolvedName) {
        throw new Error(`No tests found in ${specPath}`);
      }

      // 9. Run the test via pw-web's runSingleTest
      this.callbacks?.onTestStart(testId);

      const result = await ctx.runSingleTest(resolvedName, {
        targetDocument: iframe.contentDocument,
        onGoto: async (path: string) => {
          const url = path.startsWith('http')
            ? path
            : `${this.devServerUrl}${path.startsWith('/') ? '' : '/'}${path}`;
          iframe.src = url;
          await waitForIframeLoad(iframe);
          await delay(300);
        },
        onWaitForLoadState: async () => {
          await delay(200);
        },
        onStep: (_testName: string, step: any) => {
          steps.push({
            type: step.type || 'action',
            action: step.action || step.type || 'unknown',
            description: step.description || `${step.action || step.type || 'step'}`,
            status: 'passed', // will be overridden if test fails
            timestamp: step.timestamp,
            index: step.index,
          });
        },
      });

      testPassed = result.status === 'passed';
      if (result.error) {
        testError = result.error instanceof Error ? result.error.message : String(result.error);
        // Mark the last step as failed
        if (steps.length > 0) {
          steps[steps.length - 1].status = 'failed';
          steps[steps.length - 1].error = testError;
        }
      }

      // Cleanup iframe
      iframe.src = 'about:blank';
      // Don't remove — keep visible for debugging
    } catch (err) {
      testPassed = false;
      testError = err instanceof Error ? err.message : String(err);
    }

    const duration = Math.round(performance.now() - startTime);

    const runResult: TestRunResult = {
      testId,
      passed: testPassed,
      steps,
      duration,
      error: testError,
    };

    this.callbacks?.onTestComplete(testId, runResult);
    this.callbacks?.onProgress(1, 1);

    return runResult;
  }

  dispose(): void {
    // Nothing to clean up — iframes are managed per-run
  }
}
