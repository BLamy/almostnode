import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { WASI as NodeWASI } from "node:wasi";
import { Worker } from "node:worker_threads";

type OxcExports = {
  Severity: {
    Error: string;
    Warning: string;
    Advice: string;
  };
  Oxc: new () => {
    astJson: string;
    formattedText: string;
    formatterFormattedText: string;
    getDiagnostics(): unknown[];
    run(sourceText: string, options: unknown): void;
  };
};

type NodeBindingModule = {
  exports: OxcExports;
};

type WasmRuntimeModule = {
  createOnMessage: (nodeFs: typeof fs) => (data: unknown) => void;
  getDefaultContext: () => unknown;
  instantiateNapiModuleSync: (
    wasm: Uint8Array,
    options: {
      asyncWorkPoolSize: number;
      beforeInit: (context: {
        instance: {
          exports: Record<string, unknown>;
        };
      }) => void;
      context: unknown;
      onCreateWorker: () => Worker;
      overwriteImports: (
        importObject: Record<string, Record<string, unknown>>,
      ) => Record<string, Record<string, unknown>>;
      reuseWorker: boolean;
      wasi: NodeWASI;
    },
  ) => {
    napiModule: {
      exports: OxcExports;
    };
  };
};

let nodeBindingPromise: Promise<NodeBindingModule> | null = null;

function getAsyncWorkPoolSize(): number {
  const raw = Number(
    process.env.NAPI_RS_ASYNC_WORK_POOL_SIZE ?? process.env.UV_THREADPOOL_SIZE,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 4;
}

function createNodeWasi(): NodeWASI {
  const rootDirectory = path.parse(process.cwd()).root;
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );

  return new NodeWASI({
    version: "preview1",
    env,
    preopens: {
      [rootDirectory]: rootDirectory,
    },
  });
}

async function createNodeBinding(): Promise<NodeBindingModule> {
  const require = createRequire(import.meta.url);
  const wasmRuntime = require("@napi-rs/wasm-runtime") as WasmRuntimeModule;
  const emnapiContext = wasmRuntime.getDefaultContext();
  const sharedMemory = new WebAssembly.Memory({
    initial: 4000,
    maximum: 65536,
    shared: true,
  });
  const wasmPath = fileURLToPath(
    new URL("./vendor/playground.wasm32-wasi.wasm", import.meta.url),
  );
  const workerUrl = new URL("./vendor/wasi-worker-node.mjs", import.meta.url);
  const { napiModule } = wasmRuntime.instantiateNapiModuleSync(
    fs.readFileSync(wasmPath),
    {
      asyncWorkPoolSize: getAsyncWorkPoolSize(),
      beforeInit({ instance }) {
        for (const name of Object.keys(instance.exports)) {
          if (!name.startsWith("__napi_register__")) {
            continue;
          }
          const register = instance.exports[name];
          if (typeof register === "function") {
            (register as () => void)();
          }
        }
      },
      context: emnapiContext,
      onCreateWorker() {
        const handleWorkerMessage = wasmRuntime.createOnMessage(fs);
        const worker = new Worker(workerUrl, {
          env: process.env,
        });
        worker.on("message", (data) => {
          handleWorkerMessage(data);
        });
        worker.unref();
        return worker;
      },
      overwriteImports(importObject) {
        importObject.env = {
          ...importObject.env,
          ...importObject.napi,
          ...importObject.emnapi,
          memory: sharedMemory,
        };
        return importObject;
      },
      reuseWorker: true,
      wasi: createNodeWasi(),
    },
  );

  return {
    exports: napiModule.exports,
  };
}

export async function getOxcNodeBinding(): Promise<NodeBindingModule> {
  nodeBindingPromise ??= createNodeBinding();
  return nodeBindingPromise;
}
