// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory VFS + workspace mock, controlled per test.
interface FakeVfs {
  files: Map<string, string>;
  dirs: Set<string>;
}

const vfsState: FakeVfs = { files: new Map(), dirs: new Set() };
const sessions: Array<{ id: string; env?: Record<string, string>; disposed: boolean; run: ReturnType<typeof vi.fn> }> = [];
let runResolvers: Array<() => void> = [];

const fakeWorkspace = {
  vfs: {
    existsSync: (p: string) => vfsState.files.has(p) || vfsState.dirs.has(p),
    readFileSync: (p: string) => {
      const v = vfsState.files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    writeFileSync: (p: string, c: string) => {
      vfsState.files.set(p, c);
    },
    mkdirSync: (p: string) => {
      vfsState.dirs.add(p);
    },
    statSync: () => ({ isDirectory: () => true }),
    readdirSync: () => [],
  },
  remove: (dir: string) => {
    for (const key of [...vfsState.files.keys()]) {
      if (key.startsWith(dir)) vfsState.files.delete(key);
    }
    for (const d of [...vfsState.dirs]) {
      if (d.startsWith(dir)) vfsState.dirs.delete(d);
    }
  },
  terminals: {
    createSession: (opts?: { env?: Record<string, string> }) => {
      const run = vi.fn(
        () =>
          new Promise<void>((resolve) => {
            runResolvers.push(resolve);
          }),
      );
      const rec = { id: `sess-${sessions.length}`, env: opts?.env, disposed: false, run };
      sessions.push(rec);
      return {
        id: rec.id,
        session: { run },
        dispose: () => {
          rec.disposed = true;
        },
      };
    },
  },
};

vi.mock("../../runtime/runtime", () => ({
  getWorkspace: () => fakeWorkspace,
}));

import {
  appDir,
  appStoragePrefix,
  ensureInstalled,
  isInstalled,
  isRunning,
  launch,
  registerAppReset,
  reinstall,
  stop,
  uninstall,
  type ManagedElectronApp,
} from "./electron-app-manager";

function makeApp(over: Partial<ManagedElectronApp> = {}): ManagedElectronApp {
  return {
    id: "demo",
    name: "Demo",
    version: "1.0.0",
    loadFiles: async () => ({
      "package.json": JSON.stringify({ name: "demo", version: "1.0.0", main: "main.js" }),
      "main.js": "// v1",
    }),
    ...over,
  };
}

beforeEach(() => {
  // Reset the manager's module-level running state (leaks across tests otherwise).
  stop("demo");
  vfsState.files.clear();
  vfsState.dirs.clear();
  sessions.length = 0;
  runResolvers = [];
  globalThis.localStorage?.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("electron-app-manager", () => {
  it("ensureInstalled writes seed files when absent", async () => {
    const app = makeApp();
    expect(isInstalled(app.id)).toBe(false);
    await ensureInstalled(app);
    expect(isInstalled(app.id)).toBe(true);
    expect(vfsState.files.get(`${appDir("demo")}/main.js`)).toBe("// v1");
  });

  it("ensureInstalled is a no-op when the installed version matches", async () => {
    const app = makeApp();
    await ensureInstalled(app);
    const load = vi.fn(app.loadFiles);
    await ensureInstalled({ ...app, loadFiles: load });
    expect(load).not.toHaveBeenCalled();
  });

  it("ensureInstalled rewrites when the version differs", async () => {
    await ensureInstalled(makeApp({ version: "1.0.0" }));
    await ensureInstalled(
      makeApp({
        version: "2.0.0",
        loadFiles: async () => ({
          "package.json": JSON.stringify({ name: "demo", version: "2.0.0" }),
          "main.js": "// v2",
        }),
      }),
    );
    expect(vfsState.files.get(`${appDir("demo")}/main.js`)).toBe("// v2");
  });

  it("launch tags the session with ALMOST_ELECTRON_APP_ID and tracks running", () => {
    const app = makeApp();
    expect(isRunning(app.id)).toBe(false);
    launch(app);
    expect(isRunning(app.id)).toBe(true);
    expect(sessions[0].env).toEqual({ ALMOST_ELECTRON_APP_ID: "demo" });
    expect(sessions[0].run).toHaveBeenCalledWith(`electron ${appDir("demo")}`);
    // Double-launch is a no-op.
    launch(app);
    expect(sessions).toHaveLength(1);
  });

  it("stop disposes the session and clears running", () => {
    const app = makeApp();
    launch(app);
    stop(app.id);
    expect(sessions[0].disposed).toBe(true);
    expect(isRunning(app.id)).toBe(false);
  });

  it("uninstall removes files, stops the app, clears data + calls resets", async () => {
    const app = makeApp();
    await ensureInstalled(app);
    launch(app);
    globalThis.localStorage.setItem(`${appStoragePrefix("demo")}theme`, "dark");
    globalThis.localStorage.setItem("other:key", "keep");
    const reset = vi.fn();
    registerAppReset("demo", reset);

    uninstall(app.id);

    expect(isInstalled(app.id)).toBe(false);
    expect(isRunning(app.id)).toBe(false);
    expect(sessions[0].disposed).toBe(true);
    expect(globalThis.localStorage.getItem(`${appStoragePrefix("demo")}theme`)).toBeNull();
    expect(globalThis.localStorage.getItem("other:key")).toBe("keep");
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("reinstall restores pristine files after modification", async () => {
    const app = makeApp();
    await ensureInstalled(app);
    // Simulate a user/AI edit.
    fakeWorkspace.vfs.writeFileSync(`${appDir("demo")}/main.js`, "// hacked");
    await reinstall(app);
    expect(vfsState.files.get(`${appDir("demo")}/main.js`)).toBe("// v1");
  });
});
