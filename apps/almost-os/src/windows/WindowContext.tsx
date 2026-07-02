import { createContext, useContext } from "react";

/** Handle to the OS window hosting the current app body. */
export interface WindowHandle {
  id: string;
  /** True when the window renders with no OS chrome (app draws its own). */
  frameless: boolean;
  close: () => void;
  minimize: () => void;
  focus: () => void;
}

const WindowContext = createContext<WindowHandle | null>(null);

export const WindowProvider = WindowContext.Provider;

/** Access the OS window hosting the current app. Throws outside a <Window>. */
export function useWindow(): WindowHandle {
  const value = useContext(WindowContext);
  if (!value) {
    throw new Error("useWindow must be used within a <Window>");
  }
  return value;
}

/** Like {@link useWindow} but returns null outside a window (e.g. Storybook). */
export function useMaybeWindow(): WindowHandle | null {
  return useContext(WindowContext);
}
