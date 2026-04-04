import {
  getDefaultContext as getEmnapiDefaultContext,
  instantiateNapiModule,
  WASI,
} from "@napi-rs/wasm-runtime";

import playgroundWasmUrl from "./vendor/playground.wasm32-wasi.wasm?url";

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

type BrowserBindingModule = {
  exports: OxcExports;
};

let browserBindingPromise: Promise<BrowserBindingModule> | null = null;

async function createBrowserBinding(): Promise<BrowserBindingModule> {
  const wasi = new WASI({ version: "preview1" });
  const wasmFile = await fetch(playgroundWasmUrl).then((response) => response.arrayBuffer());
  const emnapiContext = getEmnapiDefaultContext();
  const sharedMemory = new WebAssembly.Memory({
    initial: 4000,
    maximum: 65536,
    shared: true,
  });

  const { napiModule } = await instantiateNapiModule(wasmFile, {
    context: emnapiContext,
    asyncWorkPoolSize: 4,
    wasi,
    onCreateWorker() {
      return new Worker(new URL("./vendor/wasi-worker-browser.mjs", import.meta.url), {
        type: "module",
      });
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
    beforeInit({ instance }) {
      for (const name of Object.keys(instance.exports)) {
        if (name.startsWith("__napi_register__")) {
          const register = instance.exports[name];
          if (typeof register === "function") {
            (register as () => void)();
          }
        }
      }
    },
  });

  return {
    exports: napiModule.exports as OxcExports,
  };
}

export async function getOxcBrowserBinding(): Promise<BrowserBindingModule> {
  browserBindingPromise ??= createBrowserBinding();
  return browserBindingPromise;
}
