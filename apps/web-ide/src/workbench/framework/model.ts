import { flushSync } from "react-dom";

export interface SurfaceModel<TState, TActions> {
  getSnapshot(): Readonly<TState>;
  subscribe(listener: () => void): () => void;
  readonly actions: TActions;
}

export class MutableSurfaceModel<TState, TActions>
  implements SurfaceModel<TState, TActions>
{
  private snapshot: TState;
  private readonly listeners = new Set<() => void>();

  constructor(
    initialState: TState,
    readonly actions: TActions,
  ) {
    this.snapshot = initialState;
  }

  getSnapshot(): Readonly<TState> {
    return this.snapshot;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setSnapshot(next: TState): void {
    this.snapshot = next;
    this.emitChange();
  }

  updateSnapshot(updater: (current: TState) => TState): void {
    this.snapshot = updater(this.snapshot);
    this.emitChange();
  }

  protected emitChange(): void {
    flushSync(() => {
      for (const listener of this.listeners) {
        listener();
      }
    });
  }
}

export class StaticSurfaceModel<TState, TActions>
  implements SurfaceModel<TState, TActions>
{
  constructor(
    private readonly snapshot: TState,
    readonly actions: TActions,
  ) {}

  getSnapshot(): Readonly<TState> {
    return this.snapshot;
  }

  subscribe(_listener: () => void): () => void {
    return () => undefined;
  }
}

export function createStaticSurfaceModel<TState, TActions>(
  snapshot: TState,
  actions: TActions,
): StaticSurfaceModel<TState, TActions> {
  return new StaticSurfaceModel(snapshot, actions);
}
