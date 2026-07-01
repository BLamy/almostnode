// Lets other surfaces (e.g. the Keychain "Log in" buttons) run a command in the
// Terminal. If no terminal is open yet, the command is buffered until one mounts.
type Handler = (command: string) => void;

const handlers = new Set<Handler>();
const buffer: string[] = [];

export const terminalBus = {
  run(command: string) {
    const first = handlers.values().next().value as Handler | undefined;
    if (first) first(command);
    else buffer.push(command);
  },
  subscribe(handler: Handler) {
    handlers.add(handler);
    while (buffer.length) {
      const next = buffer.shift();
      if (next) handler(next);
    }
    return () => handlers.delete(handler);
  },
};
