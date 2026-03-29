import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDefaultNetworkController } from '../src/network';
import { runTailscaleCommand } from '../src/shims/tailscale-command';
import type { NetworkController, NetworkStatus } from '../src/network/types';

function buildStatus(
  overrides: Partial<NetworkStatus> = {},
): NetworkStatus {
  return {
    provider: 'tailscale',
    state: 'running',
    active: true,
    canLogin: false,
    canLogout: true,
    adapterAvailable: true,
    dnsEnabled: true,
    dnsHealthy: true,
    exitNodes: [],
    selectedExitNodeId: null,
    updatedAt: '2026-03-27T00:00:00.000Z',
    ...overrides,
  };
}

describe('tailscale command', () => {
  afterEach(() => {
    setDefaultNetworkController(null);
  });

  it('renders dns health and selected exit node in status output', async () => {
    const controller: NetworkController = {
      getConfig: vi.fn(),
      configure: vi.fn(),
      getStatus: vi.fn(async () =>
        buildStatus({
          dnsHealthy: false,
          dnsDetail: 'resolver: no upstream resolvers set',
          selectedExitNodeId: 'node-sfo',
          exitNodes: [
            {
              id: 'node-sfo',
              name: 'San Francisco',
              online: true,
              selected: true,
            },
          ],
        })),
      login: vi.fn(),
      logout: vi.fn(),
      fetch: vi.fn(),
      lookup: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    };
    setDefaultNetworkController(controller);

    const result = await runTailscaleCommand([], {} as never);

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('dnsEnabled: yes');
    expect(result.stdout).toContain('dnsHealthy: no');
    expect(result.stdout).toContain('dnsDetail: resolver: no upstream resolvers set');
    expect(result.stdout).toContain('exitNode: San Francisco');
  });

  it('enables dns by default on tailscale up and forwards set flags', async () => {
    const configure = vi.fn(async () => buildStatus());
    const login = vi.fn(async () => buildStatus());
    const controller: NetworkController = {
      getConfig: vi.fn(),
      configure,
      getStatus: vi.fn(),
      login,
      logout: vi.fn(async () => buildStatus({ state: 'stopped', active: false })),
      fetch: vi.fn(),
      lookup: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    };
    setDefaultNetworkController(controller);

    const upResult = await runTailscaleCommand(['up'], {} as never);
    const setResult = await runTailscaleCommand(
      ['set', '--exit-node=node-ord', '--accept-dns=false'],
      {} as never,
    );

    expect(upResult.exitCode).toBe(0);
    expect(setResult.exitCode).toBe(0);
    expect(configure).toHaveBeenNthCalledWith(1, {
      provider: 'tailscale',
      useExitNode: true,
      acceptDns: true,
    });
    expect(login).toHaveBeenCalledTimes(1);
    expect(configure).toHaveBeenNthCalledWith(2, {
      provider: 'tailscale',
      useExitNode: true,
      exitNodeId: 'node-ord',
      acceptDns: false,
    });
  });
});
