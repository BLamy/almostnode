import { expose } from 'comlink';
import { VirtualFS } from '../virtual-fs';
import { executeInstallRequest, serializeInstallResult } from '../npm/core';
import { diffVfsSnapshots } from '../npm/vfs-patch';
import type {
  InstallWorkerPayload,
  InstallWorkerResponse,
} from '../npm/types';

const workerApi = {
  async runInstall(
    payload: InstallWorkerPayload,
    onProgress?: ((message: string) => void) | null,
  ): Promise<InstallWorkerResponse> {
    const vfs = VirtualFS.fromSnapshot(payload.snapshot);
    const result = await executeInstallRequest(
      vfs,
      payload.settings,
      payload.request,
      {
        ...payload.options,
        onProgress: onProgress || undefined,
      },
    );
    const patch = diffVfsSnapshots(payload.snapshot, vfs.toSnapshot());
    return {
      patch,
      result: serializeInstallResult(result),
    };
  },
};

expose(workerApi);
