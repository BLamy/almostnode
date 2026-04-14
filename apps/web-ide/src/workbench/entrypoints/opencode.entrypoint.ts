import type { SurfaceModel } from "../framework/model";
import { defineWorkbenchView } from "../framework/types";
import {
  OPEN_CODE_VIEW_ID,
  WORKBENCH_SURFACE_ICONS,
} from "../surface-constants";
import SlotSurfaceView from "./components/slot-surface-view";
import type {
  SlotSurfaceActions,
  SlotSurfaceState,
} from "../surface-model-types";

export default defineWorkbenchView({
  kind: "view",
  id: OPEN_CODE_VIEW_ID,
  title: "OpenCode",
  location: "sidebar",
  order: 0,
  icon: WORKBENCH_SURFACE_ICONS.opencode,
  hostClassName: "almostnode-opencode-panel-host",
  component: SlotSurfaceView,
  createModel: (context) =>
    context.surfaces.openCodeSurface.model as SurfaceModel<
      SlotSurfaceState,
      SlotSurfaceActions
    >,
});
