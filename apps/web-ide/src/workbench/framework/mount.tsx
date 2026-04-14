import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import type {
  WorkbenchEditorEntrypoint,
  WorkbenchViewEntrypoint,
} from "./types";
import type { SurfaceModel } from "./model";

type MountableEntrypoint<TState, TActions> =
  | WorkbenchViewEntrypoint<TState, TActions>
  | WorkbenchEditorEntrypoint<TState, TActions>;

const roots = new WeakMap<HTMLElement, Root>();

export function mountWorkbenchSurface<TState, TActions>(
  container: HTMLElement,
  entrypoint: MountableEntrypoint<TState, TActions>,
  model: SurfaceModel<TState, TActions>,
): { dispose: () => void } {
  if (entrypoint.hostClassName) {
    container.classList.add(entrypoint.hostClassName);
  }

  const root = createRoot(container);
  roots.set(container, root);
  const Component = entrypoint.component;
  flushSync(() => {
    root.render(<Component model={model} />);
  });

  return {
    dispose: () => {
      root.unmount();
      roots.delete(container);
      if (entrypoint.hostClassName) {
        container.classList.remove(entrypoint.hostClassName);
      }
    },
  };
}
