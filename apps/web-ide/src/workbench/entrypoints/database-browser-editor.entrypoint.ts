import type { SurfaceModel } from "../framework/model";
import { defineWorkbenchEditor } from "../framework/types";
import {
  DATABASE_EDITOR_RESOURCE,
  DATABASE_EDITOR_TYPE_ID,
} from "../surface-constants";
import SlotSurfaceView from "./components/slot-surface-view";
import type {
  SlotSurfaceActions,
  SlotSurfaceState,
} from "../surface-model-types";

export default defineWorkbenchEditor({
  kind: "editor",
  id: DATABASE_EDITOR_TYPE_ID,
  typeId: DATABASE_EDITOR_TYPE_ID,
  title: "Database",
  resource: DATABASE_EDITOR_RESOURCE,
  inputName: "Database",
  inputTitle: {
    short: "Database",
    medium: "Database Browser",
    long: "Database Browser",
  },
  inputDescription: "Browse and query PGlite databases",
  component: SlotSurfaceView,
  createModel: (context) =>
    context.surfaces.databaseBrowserSurface.model as SurfaceModel<
      SlotSurfaceState,
      SlotSurfaceActions
    >,
});
