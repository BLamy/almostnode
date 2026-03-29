import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import { getDefaultNetworkController } from '../network';
import type { NetworkStatus } from '../network/types';

function ok(stdout: string): JustBashExecResult {
  return { stdout, stderr: '', exitCode: 0 };
}

function err(stderr: string, exitCode = 1): JustBashExecResult {
  return { stdout: '', stderr, exitCode };
}

function renderStatus(status: NetworkStatus): string {
  const lines = [
    `provider: ${status.provider}`,
    `state: ${status.state}`,
    `active: ${status.active ? 'yes' : 'no'}`,
    `dnsEnabled: ${status.dnsEnabled ? 'yes' : 'no'}`,
    `dnsHealthy: ${status.dnsHealthy === null ? 'unknown' : status.dnsHealthy ? 'yes' : 'no'}`,
  ];

  if (status.selfName) {
    lines.push(`self: ${status.selfName}`);
  }
  if (status.tailnetName) {
    lines.push(`tailnet: ${status.tailnetName}`);
  }
  if (status.detail) {
    lines.push(`detail: ${status.detail}`);
  }
  if (status.dnsDetail) {
    lines.push(`dnsDetail: ${status.dnsDetail}`);
  }
  if (status.loginUrl) {
    lines.push(`loginUrl: ${status.loginUrl}`);
  }
  if (status.selectedExitNodeId) {
    const selectedExitNode = status.exitNodes.find(
      (exitNode) => exitNode.id === status.selectedExitNodeId,
    );
    lines.push(`exitNode: ${selectedExitNode?.name || status.selectedExitNodeId}`);
  }
  if (status.exitNodes.length > 0) {
    lines.push(
      `exitNodes: ${status.exitNodes
        .map((exitNode) => `${exitNode.selected ? '*' : ''}${exitNode.name}`)
        .join(', ')}`,
    );
  }

  return `${lines.join('\n')}\n`;
}

export async function runTailscaleCommand(
  args: string[],
  _ctx: CommandContext,
): Promise<JustBashExecResult> {
  const command = args[0] || 'status';
  const controller = getDefaultNetworkController();

  try {
    switch (command) {
      case 'up':
      case 'login': {
        await controller.configure({
          provider: 'tailscale',
          useExitNode: true,
          acceptDns: true,
        });
        const status = await controller.login();
        return ok(renderStatus(status));
      }
      case 'down':
      case 'logout': {
        const status = await controller.logout();
        return ok(renderStatus(status));
      }
      case 'set': {
        let exitNodeId: string | null | undefined;
        let acceptDns: boolean | undefined;

        for (let index = 1; index < args.length; index += 1) {
          const arg = args[index];
          if (arg === '--exit-node') {
            exitNodeId = args[index + 1]?.trim() || null;
            index += 1;
            continue;
          }
          if (arg.startsWith('--exit-node=')) {
            exitNodeId = arg.slice('--exit-node='.length).trim() || null;
            continue;
          }
          if (arg === '--accept-dns') {
            const value = args[index + 1];
            acceptDns = value ? value !== 'false' : true;
            if (value) {
              index += 1;
            }
            continue;
          }
          if (arg.startsWith('--accept-dns=')) {
            acceptDns = arg.slice('--accept-dns='.length) !== 'false';
            continue;
          }
          return err(`tailscale set: unknown flag '${arg}'\n`);
        }

        const status = await controller.configure({
          provider: 'tailscale',
          useExitNode: true,
          exitNodeId,
          acceptDns,
        });
        return ok(renderStatus(status));
      }
      case 'status': {
        const status = await controller.getStatus();
        return ok(renderStatus(status));
      }
      case '--help':
      case 'help':
        return ok(`Usage: tailscale <status|up|down|set|login|logout>
Commands:
  status   Show the current almostnode Tailscale session status
  up       Start an interactive Tailscale login for almostnode networking
  down     Disconnect the current almostnode Tailscale session
  set      Update exit-node and DNS preferences
  login    Alias for 'up'
  logout   Alias for 'down'
`);
      default:
        return err(`tailscale: unknown subcommand '${command}'\n`);
    }
  } catch (error) {
    return err(
      `tailscale: ${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
}
