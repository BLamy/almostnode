import type { SurfaceModel } from "../framework/model";
import { defineWorkbenchView } from "../framework/types";
import {
  DATABASE_VIEW_ID,
  WORKBENCH_SURFACE_ICONS,
} from "../surface-constants";
import DatabaseSidebarView from "./components/database-sidebar-view";
import type {
  DatabaseSidebarActions,
  DatabaseSidebarState,
} from "../surface-model-types";

export default defineWorkbenchView({
  kind: "view",
  id: DATABASE_VIEW_ID,
  title: "Database",
  location: "sidebar",
  order: 1,
  icon: WORKBENCH_SURFACE_ICONS.database,
  activation: {
    kind: "conditional",
    initial: false,
  },
  component: DatabaseSidebarView,
  createModel: (context) =>
    context.surfaces.databaseSurface.model as SurfaceModel<
      DatabaseSidebarState,
      DatabaseSidebarActions
    >,
});
