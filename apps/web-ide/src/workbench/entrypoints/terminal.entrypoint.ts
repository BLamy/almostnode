import type { SurfaceModel } from "../framework/model";
import { defineWorkbenchView } from "../framework/types";
import { TERMINAL_VIEW_ID } from "../surface-constants";
import SlotSurfaceView from "./components/slot-surface-view";
import type {
  SlotSurfaceActions,
  SlotSurfaceState,
} from "../surface-model-types";

export default defineWorkbenchView({
  kind: "view",
  id: TERMINAL_VIEW_ID,
  title: "Terminal",
  location: "panel",
  hostClassName: "almostnode-terminal-panel-host",
  component: SlotSurfaceView,
  createModel: (context) =>
    context.surfaces.terminalSurface.model as SurfaceModel<
      SlotSurfaceState,
      SlotSurfaceActions
    >,
});
