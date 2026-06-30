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

const runtimeEntrypoints: WorkbenchEntrypoint[] = [];

export interface RegisteredWorkbenchEntrypoints {
  createEditorInput(id: string): SimpleEditorInput;
  viewIds: Record<string, string>;
  setActivation(id: string, active: boolean): void;
  registerPanel(entrypoint: WorkbenchViewEntrypoint): IDisposable;
  registerCustomEditor(entrypoint: WorkbenchEditorEntrypoint): IDisposable;
  dispose(): void;
}

export interface RegisterWorkbenchEntrypointsOptions {
  entrypoints?: WorkbenchEntrypoint[];
}

export function getWorkbenchEntrypoint(
  id: string,
): WorkbenchEntrypoint | undefined {
  return getAllWorkbenchEntrypoints().find((entrypoint) => entrypoint.id === id);
}

export function registerPanel(entrypoint: WorkbenchViewEntrypoint): IDisposable {
  runtimeEntrypoints.push(entrypoint);
  return {
    dispose: () => {
      const index = runtimeEntrypoints.indexOf(entrypoint);
      if (index >= 0) {
        runtimeEntrypoints.splice(index, 1);
      }
    },
  };
}

export function registerCustomEditor(entrypoint: WorkbenchEditorEntrypoint): IDisposable {
  runtimeEntrypoints.push(entrypoint);
  return {
    dispose: () => {
      const index = runtimeEntrypoints.indexOf(entrypoint);
      if (index >= 0) {
        runtimeEntrypoints.splice(index, 1);
      }
    },
  };
}

export function registerWorkbenchEntrypoints(
  context: WorkbenchMountContext,
  options: RegisterWorkbenchEntrypointsOptions = {},
): RegisteredWorkbenchEntrypoints {
  const entrypoints = getAllWorkbenchEntrypoints(options.entrypoints);
  validateWorkbenchEntrypoints(entrypoints);

  const disposables = new DisposableStore();
  const conditionalRegistrations = new Map<string, ConditionalRegistration>();
  const editorInputFactories: Record<string, () => SimpleEditorInput> = {};
  const viewIds: Record<string, string> = {};

  const registerEntrypoint = (
    entrypoint: WorkbenchEntrypoint,
    targetDisposables: DisposableStore = disposables,
  ): IDisposable => {
    if (entrypoint.kind === "editor") {
      const editorRegistrationDisposables = targetDisposables === disposables
        ? disposables
        : new DisposableStore();
      const createInput = registerWorkbenchEditor(entrypoint, context, editorRegistrationDisposables);
      editorInputFactories[entrypoint.id] = createInput;
      if (targetDisposables !== disposables) {
        const dynamicDisposable = {
          dispose: () => {
            delete editorInputFactories[entrypoint.id];
            editorRegistrationDisposables.dispose();
          },
        };
        targetDisposables.add(dynamicDisposable);
        return dynamicDisposable;
      }
      return {
        dispose: () => {
          delete editorInputFactories[entrypoint.id];
        },
      };
    }

    viewIds[entrypoint.id] = entrypoint.id;
    const activation = entrypoint.activation ?? "eager";
    if (activation === "eager") {
      const viewDisposable = registerWorkbenchView(entrypoint, context);
      const disposable = {
        dispose: () => {
          delete viewIds[entrypoint.id];
          viewDisposable.dispose();
        },
      };
      targetDisposables.add(disposable);
      return disposable;
    }

    const initial = activation.initial === true;
    conditionalRegistrations.set(entrypoint.id, {
      entrypoint,
      dispose: initial ? registerWorkbenchView(entrypoint, context) : null,
    });
    const disposable = {
      dispose: () => {
        const record = conditionalRegistrations.get(entrypoint.id);
        record?.dispose?.dispose();
        conditionalRegistrations.delete(entrypoint.id);
        delete viewIds[entrypoint.id];
      },
    };
    targetDisposables.add(disposable);
    return disposable;
  };

  for (const entrypoint of entrypoints) {
    registerEntrypoint(entrypoint);
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
    registerPanel(entrypoint: WorkbenchViewEntrypoint): IDisposable {
      validateWorkbenchEntrypoints([entrypoint]);
      const dynamicDisposables = new DisposableStore();
      registerEntrypoint(entrypoint, dynamicDisposables);
      return {
        dispose: () => {
          dynamicDisposables.dispose();
        },
      };
    },
    registerCustomEditor(entrypoint: WorkbenchEditorEntrypoint): IDisposable {
      validateWorkbenchEntrypoints([entrypoint]);
      const dynamicDisposables = new DisposableStore();
      registerEntrypoint(entrypoint, dynamicDisposables);
      return {
        dispose: () => {
          dynamicDisposables.dispose();
        },
      };
    },
    dispose: () => {
      for (const record of conditionalRegistrations.values()) {
        record.dispose?.dispose();
      }
      disposables.dispose();
    },
  };
}

function getAllWorkbenchEntrypoints(
  extraEntrypoints: WorkbenchEntrypoint[] = [],
): WorkbenchEntrypoint[] {
  return [
    ...discoveredEntrypoints,
    ...runtimeEntrypoints,
    ...extraEntrypoints,
  ];
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
