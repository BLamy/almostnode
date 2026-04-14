import type { SurfaceModel } from "../framework/model";
import { defineWorkbenchView } from "../framework/types";
import {
  TESTS_VIEW_ID,
  WORKBENCH_SURFACE_ICONS,
} from "../surface-constants";
import TestsSidebarView from "./components/tests-sidebar-view";
import type {
  TestsSidebarActions,
  TestsSidebarState,
} from "../surface-model-types";

export default defineWorkbenchView({
  kind: "view",
  id: TESTS_VIEW_ID,
  title: "Tests",
  location: "sidebar",
  order: 2,
  icon: WORKBENCH_SURFACE_ICONS.tests,
  component: TestsSidebarView,
  createModel: (context) =>
    context.surfaces.testsSurface.model as SurfaceModel<
      TestsSidebarState,
      TestsSidebarActions
    >,
});
