type MirroredConsoleLevel =
  | "debug"
  | "error"
  | "info"
  | "log"
  | "trace"
  | "warn";

type ConsoleSink = (
  level: MirroredConsoleLevel,
  args: unknown[],
  timestamp: number,
) => void;

type ConsoleMethod = (...args: unknown[]) => void;

interface HostConsoleBridgeState {
  dispatching: boolean;
  original: Record<MirroredConsoleLevel, ConsoleMethod>;
  sinks: Set<ConsoleSink>;
}

const HOST_CONSOLE_METHODS: MirroredConsoleLevel[] = [
  "debug",
  "error",
  "info",
  "log",
  "trace",
  "warn",
];
const HOST_CONSOLE_BRIDGE_KEY = Symbol.for(
  "almostnode.webide.hostConsoleBridge",
);

function getBridgeState():
  | (HostConsoleBridgeState & { cleanup?: () => void })
  | undefined {
  return (globalThis.console as Console & {
    [HOST_CONSOLE_BRIDGE_KEY]?: HostConsoleBridgeState & { cleanup?: () => void };
  })[HOST_CONSOLE_BRIDGE_KEY];
}

export function installHostConsoleBridge(sink: ConsoleSink): () => void {
  const consoleObject = globalThis.console as Console & {
    [HOST_CONSOLE_BRIDGE_KEY]?: HostConsoleBridgeState & { cleanup?: () => void };
  };

  let state = getBridgeState();
  if (!state) {
    const original = Object.create(null) as Record<
      MirroredConsoleLevel,
      ConsoleMethod
    >;
    for (const method of HOST_CONSOLE_METHODS) {
      const candidate = consoleObject[method];
      original[method] =
        typeof candidate === "function"
          ? candidate.bind(consoleObject)
          : (() => {});
    }

    state = {
      dispatching: false,
      original,
      sinks: new Set(),
    };

    for (const method of HOST_CONSOLE_METHODS) {
      consoleObject[method] = ((...args: unknown[]) => {
        const timestamp = Date.now();
        const result = state!.original[method](...args);
        if (!state!.dispatching) {
          state!.dispatching = true;
          try {
            for (const currentSink of state!.sinks) {
              currentSink(method, args, timestamp);
            }
          } finally {
            state!.dispatching = false;
          }
        }
        return result;
      }) as ConsoleMethod;
    }

    state.cleanup = () => {
      if (state && state.sinks.size === 0) {
        for (const method of HOST_CONSOLE_METHODS) {
          consoleObject[method] = state.original[method] as Console[typeof method];
        }
        delete consoleObject[HOST_CONSOLE_BRIDGE_KEY];
      }
    };

    consoleObject[HOST_CONSOLE_BRIDGE_KEY] = state;
  }

  state.sinks.add(sink);

  return () => {
    const current = getBridgeState();
    if (!current) {
      return;
    }
    current.sinks.delete(sink);
    current.cleanup?.();
  };
}
