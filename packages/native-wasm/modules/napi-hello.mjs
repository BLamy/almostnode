/**
 * napi-hello — a minimal, self-contained N-API C addon used to prove the
 * pipeline produces a *loadable* wasm on the correct toolchain, independent of
 * any third-party module's quirks (better-sqlite3 pulls in `<node.h>`).
 *
 * Correct target (discovered from emnapi's layout + how oxc loads):
 * `@napi-rs/wasm-runtime` loads **wasm32-wasi (threaded)** modules — built with
 * **wasi-sdk clang**, linking emnapi's `wasm32-wasi-threads/libemnapi-napi-rs-mt.a`
 * — NOT emscripten output. This recipe uses wasi-sdk (env `WASI_SDK`).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const HELLO_C = `#include <node_api.h>

static napi_value Add(napi_env env, napi_callback_info info) {
  size_t argc = 2;
  napi_value args[2];
  napi_get_cb_info(env, info, &argc, args, NULL, NULL);
  double a = 0, b = 0;
  napi_get_value_double(env, args[0], &a);
  napi_get_value_double(env, args[1], &b);
  napi_value result;
  napi_create_double(env, a + b, &result);
  return result;
}

NAPI_MODULE_INIT() {
  napi_value fn;
  napi_create_function(env, "add", NAPI_AUTO_LENGTH, Add, NULL, &fn);
  napi_set_named_property(env, exports, "add", fn);
  return exports;
}
`;

export default {
  name: "napi-hello",
  version: "0.0.0",

  async prepare({ srcDir }) {
    writeFileSync(join(srcDir, "hello.c"), HELLO_C);
  },

  async build({ srcDir, outWasm, emnapiDir, run }) {
    const wasiSdk = process.env.WASI_SDK;
    if (!wasiSdk) {
      throw Object.assign(new Error("WASI_SDK env not set (install wasi-sdk in CI)"), {
        exitCode: 1,
      });
    }
    const clang = `${wasiSdk}/bin/clang`;
    const emnapiInclude = join(emnapiDir, "include", "node");

    // emnapi's node_api.h declares the napi_* functions as wasm imports (module
    // "napi"), which @napi-rs/wasm-runtime supplies at instantiate time — so we
    // do NOT link the emnapi C archive (that's the emscripten model and causes an
    // import-module mismatch). The addon only imports napi_* and exports its
    // registration; `--import-undefined` marks any stray refs as imports too.
    run(clang, [
      "--target=wasm32-wasi-threads",
      `--sysroot=${wasiSdk}/share/wasi-sysroot`,
      "-pthread",
      "-O2",
      "-mexec-model=reactor",
      `-I${emnapiInclude}`,
      join(srcDir, "hello.c"),
      "-Wl,--import-undefined",
      "-Wl,--import-memory",
      "-Wl,--shared-memory",
      "-Wl,--max-memory=4294967296",
      "-Wl,--export-dynamic",
      "-Wl,--export=napi_register_wasm_v1",
      "-Wl,--export=malloc",
      "-Wl,--export=free",
      "-Wl,--no-entry",
      "-o",
      outWasm,
    ]);
  },

  // Node-side smoke: the orchestrator's default verify loads it under
  // @napi-rs/wasm-runtime; here we assert the addon's `add` works.
  async smoke(exports) {
    const sum = exports.add(2, 3);
    if (sum !== 5) throw new Error(`add(2,3) returned ${sum}, expected 5`);
  },
};
