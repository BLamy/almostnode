import { afterEach, describe, expect, it, vi } from "vitest";

import { installHostConsoleBridge } from "../src/features/host-console-bridge";

const CONSOLE_METHODS = ["debug", "error", "info", "log", "trace", "warn"] as const;

describe("installHostConsoleBridge", () => {
  const originalConsole = Object.fromEntries(
    CONSOLE_METHODS.map((method) => [method, console[method]]),
  ) as Record<(typeof CONSOLE_METHODS)[number], typeof console.log>;

  afterEach(() => {
    for (const method of CONSOLE_METHODS) {
      console[method] = originalConsole[method];
    }
  });

  it("mirrors host console traffic to sinks and restores the original methods", () => {
    const info = vi.fn();
    const warn = vi.fn();
    console.info = info;
    console.warn = warn;

    const events: Array<{
      args: unknown[];
      level: string;
      timestamp: number;
    }> = [];
    const cleanup = installHostConsoleBridge((level, args, timestamp) => {
      events.push({ level, args, timestamp });
    });

    console.info("[vite] hot updated", "/src/app.tsx");
    console.warn("request failed", { status: 500 });

    expect(info).toHaveBeenCalledWith("[vite] hot updated", "/src/app.tsx");
    expect(warn).toHaveBeenCalledWith("request failed", { status: 500 });
    expect(events).toHaveLength(2);
    expect(events[0]?.level).toBe("info");
    expect(events[0]?.args).toEqual(["[vite] hot updated", "/src/app.tsx"]);
    expect(events[1]?.level).toBe("warn");

    cleanup();

    console.info("after cleanup");
    console.warn("warn after cleanup");
    expect(events).toHaveLength(2);
    expect(info).toHaveBeenLastCalledWith("after cleanup");
    expect(warn).toHaveBeenLastCalledWith("warn after cleanup");
  });
});
