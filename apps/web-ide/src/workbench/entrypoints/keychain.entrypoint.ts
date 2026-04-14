import type { SurfaceModel } from "../framework/model";
import { defineWorkbenchView } from "../framework/types";
import {
  KEYCHAIN_VIEW_ID,
  WORKBENCH_SURFACE_ICONS,
} from "../surface-constants";
import KeychainSidebarView from "./components/keychain-sidebar-view";
import type {
  KeychainSidebarActions,
  KeychainSidebarState,
} from "../surface-model-types";

export default defineWorkbenchView({
  kind: "view",
  id: KEYCHAIN_VIEW_ID,
  title: "Keychain",
  location: "auxiliarybar",
  order: 2,
  icon: WORKBENCH_SURFACE_ICONS.keychain,
  component: KeychainSidebarView,
  createModel: (context) =>
    context.surfaces.keychainSurface.model as SurfaceModel<
      KeychainSidebarState,
      KeychainSidebarActions
    >,
});
