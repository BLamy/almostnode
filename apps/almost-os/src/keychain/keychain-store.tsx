import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Keychain, type KeychainState } from "@agent-wasm/keychain";
import { tokenFilePathForService } from "@agent-wasm/keychain/oauth";
import { defaultCredentialSlots } from "@agent-wasm/sdk/auth";
import { listExecutorSecretSlots } from "../apps/executor/executor-secrets";
import { getWorkspace } from "../runtime/runtime";
import { getOAuthRegistry } from "./oauth-runtime";

interface KeychainValue {
  keychain: Keychain;
  state: KeychainState;
  /** Re-read keychain state after an external VFS credential change. */
  refresh: () => void;
}

const KeychainContext = createContext<KeychainValue | null>(null);

// Singletons so the app AND every Storybook story share ONE keychain over the
// one shared workspace VFS.
let singleton: Keychain | null = null;
const listeners = new Set<(state: KeychainState) => void>();

export function getKeychain(): Keychain {
  if (typeof window === "undefined") {
    throw new Error("Keychain is browser-only");
  }
  if (!singleton) {
    const workspace = getWorkspace();
    singleton = new Keychain({
      vfs: workspace.vfs,
      overlayRoot: typeof document !== "undefined" ? document.body : null,
      onStateChange: (next) => {
        for (const listener of listeners) listener(next);
      },
      isAgentLaunchCommand: (command) => /\bopencode\b/.test(command),
    });
    for (const slot of defaultCredentialSlots) {
      singleton.registerSlot(slot.id, [...slot.paths]);
    }
    // Dynamic slots must be registered BEFORE init() so their files restore
    // into the VFS on vault unlock: user-added OAuth services (executor.sh
    // connections + any future keychain-managed service) and executor.sh
    // API-key secrets.
    for (const service of getOAuthRegistry().list()) {
      singleton.registerSlot(service.id, [tokenFilePathForService(service.id)]);
    }
    for (const slot of listExecutorSecretSlots()) {
      singleton.registerSlot(slot.name, slot.paths);
    }
    void singleton.init();
  }
  return singleton;
}

export function KeychainProvider({ children }: { children: ReactNode }) {
  const keychain = getKeychain();
  const [state, setState] = useState<KeychainState>(() => keychain.getState());

  useEffect(() => {
    const listener = (next: KeychainState) => setState(next);
    listeners.add(listener);
    setState(keychain.getState());
    return () => {
      listeners.delete(listener);
    };
  }, [keychain]);

  const value = useMemo<KeychainValue>(
    () => ({
      keychain,
      state,
      refresh: () => {
        keychain.notifyExternalStateChanged();
        setState(keychain.getState());
      },
    }),
    [keychain, state],
  );

  return <KeychainContext.Provider value={value}>{children}</KeychainContext.Provider>;
}

export function useKeychain(): KeychainValue {
  const value = useContext(KeychainContext);
  if (!value) {
    throw new Error("useKeychain must be used within <KeychainProvider>");
  }
  return value;
}
