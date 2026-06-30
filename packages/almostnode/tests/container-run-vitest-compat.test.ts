// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createContainer } from '../src/index';

describe('container.run Vitest compatibility', () => {
  it('honors process.exitCode when process.exit has no explicit code', async () => {
    const container = createContainer();
    container.vfs.writeFileSync('/exit.js', 'process.exitCode = 7; process.exit();\n');

    const result = await container.run('node /exit.js');

    expect(result.exitCode).toBe(7);
  });

  it('queues fork IPC messages until the child registers a message listener', async () => {
    const container = createContainer();
    container.vfs.writeFileSync(
      '/child.js',
      `
        process.on('message', (message) => {
          process.send('got:' + message);
          process.exit(0);
        });
      `,
    );
    container.vfs.writeFileSync(
      '/parent.js',
      `
        const { fork } = require('child_process');
        const child = fork('/child.js');
        child.on('message', (message) => {
          console.log(message);
        });
        child.send('start');
      `,
    );

    const result = await container.run('node /parent.js');

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('got:start');
  });
});
