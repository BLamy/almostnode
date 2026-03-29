import type {
  NetworkFetchRequest,
  NetworkLookupOptions,
  NetworkLookupResult,
  NetworkOptions,
  NetworkFetchResponse,
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
  phase?: 'prepare_public_dns' | 'ipn_start' | 'primary_fetch' | 'fallback_fetch';
  url?: string;
  hostname?: string | null;
  ipAddress?: string | null;
  useExitNode?: boolean;
  exitNodeId?: string | null;
  hadLiveIpn?: boolean;
  attemptedIpMapSync?: boolean;
  capabilities?: {
    canStructuredFetch: boolean;
    canReconfigure: boolean;
    canLookup: boolean;
  };
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
      type: 'hydrateStorage';
      snapshot: TailscaleStateSnapshot | null;
    }
  | {
      type: 'configure';
      options: Required<NetworkOptions>;
    }
  | {
      type: 'getStatus';
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
        | NetworkFetchResponse
        | NetworkLookupResult;
    }
  | {
      type: 'response';
      id: number;
      ok: false;
      error: TailscaleWorkerErrorPayload;
    };
