import type { SurfaceModel } from "../framework/model";
import { defineWorkbenchView } from "../framework/types";
import {
  FILES_VIEW_ID,
  WORKBENCH_SURFACE_ICONS,
} from "../surface-constants";
import SlotSurfaceView from "./components/slot-surface-view";
import type {
  SlotSurfaceActions,
  SlotSurfaceState,
} from "../surface-model-types";

export default defineWorkbenchView({
  kind: "view",
  id: FILES_VIEW_ID,
  title: "Files",
  location: "sidebar",
  default: true,
  order: -1,
  icon: WORKBENCH_SURFACE_ICONS.files,
  hostClassName: "almostnode-files-tree-host",
  component: SlotSurfaceView,
  createModel: (context) =>
    context.surfaces.filesSurface.model as SurfaceModel<
      SlotSurfaceState,
      SlotSurfaceActions
    >,
});
