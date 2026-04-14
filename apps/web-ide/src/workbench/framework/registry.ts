import {
  DisposableStore,
  type IDisposable,
} from "@codingame/monaco-vscode-api/vscode/vs/base/common/lifecycle";
import {
  EditorInputCapabilities,
  SimpleEditorInput,
  SimpleEditorPane,
  ViewContainerLocation,
  registerCustomView,
  registerEditorPane,
} from "@codingame/monaco-vscode-workbench-service-override";
import type { IEditorGroup } from "@codingame/monaco-vscode-api/services";
import discoveredEntrypoints from "virtual:workbench-entrypoints";
import { mountWorkbenchSurface } from "./mount";
import type {
  WorkbenchEditorEntrypoint,
  WorkbenchEntrypoint,
  WorkbenchMountContext,
  WorkbenchViewEntrypoint,
} from "./types";
import { validateWorkbenchEntrypoints } from "./validate";

const LOCATION_MAP = {
  sidebar: ViewContainerLocation.Sidebar,
  panel: ViewContainerLocation.Panel,
  auxiliarybar: ViewContainerLocation.AuxiliaryBar,
} as const;

type ConditionalRegistration = {
  entrypoint: WorkbenchViewEntrypoint;
  dispose: IDisposable | null;
};

export interface RegisteredWorkbenchEntrypoints {
  createEditorInput(id: string): SimpleEditorInput;
  viewIds: Record<string, string>;
  setActivation(id: string, active: boolean): void;
  dispose(): void;
}

export function getWorkbenchEntrypoint(
  id: string,
): WorkbenchEntrypoint | undefined {
  return discoveredEntrypoints.find((entrypoint) => entrypoint.id === id);
}

export function registerWorkbenchEntrypoints(
  context: WorkbenchMountContext,
): RegisteredWorkbenchEntrypoints {
  validateWorkbenchEntrypoints(discoveredEntrypoints);

  const disposables = new DisposableStore();
  const conditionalRegistrations = new Map<string, ConditionalRegistration>();
  const editorInputFactories: Record<string, () => SimpleEditorInput> = {};
  const viewIds: Record<string, string> = {};

  for (const entrypoint of discoveredEntrypoints) {
    if (entrypoint.kind === "editor") {
      const createInput = registerWorkbenchEditor(entrypoint, context, disposables);
      editorInputFactories[entrypoint.id] = createInput;
      continue;
    }

    viewIds[entrypoint.id] = entrypoint.id;
    const activation = entrypoint.activation ?? "eager";
    if (activation === "eager") {
      disposables.add(registerWorkbenchView(entrypoint, context));
      continue;
    }

    const initial = activation.initial === true;
    conditionalRegistrations.set(entrypoint.id, {
      entrypoint,
      dispose: initial ? registerWorkbenchView(entrypoint, context) : null,
    });
  }

  return {
    createEditorInput(id: string): SimpleEditorInput {
      const createInput = editorInputFactories[id];
      if (!createInput) {
        throw new Error(`Workbench editor input "${id}" was not registered.`);
      }
      return createInput();
    },
    viewIds,
    setActivation(id: string, active: boolean) {
      const record = conditionalRegistrations.get(id);
      if (!record) {
        return;
      }

      if (active) {
        if (!record.dispose) {
          record.dispose = registerWorkbenchView(record.entrypoint, context);
        }
        return;
      }

      record.dispose?.dispose();
      record.dispose = null;
    },
    dispose: () => {
      for (const record of conditionalRegistrations.values()) {
        record.dispose?.dispose();
      }
      disposables.dispose();
    },
  };
}

function registerWorkbenchView(
  entrypoint: WorkbenchViewEntrypoint,
  context: WorkbenchMountContext,
): IDisposable {
  const model = entrypoint.createModel(context);
  return registerCustomView({
    id: entrypoint.id,
    name: entrypoint.title,
    location: LOCATION_MAP[entrypoint.location],
    default: entrypoint.default,
    order: entrypoint.order,
    icon: entrypoint.icon,
    renderBody: (container) => mountWorkbenchSurface(container, entrypoint, model),
  });
}

function registerWorkbenchEditor(
  entrypoint: WorkbenchEditorEntrypoint,
  context: WorkbenchMountContext,
  disposables: DisposableStore,
): () => SimpleEditorInput {
  const model = entrypoint.createModel(context);

  class WorkbenchDiscoveredEditorInput extends SimpleEditorInput {
    readonly typeId = entrypoint.typeId;

    constructor() {
      super(entrypoint.resource as never);
      this.setName(entrypoint.inputName);
      this.setTitle(entrypoint.inputTitle);
      this.setDescription(entrypoint.inputDescription);
      this.addCapability(EditorInputCapabilities.Singleton);
    }
  }

  class WorkbenchDiscoveredEditorPane extends SimpleEditorPane {
    constructor(group: IEditorGroup) {
      super(entrypoint.typeId, group);
    }

    initialize(): HTMLElement {
      return document.createElement("div");
    }

    override focus(): void {
      const focus = (model.actions as { focus?: () => void }).focus;
      focus?.();
    }

    async renderInput(): Promise<IDisposable> {
      return mountWorkbenchSurface(this.container, entrypoint, model);
    }
  }

  disposables.add(
    registerEditorPane(entrypoint.typeId, entrypoint.title, WorkbenchDiscoveredEditorPane, [
      WorkbenchDiscoveredEditorInput,
    ]),
  );

  return () => new WorkbenchDiscoveredEditorInput();
}
