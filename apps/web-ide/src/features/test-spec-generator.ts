import type { RecordedStep } from './test-recorder';

function escapeString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n');
}

function generateSelector(step: RecordedStep): string {
  const ctx = step.selectorContext;
  if (!ctx) return `page.locator('[data-ref]')`;

  // Prefer data-testid if available
  if (ctx.testId) {
    return `page.getByTestId('${escapeString(ctx.testId)}')`;
  }

  // Use role + name for stable selectors
  if (ctx.role && ctx.name) {
    return `page.getByRole('${escapeString(ctx.role)}', { name: '${escapeString(ctx.name)}' })`;
  }

  // Fallback to role only
  if (ctx.role) {
    return `page.getByRole('${escapeString(ctx.role)}')`;
  }

  return `page.locator('${escapeString(ctx.tagName.toLowerCase())}')`;
}

function generateStepCode(step: RecordedStep): string | null {
  switch (step.command) {
    case 'open': {
      const url = step.args[0] || '/';
      return `  await page.goto('${escapeString(url)}');`;
    }

    case 'click': {
      const selector = generateSelector(step);
      return `  await ${selector}.click();`;
    }

    case 'fill': {
      const value = step.args.slice(1).join(' ');
      const selector = generateSelector(step);
      return `  await ${selector}.fill('${escapeString(value)}');`;
    }

    case 'type': {
      const text = step.args.join(' ');
      return `  await page.keyboard.type('${escapeString(text)}');`;
    }

    case 'press': {
      const key = step.args[0] || 'Enter';
      return `  await page.keyboard.press('${escapeString(key)}');`;
    }

    case 'hover': {
      const selector = generateSelector(step);
      return `  await ${selector}.hover();`;
    }

    case 'snapshot':
    case 'console':
    case 'eval':
    case 'screenshot':
      // Context commands — generate as comments
      return `  // ${step.command} ${step.args.join(' ')}`.trimEnd();

    default:
      return null;
  }
}

export function generateTestSpec(name: string, steps: RecordedStep[]): string {
  const lines: string[] = [];

  lines.push(`import { test, expect } from '@playwright/test';`);
  lines.push('');
  lines.push(`test('${escapeString(name)}', async ({ page }) => {`);

  for (const step of steps) {
    const code = generateStepCode(step);
    if (code) lines.push(code);
  }

  lines.push('});');
  lines.push('');

  return lines.join('\n');
}

export interface TestMetadata {
  id: string;
  name: string;
  specPath: string;
  createdAt: string;
  status: 'pending' | 'passed' | 'failed' | 'running';
  lastRunAt?: string;
  error?: string;
}

export function generateTestId(): string {
  return `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
