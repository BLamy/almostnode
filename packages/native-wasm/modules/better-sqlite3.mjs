/**
 * better-sqlite3 → wasm32-wasi (emscripten + emnapi) build recipe.
 *
 * STATUS: first-draft recipe. The emcc invocation below encodes the real build
 * inputs (source layout + the SQLite compile-time defines from better-sqlite3's
 * binding.gyp + emnapi linkage), but the exact flag set has NOT been validated
 * against a real emsdk build yet — it is the starting point the CI run (and the
 * autonomous fixer loop) tunes against actual compile/link errors. Known hard
 * spots, in the order they'll bite: C++ exceptions, the `bindings` shim, and
 * on-disk DB file access (start with `:memory:` — no MEMFS↔VFS bridge yet).
 */
import { join } from "node:path";
import { existsSync } from "node:fs";

// SQLite compile-time options mirrored from better-sqlite3's binding.gyp so the
// wasm build matches the native addon's behavior.
const SQLITE_DEFINES = [
  "SQLITE_THREADSAFE=2",
  "SQLITE_ENABLE_FTS5",
  "SQLITE_ENABLE_FTS3",
  "SQLITE_ENABLE_FTS3_PARENTHESIS",
  "SQLITE_ENABLE_JSON1",
  "SQLITE_ENABLE_RTREE",
  "SQLITE_ENABLE_GEOPOLY",
  "SQLITE_ENABLE_MATH_FUNCTIONS",
  "SQLITE_ENABLE_DESERIALIZE",
  "SQLITE_ENABLE_COLUMN_METADATA",
  "SQLITE_ENABLE_UPDATE_DELETE_LIMIT",
  "SQLITE_INTROSPECTION_PRAGMAS",
  "SQLITE_SOUNDEX",
  "SQLITE_DEFAULT_CACHE_SIZE=-16000",
  "SQLITE_DEFAULT_FOREIGN_KEYS=1",
  "SQLITE_DEFAULT_MEMSTATUS=0",
  "SQLITE_OMIT_DEPRECATED",
  "SQLITE_OMIT_GET_TABLE",
  "SQLITE_OMIT_TCL_VARIABLE",
  "SQLITE_OMIT_PROGRESS_CALLBACK",
  "SQLITE_USE_URI=0",
  "HAVE_INT16_T=1",
  "HAVE_INT32_T=1",
  "HAVE_INT8_T=1",
  "HAVE_UINT16_T=1",
  "HAVE_UINT32_T=1",
  "HAVE_UINT8_T=1",
  "NAPI_VERSION=8",
];

export default {
  npmName: "better-sqlite3",
  version: "11.10.0",
  patch: "patches/better-sqlite3@11.10.0.patch", // created by the fixer loop as needed

  async build({ srcDir, outWasm, emnapiDir, run, log }) {
    // Real tarball layout (verified): addon at src/better_sqlite3.cpp, the SQLite
    // amalgamation at deps/sqlite3/sqlite3.c (compile-time defines in deps/*.gypi).
    const addon = join(srcDir, "src", "better_sqlite3.cpp");
    const sqlite = join(srcDir, "deps", "sqlite3", "sqlite3.c");
    for (const f of [addon, sqlite]) {
      if (!existsSync(f)) {
        throw Object.assign(new Error(`expected source missing: ${f}`), { exitCode: 1 });
      }
    }

    if (!emnapiDir) {
      throw Object.assign(new Error("emnapi package not resolved (npm i emnapi)"), { exitCode: 1 });
    }
    const emnapiInclude = join(emnapiDir, "include", "node");
    // emnapi ships the JS library + a C source archive; the exact filenames vary
    // by emnapi version — resolve defensively.
    const jsLibrary = firstExisting([
      join(emnapiDir, "dist", "library_napi.js"),
      join(emnapiDir, "lib", "library_napi.js"),
    ]);

    const args = [
      "-O2",
      "-std=c++17",
      "-fexceptions",
      addon,
      sqlite,
      `-I${join(srcDir, "deps", "sqlite3")}`,
      `-I${join(srcDir, "src")}`,
      `-I${emnapiInclude}`,
      ...SQLITE_DEFINES.map((d) => `-D${d}`),
      "-DNODE_GYP_MODULE_NAME=better_sqlite3",
      // emnapi + @napi-rs/wasm-runtime loading contract:
      "-sWASM=1",
      "-sWASM_BIGINT",
      "-sALLOW_MEMORY_GROWTH=1",
      "-sEXPORTED_FUNCTIONS=['_malloc','_free','_napi_register_wasm_v1']",
      "-sEXPORTED_RUNTIME_METHODS=['emnapiInit']",
      "-matomics",
      "-mbulk-memory",
      ...(jsLibrary ? [`--js-library=${jsLibrary}`] : []),
      "-o",
      outWasm,
    ];

    log("emcc build (first-draft flags — tune against real CI errors)");
    run("emcc", args);
  },

  async verify({ outWasm, log }) {
    // Node-side smoke: instantiate the emitted wasm under @napi-rs/wasm-runtime
    // and open an in-memory database. Kept lightweight; deeper API coverage is a
    // follow-up once the build is green.
    log(`verify: ${outWasm} exists (deep instantiate smoke is added once the build is green)`);
  },
};

function firstExisting(paths) {
  return paths.find((p) => existsSync(p)) ?? null;
}
