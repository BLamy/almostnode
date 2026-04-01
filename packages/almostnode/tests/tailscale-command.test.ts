import { afterEach, describe, expect, it, vi } from 'vitest';
import { setDefaultNetworkController } from '../src/network';
import { runTailscaleCommand } from '../src/shims/tailscale-command';
import type {
  NetworkController,
  NetworkDiagnosticsSnapshot,
  NetworkStatus,
} from '../src/network/types';

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

function buildDiagnostics(
  overrides: Partial<NetworkDiagnosticsSnapshot> = {},
): NetworkDiagnosticsSnapshot {
  return {
    provider: 'tailscale',
    available: true,
    state: 'running',
    counters: {
      totalFetches: 0,
      publicFetches: 0,
      tailnetFetches: 0,
      structuredFetches: 0,
      directIpFallbacks: 0,
      runtimeResets: 0,
      recoveriesAttempted: 0,
      successes: 0,
      failures: 0,
    },
    failureBuckets: {
      dns_loopback: 0,
      direct_ip_fallback_failed: 0,
      structured_fetch_missing_body_base64: 0,
      body_read_timeout: 0,
      fetch_timeout_other: 0,
      runtime_panic: 0,
      runtime_unavailable_other: 0,
      tls_sni_failed: 0,
    },
    dominantFailureBucket: null,
    recentFailures: [],
    runtimeGeneration: 1,
    runtimeResetCount: 0,
    lastRuntimeResetReason: null,
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
      getDiagnostics: vi.fn(async () => buildDiagnostics()),
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
      getDiagnostics: vi.fn(async () => buildDiagnostics()),
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

  it('renders a compact diagnostics summary and supports --json output', async () => {
    const controller: NetworkController = {
      getConfig: vi.fn(),
      configure: vi.fn(),
      getDiagnostics: vi.fn(async () => buildDiagnostics({
        counters: {
          totalFetches: 12,
          publicFetches: 8,
          tailnetFetches: 4,
          structuredFetches: 6,
          directIpFallbacks: 2,
          runtimeResets: 3,
          recoveriesAttempted: 2,
          successes: 9,
          failures: 3,
        },
        failureBuckets: {
          dns_loopback: 1,
          direct_ip_fallback_failed: 1,
          structured_fetch_missing_body_base64: 0,
          body_read_timeout: 1,
          fetch_timeout_other: 0,
          runtime_panic: 0,
          runtime_unavailable_other: 0,
          tls_sni_failed: 0,
        },
        dominantFailureBucket: 'dns_loopback',
        recentFailures: [{
          seenAt: '2026-04-01T12:00:00.000Z',
          host: 'chatgpt.com',
          targetType: 'public',
          bucket: 'body_read_timeout',
          errorCode: 'fetch_timeout',
          message: 'Tailscale response body read failed: context deadline exceeded',
          phase: 'read_body',
          requestShape: {
            method: 'POST',
            hasBody: true,
            contentType: 'application/json',
            acceptsEventStream: true,
          },
          useExitNode: true,
          exitNodeId: 'node-sfo',
          runtimeGeneration: 4,
          runtimeResetCount: 3,
          lastRuntimeResetReason: 'Tailscale response body read failed: context deadline exceeded',
        }],
        runtimeGeneration: 4,
        runtimeResetCount: 3,
        lastRuntimeResetReason: 'Tailscale response body read failed: context deadline exceeded',
      })),
      getStatus: vi.fn(async () => buildStatus()),
      login: vi.fn(),
      logout: vi.fn(),
      fetch: vi.fn(),
      lookup: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    };
    setDefaultNetworkController(controller);

    const summary = await runTailscaleCommand(['debug'], {} as never);
    const json = await runTailscaleCommand(['debug', '--json'], {} as never);

    expect(summary.exitCode).toBe(0);
    expect(summary.stdout).toContain('diagnosticsAvailable: yes');
    expect(summary.stdout).toContain('dominantFailureBucket: dns_loopback');
    expect(summary.stdout).toContain('failureBuckets: dns_loopback=1, direct_ip_fallback_failed=1, body_read_timeout=1');
    expect(summary.stdout).toContain('lastFailure: 2026-04-01T12:00:00.000Z body_read_timeout host=chatgpt.com phase=read_body code=fetch_timeout method=POST');

    expect(json.exitCode).toBe(0);
    expect(JSON.parse(json.stdout)).toMatchObject({
      status: { state: 'running' },
      diagnostics: {
        dominantFailureBucket: 'dns_loopback',
        runtimeResetCount: 3,
      },
    });
  });
});
