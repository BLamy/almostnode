import type {
  NetworkDiagnosticsSnapshot,
  NetworkFetchRequest,
  NetworkLookupOptions,
  NetworkLookupResult,
  NetworkFetchResponse,
  ResolvedNetworkOptions,
  TailscaleAdapterStatus,
} from './types';
import type { TailscaleStateSnapshot } from './tailscale-session-storage';

export type TailscaleWorkerErrorCode =
  | 'unsupported_fetch_shape'
  | 'dns_resolution_failed'
  | 'tls_sni_failed'
  | 'fetch_timeout'
  | 'runtime_panic'
  | 'runtime_unavailable';

export interface TailscaleWorkerErrorDebug {
  phase?: 'prepare_public_dns' | 'ipn_start' | 'recover_runtime' | 'primary_fetch' | 'fallback_fetch' | 'read_body';
  url?: string;
  hostname?: string | null;
  ipAddress?: string | null;
  useExitNode?: boolean;
  exitNodeId?: string | null;
  hadLiveIpn?: boolean;
  timeoutMs?: number;
  runtimeGeneration?: number;
  runtimeResetCount?: number;
  lastRuntimeResetReason?: string | null;
  attemptedIpMapSync?: boolean;
  capabilities?: {
    canStructuredFetch: boolean;
    canReconfigure: boolean;
    canLookup: boolean;
  };
  responseUrl?: string;
  responseStatus?: number;
  hadBodyBase64?: boolean;
  expectedBodyBase64?: boolean;
  recentRuntimeSignal?: string | null;
  recentRuntimeSignalAgeMs?: number | null;
  bodyReadError?: string;
  fallbackStrategy?: 'rewrite_to_resolved_ip';
  fallbackAttempted?: boolean;
  primaryError?: string;
  fallbackError?: string;
}

export interface TailscaleWorkerErrorPayload {
  code: TailscaleWorkerErrorCode;
  message: string;
  debug?: TailscaleWorkerErrorDebug;
}

export type TailscaleWorkerRequest =
  | {
      type: 'setDebug';
      raw: string | null;
    }
  | {
      type: 'hydrateStorage';
      snapshot: TailscaleStateSnapshot | null;
    }
  | {
      type: 'configure';
      options: ResolvedNetworkOptions;
    }
  | {
      type: 'getStatus';
    }
  | {
      type: 'getDiagnostics';
    }
  | {
      type: 'login';
    }
  | {
      type: 'logout';
    }
  | {
      type: 'fetch';
      request: NetworkFetchRequest;
    }
  | {
      type: 'lookup';
      hostname: string;
      options?: NetworkLookupOptions;
    };

export type TailscaleWorkerRequestWithId = TailscaleWorkerRequest & {
  id: number;
};

export type TailscaleWorkerEvent =
  | {
      type: 'storageUpdate';
      snapshot: TailscaleStateSnapshot | null;
    }
  | {
      type: 'status';
      status: TailscaleAdapterStatus;
    }
  | {
      type: 'response';
      id: number;
      ok: true;
      value:
        | null
        | TailscaleAdapterStatus
        | NetworkDiagnosticsSnapshot
        | NetworkFetchResponse
        | NetworkLookupResult;
    }
  | {
      type: 'response';
      id: number;
      ok: false;
      error: TailscaleWorkerErrorPayload;
    };
