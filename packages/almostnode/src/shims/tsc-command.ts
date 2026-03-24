import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import type { VirtualFS } from '../virtual-fs';

/**
 * Intercepts the `tsc` command and redirects it to the TypeScript compiler
 * from the `typescript` package (node_modules/typescript/bin/tsc).
 *
 * Without this shim, `npx tsc` resolves to a rogue npm package called `tsc`
 * (v2.0.4) which is NOT the TypeScript compiler.
 */
export async function runTscCommand(
  args: string[],
  ctx: CommandContext,
  vfs: VirtualFS,
): Promise<JustBashExecResult> {
  const cwd = ctx.cwd || '/';

  if (!ctx.exec) {
    return {
      stdout: '',
      stderr: 'tsc: execution context unavailable\n',
      exitCode: 1,
    };
  }

  // Look for typescript's tsc binary — check cwd-relative first, then root
  const findTscBin = () => {
    const candidates = [
      `${cwd}/node_modules/typescript/bin/tsc`.replace(/\/+/g, '/'),
      '/node_modules/typescript/bin/tsc',
    ];
    return candidates.find((p) => vfs.existsSync(p)) ?? null;
  };

  let tscBinPath = findTscBin();

  // Auto-install typescript if not found
  if (!tscBinPath) {
    await ctx.exec('npm install typescript', { cwd, env: {} });
    tscBinPath = findTscBin();
  }

  if (!tscBinPath) {
    return {
      stdout: '',
      stderr:
        'Error: TypeScript could not be installed. Run `npm install typescript` manually.\n',
      exitCode: 1,
    };
  }

  const quotedArgs = args.map((a) => JSON.stringify(a)).join(' ');
  const command = `node ${tscBinPath}${quotedArgs ? ' ' + quotedArgs : ''}`;

  return ctx.exec(command, { cwd, env: {} });
}
