// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createContainer } from '../src/index';

describe('repro shadcn npx', () => {
  it('runs npx shadcn init with preset and template', async () => {
    const container = createContainer();

    const WORK_DIR = '/workspace';
    container.vfs.mkdirSync(WORK_DIR, { recursive: true });
    container.vfs.writeFileSync(`${WORK_DIR}/package.json`, JSON.stringify({
      name: 'repro',
      version: '0.0.1',
      private: true,
      scripts: {},
    }, null, 2));

    const output: string[] = [];
    const result = await container.run('npx shadcn@latest init --preset awNh89Y --template vite', {
      cwd: WORK_DIR,
      onStdout: (text) => output.push(`O:${text}`),
      onStderr: (text) => output.push(`E:${text}`),
    });

    console.log(output.join(''));
    console.log('EXIT', result.exitCode);
    expect(typeof result.exitCode).toBe('number');
    expect(result.stdout + result.stderr).toContain('shadcn');
  }, 120000);
});
