import { beforeEach, describe, expect, it } from "vitest";
import {
  attachRenderer,
  electronDesktopHost,
  emitFromRenderer,
  notifyClosed,
  setElectronWindowController,
  type ElectronWindowController,
} from "./electron-desktop";

interface OpenCall {
  id: string;
  title: string;
  size: { width: number; height: number };
  frame: { electronWindowId: number; url: string };
}

function fakeController() {
  const calls = {
    open: [] as OpenCall[],
    setUrl: [] as Array<{ id: string; url: string }>,
    setTitle: [] as Array<{ id: string; title: string }>,
    close: [] as string[],
  };
  const controller: ElectronWindowController = {
    openWindow: (p) => calls.open.push(p),
    setWindowUrl: (id, url) => calls.setUrl.push({ id, url }),
    setWindowTitle: (id, title) => calls.setTitle.push({ id, title }),
    close: (id) => calls.close.push(id),
    getViewport: () => ({ width: 1000, height: 800 }),
  };
  return { controller, calls };
}

describe("electron desktop bridge", () => {
  let calls: ReturnType<typeof fakeController>["calls"];

  beforeEach(() => {
    const fc = fakeController();
    calls = fc.calls;
    setElectronWindowController(fc.controller);
  });

  it("createWindow dispatches openWindow and returns a handle", () => {
    const win = electronDesktopHost.createWindow({ width: 400, height: 300, title: "My App" });
    expect(calls.open).toHaveLength(1);
    expect(calls.open[0].title).toBe("My App");
    expect(calls.open[0].frame.electronWindowId).toBe(win.id);
    expect(win.id).toBeGreaterThan(0);
  });

  it("loadURL updates the window url through the controller", async () => {
    const win = electronDesktopHost.createWindow({ title: "app" });
    await win.loadURL("http://localhost:5173");
    expect(calls.setUrl.at(-1)).toEqual({
      id: `electron-${win.id}`,
      url: "http://localhost:5173",
    });
  });

  it("queues main->renderer messages until a renderer attaches, then delivers", () => {
    const win = electronDesktopHost.createWindow({});
    const delivered: unknown[] = [];
    win.postMessage({ a: 1 }); // queued (no renderer yet)
    const detach = attachRenderer(win.id, (m) => delivered.push(m));
    expect(delivered).toEqual([{ a: 1 }]); // flushed on attach
    win.postMessage({ a: 2 });
    expect(delivered).toEqual([{ a: 1 }, { a: 2 }]);
    detach();
    win.postMessage({ a: 3 }); // re-queued after detach
    expect(delivered).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it("delivers renderer->main messages to host onMessage listeners", () => {
    const win = electronDesktopHost.createWindow({});
    const received: unknown[] = [];
    win.onMessage((m) => received.push(m));
    emitFromRenderer(win.id, { hello: "main" });
    expect(received).toEqual([{ hello: "main" }]);
  });

  it("notifyClosed fires the host 'closed' event exactly once", () => {
    const win = electronDesktopHost.createWindow({});
    let closedCount = 0;
    win.on("closed", () => {
      closedCount += 1;
    });
    expect(win.isDestroyed()).toBe(false);
    notifyClosed(win.id);
    expect(closedCount).toBe(1);
    expect(win.isDestroyed()).toBe(true);
    notifyClosed(win.id); // idempotent
    expect(closedCount).toBe(1);
  });

  it("handle.close() asks the controller to remove the window", () => {
    const win = electronDesktopHost.createWindow({});
    win.close();
    expect(calls.close).toContain(`electron-${win.id}`);
  });

  it("queues host ops issued before a controller is registered", () => {
    setElectronWindowController(null);
    const win = electronDesktopHost.createWindow({ title: "Queued" });
    const fc = fakeController();
    // Nothing dispatched while no controller is registered.
    expect(fc.calls.open).toHaveLength(0);
    setElectronWindowController(fc.controller);
    expect(fc.calls.open).toHaveLength(1);
    expect(fc.calls.open[0].title).toBe("Queued");
    expect(fc.calls.open[0].frame.electronWindowId).toBe(win.id);
  });
});
