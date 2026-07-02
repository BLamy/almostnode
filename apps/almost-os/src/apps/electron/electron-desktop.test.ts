import { beforeEach, describe, expect, it } from "vitest";
import {
  attachRenderer,
  electronDesktopHost,
  emitFromRenderer,
  notifyBoundsChanged,
  notifyClosed,
  notifyFocusChanged,
  setElectronWindowController,
  type ElectronWindowController,
} from "./electron-desktop";

interface OpenCall {
  id: string;
  title: string;
  size: { width: number; height: number };
  frame: { electronWindowId: number; url: string };
  frameless?: boolean;
  transparent?: boolean;
  resizable?: boolean;
  minSize?: { width: number; height: number };
  position?: { x: number; y: number };
}

function fakeController() {
  const calls = {
    open: [] as OpenCall[],
    setUrl: [] as Array<{ id: string; url: string }>,
    setTitle: [] as Array<{ id: string; title: string }>,
    setBounds: [] as Array<{ id: string; bounds: Record<string, number | undefined> }>,
    focus: [] as string[],
    minimize: [] as string[],
    unminimize: [] as string[],
    setMaximized: [] as Array<{ id: string; maximized: boolean }>,
    close: [] as string[],
  };
  const controller: ElectronWindowController = {
    openWindow: (p) => calls.open.push(p),
    setWindowUrl: (id, url) => calls.setUrl.push({ id, url }),
    setWindowTitle: (id, title) => calls.setTitle.push({ id, title }),
    setWindowBounds: (id, bounds) => calls.setBounds.push({ id, bounds }),
    focus: (id) => calls.focus.push(id),
    minimize: (id) => calls.minimize.push(id),
    unminimize: (id) => calls.unminimize.push(id),
    setMaximized: (id, maximized) => calls.setMaximized.push({ id, maximized }),
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

  it("forwards frame/transparent/min-size/position window options", () => {
    electronDesktopHost.createWindow({
      width: 300,
      height: 200,
      x: 40,
      y: 60,
      minWidth: 120,
      minHeight: 90,
      resizable: false,
      frame: false,
      transparent: true,
    });
    const open = calls.open[0];
    expect(open.frameless).toBe(true);
    expect(open.transparent).toBe(true);
    expect(open.resizable).toBe(false);
    expect(open.minSize).toEqual({ width: 120, height: 90 });
    expect(open.position).toEqual({ x: 40, y: 60 });
  });

  it("wires window controls (minimize/maximize/setBounds/show) to the controller", () => {
    const win = electronDesktopHost.createWindow({});
    const id = `electron-${win.id}`;
    win.minimize();
    expect(calls.minimize).toContain(id);
    win.maximize();
    expect(calls.setMaximized.at(-1)).toEqual({ id, maximized: true });
    win.unmaximize();
    expect(calls.setMaximized.at(-1)).toEqual({ id, maximized: false });
    win.focus();
    expect(calls.focus).toContain(id);
    win.show();
    expect(calls.unminimize).toContain(id);
    win.hide();
    expect(calls.minimize.filter((c) => c === id)).toHaveLength(2);
    win.setBounds({ x: 10, y: 30 });
    expect(calls.setBounds.at(-1)).toEqual({ id, bounds: { x: 10, y: 30 } });
    expect(win.getBounds()).toMatchObject({ x: 10, y: 30 });
  });

  it("back-propagates WM geometry and fires move/resize host events", () => {
    const win = electronDesktopHost.createWindow({ width: 400, height: 300 });
    const events: string[] = [];
    win.on("move", () => events.push("move"));
    win.on("resize", () => events.push("resize"));
    notifyBoundsChanged(win.id, { x: 50, y: 60, width: 400, height: 300 });
    expect(events).toEqual(["move"]);
    notifyBoundsChanged(win.id, { x: 50, y: 60, width: 500, height: 350 });
    expect(events).toEqual(["move", "resize"]);
    expect(win.getBounds()).toEqual({ x: 50, y: 60, width: 500, height: 350 });
    // No-op geometry does not re-fire.
    notifyBoundsChanged(win.id, { x: 50, y: 60, width: 500, height: 350 });
    expect(events).toEqual(["move", "resize"]);
  });

  it("fires focus/blur host events once per focus flip", () => {
    const win = electronDesktopHost.createWindow({});
    const events: string[] = [];
    win.on("focus", () => events.push("focus"));
    win.on("blur", () => events.push("blur"));
    notifyFocusChanged(win.id, true);
    notifyFocusChanged(win.id, true); // duplicate — ignored
    notifyFocusChanged(win.id, false);
    expect(events).toEqual(["focus", "blur"]);
  });

  it("getScreenInfo reflects the controller viewport minus menubar/dock", () => {
    const info = electronDesktopHost.getScreenInfo!();
    expect(info).toEqual({
      width: 1000,
      height: 800,
      workArea: { x: 0, y: 28, width: 1000, height: 800 - 28 - 96 },
    });
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
