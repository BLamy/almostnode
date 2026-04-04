import { describe, expect, it } from 'vitest';
import { Runtime } from '../src/runtime';
import { VirtualFS } from '../src/virtual-fs';

describe('aws command child_process integration', () => {
  it('supports direct-dispatched aws commands with quoted flags via exec callbacks', async () => {
    const vfs = new VirtualFS();
    const consoleOutput: string[] = [];
    const runtime = new Runtime(vfs, {
      onConsole: (_method, args) => {
        consoleOutput.push(args.join(' '));
      },
    });

    await runtime.execute(`
      const { exec } = require('child_process');
      exec('aws configure sso-session --name dev --start-url "https://example.awsapps.com/start" --region us-east-1', (sessionError, _stdout1, stderr1) => {
        if (sessionError) {
          console.log('ERR1:' + sessionError.message + stderr1);
          return;
        }
        exec('aws configure profile --name dev --sso-session dev --account-id 123456789012 --role-name "Administrator Access" --region us-east-1', (profileError, _stdout2, stderr2) => {
          if (profileError) {
            console.log('ERR2:' + profileError.message + stderr2);
            return;
          }
          exec('aws configure list', (listError, stdout3, stderr3) => {
            if (listError) {
              console.log('ERR3:' + listError.message + stderr3);
              return;
            }
            console.log('AWS:' + stdout3);
          });
        });
      });
    `, '/test.js');

    const waitFor = async (predicate: () => boolean, timeoutMs = 8000): Promise<void> => {
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        if (predicate()) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }

      throw new Error(`Timed out waiting for AWS child_process output: ${consoleOutput.join('\n')}`);
    };

    await waitFor(() =>
      consoleOutput.some((line) => line.includes('AWS:'))
      || consoleOutput.some((line) => line.startsWith('ERR')),
    );

    expect(consoleOutput.some((line) => line.includes('AWS:'))).toBe(true);
    expect(consoleOutput.some((line) => line.includes('Administrator Access'))).toBe(true);
  }, 15000);
});
