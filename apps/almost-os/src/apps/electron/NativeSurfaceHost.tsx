import { useEffect, useRef, useState } from "react";
import {
  ELECTRON_IPC_KIND,
  ELECTRON_IPC_TAG,
  isElectronIpcEnvelope,
} from "@agent-wasm/core";
import { attachRenderer, emitFromRenderer, notifyClosed } from "./electron-desktop";
import {
  getNativeSurface,
  parseNativeSurfaceName,
  type NativeSurfaceChannel,
} from "./native-surfaces";

/**
 * Renders a registered native-surface component as an Electron BrowserWindow's
 * renderer (in place of an iframe), wiring it a NativeSurfaceChannel that speaks
 * the same IPC envelope protocol as the iframe preload bridge — but via direct
 * attachRenderer/emitFromRenderer calls.
 */
function createChannel(electronId: number): NativeSurfaceChannel & {
  _deliver: (message: unknown) => void;
} {
  let seq = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>();
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  const post = (envelope: Record<string, unknown>) => {
    envelope[ELECTRON_IPC_TAG] = true;
    emitFromRenderer(electronId, envelope);
  };

  const _deliver = (message: unknown) => {
    if (!isElectronIpcEnvelope(message)) return;
    if (message.kind === ELECTRON_IPC_KIND.invokeReply) {
      const entry = pending.get(message.id as number);
      if (!entry) return;
      pending.delete(message.id as number);
      if (message.ok) entry.resolve(message.args?.[0]);
      else entry.reject(new Error(message.error?.message ?? "IPC error"));
    } else if (message.kind === ELECTRON_IPC_KIND.event) {
      const set = listeners.get(message.channel ?? "");
      if (!set) return;
      for (const fn of set) {
        try {
          fn(...(message.args ?? []));
        } catch (e) {
          console.error(e);
        }
      }
    }
  };

  return {
    invoke: (channel, ...args) =>
      new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        post({ kind: ELECTRON_IPC_KIND.invoke, id, channel, args });
      }),
    send: (channel, ...args) => post({ kind: ELECTRON_IPC_KIND.send, channel, args }),
    on: (channel, listener) => {
      const set = listeners.get(channel) ?? new Set();
      set.add(listener);
      listeners.set(channel, set);
      return () => set.delete(listener);
    },
    _deliver,
  };
}

export function NativeSurfaceHost({
  electronId,
  url,
}: {
  electronId: number;
  url: string;
}) {
  const name = parseNativeSurfaceName(url);
  const entry = name ? getNativeSurface(name) : null;
  const [channel] = useState(() => createChannel(electronId));
  // Same StrictMode-safe close deferral as ElectronWindow's iframe path.
  const pendingClose = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pendingClose.current !== null) {
      clearTimeout(pendingClose.current);
      pendingClose.current = null;
    }
    const detach = attachRenderer(electronId, (message) => channel._deliver(message));
    // Announce the renderer is live so ready-to-show / did-finish-load fire.
    emitFromRenderer(electronId, {
      [ELECTRON_IPC_TAG]: true,
      kind: ELECTRON_IPC_KIND.rendererReady,
    });
    return () => {
      detach();
      pendingClose.current = setTimeout(() => notifyClosed(electronId), 0);
    };
  }, [electronId, channel]);

  if (!entry) {
    return (
      <div style={{ padding: 16, color: "#fff", fontFamily: "sans-serif" }}>
        Unknown native surface: <code>{name ?? url}</code>
      </div>
    );
  }
  const Component = entry.component;
  return <Component channel={channel} />;
}
