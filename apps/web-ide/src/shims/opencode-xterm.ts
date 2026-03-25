import xtermModule from "../../../../vendor/opencode/node_modules/@xterm/xterm/lib/xterm.js";

type XtermModule = {
  Terminal: new (...args: any[]) => any;
};

const xterm = xtermModule as XtermModule;

export const Terminal = xterm.Terminal;
export default xterm;
