import type {
  NetworkFetchRequest,
  NetworkLookupOptions,
  NetworkLookupResult,
  NetworkOptions,
  NetworkFetchResponse,
  TailscaleAdapterStatus,
} from './types';
import type { TailscaleStateSnapshot } from './tailscale-session-storage';

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
      error: string;
    };
