import type { SurfaceModel } from "../framework/model";
import { defineWorkbenchEditor } from "../framework/types";
import {
  CODESPACE_EDITOR_RESOURCE,
  CODESPACE_EDITOR_TYPE_ID,
} from "../surface-constants";
import SlotSurfaceView from "./components/slot-surface-view";
import type {
  SlotSurfaceActions,
  SlotSurfaceState,
} from "../surface-model-types";

export default defineWorkbenchEditor({
  kind: "editor",
  id: CODESPACE_EDITOR_TYPE_ID,
  typeId: CODESPACE_EDITOR_TYPE_ID,
  title: "Codespace",
  resource: CODESPACE_EDITOR_RESOURCE,
  inputName: "Codespace",
  inputTitle: {
    short: "Codespace",
    medium: "Codespace",
    long: "GitHub Codespace",
  },
  inputDescription: "Embedded GitHub Codespace editor",
  component: SlotSurfaceView,
  createModel: (context) =>
    context.surfaces.codespaceSurface.model as SurfaceModel<
      SlotSurfaceState,
      SlotSurfaceActions
    >,
});
