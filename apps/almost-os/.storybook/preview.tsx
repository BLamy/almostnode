import type { Preview } from "@storybook/react-vite";
import type { ReactNode } from "react";
import "../src/styles/os.css";
import { chromeStore } from "../src/apps/chrome/chrome-store";
import { terminalBus } from "../src/apps/terminal/terminal-bus";
import { KeychainProvider } from "../src/keychain/keychain-store";
import type { SystemActions } from "../src/os/system";
import { SystemProvider } from "../src/os/system";
import { getWorkspace } from "../src/runtime/runtime";
import { OsRuntimeProvider } from "../src/runtime/OsRuntimeProvider";
import { WindowManagerProvider } from "../src/windows/WindowManager";

// One shared system surface for every story. openApp is a no-op in isolation;
// file/terminal actions hit the same shared workspace.
const storySystem: SystemActions = {
  openApp: () => {},
  openFile: (path) => {
    getWorkspace().setCurrentFile(path);
  },
  runInTerminal: (command) => terminalBus.run(command),
  openUrl: (url) => {
    chromeStore.createTab({ url, activate: true });
  },
};

function StoryProviders({ children }: { children: ReactNode }) {
  return (
    <OsRuntimeProvider>
      <WindowManagerProvider>
        <KeychainProvider>
          <SystemProvider value={storySystem}>{children}</SystemProvider>
        </KeychainProvider>
      </WindowManagerProvider>
    </OsRuntimeProvider>
  );
}

const preview: Preview = {
  parameters: {
    layout: "fullscreen",
    backgrounds: { default: "desktop" },
  },
  decorators: [
    (Story) => (
      <StoryProviders>
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100vh",
            overflow: "hidden",
            background: "#1d1f21",
          }}
        >
          <Story />
        </div>
      </StoryProviders>
    ),
  ],
};

export default preview;
