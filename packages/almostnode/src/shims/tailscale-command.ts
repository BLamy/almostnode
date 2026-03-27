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
      case 'login': {
        await controller.configure({ provider: 'tailscale', useExitNode: true });
        const status = await controller.login();
        return ok(renderStatus(status));
      }
      case 'logout': {
        const status = await controller.logout();
        return ok(renderStatus(status));
      }
      case 'status': {
        const status = await controller.getStatus();
        return ok(renderStatus(status));
      }
      case '--help':
      case 'help':
        return ok(`Usage: tailscale <status|login|logout>
Commands:
  status   Show the current almostnode Tailscale session status
  login    Start an interactive Tailscale login for almostnode networking
  logout   Disconnect the current almostnode Tailscale session
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
