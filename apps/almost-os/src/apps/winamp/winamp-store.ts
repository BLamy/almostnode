import { useSyncExternalStore } from "react";

// Small external store for the Winamp/Webamp app's skin. Finder sets a skin when
// you double-click a .wsz in the "Winamp Skins" folder; WinampApp subscribes and
// calls webamp.setSkinFromUrl. Kept separate from player-store (audio) so the two
// concerns don't churn each other.

interface WinampSkinState {
  /** Object URL (or http URL) of the current .wsz skin, or null for the default. */
  skinUrl: string | null;
  /** Human label for the current skin (filename), for UI. */
  skinName: string | null;
}

let state: WinampSkinState = { skinUrl: null, skinName: null };
const listeners = new Set<() => void>();

function commit(next: WinampSkinState): void {
  // Revoke a previous object URL so we don't leak blobs as skins pile up.
  if (state.skinUrl && state.skinUrl.startsWith("blob:") && state.skinUrl !== next.skinUrl) {
    try {
      URL.revokeObjectURL(state.skinUrl);
    } catch {
      /* ignore */
    }
  }
  state = next;
  for (const listener of listeners) listener();
}

export const winampStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot(): WinampSkinState {
    return state;
  },
  setSkin(url: string, name?: string) {
    commit({ skinUrl: url, skinName: name ?? state.skinName });
  },
  /** Apply a .wsz from raw bytes (Finder reads the real file → Blob → object URL). */
  setSkinFromBytes(bytes: ArrayBuffer | Uint8Array, name?: string) {
    const blob = new Blob([bytes], { type: "application/octet-stream" });
    commit({ skinUrl: URL.createObjectURL(blob), skinName: name ?? state.skinName });
  },
};

export function useWinampSkin(): WinampSkinState {
  return useSyncExternalStore(winampStore.subscribe, winampStore.getSnapshot, winampStore.getSnapshot);
}
