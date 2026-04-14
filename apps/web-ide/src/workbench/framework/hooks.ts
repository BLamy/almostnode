import { useSyncExternalStore } from "react";
import type { SurfaceModel } from "./model";

export function useSurfaceModel<TState, TActions>(
  model: SurfaceModel<TState, TActions>,
): readonly [Readonly<TState>, TActions] {
  const snapshot = useSyncExternalStore(
    (listener) => model.subscribe(listener),
    () => model.getSnapshot(),
    () => model.getSnapshot(),
  );

  return [snapshot, model.actions] as const;
}
