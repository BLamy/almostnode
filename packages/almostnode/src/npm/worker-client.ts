import { proxy, wrap, type Remote } from 'comlink';
import type {
  InstallWorkerPayload,
  InstallWorkerResponse,
  PackageManagerWorkerClient,
} from './types';

interface NpmInstallWorkerApi {
  runInstall(
    payload: InstallWorkerPayload,
    onProgress?: ((message: string) => void) | null,
  ): Promise<InstallWorkerResponse>;
}

export class NpmInstallWorkerClient implements PackageManagerWorkerClient {
  private worker: Worker | null = null;
  private workerApi: Remote<NpmInstallWorkerApi> | null = null;

  async runInstall(
    payload: InstallWorkerPayload,
    onProgress?: ((message: string) => void) | null,
  ): Promise<InstallWorkerResponse> {
    const api = this.getWorkerApi();
    return api.runInstall(payload, onProgress ? proxy(onProgress) : null);
  }

  terminate(): void {
    this.workerApi = null;
    this.worker?.terminate();
    this.worker = null;
  }

  private getWorkerApi(): Remote<NpmInstallWorkerApi> {
    if (this.workerApi) {
      return this.workerApi;
    }

    this.worker = new Worker(
      new URL('../worker/npm-install-worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.workerApi = wrap<NpmInstallWorkerApi>(this.worker);
    return this.workerApi;
  }
}
