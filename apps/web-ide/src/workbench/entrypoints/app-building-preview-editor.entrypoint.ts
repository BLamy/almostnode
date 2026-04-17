import type { SurfaceModel } from "../framework/model";
import { defineWorkbenchEditor } from "../framework/types";
import {
  APP_BUILDING_PREVIEW_EDITOR_RESOURCE,
  APP_BUILDING_PREVIEW_EDITOR_TYPE_ID,
} from "../surface-constants";
import SlotSurfaceView from "./components/slot-surface-view";
import type {
  SlotSurfaceActions,
  SlotSurfaceState,
} from "../surface-model-types";

export default defineWorkbenchEditor({
  kind: "editor",
  id: APP_BUILDING_PREVIEW_EDITOR_TYPE_ID,
  typeId: APP_BUILDING_PREVIEW_EDITOR_TYPE_ID,
  title: "App Building Preview",
  resource: APP_BUILDING_PREVIEW_EDITOR_RESOURCE,
  inputName: "App Building Preview",
  inputTitle: {
    short: "Preview",
    medium: "App Building Preview",
    long: "Almostnode App Building Preview",
  },
  inputDescription: "Live preview of the remote worker's dev server",
  hostClassName: "almostnode-preview-editor-host",
  component: SlotSurfaceView,
  createModel: (context) =>
    context.surfaces.appBuildingPreviewSurface.model as SurfaceModel<
      SlotSurfaceState,
      SlotSurfaceActions
    >,
});
