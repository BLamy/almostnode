import type { CommandContext, ExecResult as JustBashExecResult } from 'just-bash';
import { getDefaultNetworkController } from '../network';
import type { NetworkDiagnosticsSnapshot, NetworkStatus } from '../network/types';

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

function renderDebugSummary(
  status: NetworkStatus,
  diagnostics: NetworkDiagnosticsSnapshot,
): string {
  const lines = [
    `provider: ${status.provider}`,
    `state: ${status.state}`,
    `diagnosticsAvailable: ${diagnostics.available ? 'yes' : 'no'}`,
    `diagnosticsState: ${diagnostics.state}`,
    `runtimeGeneration: ${diagnostics.runtimeGeneration}`,
    `runtimeResetCount: ${diagnostics.runtimeResetCount}`,
    `recoveriesAttempted: ${diagnostics.counters.recoveriesAttempted}`,
    `dominantFailureBucket: ${diagnostics.dominantFailureBucket ?? 'none'}`,
    `fetches: total=${diagnostics.counters.totalFetches} public=${diagnostics.counters.publicFetches} tailnet=${diagnostics.counters.tailnetFetches} structured=${diagnostics.counters.structuredFetches}`,
    `results: successes=${diagnostics.counters.successes} failures=${diagnostics.counters.failures} directIpFallbacks=${diagnostics.counters.directIpFallbacks}`,
  ];

  if (diagnostics.lastRuntimeResetReason) {
    lines.push(`lastRuntimeResetReason: ${diagnostics.lastRuntimeResetReason}`);
  }

  const nonZeroBuckets = Object.entries(diagnostics.failureBuckets)
    .filter(([, count]) => count > 0)
    .map(([bucket, count]) => `${bucket}=${count}`);
  if (nonZeroBuckets.length > 0) {
    lines.push(`failureBuckets: ${nonZeroBuckets.join(', ')}`);
  }

  const lastFailure = diagnostics.recentFailures[0];
  if (lastFailure) {
    lines.push(
      `lastFailure: ${lastFailure.seenAt} ${lastFailure.bucket} host=${lastFailure.host ?? 'unknown'} phase=${lastFailure.phase ?? 'unknown'} code=${lastFailure.errorCode ?? 'unknown'} method=${lastFailure.requestShape.method}`,
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
      case 'debug': {
        const json = args.slice(1);
        if (json.length > 1 || (json[0] && json[0] !== '--json')) {
          return err(`tailscale debug: unknown flag '${json[0]}'\n`);
        }

        const status = await controller.getStatus();
        const diagnostics = await controller.getDiagnostics();
        if (json[0] === '--json') {
          return ok(`${JSON.stringify({ status, diagnostics }, null, 2)}\n`);
        }
        return ok(renderDebugSummary(status, diagnostics));
      }
      case '--help':
      case 'help':
        return ok(`Usage: tailscale <status|up|down|set|debug|login|logout>
Commands:
  status   Show the current almostnode Tailscale session status
  up       Start an interactive Tailscale login for almostnode networking
  down     Disconnect the current almostnode Tailscale session
  set      Update exit-node and DNS preferences
  debug    Show Tailscale diagnostics summary (--json for structured output)
  login    Alias for 'up'
  logout   Alias for 'down'

Debug repro:
  1. Open the IDE with ?debug=tailscale,network,http
  2. Reproduce the failure or recovery
  3. Run: tailscale debug --json
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
