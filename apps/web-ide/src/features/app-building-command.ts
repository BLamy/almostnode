import type { AppBuildingJobRecord } from './project-db';

export type AppBuildingCommand =
  | { verb: 'help' }
  | { verb: 'list' }
  | { verb: 'create'; name: string; prompt: string; remote: boolean }
  | { verb: 'status'; jobId: string }
  | { verb: 'logs'; jobId: string; offset?: number }
  | { verb: 'message'; jobId: string; prompt: string }
  | { verb: 'stop'; jobId: string };

export const APP_BUILDING_HELP_TEXT = [
  'app-building - remote Fly.io worker orchestration',
  '',
  'Commands:',
  '  app-building create --remote --name <app-name> --prompt <prompt>',
  '  app-building list',
  '  app-building status <job-id>',
  '  app-building logs <job-id> [--offset <n>]',
  '  app-building message <job-id> --prompt <prompt>',
  '  app-building stop <job-id>',
  '',
].join('\n');

function requireValue(
  args: string[],
  index: number,
  flag: string,
): { value: string; nextIndex: number } {
  const value = args[index + 1];
  if (!value) {
    throw new Error(`Missing value for ${flag}.`);
  }
  return { value, nextIndex: index + 2 };
}

export function summarizeAppBuildingPrompt(
  prompt: string,
  maxLength = 120,
): string {
  const singleLine = prompt.replace(/\s+/g, ' ').trim();
  if (singleLine.length <= maxLength) {
    return singleLine;
  }
  return `${singleLine.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function parseAppBuildingCommand(args: string[]): AppBuildingCommand {
  const [verb, ...rest] = args;
  if (!verb || verb === 'help' || verb === '--help' || verb === '-h') {
    return { verb: 'help' };
  }

  if (verb === 'list') {
    return { verb: 'list' };
  }

  if (verb === 'status') {
    const jobId = rest[0]?.trim();
    if (!jobId) {
      throw new Error('Usage: app-building status <job-id>');
    }
    return { verb: 'status', jobId };
  }

  if (verb === 'stop') {
    const jobId = rest[0]?.trim();
    if (!jobId) {
      throw new Error('Usage: app-building stop <job-id>');
    }
    return { verb: 'stop', jobId };
  }

  if (verb === 'logs') {
    const jobId = rest[0]?.trim();
    if (!jobId) {
      throw new Error('Usage: app-building logs <job-id> [--offset <n>]');
    }

    let offset: number | undefined;
    let index = 1;
    while (index < rest.length) {
      const arg = rest[index];
      if (arg === '--offset') {
        const parsed = requireValue(rest, index, '--offset');
        const value = Number.parseInt(parsed.value, 10);
        if (!Number.isFinite(value) || value < 0) {
          throw new Error('--offset must be a non-negative integer.');
        }
        offset = value;
        index = parsed.nextIndex;
        continue;
      }
      throw new Error(`Unknown app-building logs flag: ${arg}`);
    }

    return { verb: 'logs', jobId, offset };
  }

  if (verb === 'message') {
    const jobId = rest[0]?.trim();
    if (!jobId) {
      throw new Error('Usage: app-building message <job-id> --prompt <prompt>');
    }

    let prompt = '';
    let index = 1;
    while (index < rest.length) {
      const arg = rest[index];
      if (arg === '--prompt') {
        const parsed = requireValue(rest, index, '--prompt');
        prompt = parsed.value.trim();
        index = parsed.nextIndex;
        continue;
      }
      throw new Error(`Unknown app-building message flag: ${arg}`);
    }

    if (!prompt) {
      throw new Error('Usage: app-building message <job-id> --prompt <prompt>');
    }

    return { verb: 'message', jobId, prompt };
  }

  if (verb === 'create') {
    let name = '';
    let prompt = '';
    let remote = false;
    let index = 0;
    while (index < rest.length) {
      const arg = rest[index];
      if (arg === '--remote') {
        remote = true;
        index += 1;
        continue;
      }
      if (arg === '--name') {
        const parsed = requireValue(rest, index, '--name');
        name = parsed.value.trim();
        index = parsed.nextIndex;
        continue;
      }
      if (arg === '--prompt') {
        const parsed = requireValue(rest, index, '--prompt');
        prompt = parsed.value.trim();
        index = parsed.nextIndex;
        continue;
      }
      throw new Error(`Unknown app-building create flag: ${arg}`);
    }

    if (!remote) {
      throw new Error('`app-building create` currently requires `--remote`.');
    }
    if (!name || !prompt) {
      throw new Error('Usage: app-building create --remote --name <app-name> --prompt <prompt>');
    }

    return { verb: 'create', name, prompt, remote };
  }

  throw new Error(`Unknown app-building command: ${verb}`);
}

export function formatAppBuildingJobList(
  jobs: AppBuildingJobRecord[],
): string {
  if (jobs.length === 0) {
    return 'No app-building jobs for this project.\n';
  }

  return `${jobs.map((job) => [
    `${job.id}  ${job.status}`,
    `  app: ${job.appName}`,
    `  repo: ${job.repositoryFullName || '(pending)'}`,
    `  branch: ${job.pushBranch || '(pending)'}`,
    `  machine: ${job.machineId || '(pending)'}`,
  ].join('\n')).join('\n\n')}\n`;
}
