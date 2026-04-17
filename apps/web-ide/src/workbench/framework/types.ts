import type { ComponentType } from "react";
import type { SurfaceModel } from "./model";

export type WorkbenchActivation =
  | "eager"
  | {
      kind: "conditional";
      initial: boolean;
    };

export type WorkbenchViewLocation = "sidebar" | "panel" | "auxiliarybar";

export interface WorkbenchMountContext {
  surfaces: {
    filesSurface: { model: SurfaceModel<unknown, unknown> };
    openCodeSurface: { model: SurfaceModel<unknown, unknown> };
    previewSurface: { model: SurfaceModel<unknown, unknown> };
    appBuildingPreviewSurface: { model: SurfaceModel<unknown, unknown> };
    terminalSurface: { model: SurfaceModel<unknown, unknown> };
    databaseSurface: { model: SurfaceModel<unknown, unknown> };
    databaseBrowserSurface: { model: SurfaceModel<unknown, unknown> };
    keychainSurface: { model: SurfaceModel<unknown, unknown> };
    testsSurface: { model: SurfaceModel<unknown, unknown> };
  };
}

export interface WorkbenchSurfaceComponentProps<
  TState = unknown,
  TActions = unknown,
> {
  model: SurfaceModel<TState, TActions>;
}

interface WorkbenchEntrypointBase<TState, TActions> {
  id: string;
  title: string;
  activation?: WorkbenchActivation;
  hostClassName?: string;
  createModel(context: WorkbenchMountContext): SurfaceModel<TState, TActions>;
  component: ComponentType<WorkbenchSurfaceComponentProps<TState, TActions>>;
}

export interface WorkbenchViewEntrypoint<TState = unknown, TActions = unknown>
  extends WorkbenchEntrypointBase<TState, TActions> {
  kind: "view";
  location: WorkbenchViewLocation;
  icon?: string;
  order?: number;
  default?: boolean;
}

export interface WorkbenchEditorTitle {
  short: string;
  medium: string;
  long: string;
}

export interface WorkbenchEditorEntrypoint<
  TState = unknown,
  TActions = unknown,
> extends WorkbenchEntrypointBase<TState, TActions> {
  kind: "editor";
  typeId: string;
  resource: unknown;
  inputName: string;
  inputTitle: WorkbenchEditorTitle;
  inputDescription: string;
}

export type WorkbenchEntrypoint<TState = unknown, TActions = unknown> =
  | WorkbenchViewEntrypoint<TState, TActions>
  | WorkbenchEditorEntrypoint<TState, TActions>;

export function defineWorkbenchView<TState, TActions>(
  definition: WorkbenchViewEntrypoint<TState, TActions>,
): WorkbenchViewEntrypoint<TState, TActions> {
  return definition;
}

export function defineWorkbenchEditor<TState, TActions>(
  definition: WorkbenchEditorEntrypoint<TState, TActions>,
): WorkbenchEditorEntrypoint<TState, TActions> {
  return definition;
}
