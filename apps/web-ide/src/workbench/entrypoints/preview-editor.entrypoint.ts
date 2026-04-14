import type { SurfaceModel } from "../framework/model";
import { defineWorkbenchEditor } from "../framework/types";
import {
  PREVIEW_EDITOR_RESOURCE,
  PREVIEW_EDITOR_TYPE_ID,
} from "../surface-constants";
import SlotSurfaceView from "./components/slot-surface-view";
import type {
  SlotSurfaceActions,
  SlotSurfaceState,
} from "../surface-model-types";

export default defineWorkbenchEditor({
  kind: "editor",
  id: PREVIEW_EDITOR_TYPE_ID,
  typeId: PREVIEW_EDITOR_TYPE_ID,
  title: "Preview",
  resource: PREVIEW_EDITOR_RESOURCE,
  inputName: "Preview",
  inputTitle: {
    short: "Preview",
    medium: "Preview",
    long: "Almostnode Preview",
  },
  inputDescription: "Live workspace preview",
  hostClassName: "almostnode-preview-editor-host",
  component: SlotSurfaceView,
  createModel: (context) =>
    context.surfaces.previewSurface.model as SurfaceModel<
      SlotSurfaceState,
      SlotSurfaceActions
    >,
});
