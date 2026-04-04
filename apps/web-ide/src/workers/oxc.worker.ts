import {
  runOxcOnSource,
  type RunOxcOnSourceOptions,
} from "almostnode/internal";

type WorkerRequest = {
  id: number;
  input: RunOxcOnSourceOptions;
};

type WorkerResponse = {
  id: number;
  result?: Awaited<ReturnType<typeof runOxcOnSource>>;
  error?: string;
};

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (message: WorkerResponse) => void;
};

workerScope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, input } = event.data;
  try {
    const result = await runOxcOnSource(input);
    workerScope.postMessage({
      id,
      result,
    } satisfies WorkerResponse);
  } catch (error) {
    workerScope.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    } satisfies WorkerResponse);
  }
};
