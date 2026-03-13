/**
 * child_process integration tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { VirtualFS } from '../src/virtual-fs';
import { Runtime } from '../src/runtime';
import { setStreamingCallbacks, clearStreamingCallbacks } from '../src/shims/child_process';

describe('child_process Integration', () => {
  let vfs: VirtualFS;
  let runtime: Runtime;
  let consoleOutput: string[] = [];

  const waitFor = async (predicate: () => boolean, timeoutMs = 3000): Promise<void> => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (predicate()) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
  };

  beforeEach(() => {
    vfs = new VirtualFS();
    consoleOutput = [];
    runtime = new Runtime(vfs, {
      onConsole: (method, args) => {
        consoleOutput.push(args.join(' '));
      },
    });
  });

  describe('exec', () => {
    it('should execute echo command', async () => {
      // Create a test file
      vfs.writeFileSync('/test.txt', 'hello world');

      const code = `
const { exec } = require('child_process');

exec('echo "Hello from bash"', (error, stdout, stderr) => {
  if (error) {
    console.log('error:', error.message);
    return;
  }
  console.log('stdout:', stdout.trim());
});
      `;

      await runtime.execute(code, '/test.js');

      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(consoleOutput.some(o => o.includes('Hello from bash'))).toBe(true);
    });

    it('should execute ls command', async () => {
      // Create some test files
      vfs.writeFileSync('/file1.txt', 'content1');
      vfs.writeFileSync('/file2.txt', 'content2');

      // Re-create runtime to pick up new files
      runtime = new Runtime(vfs, {
        onConsole: (method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');

exec('ls /', (error, stdout, stderr) => {
  if (error) {
    console.log('error:', error.message);
    return;
  }
  console.log('files:', stdout);
});
      `;

      await runtime.execute(code, '/test.js');

      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(consoleOutput.some(o => o.includes('file1.txt') || o.includes('files:'))).toBe(true);
    });

    it('should execute cat command', async () => {
      vfs.writeFileSync('/hello.txt', 'Hello, World!');

      // Re-create runtime to pick up new files
      runtime = new Runtime(vfs, {
        onConsole: (method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');

exec('cat /hello.txt', (error, stdout, stderr) => {
  if (error) {
    console.log('error:', error.message);
    return;
  }
  console.log('content:', stdout);
});
      `;

      await runtime.execute(code, '/test.js');

      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(consoleOutput.some(o => o.includes('Hello, World!'))).toBe(true);
    });

    it('should default exec cwd to process.cwd()', async () => {
      vfs.mkdirSync('/workspace', { recursive: true });
      runtime = new Runtime(vfs, {
        cwd: '/workspace',
        onConsole: (_method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('pwd', (error, stdout, stderr) => {
  if (error) {
    console.log('error:', error.message);
    return;
  }
  console.log('PWD:' + stdout.trim());
});
      `;

      await runtime.execute(code, '/workspace/test.js');
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(consoleOutput.some(o => o.includes('PWD:/workspace'))).toBe(true);
    });

    it('should preload yoga-layout for node scripts', async () => {
      vfs.writeFileSync(
        '/workspace/node_modules/yoga-layout/dist/src/load.js',
        `module.exports = {
  loadYoga: async () => ({
    EDGE_LEFT: 0,
    Node: { create: () => 'from-preload' },
  }),
};`
      );
      // If require('yoga-layout') falls back to package resolution, this should crash.
      vfs.writeFileSync(
        '/workspace/node_modules/yoga-layout/dist/src/index.js',
        'const broken = (;\n'
      );

      runtime = new Runtime(vfs, {
        cwd: '/workspace',
        onConsole: (_method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('node /workspace/app.js', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout.trim());
  if (stderr) console.log('STDERR:' + stderr.trim());
  if (error) console.log('ERROR:' + error.message);
});
      `;

      vfs.writeFileSync(
        '/workspace/app.js',
        'const yoga = require("yoga-layout"); console.log("YOGA:" + yoga.Node.create());'
      );

      await runtime.execute(code, '/workspace/test.js');
      await waitFor(() => consoleOutput.some(o => o.includes('YOGA:from-preload')));

      expect(consoleOutput.some(o => o.includes('YOGA:from-preload'))).toBe(true);
      expect(consoleOutput.some(o => o.includes('ERROR:'))).toBe(false);
    });

    it('should enable TTY for node commands when streaming callbacks are set', async () => {
      vfs.writeFileSync('/workspace/tty-check.js', 'console.log(`TTY:${process.stdout.isTTY ? 1 : 0}`);');

      try {
        setStreamingCallbacks({
          onStdout: () => {},
        });

        const code = `
const { exec } = require('child_process');
exec('node /workspace/tty-check.js', (error, stdout, stderr) => {
  if (error) {
    console.log('ERROR:' + error.message);
    return;
  }
  console.log('OUT:' + stdout.trim());
});
        `;

        await runtime.execute(code, '/test.js');
        await waitFor(() => consoleOutput.some(o => o.includes('OUT:TTY:1')));
      } finally {
        clearStreamingCallbacks();
      }

      expect(consoleOutput.some(o => o.includes('OUT:TTY:1'))).toBe(true);
      expect(consoleOutput.some(o => o.includes('ERROR:'))).toBe(false);
    });

    it('should not hold one-shot node_modules CLIs open under long idle mode', async () => {
      vfs.mkdirSync('/node_modules/cli', { recursive: true });
      vfs.writeFileSync('/node_modules/cli/cli.js', 'console.log("cli-version");');

      runtime = new Runtime(vfs, {
        onConsole: (_method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('node /node_modules/cli/cli.js --version', {
  env: { ...process.env, ALMOSTNODE_LONG_NODE_IDLE: '1' }
}, (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout.trim());
  if (error) console.log('ERROR:' + error.message);
});
      `;

      await runtime.execute(code, '/test.js');
      await waitFor(() => consoleOutput.some(o => o.includes('STDOUT:cli-version')), 3000);

      expect(consoleOutput.some(o => o.includes('STDOUT:cli-version'))).toBe(true);
      expect(consoleOutput.some(o => o.includes('ERROR:'))).toBe(false);
    });
  });

  describe('execFileSync', () => {
    it('should support architecture probe commands like getconf LONG_BIT', async () => {
      const { exports } = await runtime.execute(`
        const cp = require('child_process');
        module.exports = cp.execFileSync('getconf', ['LONG_BIT'], { encoding: 'utf8' }).trim();
      `, '/test.js');

      expect(exports).toBe('64');
    });

    it('should expose execFileSync on default import interop shape', async () => {
      const { exports } = await runtime.execute(`
        var __create = Object.create;
        var __defProp = Object.defineProperty;
        var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
        var __getOwnPropNames = Object.getOwnPropertyNames;
        var __getProtoOf = Object.getPrototypeOf;
        var __hasOwnProp = Object.prototype.hasOwnProperty;
        var __copyProps = (to, from, except, desc) => {
          if (from && typeof from === "object" || typeof from === "function") {
            for (let key of __getOwnPropNames(from))
              if (!__hasOwnProp.call(to, key) && key !== except)
                __defProp(to, key, {
                  get: () => from[key],
                  enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
                });
          }
          return to;
        };
        var __toESM = (mod, isNodeMode, target) => (
          target = mod != null ? __create(__getProtoOf(mod)) : {},
          __copyProps(isNodeMode || !mod || !mod.__esModule
            ? __defProp(target, "default", { value: mod, enumerable: true })
            : target, mod)
        );

        var import_node_child_process = __toESM(require('node:child_process'));
        module.exports = typeof import_node_child_process.default.execFileSync;
      `, '/test.js');

      expect(exports).toBe('function');
    });
  });

  describe('execSync', () => {
    it('should support shell detection probes used by interactive CLIs', async () => {
      const { exports } = await runtime.execute(`
        const cp = require('child_process');
        module.exports = {
          shellPath: cp.execSync('which bash', { encoding: 'utf8' }).trim(),
          shellVersion: cp.execSync('/bin/bash --version', { encoding: 'utf8' }).split('\\n')[0],
        };
      `, '/test.js');

      expect(exports).toEqual({
        shellPath: '/bin/bash',
        shellVersion: 'GNU bash, version 5.2.15(1)-release (x86_64-pc-linux-gnu)',
      });
    });

    it('should execute common bash commands synchronously', async () => {
      vfs.mkdirSync('/workspace', { recursive: true });
      vfs.writeFileSync('/workspace/hello.txt', 'Hello, World!');
      vfs.writeFileSync('/workspace/readme.md', 'README');

      runtime = new Runtime(vfs, {
        cwd: '/workspace',
        onConsole: (_method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const { exports } = await runtime.execute(`
        const cp = require('child_process');
        module.exports = {
          pwd: cp.execSync('pwd', { encoding: 'utf8' }).trim(),
          ls: cp.execSync('ls /workspace', { encoding: 'utf8' }).trim(),
          echo: cp.execSync('echo hello world', { encoding: 'utf8' }).trim(),
          cat: cp.execSync('cat /workspace/hello.txt', { encoding: 'utf8' }),
          bashLs: cp.execSync('/bin/bash -c "ls /workspace"', { encoding: 'utf8' }).trim(),
          bashPwd: cp.execSync('bash -c pwd', { encoding: 'utf8' }).trim(),
          uname: cp.execSync('uname -s', { encoding: 'utf8' }).trim(),
          whoami: cp.execSync('whoami', { encoding: 'utf8' }).trim(),
          trueCmd: (() => { try { cp.execSync('true'); return 'ok'; } catch { return 'error'; } })(),
        };
      `, '/test.js');
      const result = exports as {
        pwd: string;
        ls: string;
        echo: string;
        cat: string;
        bashLs: string;
        bashPwd: string;
        uname: string;
        whoami: string;
        trueCmd: string;
      };

      expect(result.pwd).toBe('/workspace');
      expect(result.ls).toContain('hello.txt');
      expect(result.ls).toContain('readme.md');
      expect(result.echo).toBe('hello world');
      expect(result.cat).toBe('Hello, World!');
      expect(result.bashLs).toContain('hello.txt');
      expect(result.bashPwd).toBe('/workspace');
      expect(result.uname).toBe('Linux');
      expect(result.whoami).toBe('user');
      expect(result.trueCmd).toBe('ok');
    });

    it('should execute spawnSync with common commands', async () => {
      vfs.mkdirSync('/workspace', { recursive: true });
      vfs.writeFileSync('/workspace/file.txt', 'content');

      runtime = new Runtime(vfs, {
        cwd: '/workspace',
        onConsole: (_method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const { exports } = await runtime.execute(`
        const cp = require('child_process');
        const result = cp.spawnSync('ls', ['/workspace'], { encoding: 'utf8' });
        const bashResult = cp.spawnSync('/bin/bash', ['-c', 'pwd'], { encoding: 'utf8', cwd: '/workspace' });
        module.exports = {
          ls: result.stdout.trim(),
          status: result.status,
          bashPwd: bashResult.stdout.trim(),
          bashStatus: bashResult.status,
        };
      `, '/test.js');
      const result = exports as {
        ls: string;
        status: number;
        bashPwd: string;
        bashStatus: number;
      };

      expect(result.ls).toContain('file.txt');
      expect(result.status).toBe(0);
      expect(result.bashPwd).toBe('/workspace');
      expect(result.bashStatus).toBe(0);
    });
  });

  describe('spawnSync', () => {
    it('should support which-style dependency probes used by CLIs', async () => {
      const { exports } = await runtime.execute(`
        const cp = require('child_process');
        const found = cp.spawnSync('which', ['node'], { encoding: 'utf8' });
        const missing = cp.spawnSync('which', ['rg'], { encoding: 'utf8' });
        module.exports = {
          foundStatus: found.status,
          foundStdout: found.stdout.trim(),
          missingStatus: missing.status,
          missingStdout: missing.stdout,
          missingStderr: missing.stderr,
        };
      `, '/test.js');

      expect(exports).toEqual({
        foundStatus: 0,
        foundStdout: '/usr/bin/node',
        missingStatus: 1,
        missingStdout: '',
        missingStderr: '',
      });
    });
  });

  describe('spawn', () => {
    it('should spawn echo command and emit exit', async () => {
      const code = `
const { spawn } = require('child_process');

const child = spawn('echo', ['Hello', 'World']);

child.on('close', (code) => {
  console.log('exit code:', code);
});

child.on('exit', (code) => {
  console.log('process exited with:', code);
});
      `;

      await runtime.execute(code, '/test.js');

      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check that the process completed successfully
      expect(consoleOutput.some(o => o.includes('exit code: 0') || o.includes('process exited with: 0'))).toBe(true);
    });

    it('should write spawn output to numeric stdio file descriptors', async () => {
      vfs.mkdirSync('/workspace', { recursive: true });
      runtime = new Runtime(vfs, {
        cwd: '/workspace',
        onConsole: (_method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const fs = require('fs');
const { spawn } = require('child_process');

const outputPath = '/workspace/claude-shell-output.txt';
const fd = fs.openSync(outputPath, 'a');
const child = spawn('pwd', [], {
  cwd: '/workspace',
  stdio: ['pipe', fd, fd],
});

child.on('close', (code) => {
  fs.closeSync(fd);
  console.log('RESULT:' + code + ':' + fs.readFileSync(outputPath, 'utf8').trim());
});
      `;

      await runtime.execute(code, '/workspace/test.js');
      await waitFor(() => consoleOutput.some(o => o.includes('RESULT:0:/workspace')));

      expect(consoleOutput.some(o => o.includes('RESULT:0:/workspace'))).toBe(true);
    });

    it('should keep writing to numeric stdio fds after the parent closes its copy', async () => {
      vfs.mkdirSync('/workspace', { recursive: true });
      runtime = new Runtime(vfs, {
        cwd: '/workspace',
        onConsole: (_method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const fs = require('fs');
const { spawn } = require('child_process');

const outputPath = '/workspace/claude-shell-output-detached.txt';
const fd = fs.openSync(outputPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND);
const child = spawn('pwd', [], {
  cwd: '/workspace',
  stdio: ['pipe', fd, fd],
});

fs.closeSync(fd);

child.on('close', (code) => {
  console.log('RESULT_AFTER_CLOSE:' + code + ':' + fs.readFileSync(outputPath, 'utf8').trim());
});
      `;

      await runtime.execute(code, '/workspace/test-close-fd.js');
      await waitFor(() => consoleOutput.some(o => o.includes('RESULT_AFTER_CLOSE:0:/workspace')));

      expect(consoleOutput.some(o => o.includes('RESULT_AFTER_CLOSE:0:/workspace'))).toBe(true);
    });

    it('should default spawn cwd to process.cwd()', async () => {
      vfs.mkdirSync('/workspace', { recursive: true });
      runtime = new Runtime(vfs, {
        cwd: '/workspace',
        onConsole: (_method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { spawn } = require('child_process');
const child = spawn('mkdir', ['-p', 'spawned-from-spawn']);
child.on('close', () => {
  console.log('SPAWN_DONE');
});
      `;

      await runtime.execute(code, '/workspace/test.js');
      await new Promise(resolve => setTimeout(resolve, 120));

      expect(consoleOutput.some(o => o.includes('SPAWN_DONE'))).toBe(true);
      expect(vfs.existsSync('/workspace/spawned-from-spawn')).toBe(true);
      expect(vfs.existsSync('/spawned-from-spawn')).toBe(false);
    });

    it('should pipe spawn stdout data to child.stdout stream', async () => {
      vfs.mkdirSync('/workspace', { recursive: true });
      vfs.writeFileSync('/workspace/hello.txt', 'content');
      runtime = new Runtime(vfs, {
        cwd: '/workspace',
        onConsole: (_method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { spawn } = require('child_process');
const child = spawn('ls', ['/workspace']);

let stdout = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});
child.on('close', (code) => {
  console.log('SPAWN_STDOUT:' + (stdout.includes('hello.txt') ? 'HAS_FILE' : 'MISSING') + ':EXIT:' + code);
});
      `;

      await runtime.execute(code, '/workspace/test.js');
      await waitFor(() => consoleOutput.some(o => o.includes('SPAWN_STDOUT:')));

      expect(consoleOutput.some(o => o.includes('SPAWN_STDOUT:HAS_FILE:EXIT:0'))).toBe(true);
    });

    it('should pipe spawn stdout via bash -c', async () => {
      vfs.mkdirSync('/workspace', { recursive: true });
      vfs.writeFileSync('/workspace/test.txt', 'content');
      runtime = new Runtime(vfs, {
        cwd: '/workspace',
        onConsole: (_method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { spawn } = require('child_process');
const child = spawn('/bin/bash', ['-c', 'ls /workspace']);

let stdout = '';
child.stdout.on('data', (chunk) => {
  stdout += chunk.toString();
});
child.on('close', (code) => {
  console.log('BASH_STDOUT:' + (stdout.includes('test.txt') ? 'HAS_FILE' : 'MISSING') + ':EXIT:' + code);
});
      `;

      await runtime.execute(code, '/workspace/test.js');
      await waitFor(() => consoleOutput.some(o => o.includes('BASH_STDOUT:')));

      expect(consoleOutput.some(o => o.includes('BASH_STDOUT:HAS_FILE:EXIT:0'))).toBe(true);
    });
  });

  describe('execFile', () => {
    it('should execute synthetic shell paths used by interactive CLIs', async () => {
      const code = `
const { execFile } = require('child_process');

execFile('/bin/bash', ['-lc', 'echo shell-path-ready'], (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout.trim());
  if (error) console.log('ERROR:' + error.message);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(consoleOutput.some(o => o.includes('STDOUT:shell-path-ready'))).toBe(true);
      expect(consoleOutput.some(o => o.includes('ERROR:'))).toBe(false);
    });

    it('should support /dev/null redirection in synthetic shell commands', async () => {
      const code = `
const { execFile } = require('child_process');

execFile('/bin/bash', ['-lc', 'shopt -u extglob 2>/dev/null || true; echo shell-null-ready'], (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout.trim());
  if (stderr) console.log('STDERR:' + stderr.trim());
  if (error) console.log('ERROR:' + error.message);
});
      `;

      await runtime.execute(code, '/test-null-device.js');
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(consoleOutput.some(o => o.includes('STDOUT:shell-null-ready'))).toBe(true);
      expect(consoleOutput.some(o => o.includes('/dev/null'))).toBe(false);
      expect(consoleOutput.some(o => o.includes('ERROR:'))).toBe(false);
    });
  });

  describe('shell features', () => {
    it('should support pipes', async () => {
      const code = `
const { exec } = require('child_process');

exec('echo "line1\\nline2\\nline3" | wc -l', (error, stdout, stderr) => {
  if (error) {
    console.log('error:', error.message);
    return;
  }
  console.log('lines:', stdout.trim());
});
      `;

      await runtime.execute(code, '/test.js');

      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(consoleOutput.some(o => o.includes('3') || o.includes('lines:'))).toBe(true);
    });

    it('should support command chaining with &&', async () => {
      const code = `
const { exec } = require('child_process');

exec('echo "first" && echo "second"', (error, stdout, stderr) => {
  if (error) {
    console.log('error:', error.message);
    return;
  }
  console.log('output:', stdout);
});
      `;

      await runtime.execute(code, '/test.js');

      // Wait for async execution
      await new Promise(resolve => setTimeout(resolve, 100));

      expect(consoleOutput.some(o => o.includes('first') && o.includes('second'))).toBe(true);
    });
  });

  describe('npm command', () => {
    it('should execute a script from package.json with npm run', async () => {
      vfs.writeFileSync('/package.json', JSON.stringify({
        name: 'test-app',
        version: '1.0.0',
        scripts: { hello: 'echo hello from npm' },
      }));

      runtime = new Runtime(vfs, {
        onConsole: (method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npm run hello', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout);
  if (error) console.log('ERROR:' + error.message);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(consoleOutput.some(o => o.includes('hello from npm'))).toBe(true);
    });

    it('should list available scripts when npm run has no args', async () => {
      vfs.writeFileSync('/package.json', JSON.stringify({
        name: 'test-app',
        scripts: { build: 'echo building', dev: 'echo devving' },
      }));

      runtime = new Runtime(vfs, {
        onConsole: (method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npm run', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(consoleOutput.some(o => o.includes('build') && o.includes('dev'))).toBe(true);
    });

    it('should support npm start shorthand', async () => {
      vfs.writeFileSync('/package.json', JSON.stringify({
        name: 'test-app',
        scripts: { start: 'echo started' },
      }));

      runtime = new Runtime(vfs, {
        onConsole: (method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npm start', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout);
  if (error) console.log('ERROR:' + error.message);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(consoleOutput.some(o => o.includes('started'))).toBe(true);
    });

    it('should support npm test shorthand', async () => {
      vfs.writeFileSync('/package.json', JSON.stringify({
        name: 'test-app',
        scripts: { test: 'echo tested' },
      }));

      runtime = new Runtime(vfs, {
        onConsole: (method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npm test', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout);
  if (error) console.log('ERROR:' + error.message);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(consoleOutput.some(o => o.includes('tested'))).toBe(true);
    });

    it('should return error for missing script', async () => {
      vfs.writeFileSync('/package.json', JSON.stringify({
        name: 'test-app',
        scripts: { build: 'echo build' },
      }));

      runtime = new Runtime(vfs, {
        onConsole: (method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npm run nonexistent', (error, stdout, stderr) => {
  console.log('STDERR:' + stderr);
  if (error) console.log('EXITCODE:' + error.code);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(consoleOutput.some(o => o.includes('Missing script') && o.includes('nonexistent'))).toBe(true);
      expect(consoleOutput.some(o => o.includes('EXITCODE:'))).toBe(true);
    });

    it('should return error when package.json is missing', async () => {
      // No package.json written to VFS

      const code = `
const { exec } = require('child_process');
exec('npm run build', (error, stdout, stderr) => {
  console.log('STDERR:' + stderr);
  if (error) console.log('FAILED');
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(consoleOutput.some(o => o.includes('no package.json'))).toBe(true);
      expect(consoleOutput.some(o => o.includes('FAILED'))).toBe(true);
    });

    it('should execute pre and post lifecycle scripts', async () => {
      vfs.writeFileSync('/package.json', JSON.stringify({
        name: 'test-app',
        scripts: {
          prebuild: 'echo pre',
          build: 'echo main',
          postbuild: 'echo post',
        },
      }));

      runtime = new Runtime(vfs, {
        onConsole: (method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npm run build', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout);
  if (error) console.log('ERROR:' + error.message);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 300));

      const stdoutLine = consoleOutput.find(o => o.startsWith('STDOUT:'));
      expect(stdoutLine).toBeDefined();
      // All three should appear in stdout, in order
      const stdout = stdoutLine!;
      const preIdx = stdout.indexOf('pre');
      const mainIdx = stdout.indexOf('main');
      const postIdx = stdout.indexOf('post');
      expect(preIdx).toBeGreaterThanOrEqual(0);
      expect(mainIdx).toBeGreaterThan(preIdx);
      expect(postIdx).toBeGreaterThan(mainIdx);
    });

    it('should execute scripts with shell features', async () => {
      vfs.writeFileSync('/package.json', JSON.stringify({
        name: 'test-app',
        scripts: { combo: 'echo first && echo second' },
      }));

      runtime = new Runtime(vfs, {
        onConsole: (method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npm run combo', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout);
  if (error) console.log('ERROR:' + error.message);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(consoleOutput.some(o => o.includes('first') && o.includes('second'))).toBe(true);
    });

    it('should execute scripts that invoke node', async () => {
      vfs.writeFileSync('/script.js', 'console.log("node script ran");');
      vfs.writeFileSync('/package.json', JSON.stringify({
        name: 'test-app',
        scripts: { start: 'node /script.js' },
      }));

      runtime = new Runtime(vfs, {
        onConsole: (method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npm start', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout);
  if (error) console.log('ERROR:' + error.message);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 300));

      expect(consoleOutput.some(o => o.includes('node script ran'))).toBe(true);
    });

    it('should show help with npm --help', async () => {
      const code = `
const { exec } = require('child_process');
exec('npm --help', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(consoleOutput.some(o => o.includes('Usage: npm'))).toBe(true);
    });

    it('should return error for unknown subcommand', async () => {
      const code = `
const { exec } = require('child_process');
exec('npm foobar', (error, stdout, stderr) => {
  console.log('STDERR:' + stderr);
  if (error) console.log('FAILED');
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(consoleOutput.some(o => o.includes('Unknown command') && o.includes('foobar'))).toBe(true);
    });
  });

  describe('npx command', () => {
    it('should run an already-installed bin command without installing', async () => {
      // Set up a pre-installed package with bin stub
      vfs.mkdirSync('/node_modules/.bin', { recursive: true });
      vfs.writeFileSync('/node_modules/.bin/hello', 'node "/node_modules/hello/cli.js" "$@"\n');
      vfs.mkdirSync('/node_modules/hello', { recursive: true });
      vfs.writeFileSync('/node_modules/hello/cli.js', 'console.log("hello from npx");');

      runtime = new Runtime(vfs, {
        onConsole: (method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npx hello', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout);
  if (error) console.log('ERROR:' + error.message);
});
      `;

      await runtime.execute(code, '/test.js');
      await waitFor(() => consoleOutput.some(o => o.includes('ERROR_CODE:1')));

      expect(consoleOutput.some(o => o.includes('hello from npx'))).toBe(true);
    });

    it('should pass arguments through to the bin command', async () => {
      vfs.mkdirSync('/node_modules/.bin', { recursive: true });
      vfs.writeFileSync('/node_modules/.bin/greeter', 'node "/node_modules/greeter/index.js" "$@"\n');
      vfs.mkdirSync('/node_modules/greeter', { recursive: true });
      vfs.writeFileSync('/node_modules/greeter/index.js', 'console.log("greeting: " + process.argv.slice(2).join(" "));');

      runtime = new Runtime(vfs, {
        onConsole: (method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npx greeter world foo', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout);
  if (error) console.log('ERROR:' + error.message);
});
      `;

      await runtime.execute(code, '/test.js');
      await waitFor(() => consoleOutput.some(o => o.includes('ERROR_CODE:1')));

      expect(consoleOutput.some(o => o.includes('greeting: world foo'))).toBe(true);
    });

    it('should return error when no command is given', async () => {
      const code = `
const { exec } = require('child_process');
exec('npx', (error, stdout, stderr) => {
  console.log('STDERR:' + stderr);
  if (error) console.log('FAILED');
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 200));

      expect(consoleOutput.some(o => o.includes('missing command'))).toBe(true);
      expect(consoleOutput.some(o => o.includes('FAILED'))).toBe(true);
    });

    it('should strip version specifier for bin lookup', async () => {
      // Install a package as "mypkg" — npx mypkg@1.0.0 should find "mypkg" bin
      vfs.mkdirSync('/node_modules/.bin', { recursive: true });
      vfs.writeFileSync('/node_modules/.bin/mypkg', 'node "/node_modules/mypkg/cli.js" "$@"\n');
      vfs.mkdirSync('/node_modules/mypkg', { recursive: true });
      vfs.writeFileSync('/node_modules/mypkg/cli.js', 'console.log("mypkg ran");');
      vfs.writeFileSync('/node_modules/mypkg/package.json', JSON.stringify({
        name: 'mypkg',
        bin: { mypkg: './cli.js' },
      }));

      runtime = new Runtime(vfs, {
        onConsole: (method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npx mypkg@1.0.0', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout);
  if (error) console.log('ERROR:' + error.message);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(consoleOutput.some(o => o.includes('mypkg ran'))).toBe(true);
    });

    it('should support -p package flag', async () => {
      // -p installs one package, runs a different command
      vfs.mkdirSync('/node_modules/.bin', { recursive: true });
      vfs.writeFileSync('/node_modules/.bin/babel', 'node "/node_modules/@babel/cli/bin/babel.js" "$@"\n');
      vfs.mkdirSync('/node_modules/@babel/cli/bin', { recursive: true });
      vfs.writeFileSync('/node_modules/@babel/cli/bin/babel.js', 'console.log("babel ran");');

      runtime = new Runtime(vfs, {
        onConsole: (method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npx -p @babel/cli babel', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout);
  if (error) console.log('ERROR:' + error.message);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(consoleOutput.some(o => o.includes('babel ran'))).toBe(true);
    });

    it('should include command diagnostics when npx exits non-zero', async () => {
      vfs.mkdirSync('/node_modules/failpkg', { recursive: true });
      vfs.writeFileSync('/node_modules/failpkg/package.json', JSON.stringify({
        name: 'failpkg',
        bin: './cli.js',
      }));
      vfs.writeFileSync(
        '/node_modules/failpkg/cli.js',
        'console.log("about to fail"); process.exit(1);'
      );

      runtime = new Runtime(vfs, {
        onConsole: (_method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npx failpkg', (error, stdout, stderr) => {
  console.log('STDERR:' + stderr);
  if (error) console.log('ERROR_CODE:' + error.code);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(consoleOutput.some(o => o.includes('ERROR_CODE:1'))).toBe(true);
      expect(
        consoleOutput.some(o =>
          o.includes('npx: command "failpkg" exited with code 1 while running node /node_modules/failpkg/')
        )
      ).toBe(true);
      expect(consoleOutput.some(o => o.includes('npx: stdout tail:'))).toBe(true);
      expect(consoleOutput.some(o => o.includes('about to fail'))).toBe(true);
    });

    it('should include the first stderr line in npx diagnostics', async () => {
      vfs.mkdirSync('/node_modules/failstderr', { recursive: true });
      vfs.writeFileSync('/node_modules/failstderr/package.json', JSON.stringify({
        name: 'failstderr',
        bin: './cli.js',
      }));
      vfs.writeFileSync(
        '/node_modules/failstderr/cli.js',
        'console.error("boom reason"); process.exit(1);'
      );

      runtime = new Runtime(vfs, {
        onConsole: (_method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npx failstderr', (error, stdout, stderr) => {
  console.log('STDERR:' + stderr);
  if (error) console.log('ERROR_CODE:' + error.code);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(consoleOutput.some(o => o.includes('ERROR_CODE:1'))).toBe(true);
      expect(consoleOutput.some(o => o.includes('npx: first stderr line: boom reason'))).toBe(true);
    });

    it('should surface ERR_REQUIRE_ESM when a CommonJS bin requires an ESM-only dependency', async () => {
      vfs.mkdirSync('/node_modules/gemini-cli/dist', { recursive: true });
      vfs.writeFileSync('/node_modules/gemini-cli/package.json', JSON.stringify({
        name: 'gemini-cli',
        bin: {
          'gemini-cli': './dist/index.js',
        },
      }));
      vfs.writeFileSync(
        '/node_modules/gemini-cli/dist/index.js',
        'const ink = require("ink"); console.log("gemini uses " + ink);'
      );

      vfs.mkdirSync('/node_modules/ink/build', { recursive: true });
      vfs.writeFileSync('/node_modules/ink/package.json', JSON.stringify({
        name: '@jrichman/ink',
        exports: {
          default: './build/reconciler.js',
        },
      }));
      vfs.writeFileSync(
        '/node_modules/ink/build/reconciler.js',
        `
import process from 'node:process';
if (process.env['DEV'] === 'true') {
  await import('./devtools.js');
}
module.exports = 'ink-ok';
`
      );
      vfs.writeFileSync('/node_modules/ink/build/devtools.js', 'module.exports = { enabled: true };');

      runtime = new Runtime(vfs, {
        onConsole: (_method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npx gemini-cli', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout);
  console.log('STDERR:' + stderr);
  if (error) console.log('ERROR_CODE:' + error.code);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 500));

      const output = consoleOutput.join('\n');
      expect(output).toContain('ERR_REQUIRE_ESM');
      expect(output).toContain(`require() of ES Module 'ink' is not supported`);
      expect(output).toContain('ERROR_CODE:1');
    });

    it('should run npx bins whose ESM entrypoints use arbitrary top-level await', async () => {
      vfs.mkdirSync('/node_modules/@openai/codex/bin', { recursive: true });
      vfs.writeFileSync('/node_modules/@openai/codex/package.json', JSON.stringify({
        name: '@openai/codex',
        type: 'module',
        bin: {
          codex: './bin/codex.js',
        },
      }));
      vfs.writeFileSync(
        '/node_modules/@openai/codex/bin/codex.js',
        `
import process from 'node:process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');
const childResult = await Promise.resolve({ type: 'code', exitCode: 0 });

console.log(pkg.name + ' ready');
process.exit(childResult.exitCode);
`
      );

      runtime = new Runtime(vfs, {
        onConsole: (_method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('npx @openai/codex', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout);
  console.log('STDERR:' + stderr);
  if (error) console.log('ERROR_CODE:' + error.code);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 500));

      const output = consoleOutput.join('\n');
      expect(output).toContain('@openai/codex ready');
      expect(output).not.toContain('await is only valid in async functions');
      expect(output).not.toContain('SyntaxError');
      expect(output).not.toContain('ERROR_CODE:1');
    });
  });

  describe('bin stubs', () => {
    it('should resolve commands from /node_modules/.bin/ via PATH', async () => {
      // Create a simple bin stub like npm install would
      vfs.mkdirSync('/node_modules/.bin', { recursive: true });
      vfs.writeFileSync('/node_modules/.bin/hello', 'node "/node_modules/hello/cli.js" "$@"\n');

      // Create the actual script
      vfs.mkdirSync('/node_modules/hello', { recursive: true });
      vfs.writeFileSync('/node_modules/hello/cli.js', 'console.log("hello from bin stub");');

      runtime = new Runtime(vfs, {
        onConsole: (method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { exec } = require('child_process');
exec('hello', (error, stdout, stderr) => {
  console.log('STDOUT:' + stdout);
  if (error) console.log('ERROR:' + error.message);
});
      `;

      await runtime.execute(code, '/test.js');
      await new Promise(resolve => setTimeout(resolve, 500));

      const output = consoleOutput.join('\n');
      expect(output).toContain('hello from bin stub');
    });
  });

  describe('execa shim', () => {
    it('should expose named execa export compatible with shadcn usage', async () => {
      vfs.mkdirSync('/workspace', { recursive: true });
      vfs.writeFileSync('/workspace/echo.js', 'console.log("execa-ok");');

      runtime = new Runtime(vfs, {
        cwd: '/workspace',
        onConsole: (_method, args) => {
          consoleOutput.push(args.join(' '));
        },
      });

      const code = `
const { execa } = require('execa');
(async () => {
  try {
    const result = await execa('node', ['/workspace/echo.js']);
    console.log('EXECA_STDOUT:' + result.stdout.trim());
  } catch (error) {
    console.log('EXECA_ERROR:' + error.message);
  }
})();
      `;

      await runtime.execute(code, '/workspace/test-execa.js');
      await new Promise(resolve => setTimeout(resolve, 500));

      expect(consoleOutput.some(o => o.includes('EXECA_STDOUT:execa-ok'))).toBe(true);
      expect(consoleOutput.some(o => o.includes('EXECA_ERROR:'))).toBe(false);
    });
  });
});
