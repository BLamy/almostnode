import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { WASI } from "node:wasi";
import { parentPort, Worker } from "node:worker_threads";

const require = createRequire(import.meta.url);

const {
  MessageHandler,
  getDefaultContext,
  instantiateNapiModuleSync,
} = require("@napi-rs/wasm-runtime");

if (parentPort) {
  parentPort.on("message", (data) => {
    globalThis.onmessage({ data });
  });
}

Object.assign(globalThis, {
  importScripts(filePath) {
    (0, eval)(fs.readFileSync(filePath, "utf8") + `\n//# sourceURL=${filePath}`);
  },
  postMessage(message) {
    parentPort?.postMessage(message);
  },
  require,
  self: globalThis,
  Worker,
});

const emnapiContext = getDefaultContext();
const rootDirectory = path.parse(process.cwd()).root;

const handler = new MessageHandler({
  onLoad({ wasmMemory, wasmModule }) {
    const env = Object.fromEntries(
      Object.entries(process.env).filter((entry) => typeof entry[1] === "string"),
    );
    const wasi = new WASI({
      version: "preview1",
      env,
      preopens: {
        [rootDirectory]: rootDirectory,
      },
    });

    return instantiateNapiModuleSync(wasmModule, {
      childThread: true,
      context: emnapiContext,
      overwriteImports(importObject) {
        importObject.env = {
          ...importObject.env,
          ...importObject.napi,
          ...importObject.emnapi,
          memory: wasmMemory,
        };
      },
      wasi,
    });
  },
});

globalThis.onmessage = function onMessage(event) {
  handler.handle(event);
};
